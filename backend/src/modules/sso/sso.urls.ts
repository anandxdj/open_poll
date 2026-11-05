import { env } from '../../common/config/env';

/**
 * The service provider's URLs for one connection, from API_PUBLIC_URL (never
 * request headers): admins copy them into their IdP, which pins them.
 */
export const ssoUrls = (connectionId: string) => {
  const base = `${env.apiPublicUrl}/api/sso`;
  return {
    /** SAML SP entity id; also where the SP metadata is served. */
    spEntityId: `${base}/saml/${connectionId}/metadata`,
    acsUrl: `${base}/saml/${connectionId}/acs`,
    metadataUrl: `${base}/saml/${connectionId}/metadata`,
    oidcRedirectUri: `${base}/oidc/${connectionId}/callback`,
    loginUrl: `${base}/${connectionId}/login`,
  };
};
