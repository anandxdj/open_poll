import { describe, expect, it } from 'bun:test';
import { contrastFailures, contrastRatio } from '../src/modules/themes/contrast';
import { themeFont } from '../src/modules/themes/fonts';
import { DEFAULT_THEME_PRESET, THEME_PRESETS, knownPresetId, presetFor } from '../src/modules/themes/presets';
import { buildTokens, overridesOf } from '../src/modules/themes/resolve';

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('every built-in preset is readable', () => {
    for (const preset of THEME_PRESETS) expect([preset.id, contrastFailures(preset.colors)]).toEqual([preset.id, []]);
  });

  it('names each failing pair with its ratio', () => {
    const failures = contrastFailures({ ...presetFor('ocean').colors, text: '#1a2733', accentText: '#38bdf8' });
    expect(failures.map((f) => `${f.foreground}/${f.background}`)).toEqual(['text/background', 'text/surface', 'accentText/accent']);
    expect(failures[0]!.minimum).toBe(4.5);
    expect(failures[0]!.ratio).toBeLessThan(4.5);
  });
});

describe('presets and tokens', () => {
  it('resolves the old default id and rejects unknown ones', () => {
    expect(knownPresetId('amber')).toBe(DEFAULT_THEME_PRESET);
    expect(knownPresetId('ocean')).toBe('ocean');
    expect(knownPresetId('neon')).toBeNull();
    expect(presetFor('neon').id).toBe(DEFAULT_THEME_PRESET);
  });

  it('builds Google font links from the allow-list only', () => {
    expect(themeFont('System')).toEqual({ family: 'ui-sans-serif, system-ui, sans-serif', source: 'system', url: null });
    expect(themeFont('Playfair Display')).toEqual({
      family: '"Playfair Display", ui-serif, Georgia, serif',
      source: 'google',
      url: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap',
    });
  });

  it('marks only the plain default as not custom, and applies valid overrides', () => {
    expect(buildTokens(presetFor(DEFAULT_THEME_PRESET), DEFAULT_THEME_PRESET, null).custom).toBe(false);
    expect(buildTokens(presetFor('ocean'), 'ocean', null).custom).toBe(true);
    const overridden = buildTokens(presetFor(DEFAULT_THEME_PRESET), DEFAULT_THEME_PRESET, null, { accent: '#38bdf8', accentText: '#04202f' });
    expect(overridden.custom).toBe(true);
    expect(overridden.colors.accent).toBe('#38bdf8');
    expect(overridesOf({ accent: 'red', accentText: '#04202f', other: '#ffffff' })).toEqual({ accentText: '#04202f' });
    expect(overridesOf(null)).toEqual({});
  });
});
