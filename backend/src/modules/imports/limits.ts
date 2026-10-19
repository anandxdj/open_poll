const MB = 1024 * 1024;

/**
 * Every cap the import pipeline enforces, in one place (documented in
 * backend/docs/wiki/modules/imports.md). Parsers take a `limits` argument
 * defaulting to these so tests can lower them.
 */
export const IMPORT_LIMITS = {
  /** A deck holds at most this many slides (presentations request schema). */
  maxSlides: 50,
  /** Source files (matches the `import_source` upload purpose). */
  maxSourceBytes: 100 * MB,

  zip: {
    /** Entries in one archive (PPTX/XLSX). Real decks have a few hundred. */
    maxEntries: 5000,
    /** Declared uncompressed size of all entries together. */
    maxTotalBytes: 400 * MB,
    /** Declared uncompressed size of one entry. */
    maxEntryBytes: 100 * MB,
    /** Uncompressed / compressed, checked for entries larger than `ratioFloorBytes`. */
    maxRatio: 100,
    ratioFloorBytes: 1 * MB,
    /** One XML part (slide, notes, rels). */
    maxXmlBytes: 20 * MB,
  },

  pptx: {
    /** Embedded pictures larger than this are skipped with a warning. */
    maxImageBytes: 20 * MB,
    /** Pictures covering at least this share of the slide make it an image slide. */
    pictureDominantRatio: 0.4,
  },

  pdf: {
    maxPages: 50,
    /** Rendered page width/height cap in pixels (the scale is lowered to fit). */
    maxRenderPx: 1920,
    /** Preferred render scale (2 = sharp on high-DPI projectors). */
    renderScale: 2,
    /** A page larger than this (points, either side) is refused: likely hostile. */
    maxPagePoints: 14400,
  },

  questions: {
    /** Upload size for CSV/XLSX question files. */
    maxBytes: 2 * MB,
    /** Data rows (questions) per file: one deck's worth. */
    maxRows: 50,
    /** Declared uncompressed size of an XLSX (zip) package. */
    maxXlsxUncompressedBytes: 50 * MB,
  },

  gslides: {
    /** Download cap for an exported deck. */
    maxBytes: 100 * MB,
    timeoutMs: 60_000,
    maxRedirects: 3,
  },

  gotenberg: {
    timeoutMs: 120_000,
    maxPdfBytes: 200 * MB,
  },
} as const;

export type ImportLimits = typeof IMPORT_LIMITS;
