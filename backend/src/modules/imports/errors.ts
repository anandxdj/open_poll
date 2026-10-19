import { ApiError } from '../../common/utils/ApiError';

/**
 * A problem with the imported file or link that the user can act on (bad
 * file, private link, too big). The worker marks the job failed with this
 * message and never retries it; any other error is treated as transient.
 */
export class ImportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export const isImportError = (error: unknown): error is ImportError => error instanceof ImportError;

/** A non-retryable job failure from an ApiError the pipeline raised (storage off, policy). */
export function asImportError(error: unknown): ImportError | null {
  if (error instanceof ImportError) return error;
  if (error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500) {
    return new ImportError(error.code ?? 'IMPORT_REJECTED', error.message);
  }
  if (error instanceof ApiError && error.code === 'STORAGE_DISABLED') {
    return new ImportError('STORAGE_DISABLED', 'File storage is not configured on this server, so this file cannot be imported.');
  }
  return null;
}

/** One thing the import could not carry over exactly (shown to the user, never fatal). */
export interface ImportWarning {
  code: string;
  message: string;
  /** 1-based slide or page number in the source, when the warning is about one. */
  slide: number | null;
}

export const warning = (code: string, message: string, slide: number | null = null): ImportWarning => ({
  code,
  message,
  slide,
});
