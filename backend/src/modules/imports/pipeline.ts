import { Types } from 'mongoose';
import { env } from '../../common/config/env';
import { storage } from '../../common/storage/storage';
import { assertCan, type PolicyContext } from '../../common/tenancy/policy';
import { resolveWorkspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { PresentationModel } from '../presentations/models/presentation.model';
import { createPresentation } from '../presentations/crud.service';
import { presentationSlideSchema, type CreatePresentationInput } from '../presentations/presentations.schema';
import { looksLikePdf, looksLikeZip } from './bytes';
import { ImportError, warning, type ImportWarning } from './errors';
import { fetchDriveDeck, fetchPublicDeck, type FetchOptions } from './gslides';
import { IMPORT_LIMITS } from './limits';
import { storeImportImage, toWebImage, type MediaTarget, type WebImage } from './media';
import { DEFAULT_PDF_LIMITS, PdfReader } from './pdf/render';
import { mapPptxDeck, type DraftSlide } from './pptx/map';
import { PptxReader } from './pptx/parse';
import { renderPptxToPdf } from './renderers/gotenberg';
import { readDriveToken } from './queue';
import type { IImportJob } from './import.model';
import { clip, oneLine, truncate } from './text';

/**
 * Runs one import job: read the source, map it to slides, store pictures,
 * create the deck. Everything a person can fix (bad file, private link,
 * storage off) is an ImportError; anything else is treated as transient by the
 * worker and retried.
 */

export interface PipelineDeps {
  fetchImpl?: typeof fetch;
  resolve?: FetchOptions['resolve'];
  /** Gotenberg base URL; null disables rendered fallbacks. Default: GOTENBERG_URL. */
  gotenbergUrl?: string | null;
  /** Default: Redis. */
  driveToken?: (jobId: string) => Promise<string | null>;
  /** Reports a human-readable stage (`Reading slides`, …). */
  stage?: (stage: string) => Promise<void> | void;
  maxSlides?: number;
}

export interface PipelineResult {
  presentationId: string;
  title: string;
  slideCount: number;
  warnings: ImportWarning[];
}

const MAX_WARNINGS = 100;
const MAX_TITLE = 120;
const MAX_ALT = 500;
const MAX_NOTES = 5000;

export const STORAGE_OFF = () =>
  new ImportError('STORAGE_DISABLED', 'File storage is not configured on this server, so this file cannot be imported.');

const mediaTarget = (job: IImportJob): MediaTarget => ({
  workspaceId: String(job.workspaceId),
  userId: String(job.userId),
  jobId: String(job._id),
});

// ---------- Source ----------

async function loadSource(job: IImportJob, deps: PipelineDeps): Promise<{ bytes: Uint8Array; format: 'pptx' | 'pdf' }> {
  if (job.kind === 'gslides') {
    const fetchOptions: FetchOptions = { fetchImpl: deps.fetchImpl, resolve: deps.resolve };
    if (!job.sourceRef) throw new ImportError('SOURCE_MISSING', 'This import has no Google Slides file attached.');
    if (job.viaDrive) {
      const token = await (deps.driveToken ?? readDriveToken)(String(job._id));
      if (!token) throw new ImportError('GDRIVE_TOKEN_EXPIRED', 'The Google Drive permission expired. Pick the file again to retry.');
      return { bytes: await fetchDriveDeck(job.sourceRef, token, fetchOptions), format: 'pptx' };
    }
    return { bytes: await fetchPublicDeck(job.sourceRef, fetchOptions), format: 'pptx' };
  }

  if (!job.sourceKey) throw new ImportError('SOURCE_MISSING', 'This import has no uploaded file attached.');
  if (!storage.enabled) throw STORAGE_OFF();
  const info = await storage.stat(job.sourceKey);
  if (!info) throw new ImportError('SOURCE_MISSING', 'The uploaded file is no longer available. Upload it again.');
  if (info.size > IMPORT_LIMITS.maxSourceBytes) {
    throw new ImportError('FILE_TOO_LARGE', `Files can be at most ${IMPORT_LIMITS.maxSourceBytes / (1024 * 1024)} MB.`);
  }
  const bytes = await (await storage.getObject(job.sourceKey)).bytes();
  const format = job.kind === 'pdf' ? 'pdf' : 'pptx';
  // Judge by content: a renamed file must not reach the wrong parser.
  if (format === 'pdf' ? !looksLikePdf(bytes) : !looksLikeZip(bytes)) {
    throw new ImportError(
      'WRONG_FILE_TYPE',
      format === 'pdf' ? 'This file is not a PDF.' : 'This file is not a PowerPoint (.pptx) presentation.',
    );
  }
  return { bytes, format };
}

// ---------- PPTX ----------

interface Built {
  title: string;
  slides: Record<string, unknown>[];
  warnings: ImportWarning[];
}

const draftText = (slide: Record<string, unknown>): string => {
  const content = (slide.content ?? {}) as { title?: string; subtitle?: string; body?: string; items?: string[]; alt?: string };
  return oneLine([content.title, content.subtitle, content.body, ...(content.items ?? []), content.alt].filter(Boolean).join('. '));
};

const imageDraft = (source: number, text: string, notes: unknown, bytes: Uint8Array): DraftSlide => ({
  slide: {
    type: 'image',
    question: '',
    timeLimit: 0,
    notes: typeof notes === 'string' ? notes : '',
    content: { key: null, url: null, alt: clip(text || `Slide ${source}`, MAX_ALT), fit: 'contain', caption: '' },
  },
  source,
  image: { kind: 'bytes', bytes },
  degraded: [],
  warnings: [],
});

const DEGRADED_TEXT: Record<string, string> = {
  chart: 'a chart',
  smartart: 'a SmartArt diagram',
  ole: 'an embedded object',
  video: 'a video',
  audio: 'audio',
  ink: 'a drawing',
  vector_image: 'a picture in a format browsers cannot show',
  linked_image: 'a linked picture',
  graphic: 'a graphic',
};

/**
 * Slides with content the native mapping lost (charts, SmartArt, …) are
 * replaced by a picture of the slide, rendered through Gotenberg, when it is
 * configured. Without it, the editable text stays and the warnings say what
 * was left out. Slides that map to nothing natively are dropped.
 */
async function withRenderedFallback(
  bytes: Uint8Array,
  hiddenSlides: ReadonlySet<number>,
  slideCount: number,
  drafts: DraftSlide[],
  deps: PipelineDeps,
  warnings: ImportWarning[],
): Promise<DraftSlide[]> {
  const degradedSources = [...new Set(drafts.filter((d) => d.degraded.length > 0).map((d) => d.source))];
  const gotenbergUrl = deps.gotenbergUrl === undefined ? env.gotenbergUrl : deps.gotenbergUrl;
  const dropSkipped = (list: DraftSlide[]) =>
    list.filter((draft) => {
      if (!draft.skip) return true;
      if (draft.degraded.length > 0) {
        draft.warnings.push(
          warning('SLIDE_SKIPPED', `Slide ${draft.source} only held ${draft.degraded.map((k) => DEGRADED_TEXT[k] ?? 'a graphic').join(' and ')} and was skipped.`, draft.source),
        );
      }
      warnings.push(...draft.warnings);
      return false;
    });

  if (degradedSources.length === 0 || !gotenbergUrl || !storage.enabled) return dropSkipped(drafts);

  await deps.stage?.('Rendering slides with charts and diagrams');
  let reader: PdfReader | null = null;
  try {
    const pdf = await renderPptxToPdf(gotenbergUrl, bytes, { fetchImpl: deps.fetchImpl });
    reader = await PdfReader.open(pdf);
    // LibreOffice leaves hidden slides out; fall back to the full count when it kept them.
    const visible = Array.from({ length: slideCount }, (_, i) => i + 1).filter((n) => !hiddenSlides.has(n));
    const pageOf =
      reader.pageCount === visible.length
        ? (slide: number) => visible.indexOf(slide) + 1
        : reader.pageCount === slideCount
          ? (slide: number) => slide
          : null;
    if (!pageOf) throw new Error(`rendered ${reader.pageCount} pages for ${slideCount} slides`);

    const rendered = new Map<number, DraftSlide>();
    for (const source of degradedSources) {
      const page = pageOf(source);
      if (page < 1) continue;
      const original = drafts.filter((d) => d.source === source);
      const text = original.map((d) => draftText(d.slide)).filter(Boolean).join('. ');
      const notes = original.find((d) => typeof d.slide.notes === 'string' && d.slide.notes)?.slide.notes;
      const { png } = await reader.renderPage(page);
      const draft = imageDraft(source, text, notes, png);
      const kinds = [...new Set(original.flatMap((d) => d.degraded))].map((k) => DEGRADED_TEXT[k] ?? 'a graphic');
      draft.warnings.push(
        warning('SLIDE_RENDERED', `Slide ${source} has ${kinds.join(' and ')} that OpenPoll cannot edit, so it was imported as a picture of the slide.`, source),
      );
      rendered.set(source, draft);
    }

    const out: DraftSlide[] = [];
    const placed = new Set<number>();
    for (const draft of drafts) {
      const replacement = rendered.get(draft.source);
      if (!replacement) {
        out.push(draft);
        continue;
      }
      if (!placed.has(draft.source)) {
        placed.add(draft.source);
        out.push(replacement);
      }
    }
    return dropSkipped(out);
  } catch (error) {
    console.error('[Imports] Rendered fallback unavailable:', (error as Error)?.message);
    warnings.push(
      warning(
        'RENDER_UNAVAILABLE',
        'Slides with charts or diagrams could not be rendered as pictures right now, so they were imported as editable text where possible.',
      ),
    );
    return dropSkipped(drafts);
  } finally {
    await reader?.close();
  }
}

async function importPptx(bytes: Uint8Array, job: IImportJob, deps: PipelineDeps): Promise<Built> {
  await deps.stage?.('Reading slides');
  const reader = PptxReader.open(bytes);
  const deck = reader.read();
  if (deck.slides.length === 0) throw new ImportError('EMPTY_DECK', 'This presentation has no slides.');
  const mapped = mapPptxDeck(deck);
  const warnings = [...mapped.warnings];
  const hidden = new Set(deck.slides.filter((s) => s.hidden).map((s) => s.number));

  // Nothing past the deck's slide cap is worth rendering or storing pictures for.
  const maxSlides = deps.maxSlides ?? IMPORT_LIMITS.maxSlides;
  const kept: DraftSlide[] = [];
  let counted = 0;
  for (const draft of mapped.drafts) {
    if (!draft.skip && counted >= maxSlides) {
      warnings.push(warning('SLIDES_LIMIT', `Only the first ${maxSlides} slides were imported (a deck holds at most ${maxSlides}).`));
      break;
    }
    kept.push(draft);
    if (!draft.skip) counted++;
  }

  let drafts = await withRenderedFallback(bytes, hidden, deck.slides.length, kept, deps, warnings);

  await deps.stage?.('Importing pictures');
  const target = mediaTarget(job);
  const cache = new Map<string, { key: string; url: string } | null>();
  let index = 0;
  let storageNotice = false;
  for (const draft of drafts) {
    if (!draft.image) continue;
    const content = draft.slide.content as Record<string, unknown>;
    let web: WebImage | null = null;
    if (draft.image.kind === 'bytes') {
      web = { bytes: draft.image.bytes, mime: 'image/png', ext: 'png' };
    } else {
      const part = draft.image.part;
      const info = reader.zip.info(part);
      if (info && info.originalSize > IMPORT_LIMITS.pptx.maxImageBytes) {
        warnings.push(warning('IMAGE_TOO_LARGE', `Slide ${draft.source}: the picture is larger than ${IMPORT_LIMITS.pptx.maxImageBytes / (1024 * 1024)} MB and was not imported.`, draft.source));
      } else if (cache.has(part)) {
        const hit = cache.get(part);
        if (hit) Object.assign(content, hit);
        continue;
      } else {
        const raw = reader.zip.read(part);
        web = raw ? await toWebImage(raw) : null;
        if (!web) warnings.push(warning('IMAGE_FORMAT_UNSUPPORTED', `Slide ${draft.source}: the picture is in a format that could not be converted and was not imported.`, draft.source));
      }
    }
    if (!web) {
      if (draft.image.kind === 'pptx') cache.set(draft.image.part, null);
      continue;
    }
    if (!storage.enabled) {
      if (!storageNotice) {
        storageNotice = true;
        warnings.push(warning('PICTURES_NOT_STORED', 'File storage is not configured on this server, so pictures were not imported. Add them to the slides by link.'));
      }
      continue;
    }
    const stored = await storeImportImage(target, index++, web);
    Object.assign(content, { key: stored.key, url: stored.url });
    if (draft.image.kind === 'pptx') cache.set(draft.image.part, { key: stored.key, url: stored.url });
  }
  for (const draft of drafts) warnings.push(...draft.warnings);
  drafts = drafts.filter((d) => !d.skip);
  return { title: mapped.title, slides: drafts.map((d) => d.slide), warnings };
}

// ---------- PDF ----------

async function importPdf(bytes: Uint8Array, job: IImportJob, deps: PipelineDeps): Promise<Built> {
  if (!storage.enabled) throw STORAGE_OFF();
  await deps.stage?.('Reading pages');
  const reader = await PdfReader.open(bytes);
  try {
    const warnings: ImportWarning[] = [];
    const total = reader.pageCount;
    if (total === 0) throw new ImportError('EMPTY_DECK', 'This PDF has no pages.');
    const limit = Math.min(total, deps.maxSlides ?? DEFAULT_PDF_LIMITS.maxPages);
    if (total > limit) {
      warnings.push(warning('PAGES_LIMIT', `This PDF has ${total} pages; only the first ${limit} were imported (a deck holds at most ${limit} slides).`));
    }
    const target = mediaTarget(job);
    const slides: Record<string, unknown>[] = [];
    let firstLine = '';
    for (let number = 1; number <= limit; number++) {
      await deps.stage?.(`Importing page ${number} of ${limit}`);
      try {
        const [page, text] = await Promise.all([reader.renderPage(number), reader.pageText(number).catch(() => '')]);
        const stored = await storeImportImage(target, number, { bytes: page.png, mime: 'image/png', ext: 'png' });
        const flat = oneLine(text);
        if (!firstLine && flat) firstLine = flat.split(/[.!?]\s/)[0] ?? flat;
        slides.push({
          type: 'image',
          question: '',
          timeLimit: 0,
          notes: truncate(text, MAX_NOTES).text,
          content: { key: stored.key, url: stored.url, alt: clip(flat || `Page ${number}`, MAX_ALT), fit: 'contain', caption: '' },
        });
      } catch (error) {
        if (!(error instanceof ImportError)) throw error;
        warnings.push(warning('PAGE_SKIPPED', `Page ${number} was skipped: ${error.message}`, number));
      }
    }
    if (slides.length === 0) throw new ImportError('NOTHING_IMPORTED', 'None of the pages in this PDF could be imported.');
    const title = clip((await reader.title()) ?? (firstLine || 'Imported PDF'), MAX_TITLE);
    return { title, slides, warnings };
  } finally {
    await reader.close();
  }
}

// ---------- Deck ----------

/** Validates every slide with the registry's schema; slides it refuses are dropped with a warning. */
export function validateSlides(slides: Record<string, unknown>[], maxSlides: number, warnings: ImportWarning[]) {
  const valid: Record<string, unknown>[] = [];
  slides.forEach((slide, index) => {
    const parsed = presentationSlideSchema.safeParse(slide);
    if (parsed.success) valid.push(parsed.data as unknown as Record<string, unknown>);
    else {
      const issue = parsed.error.issues[0];
      warnings.push(warning('SLIDE_INVALID', `Slide ${index + 1} could not be imported: ${issue?.message ?? 'invalid content'}.`, index + 1));
    }
  });
  if (valid.length > maxSlides) {
    warnings.push(warning('SLIDES_LIMIT', `Only the first ${maxSlides} slides were imported (a deck holds at most ${maxSlides}).`));
    return valid.slice(0, maxSlides);
  }
  return valid;
}

async function contextOf(job: IImportJob): Promise<PolicyContext> {
  try {
    const { workspace, membership } = await resolveWorkspaceContext(String(job.userId), String(job.workspaceId));
    const ctx: PolicyContext = { user: { id: String(job.userId) }, workspace, membership };
    assertCan(ctx, 'deck:create');
    return ctx;
  } catch {
    throw new ImportError('FORBIDDEN', 'You no longer have permission to create presentations in this workspace.');
  }
}

/** Runs the job to a finished deck. Safe to run again after a crash: the deck id is reserved on the job. */
export async function runImportJob(job: IImportJob, deps: PipelineDeps = {}): Promise<PipelineResult> {
  const ctx = await contextOf(job);
  const reserved = job.resultPresentationId ?? new Types.ObjectId();
  if (job.resultPresentationId) {
    const existing = await PresentationModel.findById(job.resultPresentationId).select('title slides.length').lean();
    if (existing) {
      return { presentationId: String(existing._id), title: existing.title, slideCount: existing.slides?.length ?? 0, warnings: job.warnings };
    }
  }

  const { bytes, format } = await loadSource(job, deps);
  const built = format === 'pdf' ? await importPdf(bytes, job, deps) : await importPptx(bytes, job, deps);

  await deps.stage?.('Creating the deck');
  const warnings = built.warnings;
  const slides = validateSlides(built.slides, deps.maxSlides ?? IMPORT_LIMITS.maxSlides, warnings);
  if (slides.length === 0) throw new ImportError('NOTHING_IMPORTED', 'No slides could be imported from this file.');

  const title = clip(job.title ? oneLine(job.title) : built.title, MAX_TITLE) || 'Imported presentation';
  const deck = await createPresentation({ _id: reserved, title, slides } as unknown as CreatePresentationInput, ctx);
  return {
    presentationId: String(deck._id),
    title,
    slideCount: slides.length,
    warnings: warnings.slice(0, MAX_WARNINGS),
  };
}
