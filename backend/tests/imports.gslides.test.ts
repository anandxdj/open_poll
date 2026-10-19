import { describe, expect, it } from 'bun:test';
import { ImportError } from '../src/modules/imports/errors';
import { fetchDriveDeck, fetchPublicDeck, isGoogleExportHost, parseSlidesLink, PPTX_MIME } from '../src/modules/imports/gslides';
import { renderPptxToPdf } from '../src/modules/imports/renderers/gotenberg';
import { isPublicAddress } from '../src/modules/imports/ssrf';
import { buildPptx } from './fixtures/imports/pptx';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe';
const PUBLIC_IP = ['142.250.74.78'];
const resolvePublic = async () => PUBLIC_IP;
const pptx = () => buildPptx({ slides: [{ title: 'From Google' }] });

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;
const fakeFetch = (handler: Handler) => {
  const calls: URL[] = [];
  const impl = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    return handler(url, init);
  }) as typeof fetch;
  return { impl, calls };
};

const bytesResponse = (bytes: Uint8Array, type = PPTX_MIME) =>
  new Response(bytes, { status: 200, headers: { 'content-type': type } });
const redirect = (location: string, status = 307) => new Response(null, { status, headers: { location } });

const code = async (promise: Promise<unknown>) => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ImportError);
  return (error as ImportError).code;
};

describe('parseSlidesLink', () => {
  it('extracts the document id from editor, share and published-style links', () => {
    expect(parseSlidesLink(`https://docs.google.com/presentation/d/${ID}/edit#slide=id.p`)).toBe(ID);
    expect(parseSlidesLink(`https://docs.google.com/presentation/d/${ID}/edit?usp=sharing`)).toBe(ID);
    expect(parseSlidesLink(`  https://docs.google.com/presentation/u/0/d/${ID}/pub  `)).toBe(ID);
  });

  it('rejects other hosts, schemes, credentials and malformed paths', () => {
    for (const link of [
      '',
      'not a url',
      `http://docs.google.com/presentation/d/${ID}/edit`,
      `https://evil.example/presentation/d/${ID}/edit`,
      `https://docs.google.com.evil.example/presentation/d/${ID}/edit`,
      `https://user:pw@docs.google.com/presentation/d/${ID}/edit`,
      `https://drive.google.com/file/d/${ID}/view`,
      'https://docs.google.com/document/d/abc/edit',
      'https://docs.google.com/presentation/d/short/edit',
      `https://docs.google.com/presentation/d/${ID}%2F..%2F/edit`,
      'file:///etc/passwd',
      'https://127.0.0.1/presentation/d/x',
    ]) {
      expect(() => parseSlidesLink(link)).toThrow(ImportError);
    }
  });
});

describe('isGoogleExportHost', () => {
  it('allows the editor host and Google signed download hosts only', () => {
    expect(isGoogleExportHost('docs.google.com')).toBe(true);
    expect(isGoogleExportHost('doc-0k-8g-slides.googleusercontent.com')).toBe(true);
    for (const host of ['evil.com', 'google.com', 'docs.google.com.evil.com', 'googleusercontent.com', 'x.doc-1.googleusercontent.com', 'localhost']) {
      expect(isGoogleExportHost(host)).toBe(false);
    }
  });
});

describe('isPublicAddress', () => {
  it('refuses loopback, private, link-local, metadata and reserved addresses', () => {
    for (const address of [
      '127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
      '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'garbage',
    ]) {
      expect(isPublicAddress(address)).toBe(false);
    }
    for (const address of ['142.250.74.78', '8.8.8.8', '172.32.0.1', '2607:f8b0:4004:c07::65', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(address)).toBe(true);
    }
  });
});

describe('fetchPublicDeck', () => {
  it('downloads the pptx export from docs.google.com', async () => {
    const { impl, calls } = fakeFetch(() => bytesResponse(pptx()));
    const bytes = await fetchPublicDeck(ID, { fetchImpl: impl, resolve: resolvePublic });
    expect(bytes.length).toBeGreaterThan(100);
    expect(String(calls[0])).toBe(`https://docs.google.com/presentation/d/${ID}/export/pptx`);
  });

  it('follows redirects that stay on Google hosts, at most three', async () => {
    const { impl, calls } = fakeFetch((url) =>
      url.hostname === 'docs.google.com'
        ? redirect('https://doc-0k-8g-slides.googleusercontent.com/export/abc')
        : bytesResponse(pptx()),
    );
    await fetchPublicDeck(ID, { fetchImpl: impl, resolve: resolvePublic });
    expect(calls.map((c) => c.hostname)).toEqual(['docs.google.com', 'doc-0k-8g-slides.googleusercontent.com']);

    const loop = fakeFetch(() => redirect(`https://docs.google.com/presentation/d/${ID}/export/pptx`));
    expect(await code(fetchPublicDeck(ID, { fetchImpl: loop.impl, resolve: resolvePublic }))).toBe('LINK_UNREACHABLE');
    expect(loop.calls).toHaveLength(4);
  });

  it('refuses redirects off the allow-list without contacting them', async () => {
    for (const target of ['https://evil.example/x', 'http://docs.google.com/x', 'https://169.254.169.254/latest/meta-data', 'https://docs.google.com:8443/x', 'https://u:p@docs.google.com/x']) {
      const { impl, calls } = fakeFetch(() => redirect(target));
      expect(await code(fetchPublicDeck(ID, { fetchImpl: impl, resolve: resolvePublic }))).toBe('LINK_NOT_ALLOWED');
      expect(calls).toHaveLength(1);
    }
  });

  it('reports a redirect to the Google sign-in page as a private file', async () => {
    const { impl } = fakeFetch(() => redirect('https://accounts.google.com/ServiceLogin?continue=x', 302));
    expect(await code(fetchPublicDeck(ID, { fetchImpl: impl, resolve: resolvePublic }))).toBe('GSLIDES_PRIVATE');
  });

  it('reports 401, 403, 404 and an HTML sign-in page as private', async () => {
    for (const status of [401, 403, 404]) {
      const { impl } = fakeFetch(() => new Response('nope', { status }));
      expect(await code(fetchPublicDeck(ID, { fetchImpl: impl, resolve: resolvePublic }))).toBe('GSLIDES_PRIVATE');
    }
    const html = fakeFetch(() => new Response('<html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));
    expect(await code(fetchPublicDeck(ID, { fetchImpl: html.impl, resolve: resolvePublic }))).toBe('GSLIDES_PRIVATE');
    const notZip = fakeFetch(() => bytesResponse(new TextEncoder().encode('plain text, not a zip'), 'application/octet-stream'));
    expect(await code(fetchPublicDeck(ID, { fetchImpl: notZip.impl, resolve: resolvePublic }))).toBe('GSLIDES_PRIVATE');
  });

  it('never sends a request to a host that resolves to a private address', async () => {
    const { impl, calls } = fakeFetch(() => bytesResponse(pptx()));
    for (const addresses of [['127.0.0.1'], ['10.1.2.3'], ['142.250.74.78', '192.168.0.9'], []]) {
      expect(await code(fetchPublicDeck(ID, { fetchImpl: impl, resolve: async () => addresses }))).toBe('LINK_NOT_ALLOWED');
    }
    expect(calls).toHaveLength(0);
  });

  it('stops reading at the size cap, even without a Content-Length', async () => {
    const big = new Uint8Array(5000);
    big[0] = 0x50;
    big[1] = 0x4b;
    const { impl } = fakeFetch(() => bytesResponse(big));
    expect(await code(fetchPublicDeck(ID, { fetchImpl: impl, resolve: resolvePublic, maxBytes: 1000 }))).toBe('FILE_TOO_LARGE');
  });

  it('turns network failures and timeouts into an unreachable error', async () => {
    const { impl } = fakeFetch(() => {
      throw new TypeError('socket hang up');
    });
    expect(await code(fetchPublicDeck(ID, { fetchImpl: impl, resolve: resolvePublic }))).toBe('LINK_UNREACHABLE');
    const never = (async (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
    expect(await code(fetchPublicDeck(ID, { fetchImpl: never, resolve: resolvePublic, timeoutMs: 30 }))).toBe('LINK_UNREACHABLE');
  });

  it('reports DNS failures as unreachable', async () => {
    const { impl } = fakeFetch(() => bytesResponse(pptx()));
    expect(
      await code(
        fetchPublicDeck(ID, {
          fetchImpl: impl,
          resolve: async () => {
            throw new Error('ENOTFOUND');
          },
        }),
      ),
    ).toBe('LINK_UNREACHABLE');
  });
});

describe('fetchDriveDeck', () => {
  const FILE = '1aBcDeFgHiJkLmNoPqRsTuVwXyZ';

  it('exports a native Slides file with the bearer token', async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const { impl } = fakeFetch((url, init) => {
      seen.push({ url: url.pathname + url.search, auth: new Headers(init?.headers).get('authorization') });
      return url.pathname.endsWith('/export') ? bytesResponse(pptx()) : Response.json({ mimeType: 'application/vnd.google-apps.presentation' });
    });
    await fetchDriveDeck(FILE, 'ya29.token', { fetchImpl: impl, resolve: resolvePublic });
    expect(seen.map((s) => s.auth)).toEqual(['Bearer ya29.token', 'Bearer ya29.token']);
    expect(seen[1]!.url).toContain(`/files/${FILE}/export?mimeType=`);
  });

  it('downloads an uploaded pptx as media and refuses other file types', async () => {
    const pptxFile = fakeFetch((url) => (url.searchParams.get('alt') === 'media' ? bytesResponse(pptx()) : Response.json({ mimeType: PPTX_MIME })));
    await fetchDriveDeck(FILE, 't', { fetchImpl: pptxFile.impl, resolve: resolvePublic });
    const doc = fakeFetch(() => Response.json({ mimeType: 'application/vnd.google-apps.document' }));
    expect(await code(fetchDriveDeck(FILE, 't', { fetchImpl: doc.impl, resolve: resolvePublic }))).toBe('GDRIVE_UNSUPPORTED');
  });

  it('maps access errors and rejects bad ids', async () => {
    const denied = fakeFetch(() => new Response('{}', { status: 403 }));
    expect(await code(fetchDriveDeck(FILE, 't', { fetchImpl: denied.impl, resolve: resolvePublic }))).toBe('GDRIVE_NO_ACCESS');
    const down = fakeFetch(() => new Response('{}', { status: 503 }));
    expect(await code(fetchDriveDeck(FILE, 't', { fetchImpl: down.impl, resolve: resolvePublic }))).toBe('LINK_UNREACHABLE');
    expect(await code(fetchDriveDeck('../../etc', 't'))).toBe('INVALID_LINK');
  });

  it('does not follow a redirect off googleapis.com', async () => {
    const { impl, calls } = fakeFetch(() => redirect('https://evil.example/steal'));
    expect(await code(fetchDriveDeck(FILE, 't', { fetchImpl: impl, resolve: resolvePublic }))).toBe('LINK_NOT_ALLOWED');
    expect(calls).toHaveLength(1);
  });
});

describe('Gotenberg renderer', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7 fake');

  it('posts the deck as a multipart file and returns the PDF', async () => {
    let body: FormData | null = null;
    let url = '';
    const impl = (async (input: string, init?: RequestInit) => {
      url = input;
      body = init!.body as FormData;
      return new Response(pdf, { status: 200 });
    }) as unknown as typeof fetch;
    const out = await renderPptxToPdf('http://gotenberg:3000/', pptx(), { fetchImpl: impl });
    expect(url).toBe('http://gotenberg:3000/forms/libreoffice/convert');
    expect((body!.get('files') as File).name).toBe('deck.pptx');
    expect(Buffer.from(out).toString('latin1')).toStartWith('%PDF-');
  });

  it('rejects errors, non-PDF answers and oversized answers', async () => {
    const respond = (response: Response) => (async () => response) as unknown as typeof fetch;
    await expect(renderPptxToPdf('http://g', pptx(), { fetchImpl: respond(new Response('', { status: 500 })) })).rejects.toThrow(/500/);
    await expect(renderPptxToPdf('http://g', pptx(), { fetchImpl: respond(new Response('<html>')) })).rejects.toThrow(/PDF/);
    await expect(renderPptxToPdf('http://g', pptx(), { fetchImpl: respond(new Response(pdf)), maxBytes: 4 })).rejects.toThrow(/larger/);
  });
});
