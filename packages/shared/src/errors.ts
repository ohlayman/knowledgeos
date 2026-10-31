export interface ErrorDefinition {
  readonly status: number;
  readonly retryable: boolean;
  readonly message: string;
}

export const ERROR_CODES = {
  INVALID_ARGUMENT: { status: 400, retryable: false, message: '请求参数不合法' },
  TEXT_TOO_LONG: { status: 400, retryable: false, message: '文本超过长度上限' },
  UNSUPPORTED_FORMAT: { status: 415, retryable: false, message: '不支持的文件类型' },
  PDF_PASSWORD_REQUIRED: { status: 422, retryable: false, message: 'PDF 已加密，需要密码' },
  NEEDS_OCR: { status: 422, retryable: false, message: 'PDF 无可提取文字，暂不支持 OCR' },
  FILE_TOO_LARGE: { status: 413, retryable: false, message: '文件超过大小上限' },
  BATCH_TOO_LARGE: { status: 400, retryable: false, message: '单批数量超过上限' },
  SSRF_BLOCKED: { status: 400, retryable: false, message: 'URL 不允许访问' },
  FETCH_FAILED: { status: 502, retryable: true, message: '抓取远程内容失败' },
  NOT_FOUND: { status: 404, retryable: false, message: '资源不存在' },
  DUPLICATE_RESOURCE: { status: 409, retryable: false, message: '资源已存在' },
  JOB_ALREADY_RUNNING: { status: 409, retryable: false, message: '该版本已有进行中的任务' },
  VERSION_CONFLICT: { status: 409, retryable: false, message: '基于旧版本的写入被拒绝' },
  UNAUTHORIZED: { status: 401, retryable: false, message: '未授权' },
  FORBIDDEN_SCOPE: { status: 403, retryable: false, message: '超出授权范围' },
  PROVIDER_UNAVAILABLE: { status: 503, retryable: true, message: '上游服务不可用' },
  PROVIDER_TIMEOUT: { status: 504, retryable: true, message: '上游服务超时' },
  RATE_LIMITED: { status: 429, retryable: true, message: '请求过于频繁' },
  QUOTA_EXCEEDED: { status: 429, retryable: false, message: '配额已耗尽' },
  NO_EVIDENCE: { status: 200, retryable: false, message: '知识库中没有找到足够相关的内容' },
  CITATION_INVALID: { status: 200, retryable: false, message: '引用无法验证' },
  INTERNAL: { status: 500, retryable: true, message: '服务内部错误' },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_CODES;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? ERROR_CODES[code].message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_CODES[this.code].status;
  }

  get retryable(): boolean {
    return ERROR_CODES[this.code].retryable;
  }
}

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    requestId: string;
    details?: unknown;
  };
}

export function toErrorEnvelope(error: unknown, requestId: string): ErrorEnvelope {
  if (error instanceof ApiError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        requestId,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
  }

  return {
    error: {
      code: 'INTERNAL',
      message: ERROR_CODES.INTERNAL.message,
      retryable: ERROR_CODES.INTERNAL.retryable,
      requestId,
    },
  };
}
