import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { embedPolicyQuery, listScreenTokensQuery, oembedQuery, type CreateScreenTokenInput } from './embeds.schema';
import { getEmbedPolicy, getOEmbed } from './policy.service';
import { createScreenToken, listScreenTokens, revokeScreenToken } from './screenTokens.service';
import { getScreenStateByToken } from './stage.service';

/** Header a screen sends its token in, so it stays out of URLs and access logs. */
export const SCREEN_TOKEN_HEADER = 'x-screen-token';

const parseQuery = <T>(schema: ZodType<T>, req: Request): T => {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    throw ApiError.badRequest(parsed.error.issues.map((issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`).join('; '));
  }
  return parsed.data;
};

const handle =
  <R extends Request>(fn: (req: R, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req as R, res);
    } catch (error) {
      next(error);
    }
  };

export const EmbedsController = {
  listScreenTokens: handle<WorkspaceRequest>(async (req, res) => {
    const { presentationId } = parseQuery(listScreenTokensQuery, req);
    ApiResponse.ok(res, 'Screen links fetched', await listScreenTokens(req, presentationId));
  }),

  createScreenToken: handle<WorkspaceRequest>(async (req, res) => {
    ApiResponse.created(res, 'Screen link created', await createScreenToken(req, req.body as CreateScreenTokenInput));
  }),

  revokeScreenToken: handle<WorkspaceRequest>(async (req, res) => {
    ApiResponse.ok(res, 'Screen link turned off', await revokeScreenToken(req, String(req.params.id ?? '')));
  }),

  stage: handle(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    ApiResponse.ok(res, 'Stage fetched', await getScreenStateByToken(req.get(SCREEN_TOKEN_HEADER)));
  }),

  policy: handle(async (req, res) => {
    const { kind, id, token } = parseQuery(embedPolicyQuery, req);
    res.setHeader('Cache-Control', 'no-store');
    ApiResponse.ok(res, 'Embed policy', await getEmbedPolicy({ kind, id, token: token ?? null }));
  }),

  /** oEmbed answers the bare JSON document the spec describes, not the API envelope. */
  oembed: handle(async (req, res) => {
    const query = parseQuery(oembedQuery, req);
    if (query.format && query.format !== 'json') {
      throw new ApiError(501, 'Only format=json is supported', 'OEMBED_FORMAT_NOT_SUPPORTED');
    }
    const response = await getOEmbed({ url: query.url, maxwidth: query.maxwidth, maxheight: query.maxheight });
    res.setHeader('Cache-Control', `public, max-age=${response.cache_age}`);
    res.status(200).json(response);
  }),
};
