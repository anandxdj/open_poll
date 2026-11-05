# Open Poll for Zoom (Zoom App)

Zoom Apps have no manifest file: they are configured in the Zoom App Marketplace. The app's page is
`<your site>/addins/zoom`, which the app serves with the OWASP headers Zoom checks
(`frontend/lib/security/headers.ts`, `ZOOM_HEADERS`). Step-by-step setup:
[`docs/integrations/zoom.md`](../../docs/integrations/zoom.md).

| Marketplace setting | Value |
| --- | --- |
| App type | General app (Zoom App), user-managed |
| Home URL | `https://<your site>/addins/zoom` |
| Domain allow list | `<your site>` and its API host (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL`) |
| Scopes / Zoom App SDK APIs | none needed: the page draws the stage from a screen link |
