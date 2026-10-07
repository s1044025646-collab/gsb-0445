/**
 * 统一错误码。所有可预期的输入/状态错误都通过 AppError 抛出，
 * 便于 API 返回固定 code 与 CLI 打印明确原因。
 */
export const ErrorCodes = {
  VALIDATION: 'VALIDATION_ERROR',
  UNKNOWN_LEAF: 'UNKNOWN_LEAF',
  CHAIN_LENGTH: 'CHAIN_LENGTH_MISMATCH',
  CONFLICT_PARENT: 'CONFLICT_PARENT',
  ILLEGAL_FIELD: 'ILLEGAL_FIELD',
  DUPLICATE_ROW_ID: 'DUPLICATE_ROW_ID',
  EMPTY_RECORDS: 'EMPTY_RECORDS',
  INVALID_K: 'INVALID_K',
  K_TOO_LARGE: 'K_TOO_LARGE',
  NO_SOLUTION: 'NO_SOLUTION',
  NOT_FOUND: 'NOT_FOUND',
  VERSION_MISMATCH: 'VERSION_MISMATCH',
  INVALID_VECTOR: 'INVALID_VECTOR',
  CONFLICT: 'CONFLICT',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}
