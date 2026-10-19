import { readLimited, looksLikePdf } from '../bytes';
import { IMPORT_LIMITS } from '../limits';

/**
 * High-fidelity PPTX rendering through a Gotenberg container (LibreOffice):
 * the whole deck becomes a PDF, whose pages stand in for the slides the native
 * parser cannot represent (charts, SmartArt, EMF, video posters). Only used
 * when GOTENBERG_URL is set (`capabilities.pptxHighFidelity`). The URL comes
 * from the operator's configuration, never from a request.
 */

export interface GotenbergOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

export async function renderPptxToPdf(
  baseUrl: string,
  pptx: Uint8Array,
  { fetchImpl = fetch, timeoutMs = IMPORT_LIMITS.gotenberg.timeoutMs, maxBytes = IMPORT_LIMITS.gotenberg.maxPdfBytes }: GotenbergOptions = {},
): Promise<Uint8Array> {
  const form = new FormData();
  form.append(
    'files',
    new Blob([pptx], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }),
    'deck.pptx',
  );
  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/forms/libreoffice/convert`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Gotenberg answered ${response.status}`);
  const pdf = await readLimited(response, maxBytes);
  if (!pdf) throw new Error('Gotenberg returned a PDF larger than the limit');
  if (!looksLikePdf(pdf)) throw new Error('Gotenberg did not return a PDF');
  return pdf;
}
