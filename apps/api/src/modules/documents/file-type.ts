import { extname } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { ApiError } from '@kos/shared';

export interface DetectedFile {
  kind: 'pdf' | 'markdown' | 'text';
  mimeType: string;
}

const TEXT_EXTENSIONS: Record<string, DetectedFile> = {
  '.md': { kind: 'markdown', mimeType: 'text/markdown' },
  '.markdown': { kind: 'markdown', mimeType: 'text/markdown' },
  '.txt': { kind: 'text', mimeType: 'text/plain' },
};

export async function detectFileType(fileName: string, buffer: Buffer): Promise<DetectedFile> {
  if (buffer.length === 0) {
    throw new ApiError('INVALID_ARGUMENT', '文件内容为空');
  }

  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { kind: 'pdf', mimeType: 'application/pdf' };
  }

  const detected = await fileTypeFromBuffer(buffer);
  if (detected) {
    if (detected.mime === 'application/pdf') {
      return { kind: 'pdf', mimeType: 'application/pdf' };
    }
    throw new ApiError('UNSUPPORTED_FORMAT', `不支持的文件类型: ${detected.mime}`);
  }

  const extension = extname(fileName).toLowerCase();
  const textType = TEXT_EXTENSIONS[extension];
  if (!textType) {
    throw new ApiError('UNSUPPORTED_FORMAT', '仅支持 Markdown、纯文本与 PDF');
  }
  if (buffer.includes(0)) {
    throw new ApiError('UNSUPPORTED_FORMAT', '文本文件包含二进制内容');
  }

  return textType;
}
