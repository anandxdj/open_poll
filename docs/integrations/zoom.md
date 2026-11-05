# Open Poll for Zoom (W4-D)

A Zoom App that shows your deck's live stage inside the Zoom client; share the app's screen so
everyone sees it, while attendees answer on their phones with the join code on the stage. Page:
`https://<site>/addins/zoom`. There is no manifest file: the app is configured in the Zoom App
Marketplace (`addins/zoom/README.md`).

## Create the app

1. Zoom App Marketplace → Develop → **Build App** → General App (user-managed).
2. **Basic information:** name "Open Poll", your icons (the colour icon in `addins/teams/icons/` will
   do to start).
3. **Features → Zoom App:** Home URL `https://<site>/addins/zoom`. Domain allow list: `<site>` and the API
   host (`NEXT_PUBLIC_API_URL`, also used for the live socket).
4. No Zoom App SDK APIs or OAuth scopes are needed.
5. Add the app to your account (Local test → Add app now), then in a meeting: **Apps** → Open Poll.

Zoom refuses Home URLs that do not send its OWASP security headers. The app sends them on
`/addins/zoom` (`frontend/lib/security/headers.ts`, `ZOOM_HEADERS`):

| Header | Value |
| --- | --- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `Content-Security-Policy` | the app's baseline directives, `frame-ancestors 'self' https://*.zoom.us https://*.zoom.com` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

HSTS only takes effect over https: Zoom requires https anyway.

## Use

1. In Open Poll: the deck's menu → **Embed…** → **Allow embedding** → **Create screen link** → copy.
2. In Zoom: open Open Poll from **Apps**, paste the link, **Show the stage**. The link is remembered in
   the app on this computer; **Change screen link** picks another.
3. Share the app's screen (Share → the Open Poll app window) and run the session from the host console.

## Notes

- Not tested inside Zoom in CI: `frontend/e2e/addins.spec.ts` checks the headers and drives the page in a
  browser.
