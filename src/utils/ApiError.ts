export class ApiError extends Error {
  public statusCode: number;
  public code: string;
  public details?: unknown;

  constructor(statusCode: number, message: string, code = 'ERROR', details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(msg: string, details?: unknown) {
    return new ApiError(400, msg, 'BAD_REQUEST', details);
  }
  static unauthorized(msg = 'Authentication required') {
    return new ApiError(401, msg, 'UNAUTHORIZED');
  }
  static forbidden(msg = 'You do not have permission to do that') {
    return new ApiError(403, msg, 'FORBIDDEN');
  }
  static notFound(msg = 'Resource not found') {
    return new ApiError(404, msg, 'NOT_FOUND');
  }
  static conflict(msg: string) {
    return new ApiError(409, msg, 'CONFLICT');
  }
}
