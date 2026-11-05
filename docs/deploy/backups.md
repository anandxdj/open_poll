---
summary: Nightly MongoDB backups from the VPS to a private Cloudflare R2 bucket, how to install the cron job, check it, and restore.
status: active
last_updated: 2026-11-05
---

# Database backups

`deploy/mongo-backup.sh` runs on the VPS once a night. It dumps the production database with
`mongodump` (from the `mongo:8.0` image, matching Atlas 8.0), uploads the gzip archive to the
private `open-poll-backups` bucket under `mongo/`, and deletes archives older than
`BACKUP_KEEP_DAYS` (14). It needs only `docker` and `curl` on the host.

If any step fails it exits non-zero and, when `ALERT_EMAIL`, `RESEND_API_KEY` and
`RESEND_FROM_EMAIL` are in the compose `.env`, emails "[Open Poll] Nightly backup failed".

Cloudflare R2 encrypts objects at rest. Keep the backups bucket private: no custom domain and no
public `r2.dev` access. The media bucket is public, so backups never go there.

## Install (once, on the VPS)

1. Create `~/.openpoll-backup.env`, readable only by you (`chmod 600`):
   ```
   BACKUP_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   BACKUP_S3_BUCKET=open-poll-backups
   BACKUP_S3_ACCESS_KEY_ID=<R2 token access key id>
   BACKUP_S3_SECRET_ACCESS_KEY=<R2 token secret>
   BACKUP_KEEP_DAYS=14
   ```
2. Run it once by hand from the checkout and check the object appears:
   ```bash
   cd ~/open_poll && ./deploy/mongo-backup.sh
   ```
   `APP_ENV_FILE` defaults to the checkout's `.env` (the one compose reads, with `MONGO_URI`);
   `BACKUP_ENV_FILE` defaults to `~/.openpoll-backup.env`.
3. Add the cron entry (`crontab -e`), 02:30 UTC daily, logging to a file:
   ```
   30 2 * * * cd $HOME/open_poll && ./deploy/mongo-backup.sh >> $HOME/openpoll-backup.log 2>&1
   ```

## Restore

Restoring replaces data, so take a fresh dump of the current state first.

```bash
# Download the archive you want (same image the script uses):
docker run --rm -e AWS_ACCESS_KEY_ID=... -e AWS_SECRET_ACCESS_KEY=... -e AWS_DEFAULT_REGION=auto \
  -v "$PWD:/data" amazon/aws-cli:2.27.0 --endpoint-url "$BACKUP_S3_ENDPOINT" \
  s3 cp s3://open-poll-backups/mongo/<archive>.gz /data/

# Check it into a scratch database first:
docker run --rm -v "$PWD:/d" mongo:8.0 mongorestore --uri "$SCRATCH_URI" --gzip --archive=/d/<archive>.gz \
  --nsFrom 'open-poll-platform.*' --nsTo 'restore_check.*'

# Then restore production (stop the backend first: docker compose stop openpoll-backend):
docker run --rm -v "$PWD:/d" mongo:8.0 mongorestore --uri "$MONGO_URI" --gzip --archive=/d/<archive>.gz --drop
```

The container must be able to read the archive: run `mongorestore` with `--user "$(id -u):$(id -g)"`
when the folder is private to you.

## Tested

On 2026-11-05 against a local S3 server (RustFS) and the test Mongo: a dump uploaded, an archive
dated 2026-10-01 was pruned, the uploaded archive restored with every document, and a missing
`MONGO_URI` made the script exit 1 with "[backup] FAILED: MONGO_URI is not set".
