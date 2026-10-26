/**
 * Word cloud layout, kept separate from React so it can be tested.
 *
 * Live, the cloud is calm: a word keeps the spot it first landed on and grows
 * there as people repeat it. Bigger words keep their spot first; a smaller
 * neighbour in the way is nudged to the nearest free space, and new words land
 * with room around them to grow into. When the frame is
 * full (or holds `LIVE_LIMIT` words) the cloud starts over: the top
 * `KEEP_ON_RESET` words stay where they are and the rest make room for what is
 * arriving. A word that dropped out comes back when someone sends it again.
 *
 * For a finished result (`fit`), every word is shown: the whole cloud is laid
 * out at once at the largest size where all of them fit.
 */

export interface Word {
  text: string;
  count: number;
}

/** A word's ink (its glyphs, not its line box) and where that ink sits relative to the line box centre. */
export interface Ink {
  width: number;
  height: number;
  dx: number;
  dy: number;
}

export type Measure = (text: string, fontSize: number) => Ink;

export interface Frame {
  width: number;
  height: number;
}

export type Rotation = 0 | 90 | -90;

export interface PlacedWord extends Word {
  /** Centre of the word's ink, in px from the middle of the frame. */
  x: number;
  y: number;
  rotate: Rotation;
  fontSize: number;
  /** Where the span goes (its line box centre), so the ink lands on `x`, `y`. */
  spanX: number;
  spanY: number;
  /** When it first landed (smaller is older): among equal counts, the older word keeps its spot. */
  age: number;
}

export interface CloudState {
  words: PlacedWord[];
  /** Every word's count at the last update, shown or not, to tell new answers apart. */
  seen: Record<string, number>;
  /** The age the next new word gets. */
  nextAge: number;
}

export type CloudMode = "live" | "fit";

export const EMPTY_CLOUD: CloudState = { words: [], seen: {}, nextAge: 0 };

/** Most words a live cloud shows before it starts over. */
export const LIVE_LIMIT = 40;
/** Words that stay when a live cloud starts over. */
export const KEEP_ON_RESET = 3;

/** Space kept around a word's ink, as a share of its font size (wider across, so neighbours never read as one word). */
const PAD_X = 0.1;
const PAD_Y = 0.04;
/** Room left free along the frame's edges. */
const EDGE = 4;
/**
 * Clearance a new word keeps from each neighbour, as a share of that
 * neighbour's font size (and of its own), so words can grow in place before
 * they touch: the bigger a word, the more room is left around it.
 */
const GROW_ROOM = 0.35;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface PlacedBox extends Box {
  fontSize: number;
}

/** Stable pseudo-random 0..1 from a string seed (FNV-1a), so a word always gets the same choices. */
export function seededRand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Font sizes for a frame: the biggest word takes about a quarter of the height. */
export function sizeRange(frame: Frame) {
  const max = clamp(Math.min(frame.height * 0.24, frame.width * 0.13), 28, 80);
  return { min: clamp(max * 0.22, 12, 16), max };
}

/**
 * A word's size from its count. It grows with every repeat (on a log scale up
 * to 8 answers) and, past that, relative to the most repeated word, so a
 * small session sees words get bigger and bigger without all of them being huge.
 */
export function fontSizeFor(count: number, maxCount: number, range: { min: number; max: number }, scale = 1) {
  const norm = Math.log(Math.max(1, count)) / Math.log(Math.max(8, maxCount));
  return Math.round((range.min + (range.max - range.min) * (0.12 + 0.88 * clamp(norm, 0, 1))) * scale);
}

/** Whether `box` touches any placed box, each grown by `room(itsFontSize)` on every side. */
function overlaps(box: Box, placed: PlacedBox[], room: (fontSize: number) => number = () => 0) {
  for (const p of placed) {
    const r = room(p.fontSize);
    if (box.left < p.right + r && box.right > p.left - r && box.top < p.bottom + r && box.bottom > p.top - r) return true;
  }
  return false;
}

interface Candidate extends Word {
  /** The spot it holds now, for words already shown. */
  at?: { x: number; y: number; rotate: Rotation };
  age: number;
}

/**
 * Places words in the given order: each keeps its spot when it still fits,
 * otherwise takes the first free spot on a spiral around it (or around the
 * middle, for a new word). Words that find no room come back in `overflow`.
 */
function place(items: Candidate[], frame: Frame, measure: Measure, maxCount: number, scale = 1) {
  const range = sizeRange(frame);
  const rotateLimit = range.min + (range.max - range.min) * 0.35;
  const halfW = frame.width / 2 - EDGE;
  const halfH = frame.height / 2 - EDGE;
  const aspect = clamp(frame.width / frame.height, 1, 3);
  const boxes: PlacedBox[] = [];
  const words: PlacedWord[] = [];
  const overflow: Candidate[] = [];

  for (const item of items) {
    const fontSize = fontSizeFor(item.count, maxCount, range, scale);
    // Mentimeter style: about 40% of new small words run vertically. A word keeps
    // its orientation once placed, unless it grows too long to stand in the frame.
    let rotate: Rotation = item.at
      ? item.at.rotate
      : seededRand(item.text) > 0.6 && fontSize <= rotateLimit
        ? seededRand(item.text + "_rot") > 0.5
          ? 90
          : -90
        : 0;
    if (rotate && measure(item.text, fontSize).width > frame.height - 2 * EDGE) rotate = 0;
    const ink = measure(item.text, fontSize);
    const padX = fontSize * PAD_X + 1;
    const padY = fontSize * PAD_Y + 1;
    const w = (rotate ? ink.height + 2 * padY : ink.width + 2 * padX) / 2;
    const h = (rotate ? ink.width + 2 * padX : ink.height + 2 * padY) / 2;
    // A new word keeps clear of its neighbours by a share of the bigger of the
    // two sizes (plus a little for every word); a word already on screen only
    // needs to not touch. A new word that finds no such spot settles for one
    // that only doesn't touch, before the cloud counts as full.
    const growRoom = (other: number) => Math.max(other, fontSize) * GROW_ROOM + range.max * 0.08;
    const start = item.at ?? { x: 0, y: 0 };
    const phase = seededRand(item.text + "_rot") * Math.PI * 2;
    const reach = Math.hypot(frame.width, frame.height);
    const find = (room?: (other: number) => number, hereOnly = false) => {
      const fits = (cx: number, cy: number) => {
        if (Math.abs(cx) + w > halfW || Math.abs(cy) + h > halfH) return null;
        const box = { left: cx - w, top: cy - h, right: cx + w, bottom: cy + h, fontSize };
        return overlaps(box, boxes, room) ? null : box;
      };
      const here = fits(start.x, start.y);
      if (here) return { x: start.x, y: start.y, box: here };
      if (hereOnly) return null;
      // Archimedean spiral around the start, stretched to the frame, in steps of about 3px.
      for (let t = 0.3; 1.6 * t <= reach; ) {
        const radius = 1.6 * t;
        const cx = start.x + radius * Math.cos(t + phase) * aspect;
        const cy = start.y + radius * Math.sin(t + phase);
        const box = fits(cx, cy);
        if (box) return { x: cx, y: cy, box };
        t += Math.min(0.3, 3 / (radius * aspect + 1));
      }
      return null;
    };
    // A word already on screen that now overlaps a bigger one slides just far
    // enough out of the way, rather than jumping to the next free spot.
    const push = () => {
      let x = start.x;
      let y = start.y;
      for (let step = 0; step < 24; step++) {
        x = clamp(x, -halfW + w, halfW - w);
        y = clamp(y, -halfH + h, halfH - h);
        const box = { left: x - w, top: y - h, right: x + w, bottom: y + h, fontSize };
        const hit = boxes.find((p) => box.left < p.right && box.right > p.left && box.top < p.bottom && box.bottom > p.top);
        if (!hit) return { x, y, box };
        // Out along the shallower overlap, away from the other word's centre.
        const dx = Math.min(box.right - hit.left, hit.right - box.left);
        const dy = Math.min(box.bottom - hit.top, hit.bottom - box.top);
        const awayX = x === (hit.left + hit.right) / 2 ? (seededRand(item.text) > 0.5 ? 1 : -1) : Math.sign(x - (hit.left + hit.right) / 2);
        const awayY = y === (hit.top + hit.bottom) / 2 ? (seededRand(item.text + "_y") > 0.5 ? 1 : -1) : Math.sign(y - (hit.top + hit.bottom) / 2);
        if (dx * aspect < dy) x += awayX * (dx + 1);
        else y += awayY * (dy + 1);
      }
      return null;
    };
    const spot = item.at ? (find(undefined, true) ?? push() ?? find()) : (find(growRoom) ?? find());

    if (!spot) {
      overflow.push(item);
      continue;
    }
    boxes.push(spot.box);
    // The span is rotated about its own centre, so its ink offset turns with it.
    const ox = rotate ? -Math.sign(rotate) * ink.dy : ink.dx;
    const oy = rotate ? Math.sign(rotate) * ink.dx : ink.dy;
    words.push({
      text: item.text,
      count: item.count,
      x: spot.x,
      y: spot.y,
      rotate,
      fontSize,
      spanX: Math.round(spot.x - ox),
      spanY: Math.round(spot.y - oy),
      age: item.age,
    });
  }
  return { words, overflow };
}

const byCount = (a: Word, b: Word) => b.count - a.count || a.text.localeCompare(b.text);

/** Every word at once, at the largest size where all of them fit (finished results). */
function fitAll(words: Word[], frame: Frame, measure: Measure): CloudState {
  const sorted = [...words].sort(byCount).map((w, age) => ({ ...w, age }));
  const maxCount = sorted[0]?.count ?? 1;
  // A few words may grow up to 1.6x to fill the frame; many shrink until they fit.
  let laid = place(sorted, frame, measure, maxCount, 1.6);
  for (let scale = 1.6 * 0.85, tries = 0; laid.overflow.length > 0 && tries < 12; scale *= 0.85, tries++) {
    laid = place(sorted, frame, measure, maxCount, scale);
  }
  return { words: laid.words, seen: Object.fromEntries(words.map((w) => [w.text, w.count])), nextAge: sorted.length };
}

/** The next cloud after an update: `prev` is the cloud on screen, `words` every word with its count now. */
export function advance(prev: CloudState, words: Word[], frame: Frame, measure: Measure, mode: CloudMode = "live"): CloudState {
  if (words.length === 0 || frame.width <= 0 || frame.height <= 0) return EMPTY_CLOUD;
  if (mode === "fit") return fitAll(words, frame, measure);

  const counts = new Map(words.map((w) => [w.text, w.count]));
  const maxCount = Math.max(1, ...words.map((w) => w.count));
  const shownNow = new Set(prev.words.map((p) => p.text));

  // On screen and still answered: they keep their spots, biggest first so a big
  // word never moves; among equals the older word keeps its spot.
  const shown: Candidate[] = prev.words
    .filter((p) => counts.has(p.text))
    .map((p) => ({ text: p.text, count: counts.get(p.text)!, at: { x: p.x, y: p.y, rotate: p.rotate }, age: p.age }))
    .sort((a, b) => b.count - a.count || a.age - b.age);
  // New answers for words not on screen: brand new words, or ones that dropped out and came back.
  let nextAge = prev.nextAge;
  const arriving: Candidate[] = words
    .filter((w) => !shownNow.has(w.text) && (prev.seen[w.text] ?? 0) < w.count)
    .sort(byCount)
    .map((w) => ({ ...w, age: nextAge++ }));

  let laid = place([...shown, ...arriving], frame, measure, maxCount);

  const full = laid.overflow.length > 0 || laid.words.length > LIVE_LIMIT;
  if (full && shown.length > 0) {
    // Start over: the top words stay put, everything else gives way to what is arriving.
    const keep = [...shown, ...arriving].sort(byCount).slice(0, KEEP_ON_RESET);
    const kept = new Set(keep.map((k) => k.text));
    laid = place([...keep, ...arriving.filter((a) => !kept.has(a.text))], frame, measure, maxCount);
  }
  if (laid.words.length > LIVE_LIMIT) laid.words = laid.words.slice(0, LIVE_LIMIT);

  return { words: laid.words, seen: Object.fromEntries(counts), nextAge };
}
