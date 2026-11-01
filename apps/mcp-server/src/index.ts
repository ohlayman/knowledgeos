#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HELP_TEXT, HelpRequested, loadConfig, parseArgs } from './config.js';
import { KosApiClient } from './client.js';
import { startHttpServer } from './http.js';
import { createKosServer } from './server.js';

export { KosApiClient } from './client.js';
export { createKosServer } from './server.js';
export { fitToLimit } from './output.js';

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig(options.configPath);

  if (options.http) {
    await startHttpServer(config, options.host, options.port);
    return;
  }

  if (!config.token) {
    throw new Error(
      'stdio 模式需要接入令牌。请在配置文件中提供 token，或设置 KOS_MCP_TOKEN 环境变量。',
    );
  }

  const server = createKosServer(
    new KosApiClient({ apiUrl: config.apiUrl, token: config.token, transport: 'stdio' }),
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main().catch((error: unknown) => {
  if (error instanceof HelpRequested) {
    process.stderr.write(HELP_TEXT);
    process.exit(0);
  }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
