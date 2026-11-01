import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export interface McpServerConfig {
  apiUrl: string;
  token?: string;
  allowedOrigins?: string[];
  tls?: { certFile: string; keyFile: string };
}

export interface CliOptions {
  configPath?: string;
  http: boolean;
  host: string;
  port: number;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    configPath: process.env.KOS_MCP_CONFIG,
    http: false,
    host: '127.0.0.1',
    port: 3344,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config') {
      options.configPath = argv[++index];
    } else if (arg === '--http') {
      options.http = true;
    } else if (arg === '--host') {
      options.host = argv[++index] ?? options.host;
    } else if (arg === '--port') {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value <= 0 || value > 65535) {
        throw new Error('--port 必须是 1-65535 之间的整数');
      }
      options.port = value;
    } else if (arg === '--help' || arg === '-h') {
      throw new HelpRequested();
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }

  return options;
}

export class HelpRequested extends Error {}

export function loadConfig(path: string | undefined): McpServerConfig {
  if (!path) {
    return {
      apiUrl: process.env.KOS_API_URL ?? 'http://127.0.0.1:3000',
      ...(process.env.KOS_MCP_TOKEN ? { token: process.env.KOS_MCP_TOKEN } : {}),
    };
  }

  const resolved = resolve(path);
  if (process.platform !== 'win32') {
    const mode = statSync(resolved).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error(
        `配置文件权限必须为 600，当前为 ${mode.toString(8)}。请执行：chmod 600 ${resolved}`,
      );
    }
  }

  const raw = JSON.parse(readFileSync(resolved, 'utf8')) as Partial<McpServerConfig>;
  return {
    apiUrl: raw.apiUrl ?? process.env.KOS_API_URL ?? 'http://127.0.0.1:3000',
    ...((raw.token ?? process.env.KOS_MCP_TOKEN)
      ? { token: raw.token ?? process.env.KOS_MCP_TOKEN }
      : {}),
    ...(raw.allowedOrigins ? { allowedOrigins: raw.allowedOrigins } : {}),
    ...(raw.tls ? { tls: raw.tls } : {}),
  };
}

export const HELP_TEXT = `KnowledgeOS MCP Server

用法：
  kos-mcp --config ./kos-mcp.json            通过 stdio 启动（Claude Code / Cursor）
  kos-mcp --http --port 3344 --config ./kos-mcp.json   通过 Streamable HTTP 启动

配置（JSON）：
  {
    "apiUrl": "http://127.0.0.1:3000",
    "token": "kos_xxxxxxxx",
    "allowedOrigins": ["https://your-client.example"],
    "tls": { "certFile": "/path/cert.pem", "keyFile": "/path/key.pem" }
  }

说明：
  - stdio 模式必须提供 token；配置文件在非 Windows 系统上要求权限 600。
  - HTTP 模式优先使用请求头 Authorization: Bearer kos_...，未提供时回落到配置文件。
  - 环境变量 KOS_MCP_CONFIG / KOS_MCP_TOKEN / KOS_API_URL 可替代部分配置。
`;
