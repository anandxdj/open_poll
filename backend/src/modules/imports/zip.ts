import { Inflate, zipSync } from 'fflate';
import { ImportError } from './errors';
import { IMPORT_LIMITS } from './limits';

/**
 * A guarded reader for zip archives (PPTX, XLSX) that never trusts the file.
 *
 * Opening reads only the central directory and checks, before anything is
 * inflated:
 * - entry count, declared uncompressed size per entry and in total;
 * - the compression ratio of large entries (zip bombs);
 * - entry names: no absolute paths, `..` segments, backslashes, drive
 *   letters or control characters (path traversal), no duplicates;
 * - no encryption, no zip64 (neither appears in real presentations).
 *
 * Reading an entry inflates it in small slices into a buffer of its
 * *declared* size and stops the moment it would pass that size, so an entry
 * that lies about its size costs a few kilobytes of work, not gigabytes.
 * The total of what was really inflated is capped as well.
 */

export interface ZipLimits {
  maxEntries: number;
  maxTotalBytes: number;
  maxEntryBytes: number;
  maxRatio: number;
  ratioFloorBytes: number;
  /** One XML part (slide, notes, rels); parsers refuse bigger ones. */
  maxXmlBytes?: number;
}

export interface ZipEntryInfo {
  name: string;
  /** Compressed size. */
  size: number;
  /** Declared (and, once read, verified) uncompressed size. */
  originalSize: number;
}

interface Entry extends ZipEntryInfo {
  method: number;
  localOffset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const SLICE = 16 * 1024;

const unsafeName = (name: string) =>
  name.length === 0 ||
  name.length > 1024 ||
  name.startsWith('/') ||
  name.includes('\\') ||
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f]/.test(name) ||
  /^[a-zA-Z]:/.test(name) ||
  name.split('/').some((segment) => segment === '..' || segment === '.');

class Overflow extends Error {}

export class SafeZip {
  private readonly entries = new Map<string, Entry>();
  private readonly view: DataView;
  private inflated = 0;

  private constructor(
    private readonly data: Uint8Array,
    private readonly invalid: (detail: string) => ImportError,
    readonly limits: ZipLimits,
  ) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  /**
   * Reads and checks the central directory. `invalid` builds the error for a
   * file that is not a usable archive (the message names the expected format).
   */
  static open(
    data: Uint8Array,
    invalid: (detail: string) => ImportError,
    limits: ZipLimits = IMPORT_LIMITS.zip,
  ): SafeZip {
    const zip = new SafeZip(data, invalid, limits);
    zip.scan();
    return zip;
  }

  private scan() {
    const { data, view } = this;
    if (data.length < 22 || data[0] !== 0x50 || data[1] !== 0x4b) throw this.invalid('not a zip archive');

    // End-of-central-directory record: the last 22 bytes, or up to 64 KB earlier when the archive has a comment.
    let eocd = -1;
    for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
      if (view.getUint32(i, true) === EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw this.invalid('unreadable archive');
    const count = view.getUint16(eocd + 10, true);
    const directorySize = view.getUint32(eocd + 12, true);
    const directoryOffset = view.getUint32(eocd + 16, true);
    if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      throw this.invalid('archives over 4 GB are not supported');
    }
    if (count > this.limits.maxEntries) throw zipBomb('too many entries');
    if (directoryOffset + directorySize > eocd) throw this.invalid('unreadable archive');

    let total = 0;
    let at = directoryOffset;
    for (let n = 0; n < count; n++) {
      if (at + 46 > data.length || view.getUint32(at, true) !== CENTRAL) throw this.invalid('unreadable archive');
      const flags = view.getUint16(at + 8, true);
      const method = view.getUint16(at + 10, true);
      const size = view.getUint32(at + 20, true);
      const originalSize = view.getUint32(at + 24, true);
      const nameLength = view.getUint16(at + 28, true);
      const extraLength = view.getUint16(at + 30, true);
      const commentLength = view.getUint16(at + 32, true);
      const localOffset = view.getUint32(at + 42, true);
      if (at + 46 + nameLength > data.length) throw this.invalid('unreadable archive');
      const name = new TextDecoder('utf-8').decode(data.subarray(at + 46, at + 46 + nameLength));
      at += 46 + nameLength + extraLength + commentLength;

      if (flags & 1) throw this.invalid('the archive is encrypted');
      if (method !== 0 && method !== 8) throw this.invalid('unsupported compression');
      if (name.endsWith('/')) continue; // directory entry
      if (unsafeName(name)) throw zipBomb('unsafe entry name');
      if (this.entries.has(name)) throw zipBomb('duplicate entry name');
      if (originalSize > this.limits.maxEntryBytes) throw zipBomb('an entry is too large');
      if (originalSize > this.limits.ratioFloorBytes && originalSize > Math.max(size, 1) * this.limits.maxRatio) {
        throw zipBomb('an entry is compressed suspiciously well');
      }
      total += originalSize;
      if (total > this.limits.maxTotalBytes) throw zipBomb('the archive expands too much');
      this.entries.set(name, { name, size, originalSize, method, localOffset });
    }
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  info(name: string): ZipEntryInfo | undefined {
    const entry = this.entries.get(name);
    return entry && { name: entry.name, size: entry.size, originalSize: entry.originalSize };
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  /** The inflated bytes of one entry, or null when the archive has no such entry. */
  read(name: string): Uint8Array | null {
    const entry = this.entries.get(name);
    if (!entry) return null;
    const bytes = this.inflate(entry);
    this.inflated += bytes.length;
    // Belt and braces: the directory was checked, but count what was really inflated.
    if (this.inflated > this.limits.maxTotalBytes) throw zipBomb('the archive expands too much');
    return bytes;
  }

  /** Inflates several entries; missing names are left out. */
  readMany(names: Iterable<string>): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>();
    for (const name of names) {
      const bytes = this.read(name);
      if (bytes) out.set(name, bytes);
    }
    return out;
  }

  /**
   * Every entry, verified, packed into a fresh archive. Another library can
   * then read the copy knowing its declared sizes are the real ones.
   */
  repack(): Uint8Array {
    const files: Record<string, Uint8Array> = {};
    for (const name of this.entries.keys()) files[name] = this.read(name)!;
    return zipSync(files, { level: 1 });
  }

  private inflate(entry: Entry): Uint8Array {
    const { data, view } = this;
    const at = entry.localOffset;
    if (at + 30 > data.length || view.getUint32(at, true) !== LOCAL) throw this.invalid('a part of the archive is corrupt');
    const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
    if (start + entry.size > data.length) throw this.invalid('a part of the archive is corrupt');
    const raw = data.subarray(start, start + entry.size);

    if (entry.method === 0) {
      if (entry.size !== entry.originalSize) throw this.invalid('a part of the archive is corrupt');
      return raw.slice();
    }

    const out = new Uint8Array(entry.originalSize);
    let written = 0;
    const inflater = new Inflate((chunk) => {
      if (written + chunk.length > out.length) throw new Overflow();
      out.set(chunk, written);
      written += chunk.length;
    });
    try {
      if (raw.length === 0) inflater.push(raw, true);
      for (let i = 0; i < raw.length; i += SLICE) inflater.push(raw.subarray(i, i + SLICE), i + SLICE >= raw.length);
    } catch (error) {
      if (error instanceof Overflow) throw zipBomb('an entry is larger than it says');
      throw this.invalid('a part of the archive is corrupt');
    }
    if (written !== out.length) throw this.invalid('a part of the archive is corrupt');
    return out;
  }
}

const zipBomb = (detail: string) =>
  new ImportError('ARCHIVE_REJECTED', `This file was rejected because it looks unsafe (${detail}).`);
