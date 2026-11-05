import { strToU8, zipSync, type Zippable } from 'fflate';
import { Types } from 'mongoose';
import { AuditEventModel } from '../audit/audit.model';
import { UserModel } from '../auth/auth.model';
import { ImportJobModel } from '../imports/import.model';
import { McpTokenModel } from '../mcp/mcp.token.model';
import { McpGrantModel } from '../mcp/oauth/oauth.grant.model';
import { PollModel } from '../polls/polls.model';
import { PresentationModel, PresentationSessionModel } from '../presentations/presentations.model';
import { ResponseModel } from '../responses/responses.model';
import { MediaAssetModel } from '../uploads/media.model';
import { WorkspaceModel } from '../workspaces/workspace.model';
import { WorkspaceMemberModel } from '../workspaces/workspaceMember.model';
import { DataExportJobModel } from './privacy.model';

/** Most rows one file holds; README.txt says when a file was cut. */
export const EXPORT_MAX_ROWS = 10_000;

export interface UserExport {
  /** The zip archive. */
  bytes: Uint8Array;
  /** Rows per file, for the record and the tests. */
  counts: Record<string, number>;
  /** Files that hit EXPORT_MAX_ROWS. */
  truncated: string[];
}

const json = (value: unknown) => strToU8(`${JSON.stringify(value, null, 2)}\n`);

/** Drops Mongoose's version key; ObjectIds and dates serialize as strings. */
const plain = <T extends object>(doc: T) => {
  const { __v: _version, ...rest } = doc as T & { __v?: unknown };
  return rest;
};

const README = (exportedAt: string, counts: Record<string, number>, truncated: string[]) => `Open Poll data export
=====================

Exported ${exportedAt} (UTC). Every file is JSON.

profile.json            your account: name, email, sign-in methods, settings
workspaces.json         the workspaces you belong to and your role in each
polls.json              polls you created, with their questions
presentations.json      decks you created, with their slides
sessions-hosted.json    live sessions you ran: when, how many joined, how many answers
poll-responses.json     answers you sent to polls while signed in
uploads.json            files you uploaded (name, type, size, link)
imports.json            slide and question imports you started
mcp-tokens.json         AI assistant (MCP) tokens you created (never the secret)
mcp-connected-apps.json Apps you connected through sign-in (OAuth), never their tokens
activity.json           what you did that the audit log records, newest first
exports.json            earlier exports of your data

Rows: ${Object.entries(counts)
  .map(([file, n]) => `${file} ${n}`)
  .join(', ')}.
${truncated.length ? `\nThese files hold only the newest ${EXPORT_MAX_ROWS} rows: ${truncated.join(', ')}.\n` : ''}
Not included: answers people gave to your polls and sessions (they belong to
those participants and stay in your workspace's reports and exports), and other
members' content in shared workspaces.
`;

/**
 * Everything Open Poll stores about one user, as a zip of JSON files. Content
 * comes from the workspaces the user still belongs to (plus anything created
 * before workspaces existed). Secrets (password hash, token hashes, refresh
 * tokens) are never included.
 */
export async function buildUserExport(userId: string, now = new Date()): Promise<UserExport> {
  const uid = new Types.ObjectId(userId);
  const user = await UserModel.findById(uid).select('+password').lean();
  if (!user) throw new Error('User not found');

  const memberships = await WorkspaceMemberModel.find({ userId: uid }).lean();
  const workspaces = await WorkspaceModel.find({ _id: { $in: memberships.map((m) => m.workspaceId) } })
    .select('name type plan createdAt deletedAt')
    .lean();
  const activeIds = memberships.filter((m) => m.status === 'active').map((m) => m.workspaceId);
  // Content the user created, in workspaces they still belong to (or from before workspaces).
  const ownContent = { creatorId: userId, $or: [{ workspaceId: { $in: activeIds } }, { workspaceId: null }] };

  const truncated: string[] = [];
  const capped = <T>(file: string, rows: T[]) => {
    if (rows.length > EXPORT_MAX_ROWS) {
      truncated.push(file);
      return rows.slice(0, EXPORT_MAX_ROWS);
    }
    return rows;
  };
  const limit = EXPORT_MAX_ROWS + 1;

  const [polls, presentations, sessions, responses, uploads, imports, mcpTokens, mcpGrants, activity, exports] = await Promise.all([
    PollModel.find(ownContent).sort({ createdAt: -1 }).limit(limit).lean(),
    PresentationModel.find(ownContent).sort({ createdAt: -1 }).limit(limit).lean(),
    PresentationSessionModel.find({ hostUserId: userId })
      .sort({ startedAt: -1 })
      .limit(limit)
      .select('presentationId workspaceId runNumber pace status startedAt endedAt participantCount answerCount retainUntil')
      .lean(),
    ResponseModel.find({ respondentId: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('pollId answers attemptNumber score maxScore percentage passed createdAt')
      .lean(),
    MediaAssetModel.find({ uploaderId: uid }).sort({ createdAt: -1 }).limit(limit).lean(),
    ImportJobModel.find({ userId: uid })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('workspaceId kind status title resultPresentationId warnings createdAt updatedAt')
      .lean(),
    McpTokenModel.find({ userId: uid }).select('label prefix last4 scopes lastUsedAt expiresAt createdAt').lean(),
    McpGrantModel.find({ userId: uid }).select('clientName workspaceId scopes lastUsedAt createdAt').lean(),
    AuditEventModel.find({ actorId: uid })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('workspaceId action targetType targetId ip ua meta createdAt')
      .lean(),
    DataExportJobModel.find({ userId: uid }).sort({ createdAt: -1 }).select('status bytes createdAt').lean(),
  ]);

  const roleIn = new Map(memberships.map((m) => [String(m.workspaceId), m]));
  const files = {
    'profile.json': {
      id: String(user._id),
      email: user.email,
      name: user.name,
      picture: user.picture ?? null,
      locale: user.locale ?? null,
      emailVerified: user.isVerified,
      hasPassword: Boolean(user.password),
      signInMethods: (user.identities ?? []).map((identity) => ({
        provider: identity.provider,
        connectionId: identity.connectionId ? String(identity.connectionId) : null,
      })),
      defaultWorkspaceId: user.defaultWorkspaceId ? String(user.defaultWorkspaceId) : null,
      createdAt: (user as { createdAt?: Date }).createdAt ?? null,
      lastLogin: user.lastLogin ?? null,
    },
    'workspaces.json': workspaces.map((w) => ({
      id: String(w._id),
      name: w.name,
      type: w.type,
      plan: w.plan,
      role: roleIn.get(String(w._id))?.role ?? null,
      status: roleIn.get(String(w._id))?.status ?? null,
      joinedAt: roleIn.get(String(w._id))?.createdAt ?? null,
      deleted: Boolean(w.deletedAt),
    })),
    'polls.json': capped('polls.json', polls.map(plain)),
    'presentations.json': capped('presentations.json', presentations.map(plain)),
    'sessions-hosted.json': capped('sessions-hosted.json', sessions.map(plain)),
    'poll-responses.json': capped('poll-responses.json', responses.map(plain)),
    'uploads.json': capped('uploads.json', uploads.map(plain)),
    'imports.json': capped('imports.json', imports.map(plain)),
    'mcp-tokens.json': mcpTokens.map(plain),
    'mcp-connected-apps.json': mcpGrants.map(plain),
    'activity.json': capped('activity.json', activity.map(plain)),
    'exports.json': exports.map(plain),
  } satisfies Record<string, unknown>;

  const counts = Object.fromEntries(
    Object.entries(files).map(([file, rows]) => [file, Array.isArray(rows) ? rows.length : 1])
  );
  const archive: Zippable = { 'README.txt': strToU8(README(now.toISOString(), counts, truncated)) };
  for (const [file, rows] of Object.entries(files)) archive[file] = json(rows);

  return { bytes: zipSync(archive, { level: 6, mtime: now }), counts, truncated };
}
