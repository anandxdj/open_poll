import { describe, expect, it } from 'bun:test';
import { chartContrastFailures, contrastFailures, contrastRatio, paletteMode } from '../src/modules/themes/contrast';
import { themeFont } from '../src/modules/themes/fonts';
import {
  DEFAULT_THEME_MODE,
  DEFAULT_THEME_PRESET,
  THEME_MODES,
  THEME_PRESETS,
  knownPresetId,
  knownThemeMode,
  presetFor,
  presetSource,
  themeModeOf,
} from '../src/modules/themes/presets';
import { buildTokens, overridesOf, presetTokens } from '../src/modules/themes/resolve';
import { presetViews } from '../src/modules/themes/themes.service';

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('every built-in preset is readable in both modes', () => {
    for (const preset of THEME_PRESETS) {
      for (const mode of THEME_MODES) {
        expect([preset.id, mode, contrastFailures(preset.palettes[mode])]).toEqual([preset.id, mode, []]);
      }
    }
  });

  it('every chart and word cloud colour stands out from its stage, light and dark', () => {
    for (const preset of THEME_PRESETS) {
      for (const mode of THEME_MODES) {
        const palette = preset.palettes[mode];
        expect(palette.chart.length).toBe(12);
        expect([preset.id, mode, chartContrastFailures(palette)]).toEqual([preset.id, mode, []]);
      }
    }
  });

  it('light palettes are light and dark palettes are dark', () => {
    for (const preset of THEME_PRESETS) {
      expect([preset.id, paletteMode(preset.palettes.light.background)]).toEqual([preset.id, 'light']);
      expect([preset.id, paletteMode(preset.palettes.dark.background)]).toEqual([preset.id, 'dark']);
      // The text and the stage swap sides: light ink on a dark stage, dark ink on a light one.
      expect(paletteMode(preset.palettes.light.text)).toBe('dark');
      expect(paletteMode(preset.palettes.dark.text)).toBe('light');
    }
  });

  it('Graph paper light is the app paper: warm, white sheets, ink, the ember fill', () => {
    const light = presetFor(DEFAULT_THEME_PRESET).palettes.light;
    expect(light.background).toBe('#f6f6f3');
    expect(light.surface).toBe('#ffffff');
    expect(light.text).toBe('#171717');
    expect(light.accent).toBe('#cf460c');
    // Light text on light accents would be unreadable; the light palettes keep 4.5:1 for words on the stage too.
    for (const preset of THEME_PRESETS) {
      const palette = preset.palettes.light;
      expect([preset.id, Math.min(...palette.chart.map((color) => contrastRatio(color, palette.background))) >= 4.5]).toEqual([
        preset.id,
        true,
      ]);
      expect([preset.id, contrastRatio(palette.mutedText, palette.surface) >= 4.5]).toEqual([preset.id, true]);
    }
  });

  it('names each failing pair with its ratio', () => {
    const failures = contrastFailures({ ...presetFor('ocean').palettes.dark, text: '#1a2733', accentText: '#38bdf8' });
    expect(failures.map((f) => `${f.foreground}/${f.background}`)).toEqual(['text/background', 'text/surface', 'accentText/accent']);
    expect(failures[0]!.minimum).toBe(4.5);
    expect(failures[0]!.ratio).toBeLessThan(4.5);
    // A dark palette's chart colours on a light stage fail.
    const chart = chartContrastFailures({ background: '#ffffff', chart: ['#fbbf24', '#1d4ed8'] });
    expect(chart).toEqual([{ index: 0, color: '#fbbf24', ratio: 1.67, minimum: 3 }]);
  });
});

describe('presets and tokens', () => {
  it('resolves the old default id and rejects unknown ones', () => {
    expect(knownPresetId('amber')).toBe(DEFAULT_THEME_PRESET);
    expect(knownPresetId('ocean')).toBe('ocean');
    expect(knownPresetId('neon')).toBeNull();
    expect(presetFor('neon').id).toBe(DEFAULT_THEME_PRESET);
  });

  it('defaults to light when no mode is stored', () => {
    expect(DEFAULT_THEME_MODE).toBe('light');
    expect(knownThemeMode('dark')).toBe('dark');
    expect(knownThemeMode('sepia')).toBeNull();
    expect(themeModeOf(undefined)).toBe('light');
    expect(themeModeOf('dark')).toBe('dark');
    expect(presetTokens('ocean', undefined).mode).toBe('light');
    expect(presetTokens('ocean', undefined).colors.background).toBe(presetFor('ocean').palettes.light.background);
    expect(presetTokens('amber', 'dark')).toMatchObject({ presetId: DEFAULT_THEME_PRESET, mode: 'dark', custom: false });
  });

  it('builds Google font links from the allow-list only', () => {
    expect(themeFont('System')).toEqual({ family: 'ui-sans-serif, system-ui, sans-serif', source: 'system', url: null });
    expect(themeFont('Playfair Display')).toEqual({
      family: '"Playfair Display", ui-serif, Georgia, serif',
      source: 'google',
      url: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap',
    });
  });

  it('marks only the plain default as not custom (in either mode), and applies valid overrides', () => {
    const graph = presetFor(DEFAULT_THEME_PRESET);
    expect(buildTokens(presetSource(graph, 'light'), DEFAULT_THEME_PRESET, null, {}, 'light').custom).toBe(false);
    expect(buildTokens(presetSource(graph, 'dark'), DEFAULT_THEME_PRESET, null, {}, 'dark').custom).toBe(false);
    expect(buildTokens(presetSource(presetFor('ocean'), 'dark'), 'ocean', null, {}, 'dark').custom).toBe(true);
    const overridden = presetTokens(DEFAULT_THEME_PRESET, 'dark', { accent: '#38bdf8', accentText: '#04202f' });
    expect(overridden.custom).toBe(true);
    expect(overridden.mode).toBe('dark');
    expect(overridden.colors.accent).toBe('#38bdf8');
    expect(overridesOf({ accent: 'red', accentText: '#04202f', other: '#ffffff' })).toEqual({ accentText: '#04202f' });
    expect(overridesOf(null)).toEqual({});
  });

  it('gives a brand kit the mode of its own stage colour', () => {
    const kit = { name: 'Kit', colors: { ...presetFor('ocean').palettes.light }, fonts: { heading: 'System', body: 'System' } } as const;
    expect(buildTokens(kit, DEFAULT_THEME_PRESET, 'kit').mode).toBe('light');
    expect(buildTokens({ ...kit, colors: presetFor('ocean').palettes.dark }, DEFAULT_THEME_PRESET, 'kit').mode).toBe('dark');
  });

  it('lists every preset light (the default) and in both modes', () => {
    const views = presetViews();
    expect(views.map((view) => view.id)).toEqual(THEME_PRESETS.map((preset) => preset.id));
    for (const view of views) {
      expect(view.tokens.mode).toBe('light');
      expect(view.modes.light.colors.background).toBe(presetFor(view.id).palettes.light.background);
      expect(view.modes.dark.colors.background).toBe(presetFor(view.id).palettes.dark.background);
      expect(view.modes.dark.mode).toBe('dark');
    }
  });
});
