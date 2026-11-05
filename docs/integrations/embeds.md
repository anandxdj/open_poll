# Embedding Open Poll on a website (W4-D)

Three things can be put on another site, a room screen or an intranet page:

| What | Page | Who uses it |
| --- | --- | --- |
| Participant view | `https://<site>/embed/live/<join code>` | the audience joins and answers right on the page |
| Live stage | `https://<site>/embed/stage/<deck id>?token=<screen link token>` | a second screen, a webinar page, an add-in: what the presenter's stage shows, read-only |
| Shared results | `https://<site>/embed/results/<results link token>` | a finished session's aggregated results |

## Before you start

1. **Turn embedding on for the deck.** Library → the deck's menu → **Embed…** (or **Embed** in the
   builder) → **Allow embedding**. It is off for every deck by default. While it is off, embeds show
   "Embedding is turned off" and other sites cannot frame them at all. (Deck settings cannot change
   while a session is live.)
2. **Optional: limit the sites.** Settings → Workspace → **Embedding**: list the sites allowed to frame
   your embeds (`https://intranet.example.com`, or `https://*.example.com` for every subdomain). With
   none listed, any site may. Owners and admins only.

## Participant view

Copy **Embed code** from the Embed dialog:

```html
<iframe src="https://<site>/embed/live/123456" title="My deck" width="420" height="640"
  style="border:0;max-width:100%" allow="clipboard-write; fullscreen" loading="lazy"
  referrerpolicy="strict-origin-when-cross-origin"></iframe>
```

## Live stage (screen links)

In the Embed dialog, under **Stage for screens**, name the screen and **Create screen link**. The link
is shown **once**: copy it then (the dialog also gives the 16:9 iframe code and the oEmbed URL). Open
it on the room's screen, paste it into a page, or into the PowerPoint, Teams or Zoom add-in. Each
screen gets its own link; **Turn off** stops one at once (its screens go blank) without touching the
others. A screen never sees speaker notes, and never sees which answer is correct before you reveal
it.

## Shared results

Open the session's report → **Share** → create the public link; the dialog then shows the results'
**Embed code**. Turning the link off (or its expiry) stops the embed too.

## Fit the frame to its content

The participant view and the results change height as people use them. Each embed tells its parent
page its height (`postMessage` `{type: "openpoll:embed:resize", kind, height}`). Add the script from
the Embed dialog (**Fit the frame to its content**) once to your page, and each Open Poll frame grows
and shrinks to fit:

```html
<script>
window.addEventListener("message", function (e) {
  if (e.origin !== "https://<site>" || !e.data || e.data.type !== "openpoll:embed:resize") return;
  document.querySelectorAll("iframe").forEach(function (f) {
    if (f.contentWindow === e.source) f.style.height = Math.ceil(e.data.height) + "px";
  });
});
</script>
```

The stage fills its frame: give it a 16:9 size.

## oEmbed

CMSs and chat apps that turn a pasted link into an embed (WordPress, Notion, Ghost, …) ask
`GET https://<api>/api/oembed?url=<page URL>&format=json`. Pasting the participant link
(`/live/<code>`), the results link (`/r/<token>`) or a screen link works once embedding is on. The
answer is an oEmbed 1.0 `rich` document whose `html` is the iframe above (`maxwidth`/`maxheight`
respected; the stage keeps 16:9). Links of other sites, other pages, dead links and decks that do
not allow embedding get 404 / 403. For automatic discovery, register the endpoint with your CMS or
the consumer's provider list.

## Custom domains

On a workspace's custom domain (`docs/deploy/custom-domains.md`) the same `/embed/*` pages work, and
oEmbed accepts that domain's links for the workspace's own decks.

## Operators

- Framing is decided per request by the frontend proxy (`frontend/lib/proxy/embeds.ts`) from
  `GET /api/embeds/policy`; answers are cached for 10 seconds, so a change can take that long to show.
  Every other page keeps `frame-ancestors 'self'`.
- Screen tokens are stored hashed; see `backend/docs/wiki/modules/embeds.md` for the API.
