/** Values baked into response.xml by generate.ts; tests configure the SP with the same ones. */
export const SAML_FIXTURE = {
  idpEntityId: 'https://idp.openpoll.test/metadata',
  spEntityId: 'https://openpoll.test/api/sso/saml/fixture/metadata',
  acsUrl: 'https://openpoll.test/api/sso/saml/fixture/acs',
  nameId: 'ada@example.com',
  displayName: 'Ada Lovelace',
  groups: ['Engineering', 'Admins'],
  issueInstant: '2026-01-01T00:00:00.000Z',
  notBefore: '2026-01-01T00:00:00.000Z',
  notOnOrAfter: '2099-12-31T23:59:59.000Z',
} as const;
