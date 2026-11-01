---
summary: How to merge the open PR stack (#8–#16 and #13) into main and ship it in one release, with a migration rehearsal on a copy of production data first.
status: draft
last_updated: 2026-11-01
---

# Merge and deploy plan

Nothing from the roadmap work after `#6`/`#7` is live. This plan gets the open stack onto `main`, the
backend onto the VPS and the frontend onto Vercel in one short window, after proving the database
migrations on a copy of production.

## Where things stand (2026-11-01)

**GitHub.** `main` = `8101faf` (#6, #7). No branch protection; `delete_branch_on_merge` is off.

| PR | Branch | Base | CI |
| --- | --- | --- | --- |
| #8 | `feat/redesign-leftovers` | `main` | green |
| #9 | `feat/privacy` | #8 | green except GitGuardian |
| #10 | `feat/brand-kits` | #9 | green except GitGuardian |
| #11 | `feat/sso-scim` | #10 | green except GitGuardian |
| #12 | `feat/custom-domains` | #11 | green except GitGuardian |
| #14 | `feat/landing-trim` | #12 | green |
| #15 | `feat/app-shell-v2` | #14 | green |
| #16 | `feat/editor-v2` (`0023e44`) | #15 | green |
| #13 | `feat/mcp-agents` (`9a9f94f`) | #12 | green, **not** in #16 |

- `feat/editor-v2` contains #8–#12 and #14–#16; local and origin branches match.
- #13 forks from #12 and ships in this release (owner decision, 2026-11-01).
- **`R` is the head of `feat/mcp-agents` (PR #13).** It holds the whole stack plus MCP.
  - First built 2026-11-01 as `7fde277`, with green CI.
  - Rebuilt the same day after the fixes from the product test pass (`07-product-test-plan.md`) landed on
    `feat/editor-v2`.
  - Every `<R>` below means `git rev-parse origin/feat/mcp-agents` at the time of the window. Check that CI on
    that exact commit is green.
- **Merging `feat/editor-v2` into `feat/mcp-agents`** conflicts in one place only: the `last_updated` front-matter
  date of `frontend/docs/wiki/features/landing-auth.md`. Keep `2026-10-27`.
- **No migration and no new environment variable for #13.**
  - Its collections are new, and their indexes build at boot (`autoIndex` stays on):
    `mcptokens`, OAuth clients and grants, with TTL indexes.
  - It stores only hashes, so it needs no `ENCRYPTION_KEY`.
  - `API_PUBLIC_URL` becomes the OAuth issuer that connectors see (`<origin>/mcp`).
- **GitGuardian failures are false positives.** All five flags are throwaway passwords for e2e test accounts:
  - `frontend/e2e/privacy.spec.ts`, `backend/tests/integration/privacy.test.ts` (#9)
  - `frontend/e2e/brand.spec.ts` (#10)
  - `frontend/e2e/sso.spec.ts` (#11)
  - `frontend/e2e/domains.spec.ts` (#12)

**Production.**
- **Frontend:** Vercel, `open-poll.vercel.app`. It deploys `main` automatically, and `NEXT_PUBLIC_*` values are baked in at build time.
  `NEXT_PUBLIC_SITE_URL` is unset there today, so canonical, `og:url`, `robots.txt` and `sitemap.xml` all
  say `http://localhost:3000`.
- **Backend:** VPS, `docker-compose.yml` + Traefik, `openpoll-backend.anands.dev`. It runs pre-Wave-0 code
  (`GET /api/plans` → 404). The container command is `bun run start:prod` = `bun scripts/migrate.ts && bun src/app.ts`,
  so migrations run on every start.
- **Migrations to apply on production:** all of `001`–`190` (the runner did not exist in the deployed code).

## Decisions for the owner (before Phase 1)

1. **#13 (MCP): decided, this release.** Phase 0 builds one release commit that holds the whole stack plus #13.
   CI tests that commit before the window.
2. **Plan limits** in `backend/src/common/plans/plans.ts`. Free means 100 participants per session or poll,
   and 365 days of session data. The deploy enforces both on existing data (see the checks in Phase 1).
3. **Frontend URL for this release.** Recommendation: keep `open-poll.vercel.app` and set
   `NEXT_PUBLIC_SITE_URL` to it now. Moving app and API to one domain (`app.` / `api.`) is a separate step;
   it also fixes the `SameSite=None` refresh cookie that Safari drops.
4. **Window.** About 30 minutes with no live sessions. Migration `030` changes the Redis keys, and it marks any
   deck still in `lobby`/`active` as `ended`.

## Phase 0: tidy the PRs

1. In the GitGuardian dashboard, resolve the five incidents above as "test credential / false positive".
2. Re-run the GitGuardian check on #9–#12, or ignore it: without branch protection it does not block merging.
3. Leave the ignore file for later, as one small PR to `main` after the release (Phase 4).
   Adding it to #8 now would push a commit through the whole stack.
4. **Build the release commit, `R`.** Done 2026-11-01, and redone each time the stack changes. Bring #13 up to date with the stack top, so its head holds everything
   that ships:
   ```bash
   git checkout feat/mcp-agents
   git merge --no-ff feat/editor-v2
   # conflict: frontend/docs/wiki/features/landing-auth.md front matter -> keep "last_updated: 2026-10-27"
   git add frontend/docs/wiki/features/landing-auth.md && git commit --no-edit
   git push origin feat/mcp-agents
   git rev-parse HEAD          # this is R; note it
   ```
   PR #13's CI now runs on `R`. Its diff against `feat/custom-domains` also shows #14–#16 until those merge.
   Wait for every job to go green, Playwright included, before Phase 1. The route snapshot, the tenancy
   allow-list and the settings sections test all see both sides together for the first time here.
5. **Freeze.** From here until the window, nothing new lands on any branch of the stack. If something must,
   rebuild `R` and wait for CI again.

## Phase 1: rehearse the migrations on a copy of production

Do this a day or more before the window. The dump holds real user data: keep it off shared disks and delete
it at the end.

1. **On the VPS, record what runs now.** This is the rollback target.
   ```bash
   git -C <checkout> rev-parse HEAD
   docker image ls | grep openpoll
   docker tag <current backend image> openpoll-backend:pre-roadmap
   ```
2. **Dump production Mongo.** If it is Atlas, also take an on-demand snapshot. Note the server version.
   ```bash
   mongodump --uri "$MONGO_URI" --gzip --archive=openpoll-prod-$(date +%F).gz
   mongosh "$MONGO_URI" --quiet --eval 'db.version()'
   ```
3. **Restore into a throwaway container on the same Mongo major version.** Keep it apart from
   `openpoll-test-mongo` and `openpoll_dev`.
   ```bash
   docker run -d --name openpoll-rehearsal-mongo -p 127.0.0.1:27118:27017 mongo:<major> --replSet rs0
   docker exec openpoll-rehearsal-mongo mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
   mongorestore --uri 'mongodb://127.0.0.1:27118/?directConnection=true' --gzip \
     --archive=openpoll-prod-<date>.gz --nsFrom '<proddb>.*' --nsTo 'openpoll_rehearsal.*'
   ```
4. **Count before.** Save the output.
   ```bash
   R='mongodb://127.0.0.1:27118/openpoll_rehearsal?directConnection=true'
   mongosh "$R" --quiet --eval '
     for (const c of ["users","polls","responses","presentations","quizzes","presentationparticipants","presentationanswers"])
       print(c, db.getCollection(c).countDocuments());
     print("live decks", db.presentations.countDocuments({status: {$in: ["lobby","active"]}}));'
   ```
5. **Migrate from `R`, the exact commit `main` will end at.** Use a scratch worktree so the dev checkout is
   untouched. Use dummy secrets so nothing can send mail.
   ```bash
   git worktree add <scratch>/rehearsal <R> && cd <scratch>/rehearsal/backend && bun install
   export NODE_ENV=production MONGO_URI="$R" REDIS_URL=redis://127.0.0.1:6391/7 \
     FRONTEND_URL=http://localhost:3000 JWT_ACCESS_SECRET=rehearsal-access-0123456789 \
     JWT_REFRESH_SECRET=rehearsal-refresh-0123456789 RESEND_API_KEY=re_rehearsal RESEND_FROM_EMAIL=noreply@example.com
   bun run migrate status
   time bun run migrate      # note per-migration times: they size the window
   bun run migrate           # must report "Applied 0"
   ```
6. **Check after.** Stop and decide if any of these surprise you.
   - **Workspaces (020):** every user has `defaultWorkspaceId`. Polls and presentations without
     `workspaceId` are only the orphans whose creator no longer exists.
   - **Quizzes (010):** `db.presentations.countDocuments({"legacy.source":"quiz"})` equals the quiz count.
   - **Sessions (030):** participants and answers with no `sessionId` = 0.
   - **Retention.** Migration `030` gives every old run `retainUntil = endedAt + 365 days` (Free).
     The `privacy-retention-purge` job deletes those runs at the first hour boundary after boot.
     This must be 0, or you must decide to extend those runs before the window:
     ```js
     db.presentationsessions.countDocuments({isLive: false, retainUntil: {$ne: null, $lte: new Date()}})
     ```
   - **Response caps.** Polls in a workspace stop accepting answers at the plan's `audienceCap` (Free: 100).
     List the polls already over it:
     ```js
     db.responses.aggregate([{$group: {_id: "$pollId", n: {$sum: 1}}}, {$match: {n: {$gte: 100}}}, {$sort: {n: -1}}])
     ```
     For each, either accept it or raise that owner's plan (`bun scripts/set-plan.ts <owner-email> pro`).
7. **Boot the rehearsal backend and click through.** Start it with the same environment on a spare port
   (`PORT=5099 bun src/app.ts`). Point a local frontend at it with `NEXT_PUBLIC_API_URL` and
   `NEXT_PUBLIC_SOCKET_URL` set to `http://localhost:5099`.
   - Log in with **your own** production account and check: Home, the Library (old polls and decks are listed),
     an old deck in the builder, a legacy quiz, an old poll's `/p/<id>` and analytics, and the session history
     of a deck that had a run.
   - Run one new session with a phone, then end it.
   - In Settings, create an MCP token and point `mcp-remote` at `http://localhost:5099/mcp`: tools list,
     and creating a deck works.
   - The backend logs stay free of errors.
8. **Tear down.**
   ```bash
   docker rm -f openpoll-rehearsal-mongo
   git worktree remove <scratch>/rehearsal
   ```
   Then delete the local dump.

## Phase 2: prepare production config (before the window)

**VPS `.env`** (the root `.env` that compose reads). The backend refuses to boot when a required value is missing.

- **Required:** `MONGO_URI`, `FRONTEND_URL=https://open-poll.vercel.app`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
  `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `PORT=8080`. Compose sets `NODE_ENV` and `REDIS_URL`.
- **New, set them:**
  - `ID_SIGNING_SECRET`: a random value of its own. Without it, ballots fall back to the access secret.
  - `API_PUBLIC_URL=https://openpoll-backend.anands.dev`. SSO and SCIM metadata otherwise say localhost.
    It is also the MCP OAuth issuer and connector URL (`<origin>/mcp`). Set it before the first user connects
    Claude or ChatGPT, and don't change it afterwards: identity providers and connectors store it.
  - `ENCRYPTION_KEY`: 32 random bytes in hex. SSO client secrets need it.
  - `S3_*`: a real bucket. Without it, uploads and PPTX/PDF imports stay off.
  - The LLM keys.
  - `METRICS_TOKEN`: optional.
- **Leave Stripe unset.** Billing then answers `503 BILLING_DISABLED`, and pricing shows "Pricing soon".

**Vercel, Production environment.** Set these **before** merging: the first `main` build bakes them in.
- `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SOCKET_URL`: `https://openpoll-backend.anands.dev`
- `NEXT_PUBLIC_SITE_URL=https://open-poll.vercel.app`, or the real domain once it exists
- `NEXT_PUBLIC_STORAGE_PUBLIC_URL`: the bucket's public URL
- `NEXT_PUBLIC_SALES_EMAIL`: optional; "Contact sales" stays disabled without it
- `NEXT_PUBLIC_CUSTOM_DOMAINS`: unset (off)

## Phase 3: the release window

The backend goes first, from `R`, the commit that `main` will end at. The merge comes second, and Vercel then
builds that same tree. This way the new frontend never talks to the old backend. The old frontend talks to the
new backend for the few minutes between steps 3 and 5, so keep that gap short.

1. **No live sessions.** Check: `db.presentations.countDocuments({status: {$in: ["lobby","active"]}})`.
   Announce the window if anyone uses it.
2. **Fresh backup.** Repeat the `mongodump` from Phase 1, step 2: the rehearsal dump is older.
3. **Deploy the backend.**
   ```bash
   cd <checkout> && git fetch && git checkout <R>
   docker compose build openpoll-backend
   docker compose run --rm openpoll-backend bun run migrate   # same output as the rehearsal
   docker compose up -d openpoll-backend                      # start:prod migrates again: "Applied 0"
   docker compose logs -f openpoll-backend
   ```
   If a migration fails, stop here and roll back (see below). Do not leave the container in its restart loop.
4. **Smoke-test the backend:**
   - `/health` and `/ready` return 200, and `GET /api/plans` returns 200.
   - The socket handshake at `/socket.io/?EIO=4&transport=polling` works.
   - `/.well-known/oauth-authorization-server` names `https://openpoll-backend.anands.dev` as `issuer`.
5. **Merge the stack: bottom-up, merge commits, never squash.** Squashing rewrites the commits that the next
   PR in the stack still carries, and every later PR then conflicts.
   - After `#n` merges, `main` has exactly branch n's tested tree, so you don't need to wait for CI between merges.
     #13 goes last: its head `R` contains all the others, so `main` then ends at `R`'s tree.
   - With `delete_branch_on_merge` off, GitHub does not retarget the next PR, so the script does it.
   - The `gh` on PATH hangs (mise shim). Use the full binary path, as below.
   ```bash
   GH=$(ls -d ~/.local/share/mise/installs/gh/*/gh_*/bin/gh | tail -1)
   $GH pr merge 8 --merge
   for n in 9 10 11 12 14 15 16 13; do
     $GH pr edit $n --base main && $GH pr merge $n --merge || break
   done
   git fetch origin
   test "$(git rev-parse origin/main^{tree})" = "$(git rev-parse <R>^{tree})" && echo "main == tested tree"
   ```
6. **Point the VPS checkout back at `main`.** Same tree, so no rebuild is needed:
   `git -C <checkout> checkout main && git -C <checkout> pull`.
7. **Frontend.** Wait for the Vercel production build of `main`, then:
   ```bash
   curl -s https://open-poll.vercel.app/ | grep -o '<link rel="canonical"[^>]*>'   # must not say localhost
   curl -s https://open-poll.vercel.app/sitemap.xml | head
   ```
8. **Smoke the whole path on production (15 minutes).**
   - Signup, and the verification email arrives (real Resend).
   - Login, Home, a new deck, Present.
   - Join from a phone on mobile data, answer, reveal, End.
   - The session report and its CSV export.
   - An old deck, a legacy quiz, and an old poll at `/p/<id>`, with a vote.
   - Settings: connect Claude through the consent page with connector URL
     `https://openpoll-backend.anands.dev/mcp`. Ask it to list your decks, then disconnect it.
     A personal MCP token works with `mcp-remote`.
9. **Watch for one hour.** That covers the first `privacy-retention-purge` tick: look for
   `[Privacy] Retention purge` in the logs, and check it removed only what Phase 1 predicted.

## Rollback

Migrations only go forward, so a rollback means restoring the data.

1. `docker compose stop openpoll-backend`.
2. `mongorestore --drop --gzip --archive=<pre-window dump>` into the production database.
3. Run the old image: retag `openpoll-backend:pre-roadmap`, or check out the recorded commit and rebuild.
   Then `docker compose up -d`.
4. In Vercel, promote the previous production deployment.

Anything written after the window is lost on restore, so make the call within the first hour. `main` keeps the
merged code; the next deploy simply ships it again once fixed.

## Phase 4: clean-up after the release

- Add `.gitguardian.yaml` with `paths-ignore` for `frontend/e2e/**` and `backend/tests/**` (one PR to `main`).
- Protect `main`: require the CI checks and allow merge commits only.
- Delete merged branches, local and remote:
  - `feat/*` from this stack
  - `pkg/*`, `chore/backlog-and-roadmap`, `feat/roadmap-implementation`, `feat/editorial-redesign`
  - the `claude/*` and `worktree-agent-*` branches
- Remove `.claude/worktrees/*`. Once no one needs the local test containers, remove them too:
  `openpoll-test-mongo`, `openpoll-test-redis`, `openpoll-test-redis2`.
- Update `05-handoff.md`, the README "What's next" and the status tables in `01-competitive-roadmap.md`.
- Next steps, in order:
  1. Move app and API to one domain, which fixes the cross-site cookie.
  2. Real terms and privacy text.
  3. Sentry.
  4. Scheduled Mongo backups.
  5. Fix the signed-out `me → refresh-token → logout` calls, which hit the per-IP auth limits on shared networks.
