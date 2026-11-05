# Open Poll for PowerPoint (W4-D)

A task pane that shows your deck's live stage (lobby with the join code, questions, live results,
standings) next to your slides. Page: `https://<site>/addins/powerpoint`. Manifest template:
`addins/powerpoint/manifest.template.xml`.

## Build the manifest

```bash
POWERPOINT_ADDIN_ID=<a GUID you keep> TEAMS_APP_ID=<another GUID you keep> \
  bun addins/scripts/build-manifests.ts --origin https://<site> --version 1.0.0 \
  [--provider "Your company"] [--support https://<site>/support]
```

`addins/dist/powerpoint/manifest.xml` is written after the script's checks pass (well-formed XML,
required elements in schema order, every URL on `https://<site>`, ribbon resources resolved). Without
an id the script makes one and prints it: keep it, an add-in's id never changes. For Microsoft's own
validation run `npx office-addin-manifest validate addins/dist/powerpoint/manifest.xml`.

Local try-out: `--origin http://localhost:3000 --dev` (PowerPoint on the web needs https; use a
tunnel or the dev certificates of `office-addin-dev-certs`).

## Install

- **Just you:** PowerPoint → Home → Add-ins → More add-ins → My add-ins → **Upload My Add-in** → pick
  `manifest.xml`. (PowerPoint on the web: Insert → Add-ins → Upload My Add-in.)
- **Your organisation:** Microsoft 365 admin center → Settings → Integrated apps → **Upload custom
  apps** → Office add-in → upload `manifest.xml`, choose who gets it.

The ribbon gets an **Open Poll → Live stage** button on the Home tab.

## Use

1. In Open Poll: the deck's menu → **Embed…** → **Allow embedding**, then **Create screen link** and
   copy it.
2. In PowerPoint: **Live stage** → paste the link → **Show the stage**. The pane follows the session as
   you present from the host console (on your phone or another window).
3. The link is saved in the presentation file, so the pane shows the same stage next time.
   **Change screen link** at the bottom picks another.

## Notes

- The pane loads Office.js from Microsoft's CDN (required for add-ins); without it (a plain browser)
  the link is kept in the browser instead.
- `/addins/*` may be framed only by Microsoft 365 hosts (`*.office.com`, `*.officeapps.live.com`, …),
  see `frontend/lib/security/headers.ts`.
- Not tested inside PowerPoint in CI: the e2e suite (`frontend/e2e/addins.spec.ts`) tests the page in
  a browser with Office.js blocked, and `frontend/tests/unit/addins.test.ts` the manifest.
