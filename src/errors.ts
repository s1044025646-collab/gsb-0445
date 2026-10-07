export type ErrorCode =
  | 'EMPTY_RECORDS'
  | 'K_INVALID'
  | 'K_TOO_LARGE'
  | 'DUPLICATE_ROW_ID'
  | 'TOO_MANY_FIELDS'
  | 'NO_FIELDS'
  | 'TOO_MANY_LEVELS'
  | 'UNKNOWN_LEAF'
  | 'CHAIN_LENGTH_MISMATCH'
  | 'CONFLICTING_PARENT'
  | 'ROOT_MISMATCH'
  | 'INVALID_FIELD'
  | 'MISSING_HIERARCHY'
  | 'VALUE_NOT_IN_HIERARCHY'
  | 'CONSTRAINT_OUT_OF_RANGE'
  | 'NO_FEASIBLE_SOLUTION'
  | 'VECTOR_LENGTH_MISMATCH'
  | 'VECTOR_LEVEL_OUT_OF_RANGE'
  | 'VECTOR_EXCEEDS_CONSTRAINT'
  | 'INFEASIBLE_VECTOR'
  | 'NOT_FOUND'
  | 'BAD_REQUEST';

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}
