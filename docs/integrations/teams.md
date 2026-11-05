# Open Poll for Microsoft Teams (W4-D)

A meeting app: attendees join and answer in the meeting's **side panel**, and the presenter puts the
live stage on the **meeting stage** for everyone. The same tab works in chats and channels (it shows
the stage). Manifest template: `addins/teams/manifest.template.json`, icons `addins/teams/icons/`.

| Page | Teams context |
| --- | --- |
| `https://<site>/addins/teams/config` | configuration page (adding the tab) |
| `https://<site>/addins/teams/sidepanel?link=<screen link>` | the tab: meeting side panel (participant view + "Show on meeting stage"), chat/channel tab (the stage) |
| `https://<site>/addins/teams/stage?link=<screen link>` | what "Show on meeting stage" shares |

## Build the app package

```bash
POWERPOINT_ADDIN_ID=<GUID you keep> TEAMS_APP_ID=<GUID you keep> \
  bun addins/scripts/build-manifests.ts --origin https://<site> --version 1.0.0
```

`addins/dist/teams/open-poll-teams.zip` holds `manifest.json` (manifest 1.16) and the two icons. The
script checks the manifest (ids, version, URLs on the origin, `validDomains`, name and description
limits, the side panel and stage contexts, the `MeetingStage.Write.Chat` permission the stage share
needs). Bump `--version` for every upload. The Teams Developer Portal (Apps → Import app) validates
it further.

## Install

- **Test it:** Teams → Apps → Manage your apps → **Upload an app** → Upload a custom app → the zip
  (custom app upload must be allowed for you).
- **Your organisation:** Teams admin center → Teams apps → Manage apps → **Upload new app**, then make
  it available through a setup or permission policy.

## Use in a meeting

1. In Open Poll: the deck's menu → **Embed…** → **Allow embedding** → **Create screen link** → copy.
2. In the Teams meeting (or its chat): **+ Apps** → Open Poll → paste the screen link → **Use this
   screen link** → **Save**.
3. Attendees open the Open Poll side panel, enter a nickname and answer there.
4. The presenter selects **Show on meeting stage** in the side panel: the live stage appears for
   everyone. Run the session from the host console as usual.

## Notes

- The pages load the Teams JavaScript library (v2) from Microsoft's CDN (`res.cdn.office.net`); outside
  Teams they work without it ("Open this page from Teams to save the tab", sharing disabled).
- `/addins/*` may be framed by `teams.microsoft.com`, `*.teams.microsoft.com`, `*.cloud.microsoft` and
  the other Microsoft 365 hosts only.
- Turning the screen link off in Open Poll blanks the stage and the tab at once; create a new link and
  reconfigure the tab (the tab's settings → paste the new link).
- Not tested inside Teams in CI: `frontend/e2e/addins.spec.ts` drives the three pages in a browser with
  the Teams library blocked; `frontend/tests/unit/addins.test.ts` checks the manifest and the zip.
