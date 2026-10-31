import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_CODES, toErrorEnvelope } from './errors.js';

describe('toErrorEnvelope', () => {
  it('maps a known ApiError to its code, message and retryable flag', () => {
    const envelope = toErrorEnvelope(new ApiError('NOT_FOUND'), 'req_123');

    expect(envelope).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: ERROR_CODES.NOT_FOUND.message,
        retryable: false,
        requestId: 'req_123',
      },
    });
  });

  it('does not leak the message of an unknown error', () => {
    const envelope = toErrorEnvelope(new Error('secret database password'), 'req_456');

    expect(envelope.error.code).toBe('INTERNAL');
    expect(envelope.error.message).not.toContain('secret');
    expect(envelope.error.retryable).toBe(true);
  });

  it('keeps explicit details from an ApiError', () => {
    const envelope = toErrorEnvelope(
      new ApiError('INVALID_ARGUMENT', '文件数量超过上限', { limit: 200 }),
      'req_789',
    );

    expect(envelope.error.details).toEqual({ limit: 200 });
    expect(envelope.error.message).toBe('文件数量超过上限');
  });
});
