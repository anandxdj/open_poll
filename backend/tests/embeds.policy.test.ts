import { describe, expect, it } from 'bun:test';
import { normalizeOrigins, parseOrigin } from '../src/modules/embeds/origins';
import { embedPageUrl, fitSize, iframeHtml, parseEmbedPath } from '../src/modules/embeds/policy.service';
import { updateWorkspaceSchema } from '../src/modules/workspaces/workspaces.schema';

const DECK = '64b7f0c2a1b2c3d4e5f60718';
const RESULTS = 'abcdefghijklmnopqrstuvwxyz012345';
const SCREEN = `scr_${'a'.repeat(43)}`;

const path = (value: string) => parseEmbedPath(new URL(value, 'https://openpoll.test'));

describe('embed URLs (W4-D)', () => {
  it('reads the three embed pages and their public twins', () => {
    expect(path('/embed/live/123456')).toEqual({ kind: 'live', id: '123456' });
    expect(path('/live/123456')).toEqual({ kind: 'live', id: '123456' });
    expect(path('/live/123456/')).toEqual({ kind: 'live', id: '123456' });
    expect(path(`/embed/results/${RESULTS}`)).toEqual({ kind: 'results', id: RESULTS });
    expect(path(`/r/${RESULTS}`)).toEqual({ kind: 'results', id: RESULTS });
    expect(path(`/embed/stage/${DECK}?token=${SCREEN}`)).toEqual({ kind: 'stage', id: DECK, token: SCREEN });
  });

  it('refuses other pages and malformed ids', () => {
    for (const value of [
      '/',
      '/live',
      '/live/123456/summary',
      '/embed/live/12',
      '/embed/live/../../home',
      '/embed/results/short',
      `/embed/stage/${DECK}`,
      '/embed/stage/not-an-id?token=x',
      '/embed/other/123456',
      `/presentation/host/${DECK}`,
      '/home',
    ]) {
      expect(path(value)).toBeNull();
    }
  });

  it('builds the embed page URL on the requested origin', () => {
    expect(embedPageUrl('https://polls.example.com', { kind: 'live', id: '123456' })).toBe('https://polls.example.com/embed/live/123456');
    expect(embedPageUrl('https://openpoll.test', { kind: 'stage', id: DECK, token: SCREEN })).toBe(
      `https://openpoll.test/embed/stage/${DECK}?token=${SCREEN}`,
    );
  });
});

describe('oEmbed sizes and HTML', () => {
  it('uses the default size per kind and fits it into maxwidth × maxheight', () => {
    expect(fitSize('live')).toEqual({ width: 420, height: 640 });
    expect(fitSize('results', 600)).toEqual({ width: 600, height: 900 });
    expect(fitSize('live', undefined, 500)).toEqual({ width: 420, height: 500 });
    // The stage keeps 16:9.
    expect(fitSize('stage')).toEqual({ width: 960, height: 540 });
    expect(fitSize('stage', 640)).toEqual({ width: 640, height: 360 });
    expect(fitSize('stage', 2000, 270)).toEqual({ width: 480, height: 270 });
    // Silly limits are clamped.
    expect(fitSize('live', 10, 10)).toEqual({ width: 200, height: 200 });
  });

  it('escapes the source and the title', () => {
    const html = iframeHtml('https://openpoll.test/embed/live/1?a=1&b="2"', 'Quiz <b>"night"</b>', { width: 420, height: 640 });
    expect(html).toBe(
      '<iframe src="https://openpoll.test/embed/live/1?a=1&amp;b=&quot;2&quot;" title="Quiz &lt;b&gt;&quot;night&quot;&lt;/b&gt;" ' +
        'width="420" height="640" style="border:0;max-width:100%" allow="clipboard-write; fullscreen" loading="lazy" ' +
        'referrerpolicy="strict-origin-when-cross-origin"></iframe>',
    );
  });
});

describe('embedding sites', () => {
  it('accepts origins and wildcard subdomains, normalised', () => {
    expect(parseOrigin('https://Example.com/')).toBe('https://example.com');
    expect(parseOrigin(' https://*.example.com ')).toBe('https://*.example.com');
    expect(parseOrigin('http://localhost:8080')).toBe('http://localhost:8080');
    expect(parseOrigin('https://intranet.example.co.uk:8443')).toBe('https://intranet.example.co.uk:8443');
  });

  it('refuses paths, other schemes, bare wildcards and junk', () => {
    for (const value of [
      'example.com',
      'https://example.com/page',
      'https://example.com?x=1',
      'ftp://example.com',
      'https://*',
      'https://*.com',
      "https://example.com 'unsafe-inline'",
      'javascript:alert(1)',
      'https://exa mple.com',
      '*',
    ]) {
      expect(parseOrigin(value)).toBeNull();
    }
    expect(normalizeOrigins(['https://a.com', 'https://A.com/', 'nope', 'https://b.com'])).toEqual(['https://a.com', 'https://b.com']);
  });

  it('validates the workspace setting and normalises what it stores', () => {
    const ok = updateWorkspaceSchema.safeParse({ settings: { embedAllowedOrigins: ['https://Intranet.example.com/', 'https://intranet.example.com'] } });
    expect(ok.success).toBe(true);
    expect(ok.data?.settings?.embedAllowedOrigins).toEqual(['https://intranet.example.com']);
    expect(updateWorkspaceSchema.safeParse({ settings: { embedAllowedOrigins: [] } }).success).toBe(true);

    const bad = updateWorkspaceSchema.safeParse({ settings: { embedAllowedOrigins: ['https://example.com/path'] } });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toContain('is not a site address');
    const tooMany = updateWorkspaceSchema.safeParse({
      settings: { embedAllowedOrigins: Array.from({ length: 21 }, (_, i) => `https://s${i}.example.com`) },
    });
    expect(tooMany.success).toBe(false);
  });
});
