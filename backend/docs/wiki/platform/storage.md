---
summary: S3-compatible object storage (Bun.S3Client), presigned browser uploads, MediaAsset, upload purposes and error codes.
status: active
last_updated: 2026-10-19
---

# Storage and uploads (`common/storage/`, `modules/uploads/`)

## Storage (`common/storage/storage.ts`, `s3.storage.ts`)

One S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, RustFS) through `Bun.S3Client`,
path-style. Configure `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`
(+ `S3_ENDPOINT` unless AWS, `S3_REGION` default `auto`). The bucket needs CORS allowing `PUT`
from the frontend origin.

```ts
import { storage } from '../../common/storage/storage';
storage.enabled                                   // false without S3_* configuration
await storage.presignPut(key, mime, bytes)        // { key, url, method: 'PUT', headers: {'Content-Type'}, expiresAt } (15 min)
storage.publicUrl(key)                            // `${S3_PUBLIC_URL}/${key}`: anyone with it can read
await storage.stat(key)                           // { key, size, type, etag, lastModified } | null
await storage.getObject(key)                      // + stream(), bytes(), text(); 404 STORAGE_OBJECT_NOT_FOUND
await storage.putObject(key, body, mime)          // server-side writes (import renders, exports)
await storage.delete(key)                         // idempotent
```

- Disabled: every call fails with **503 `STORAGE_DISABLED`** (`publicUrl` throws it).
- Keys are relative, `[A-Za-z0-9!_.*'()/-]`, no empty / `.` / `..` segments, ≤512 chars
  (else 400).
- A presigned PUT cannot cap the size or pin the type (Bun signs only `host`), so the
  declared `mime`/`bytes` must be verified with `stat()` after upload.
- Objects are served from storage/CDN, never through the API (the API sends
  `Cross-Origin-Resource-Policy: same-site`). Use `getObject` server-side for private files.
- Tests swap the driver with `setStorageDriver(driver)` (returns the previous one).

## Uploads API (`modules/uploads/`, mounted at `/api/uploads`)

Both routes: `authenticate()` → rate limit 30/min per user → `workspaceContext()` → Zod.

**`POST /api/uploads/presign`** `{ purpose, mime, bytes }` → 201
`{ key, url, method, headers, expiresAt, maxBytes }`. The browser then `PUT`s the file to
`url` with `headers`.

**`POST /api/uploads/complete`** `{ key }` → 201 with the `MediaAsset` (200 when it was already
completed). Checks that the key was presigned for this user in this workspace (else 404
`UPLOAD_NOT_FOUND`), that the object exists (else 409 `UPLOAD_INCOMPLETE`), and that the stored
Content-Type equals the declared one and the size is ≤ declared and ≤ the purpose max; a
mismatching object is deleted (400 `UPLOAD_MISMATCH`). Audits `media.upload`.

| Purpose | Types | Max | Needs |
| --- | --- | --- | --- |
| `slide_image` | png, jpeg, gif, webp, avif | 10 MB | `deck:edit` |
| `slide_video` | mp4, webm | 200 MB | `deck:edit` |
| `brand_logo` | images | 2 MB | `workspace:brand` |
| `brand_background` | images | 10 MB | `workspace:brand` |
| `brand_font` | woff2, woff, ttf, otf | 5 MB | `workspace:brand` |
| `import_source` | pptx, pdf | 100 MB | `deck:create` |

SVG is not accepted anywhere (it can carry script). Other errors: 400
`UPLOAD_TYPE_NOT_ALLOWED` (`details.allowed`), 413 `UPLOAD_TOO_LARGE` (`details.maxBytes`),
403 `FORBIDDEN`, 503 `STORAGE_DISABLED`.

Keys: `uploads/<workspaceId>/<purpose>/<yyyymm>/<uuid>.<ext>`. The declaration lives in Redis
`uploads:pending:<key>` for 1 hour. Objects presigned but never completed stay in the bucket;
they are unreferenced and under `uploads/`, so a sweep can remove those without a MediaAsset.

## MediaAsset (`modules/uploads/media.model.ts`, `mediaassets`)

`workspaceId, uploaderId, key, url, mime, bytes, source: upload|import|ai, purpose`; `key`
unique, `{workspaceId, createdAt: -1}`.
