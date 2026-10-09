/**
 * A base error class for operational errors in the application.
 * Operational errors are expected problems (e.g., invalid user input, not found),
 * as opposed to programmer errors.
 */
export class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    // 'fail' for 4xx, 'error' for 5xx
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true; // Mark as an operational error

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid input data.') {
    super(message, 400);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found.') {
    super(message, 404);
  }
}

/**
 * An optional data source (e.g. a forecast provider) could not be used. Not an HTTP error:
 * aggregating endpoints catch it and report the message under `unavailable`, so the message
 * must be safe to show to clients.
 */
export class SourceUnavailableError extends Error {}

/**
 * The upstream provider an endpoint depends on entirely could not be used (502).
 * Single-source endpoints convert a SourceUnavailableError into this.
 */
export class UpstreamError extends AppError {
  constructor(message = 'Upstream provider is unavailable.') {
    super(message, 502);
  }
}
