export const INFRA_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNRESET',
  'EPIPE',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'PROTOCOL_CONNECTION_LOST',
  'ER_CON_COUNT_ERROR',
]);

export const INFRA_ERROR_NAMES = new Set([
  'MongoNetworkError',
  'MongoServerSelectionError',
  'MongoTimeoutError',
  'MongoNotConnectedError',
]);
