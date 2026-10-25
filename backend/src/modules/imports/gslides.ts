import { looksLikeZip, readLimited } from './bytes';
import { ImportError } from './errors';
import { IMPORT_LIMITS } from './limits';
import { guardedGet, type HostResolver } from './ssrf';

/**
 * Google Slides import.
 *
 * - Public link: `https://docs.google.com/presentation/d/<id>/…` is exported
 *   as `/export/pptx` (the file must be shared "Anyone with the link") and
 *   then follows the PPTX path.
 * - Private file (only with `GOOGLE_DRIVE_IMPORT_ENABLED` + keys): the
 *   browser's Google Picker hands over a file id and a short-lived access
 *   token; the file is exported through the Drive API with that token. The
 *   token is held in Redis only until the job finishes.
 *
 * Both go through the SSRF guard in `ssrf.ts`.
 */

export const GOOGLE_SLIDES_HOST = 'docs.google.com';
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const GOOGLE_SLIDES_MIME = 'application/vnd.google-apps.presentation';

/** Hosts a Slides export may redirect to: the editor host and Google's signed download hosts. */
export const isGoogleExportHost = (hostname: string) =>
  hostname === GOOGLE_SLIDES_HOST || /^doc-[a-z0-9-]+\.googleusercontent\.com$/.test(hostname);

const DOCUMENT_ID = /^[A-Za-z0-9_-]{15,128}$/;
const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,128}$/;

export const isDriveFileId = (value: string) => DRIVE_FILE_ID.test(value);

const invalidLink = () =>
  new ImportError(
    'INVALID_LINK',
    'This is not a Google Slides link. Paste the address of the presentation, like https://docs.google.com/presentation/d/…/edit.',
  );

const privateDeck = () =>
  new ImportError(
    'GSLIDES_PRIVATE',
    'This Google Slides file is not public. In Google Slides choose Share → General access → Anyone with the link, then try again.',
  );

/** The document id in a Google Slides link, or an ImportError for anything else. */
export function parseSlidesLink(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw invalidLink();
  }
  if (url.protocol !== 'https:' || url.hostname !== GOOGLE_SLIDES_HOST || url.username || url.password) throw invalidLink();
  const match = url.pathname.match(/^\/presentation\/(?:u\/\d+\/)?d\/(?:e\/)?([^/]+)/);
  const id = match?.[1];
  if (!id || !DOCUMENT_ID.test(id)) throw invalidLink();
  return id;
}

export interface FetchOptions {
  fetchImpl?: typeof fetch;
  resolve?: HostResolver;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

const limitsOf = (options: FetchOptions) => ({
  maxBytes: options.maxBytes ?? IMPORT_LIMITS.gslides.maxBytes,
  timeoutMs: options.timeoutMs ?? IMPORT_LIMITS.gslides.timeoutMs,
  maxRedirects: options.maxRedirects ?? IMPORT_LIMITS.gslides.maxRedirects,
});

const tooBig = (maxBytes: number) =>
  new ImportError('FILE_TOO_LARGE', `This presentation is larger than ${Math.round(maxBytes / (1024 * 1024))} MB and cannot be imported.`);

const forbiddenRedirect = (url: URL) =>
  url.hostname === 'accounts.google.com' || url.hostname.endsWith('.accounts.google.com')
    ? privateDeck()
    : new ImportError('LINK_NOT_ALLOWED', 'Google sent this download somewhere that cannot be imported safely.');

/** Downloads the public export of a Slides document as PPTX bytes. */
export async function fetchPublicDeck(documentId: string, options: FetchOptions = {}): Promise<Uint8Array> {
  const { maxBytes, timeoutMs, maxRedirects } = limitsOf(options);
  const response = await guardedGet(new URL(`https://${GOOGLE_SLIDES_HOST}/presentation/d/${documentId}/export/pptx`), {
    allowHost: isGoogleExportHost,
    fetchImpl: options.fetchImpl,
    resolve: options.resolve,
    timeoutMs,
    maxRedirects,
    onForbidden: forbiddenRedirect,
  });
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    await response.body?.cancel().catch(() => {});
    throw privateDeck();
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ImportError('LINK_UNREACHABLE', `Google Slides answered with an error (${response.status}). Try again in a moment.`);
  }
  // A sign-in page comes back as HTML with a 200.
  if ((response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) {
    await response.body?.cancel().catch(() => {});
    throw privateDeck();
  }
  const bytes = await readLimited(response, maxBytes);
  if (!bytes) throw tooBig(maxBytes);
  if (!looksLikeZip(bytes)) throw privateDeck();
  return bytes;
}

const DRIVE_HOST = 'www.googleapis.com';

/** Downloads a Drive file the user picked, as PPTX bytes (Slides are exported, uploaded PPTX files downloaded). */
export async function fetchDriveDeck(fileId: string, accessToken: string, options: FetchOptions = {}): Promise<Uint8Array> {
  if (!isDriveFileId(fileId)) throw invalidLink();
  const { maxBytes, timeoutMs, maxRedirects } = limitsOf(options);
  const guard = {
    allowHost: (hostname: string) => hostname === DRIVE_HOST,
    fetchImpl: options.fetchImpl,
    resolve: options.resolve,
    timeoutMs,
    maxRedirects,
    headers: { Authorization: `Bearer ${accessToken}` },
    onForbidden: () => new ImportError('LINK_NOT_ALLOWED', 'Google sent this download somewhere that cannot be imported safely.'),
  };
  const noAccess = () =>
    new ImportError('GDRIVE_NO_ACCESS', 'OpenPoll could not read this file from Google Drive. Pick it again and allow access.');

  const meta = await guardedGet(new URL(`https://${DRIVE_HOST}/drive/v3/files/${fileId}?fields=mimeType,size`), guard);
  if (!meta.ok) {
    await meta.body?.cancel().catch(() => {});
    throw meta.status >= 500
      ? new ImportError('LINK_UNREACHABLE', 'Google Drive is not answering. Try again in a moment.')
      : noAccess();
  }
  const info = (await meta.json().catch(() => null)) as { mimeType?: string } | null;
  const mimeType = info?.mimeType ?? '';
  let download: URL;
  if (mimeType === GOOGLE_SLIDES_MIME) {
    download = new URL(`https://${DRIVE_HOST}/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(PPTX_MIME)}`);
  } else if (mimeType === PPTX_MIME) {
    download = new URL(`https://${DRIVE_HOST}/drive/v3/files/${fileId}?alt=media`);
  } else {
    throw new ImportError('GDRIVE_UNSUPPORTED', 'Only Google Slides files and .pptx files can be imported from Google Drive.');
  }
  const response = await guardedGet(download, guard);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw response.status === 403 || response.status === 404
      ? noAccess()
      : new ImportError('LINK_UNREACHABLE', 'Google Drive could not export this file. Try again in a moment.');
  }
  const bytes = await readLimited(response, maxBytes);
  if (!bytes) throw tooBig(maxBytes);
  if (!looksLikeZip(bytes)) throw new ImportError('GDRIVE_UNSUPPORTED', 'Google Drive did not return a presentation file.');
  return bytes;
}
