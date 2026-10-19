import { unzipSync } from 'fflate';
import { ImportError } from './errors';
import { IMPORT_LIMITS } from './limits';

/**
 * A guarded view of a zip archive (PPTX, XLSX). Nothing is inflated until
 * the central directory passed every check:
 *
 * - entry count, declared uncompressed size per entry and in total;
 * - compression ratio of large entries (zip bombs);
 * - entry names: no absolute paths, `..` segments, backslashes or control
 *   characters (path traversal), no duplicates.
 *
 * fflate inflates each entry into a buffer of its *declared* size, so an
 * entry that lies about its size is truncated (and then fails to parse)
 * rather than growing past the checked total.
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
  /** Declared uncompressed size. */
  originalSize: number;
}

const unsafeName = (name: string) =>
  name.length === 0 ||
  name.length > 1024 ||
  name.startsWith('/') ||
  name.includes('\\') ||
  /[\u0000-\u001f]/.test(name) ||
  /^[a-zA-Z]:/.test(name) ||
  name.split('/').some((segment) => segment === '..' || segment === '.');

export class SafeZip {
  private readonly entries = new Map<string, ZipEntryInfo>();
  private inflated = 0;

  private constructor(
    private readonly data: Uint8Array,
    private readonly invalid: (detail: string) => ImportError,
    readonly limits: ZipLimits,
  ) {}

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
    if (this.data.length < 22 || this.data[0] !== 0x50 || this.data[1] !== 0x4b) throw this.invalid('not a zip archive');
    const listed: ZipEntryInfo[] = [];
    try {
      unzipSync(this.data, {
        filter: (file) => {
          listed.push({ name: file.name, size: file.size, originalSize: file.originalSize });
          if (listed.length > this.limits.maxEntries) throw new ZipLimitError('too many entries');
          return false;
        },
      });
    } catch (error) {
      if (error instanceof ZipLimitError) throw zipBomb(error.message);
      throw this.invalid('unreadable archive');
    }

    let total = 0;
    for (const entry of listed) {
      if (unsafeName(entry.name)) throw zipBomb(`unsafe entry name`);
      if (this.entries.has(entry.name)) throw zipBomb('duplicate entry name');
      if (entry.originalSize > this.limits.maxEntryBytes) throw zipBomb('an entry is too large');
      if (
        entry.originalSize > this.limits.ratioFloorBytes &&
        entry.originalSize > Math.max(entry.size, 1) * this.limits.maxRatio
      ) {
        throw zipBomb('an entry is compressed suspiciously well');
      }
      total += entry.originalSize;
      if (total > this.limits.maxTotalBytes) throw zipBomb('the archive expands too much');
      this.entries.set(entry.name, entry);
    }
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  info(name: string): ZipEntryInfo | undefined {
    return this.entries.get(name);
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  /** The inflated bytes of one entry, or null when the archive has no such entry. */
  read(name: string): Uint8Array | null {
    return this.readMany([name]).get(name) ?? null;
  }

  /** Inflates several entries in one pass over the directory. */
  readMany(names: Iterable<string>): Map<string, Uint8Array> {
    const wanted = new Set([...names].filter((name) => this.entries.has(name)));
    const out = new Map<string, Uint8Array>();
    if (wanted.size === 0) return out;
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(this.data, { filter: (file) => wanted.has(file.name) });
    } catch {
      throw this.invalid('a part of the archive is corrupt');
    }
    for (const [name, bytes] of Object.entries(files)) {
      this.inflated += bytes.length;
      // Belt and braces: the directory was checked, but count what we really inflated.
      if (this.inflated > this.limits.maxTotalBytes) throw zipBomb('the archive expands too much');
      out.set(name, bytes);
    }
    return out;
  }
}

class ZipLimitError extends Error {}

const zipBomb = (detail: string) =>
  new ImportError('ARCHIVE_REJECTED', `This file was rejected because it looks unsafe (${detail}).`);
