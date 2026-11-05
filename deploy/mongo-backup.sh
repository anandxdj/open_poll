#!/usr/bin/env bash
# Nightly MongoDB backup for the VPS: mongodump of production into a gzip archive, uploaded to a
# private S3-compatible bucket (Cloudflare R2), keeping the last BACKUP_KEEP_DAYS days.
# On any failure it emails ALERT_EMAIL through Resend (when both are set) and exits non-zero.
#
# Reads two env files (paths overridable):
#   APP_ENV_FILE    the compose .env: MONGO_URI, and optionally RESEND_API_KEY, RESEND_FROM_EMAIL, ALERT_EMAIL
#   BACKUP_ENV_FILE BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID,
#                   BACKUP_S3_SECRET_ACCESS_KEY, optional BACKUP_KEEP_DAYS (default 14)
# Needs only docker and curl on the host. See docs/deploy/backups.md.
set -euo pipefail

APP_ENV_FILE=${APP_ENV_FILE:-"$(dirname "$0")/../.env"}
BACKUP_ENV_FILE=${BACKUP_ENV_FILE:-"$HOME/.openpoll-backup.env"}
MONGO_IMAGE=${MONGO_IMAGE:-mongo:8.0}
AWS_IMAGE=${AWS_IMAGE:-amazon/aws-cli:2.27.0}

# Read KEY=value lines without executing the files (values may hold characters a shell would expand).
read_env() {
  local file=$1 key=$2
  { grep -E "^${key}=" "$file" 2>/dev/null || true; } | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

MONGO_URI=$(read_env "$APP_ENV_FILE" MONGO_URI)
RESEND_API_KEY=$(read_env "$APP_ENV_FILE" RESEND_API_KEY)
RESEND_FROM_EMAIL=$(read_env "$APP_ENV_FILE" RESEND_FROM_EMAIL)
ALERT_EMAIL=$(read_env "$APP_ENV_FILE" ALERT_EMAIL)
BACKUP_S3_ENDPOINT=$(read_env "$BACKUP_ENV_FILE" BACKUP_S3_ENDPOINT)
BACKUP_S3_BUCKET=$(read_env "$BACKUP_ENV_FILE" BACKUP_S3_BUCKET)
AWS_ACCESS_KEY_ID=$(read_env "$BACKUP_ENV_FILE" BACKUP_S3_ACCESS_KEY_ID)
AWS_SECRET_ACCESS_KEY=$(read_env "$BACKUP_ENV_FILE" BACKUP_S3_SECRET_ACCESS_KEY)
BACKUP_KEEP_DAYS=$(read_env "$BACKUP_ENV_FILE" BACKUP_KEEP_DAYS)
BACKUP_KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}
export MONGO_URI AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION=auto

fail() {
  local message=$1
  echo "[backup] FAILED: $message" >&2
  if [[ -n "$ALERT_EMAIL" && -n "$RESEND_API_KEY" && -n "$RESEND_FROM_EMAIL" ]]; then
    curl -fsS https://api.resend.com/emails \
      -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' \
      -d "{\"from\":\"$RESEND_FROM_EMAIL\",\"to\":[\"$ALERT_EMAIL\"],\"subject\":\"[Open Poll] Nightly backup failed\",\"text\":\"$(hostname): $message\"}" \
      >/dev/null || echo "[backup] could not send the alert email" >&2
  fi
  exit 1
}

for name in MONGO_URI BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
  [[ -n "${!name}" ]] || fail "$name is not set"
done

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
chmod 700 "$workdir"
archive="openpoll-$(date -u +%Y-%m-%dT%H%M%SZ).gz"

aws() {
  docker run --rm --network host -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
    -v "$workdir:/data" "$AWS_IMAGE" --endpoint-url "$BACKUP_S3_ENDPOINT" "$@"
}

echo "[backup] dumping to $archive"
docker run --rm --network host -e MONGO_URI -v "$workdir:/dump" --user "$(id -u):$(id -g)" "$MONGO_IMAGE" \
  mongodump --uri "$MONGO_URI" --gzip --archive="/dump/$archive" --quiet || fail "mongodump exited with an error"

size=$(stat -c %s "$workdir/$archive" 2>/dev/null || echo 0)
(( size > 1024 )) || fail "the archive is only $size bytes"

echo "[backup] uploading $size bytes to s3://$BACKUP_S3_BUCKET/mongo/$archive"
aws s3 cp "/data/$archive" "s3://$BACKUP_S3_BUCKET/mongo/$archive" --only-show-errors || fail "upload failed"

# Prune archives older than BACKUP_KEEP_DAYS (names carry their UTC date).
cutoff=$(date -u -d "-${BACKUP_KEEP_DAYS} days" +%Y-%m-%d)
aws s3 ls "s3://$BACKUP_S3_BUCKET/mongo/" | awk '{print $4}' | while read -r key; do
  day=$(echo "$key" | sed -nE 's/^openpoll-([0-9]{4}-[0-9]{2}-[0-9]{2})T.*/\1/p')
  if [[ -n "$day" && "$day" < "$cutoff" ]]; then
    echo "[backup] removing $key"
    aws s3 rm "s3://$BACKUP_S3_BUCKET/mongo/$key" --only-show-errors || fail "could not remove $key"
  fi
done

echo "[backup] done"
