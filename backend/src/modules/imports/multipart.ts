import type { Request } from 'express';
import { ApiError } from '../../common/utils/ApiError';

/**
 * A small, bounded multipart/form-data reader for the question upload (one
 * file ≤ 2 MB plus a few text fields). The body is buffered with a hard cap
 * (the request is cut off as soon as it passes it, whatever Content-Length
 * claimed) and then parsed by the platform's own `Response.formData()`.
 */

export interface MultipartForm {
  file: { name: string; bytes: Uint8Array } | null;
  fields: Record<string, string>;
}

const OVERHEAD_BYTES = 64 * 1024;

const tooLarge = (maxBytes: number) =>
  new ApiError(413, 'File is too large', 'UPLOAD_TOO_LARGE', { maxBytes });

export async function readMultipart(req: Request, options: { maxFileBytes: number; fileField?: string }): Promise<MultipartForm> {
  const contentType = req.headers['content-type'] ?? '';
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) {
    throw new ApiError(415, 'Send the file as multipart/form-data', 'UNSUPPORTED_MEDIA_TYPE');
  }
  const limit = options.maxFileBytes + OVERHEAD_BYTES;
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw tooLarge(options.maxFileBytes);

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        req.off('data', onData);
        req.off('end', onEnd);
        req.off('error', onError);
        req.off('aborted', onError);
      };
      const onData = (chunk: Buffer) => {
        total += chunk.length;
        if (total > limit) {
          cleanup();
          chunks.length = 0;
          // Let the rest of the body drain into nothing; the controller closes the connection after answering.
          req.resume();
          reject(tooLarge(options.maxFileBytes));
          return;
        }
        chunks.push(chunk);
      };
      const onEnd = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(ApiError.badRequest('The upload was interrupted'));
      };
      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', onError);
      req.on('aborted', onError);
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw ApiError.badRequest('The upload was interrupted');
  }

  let entries: Array<[string, string | File]>;
  try {
    const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': contentType } }).formData();
    entries = [...(form as unknown as { entries(): Iterable<[string, string | File]> }).entries()];
  } catch {
    throw ApiError.badRequest('The upload could not be read');
  }

  const fields: Record<string, string> = {};
  let file: MultipartForm['file'] = null;
  for (const [name, value] of entries) {
    if (typeof value === 'string') {
      if (!Object.hasOwn(fields, name)) fields[name] = value;
      continue;
    }
    if (name === (options.fileField ?? 'file') && !file) {
      if (value.size > options.maxFileBytes) throw tooLarge(options.maxFileBytes);
      file = { name: value.name, bytes: new Uint8Array(await value.arrayBuffer()) };
    }
  }
  return { file, fields: Object.assign(Object.create(null), fields) as Record<string, string> };
}
