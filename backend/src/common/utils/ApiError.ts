export class ApiError extends Error {
    public statusCode: number;
    /** Stable machine-readable reason (e.g. FEATURE_NOT_IN_PLAN), sent as `code` when set. */
    public code?: string;
    /** Extra JSON-safe context sent as `details` (e.g. the limit that was hit). */
    public details?: Record<string, unknown>;

    constructor(statusCode: number, message: string, code?: string, details?: Record<string, unknown>) {
      super(message);
      this.statusCode = statusCode;
      if (code) this.code = code;
      if (details) this.details = details;
      Error.captureStackTrace(this, this.constructor);
    }

    static badRequest(message = "Bad request") { return new ApiError(400, message); }


    static unauthorized(message = "Unauthorized") { return new ApiError(401, message); }


    static forbidden(message = "Forbidden") { return new ApiError(403, message); }


    static notFound(message = "Not found") { return new ApiError(404, message); }


    static conflict(message = "Conflict") { return new ApiError(409, message); }

    static tooManyRequests(message = "Too many requests, slow down") { return new ApiError(429, message); }

    static internal(message = "Internal server error") { return new ApiError(500, message); }
  }
