import { env } from './env';

// Email layout in the product's Graph paper colours: paper around a white
// sheet, ink text, one ember button. Tables and inline styles only, so it
// renders the same in every mail client.
export const BRAND = { paper: '#f6f6f3', sheet: '#ffffff', ink: '#171717', graphite: '#5c5a55', rule: '#e2e0d9', ember: '#cf460c', emberInk: '#b93d0b' };
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const emailLayout = ({ heading, body, button, footer }: { heading: string; body: string; button?: { href: string; label: string }; footer: string }) => `
<!doctype html>
<html lang="en">
  <body style="margin: 0; padding: 0; background: ${BRAND.paper};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: ${BRAND.paper}; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; font-family: ${FONT}; color: ${BRAND.ink};">
            <tr>
              <td style="padding: 0 4px 16px; font-size: 16px; font-weight: 600; letter-spacing: -0.01em;">
                <img src="${env.FRONTEND_URL}/logo-openpoll.png" width="22" height="22" alt="" style="vertical-align: -5px; border: 0;">&nbsp;Open Poll
              </td>
            </tr>
            <tr>
              <td style="background: ${BRAND.sheet}; border: 1px solid ${BRAND.rule}; border-radius: 12px; padding: 32px;">
                <h1 style="margin: 0 0 12px; font-size: 24px; line-height: 1.25; font-weight: 600; letter-spacing: -0.02em; color: ${BRAND.ink};">${heading}</h1>
                <div style="font-size: 16px; line-height: 1.6; color: ${BRAND.graphite};">${body}</div>
                ${
                  button
                    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 28px 0 8px;"><tr><td style="border-radius: 8px; background: ${BRAND.ember};"><a href="${button.href}" style="display: inline-block; padding: 12px 22px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">${button.label}</a></td></tr></table>`
                    : ''
                }
              </td>
            </tr>
            <tr>
              <td style="padding: 16px 4px 0; font-size: 13px; line-height: 1.5; color: ${BRAND.graphite};">${footer}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

/** A link spelled out under the button, for clients that block buttons. */
export const linkLine = (url: string) =>
  `<p style="margin: 16px 0 0; font-size: 13px; color: ${BRAND.graphite};">Or open this link:<br><a href="${url}" style="color: ${BRAND.emberInk}; word-break: break-all;">${url}</a></p>`;
