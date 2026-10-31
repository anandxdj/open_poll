import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { audit } from '../../common/audit/audit';
import { env } from '../../common/config/env';
import { redisClient } from '../../common/config/redis';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { normalizeDomain } from '../../common/utils/dnsVerify';
import { loginErrorUrl, redirectWithExchangeCode } from '../auth/auth.controller';
import { finishOidcLogin, startOidcLogin } from './oidc';
import { connectionForEmail } from './requireSso';
import { claimAssertion, identityFromProfile, samlFor } from './saml';
import { SsoAdminService } from './sso.admin.service';
import { assertDomainVerified, completeSsoLogin, SsoLoginError, type SsoIdentity } from './sso.login';
import type { CreateConnectionInput, UpdateConnectionInput } from './sso.schema';
import { ssoUrls } from './sso.urls';
import { WorkspaceModel } from '../workspaces/workspace.model';
import { SsoConnectionModel, type ISsoConnection } from './ssoConnection.model';

/** A sign-in in progress, between the redirect to the IdP and its answer. */
interface Flow {
  connectionId: string;
  mode: 'login' | 'test';
  codeVerifier?: string;
  nonce?: string;
}

const FLOW_TTL_SEC = 10 * 60;
const flowKey = (id: string) => `sso:flow:${id}`;
export const SSO_STATE_COOKIE = 'sso_state';

const stateCookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'lax' as const,
  path: '/api/sso',
  maxAge: FLOW_TTL_SEC * 1000,
};

const saveFlow = (id: string, flow: Flow) => redisClient.set(flowKey(id), JSON.stringify(flow), { EX: FLOW_TTL_SEC });

const takeFlow = async (id: unknown): Promise<Flow | null> => {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(id)) return null;
  const raw = await redisClient.getDel(flowKey(id));
  return raw ? (JSON.parse(raw) as Flow) : null;
};

const safeEqual = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const loadConnection = async (id: unknown): Promise<ISsoConnection | null> =>
  typeof id === 'string' && Types.ObjectId.isValid(id) ? SsoConnectionModel.findById(id) : null;

const logFailure = (step: string, error: unknown) =>
  console.error(`[SSO] ${step} failed:`, (error as { code?: string; message?: string })?.code ?? (error as Error)?.message ?? 'unknown error');

/** Ends a sign-in: a test records what the IdP sent; a real one signs the person in. */
async function finish(res: Response, connection: ISsoConnection, identity: SsoIdentity, mode: Flow['mode']) {
  const settings = `${env.FRONTEND_URL}/settings/sso?connection=${connection._id}`;
  if (mode === 'test') {
    try {
      assertDomainVerified(connection, identity.email);
    } catch {
      return res.redirect(`${settings}&test=domain`);
    }
    connection.lastTest = { at: new Date(), email: identity.email, name: identity.name, groups: identity.groups };
    await connection.save();
    const workspace = await WorkspaceModel.findById(connection.workspaceId).lean();
    void audit({ actorType: 'system', workspace }, 'sso.test', { type: 'sso_connection', id: connection._id }, { email: identity.email });
    return res.redirect(`${settings}&test=success`);
  }
  const { accessToken, refreshToken } = await completeSsoLogin(connection, identity);
  return redirectWithExchangeCode(res, accessToken, refreshToken);
}

const failTo = (res: Response, step: string, error: unknown) => {
  if (error instanceof SsoLoginError) return res.redirect(loginErrorUrl(error.code));
  logFailure(step, error);
  return res.redirect(loginErrorUrl('sso_failed'));
};

export const SsoController = {
  /** `?email=` → the connection that signs this address in, or 404 SSO_NOT_FOUND. */
  async discover(req: Request, res: Response, next: NextFunction) {
    try {
      const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
      const domain = normalizeDomain(email.split('@')[1] ?? '');
      if (!domain || !env.capabilities.samlSso) throw new ApiError(404, 'No single sign-on for this email', 'SSO_NOT_FOUND');
      const connection = await connectionForEmail(email);
      if (!connection) throw new ApiError(404, 'No single sign-on for this email', 'SSO_NOT_FOUND');
      ApiResponse.ok(res, 'Single sign-on found', {
        connectionId: String(connection._id),
        name: connection.name,
        type: connection.type,
        loginUrl: ssoUrls(String(connection._id)).loginUrl,
      });
    } catch (error) {
      next(error);
    }
  },

  /** Starts a sign-in (or an admin's `?test=<token>` run) at the connection's IdP. */
  async login(req: Request, res: Response) {
    try {
      if (!env.capabilities.samlSso) return res.redirect(loginErrorUrl('sso_disabled'));
      const connection = await loadConnection(req.params.connectionId);
      if (!connection) return res.redirect(loginErrorUrl('sso_failed'));
      const testToken = typeof req.query.test === 'string' ? req.query.test : '';
      const testFor = testToken ? await redisClient.getDel(`sso:test:${testToken}`) : null;
      const mode: Flow['mode'] = testFor === String(connection._id) ? 'test' : 'login';
      if (mode === 'login' && !connection.enabled) return res.redirect(loginErrorUrl('sso_disabled'));
      const loginHint = typeof req.query.email === 'string' ? req.query.email.slice(0, 254) : undefined;

      if (connection.type === 'saml') {
        const flowId = randomBytes(24).toString('base64url');
        await saveFlow(flowId, { connectionId: String(connection._id), mode });
        return res.redirect(await samlFor(connection).getAuthorizeUrlAsync(flowId, undefined, {}));
      }
      const start = await startOidcLogin(connection, loginHint);
      await saveFlow(start.state, { connectionId: String(connection._id), mode, codeVerifier: start.codeVerifier, nonce: start.nonce });
      res.cookie(SSO_STATE_COOKIE, start.state, stateCookieOptions);
      return res.redirect(start.url.toString());
    } catch (error) {
      return failTo(res, 'login', error);
    }
  },

  /** The IdP's POST: a signed SAML response for a request we issued (InResponseTo is required). */
  async acs(req: Request, res: Response) {
    try {
      const connection = await loadConnection(req.params.connectionId);
      if (!connection || connection.type !== 'saml' || !connection.saml) return res.redirect(loginErrorUrl('sso_failed'));
      const flow = await takeFlow(req.body?.RelayState);
      if (!flow || flow.connectionId !== String(connection._id)) return res.redirect(loginErrorUrl('sso_expired'));
      const { profile } = await samlFor(connection).validatePostResponseAsync({ SAMLResponse: String(req.body?.SAMLResponse ?? '') });
      if (!profile || !(await claimAssertion(String(connection._id), profile))) return res.redirect(loginErrorUrl('sso_failed'));
      return await finish(res, connection, identityFromProfile(profile, connection.saml.attributeMapping), flow.mode);
    } catch (error) {
      return failTo(res, 'SAML response', error);
    }
  },

  /** The OIDC redirect back: state bound to this browser, code exchanged with PKCE. */
  async oidcCallback(req: Request, res: Response) {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const cookieState = req.cookies?.[SSO_STATE_COOKIE];
    res.clearCookie(SSO_STATE_COOKIE, stateCookieOptions);
    try {
      const connection = await loadConnection(req.params.connectionId);
      if (!connection || connection.type !== 'oidc') return res.redirect(loginErrorUrl('sso_failed'));
      if (!state || !safeEqual(state, cookieState)) return res.redirect(loginErrorUrl('sso_expired'));
      const flow = await takeFlow(state);
      if (!flow || flow.connectionId !== String(connection._id) || !flow.codeVerifier || !flow.nonce) {
        return res.redirect(loginErrorUrl('sso_expired'));
      }
      const callbackUrl = new URL(ssoUrls(String(connection._id)).oidcRedirectUri);
      for (const [key, value] of Object.entries(req.query)) if (typeof value === 'string') callbackUrl.searchParams.set(key, value);
      const identity = await finishOidcLogin(connection, callbackUrl, { state, codeVerifier: flow.codeVerifier, nonce: flow.nonce });
      return await finish(res, connection, identity, flow.mode);
    } catch (error) {
      return failTo(res, 'OIDC callback', error);
    }
  },

  /** SP metadata for the IdP admin (entity id, ACS). */
  async metadata(req: Request, res: Response, next: NextFunction) {
    try {
      const connection = await loadConnection(req.params.connectionId);
      if (!connection || connection.type !== 'saml' || !connection.saml) throw ApiError.notFound('Not a SAML connection');
      res.type('application/samlmetadata+xml').send(samlFor(connection).generateServiceProviderMetadata(null));
    } catch (error) {
      next(error);
    }
  },
};

type Ctx = Parameters<typeof SsoAdminService.list>[0];
const handle =
  (fn: (req: Ctx, res: Response) => Promise<unknown>) => async (req: WorkspaceRequest, res: Response, next: NextFunction) => {
    try {
      await fn(req as Ctx, res);
    } catch (error) {
      next(error);
    }
  };
const id = (req: Request) => String(req.params.connectionId ?? '');

/** `/api/workspaces/:workspaceId/sso` (pathWorkspaceContext ran). */
export const SsoAdminController = {
  list: handle(async (req, res) => ApiResponse.ok(res, 'Single sign-on fetched', await SsoAdminService.list(req))),
  create: handle(async (req, res) =>
    ApiResponse.created(res, 'Connection created', await SsoAdminService.create(req, req.body as CreateConnectionInput))
  ),
  update: handle(async (req, res) =>
    ApiResponse.ok(res, 'Connection saved', await SsoAdminService.update(req, id(req), req.body as UpdateConnectionInput))
  ),
  remove: handle(async (req, res) => ApiResponse.ok(res, 'Connection deleted', await SsoAdminService.remove(req, id(req)))),
  metadata: handle(async (req, res) =>
    ApiResponse.ok(res, 'Metadata imported', await SsoAdminService.importMetadata(req, id(req), String(req.body.xml)))
  ),
  addDomain: handle(async (req, res) =>
    ApiResponse.ok(res, 'Domain added', await SsoAdminService.addDomain(req, id(req), String(req.body.domain)))
  ),
  verifyDomain: handle(async (req, res) =>
    ApiResponse.ok(res, 'Domain verified', await SsoAdminService.verifyDomain(req, id(req), String(req.params.domain)))
  ),
  removeDomain: handle(async (req, res) =>
    ApiResponse.ok(res, 'Domain removed', await SsoAdminService.removeDomain(req, id(req), String(req.params.domain)))
  ),
  test: handle(async (req, res) => ApiResponse.ok(res, 'Test sign-in ready', await SsoAdminService.startTest(req, id(req)))),
};
