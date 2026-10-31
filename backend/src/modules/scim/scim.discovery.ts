import { env } from '../../common/config/env';
import { GROUP_SCHEMA, SCIM_LIST_SCHEMA, USER_SCHEMA } from './scim.errors';

/** RFC 7643 discovery: what this SCIM server supports. */

export const serviceProviderConfig = () => ({
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
  documentationUri: 'https://openpoll.app/docs/scim',
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: 200 },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [
    { type: 'oauthbearertoken', name: 'Bearer token', description: 'A SCIM token from Settings, SCIM provisioning', primary: true },
  ],
  meta: { resourceType: 'ServiceProviderConfig', location: `${env.apiPublicUrl}/scim/v2/ServiceProviderConfig` },
});

const resourceType = (name: 'User' | 'Group', schema: string) => ({
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
  id: name,
  name,
  endpoint: `/${name}s`,
  schema,
  meta: { resourceType: 'ResourceType', location: `${env.apiPublicUrl}/scim/v2/ResourceTypes/${name}` },
});

export const resourceTypes = () => ({
  schemas: [SCIM_LIST_SCHEMA],
  totalResults: 2,
  Resources: [resourceType('User', USER_SCHEMA), resourceType('Group', GROUP_SCHEMA)],
});

const attribute = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  type: 'string',
  multiValued: false,
  required: false,
  caseExact: false,
  mutability: 'readWrite',
  returned: 'default',
  uniqueness: 'none',
  ...extra,
});

export const schemas = () => ({
  schemas: [SCIM_LIST_SCHEMA],
  totalResults: 2,
  Resources: [
    {
      id: USER_SCHEMA,
      name: 'User',
      attributes: [
        attribute('userName', { required: true, uniqueness: 'server' }),
        attribute('name', { type: 'complex', subAttributes: [attribute('formatted'), attribute('givenName'), attribute('familyName')] }),
        attribute('displayName'),
        attribute('emails', { type: 'complex', multiValued: true, subAttributes: [attribute('value'), attribute('type'), attribute('primary', { type: 'boolean' })] }),
        attribute('active', { type: 'boolean' }),
        attribute('externalId', { caseExact: true }),
        attribute('groups', { type: 'complex', multiValued: true, mutability: 'readOnly' }),
      ],
      meta: { resourceType: 'Schema', location: `${env.apiPublicUrl}/scim/v2/Schemas/${USER_SCHEMA}` },
    },
    {
      id: GROUP_SCHEMA,
      name: 'Group',
      attributes: [
        attribute('displayName', { required: true }),
        attribute('externalId', { caseExact: true }),
        attribute('members', { type: 'complex', multiValued: true, subAttributes: [attribute('value'), attribute('display')] }),
      ],
      meta: { resourceType: 'Schema', location: `${env.apiPublicUrl}/scim/v2/Schemas/${GROUP_SCHEMA}` },
    },
  ],
});
