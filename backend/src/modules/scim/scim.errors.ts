import type { Response } from 'express';

export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';

export type ScimType = 'invalidFilter' | 'uniqueness' | 'invalidValue' | 'invalidSyntax' | 'noTarget' | 'mutability' | 'tooMany';

/** An error in the SCIM wire format (RFC 7644 §3.12). */
export class ScimError extends Error {
  constructor(public readonly status: number, detail: string, public readonly scimType?: ScimType) {
    super(detail);
    this.name = 'ScimError';
  }
}

export const sendScim = (res: Response, status: number, body: unknown) =>
  res.status(status).type('application/scim+json').send(JSON.stringify(body));

export const sendScimError = (res: Response, error: ScimError) =>
  sendScim(res, error.status, {
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(error.status),
    detail: error.message,
    ...(error.scimType ? { scimType: error.scimType } : {}),
  });
