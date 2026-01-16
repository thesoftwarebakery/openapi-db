/**
 * Typed error class for openapi-db errors.
 * Users can catch this to format error responses.
 */
export class OpenApiDbError extends Error {
  public readonly name = "OpenApiDbError";

  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number = 500,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

/**
 * Known error codes thrown by openapi-db
 */
export type ErrorCode =
  | "SPEC_PARSE_ERROR"
  | "VALIDATION_ERROR"
  | "AUTH_RESOLVER_MISSING"
  | "AUTH_REQUIRED"
  | "INVALID_VARIABLE"
  | "UNKNOWN_FUNCTION"
  | "QUERY_ERROR"
  | "NOT_FOUND";
