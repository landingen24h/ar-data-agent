import { createServer } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createLaxMcpServer, VERSION } from './server.js';

/** Logs go to stderr only, so stdout carries nothing but protocol messages. */
const log = (line: string) => process.stderr.write(`[lax-mcp] ${line}\n`);

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): { mode: 'stdio' | 'http'; port: number; baseUrl?: string } {
  const http = argv.includes('--http');
  const pi = argv.indexOf('--port');
  const bi = argv.indexOf('--base-url');
  const port = Number(pi >= 0 ? argv[pi + 1] : env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be 1 to 65535');
  return { mode: http ? 'http' : 'stdio', port, baseUrl: bi >= 0 ? argv[bi + 1] : env.LAX_BASE_URL || undefined };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes('--help')) { process.stderr.write('lax-mcp [--http] [--port N] [--base-url URL]\n'); return; }
  if (argv.includes('--version')) { process.stderr.write(VERSION + '\n'); return; }
  const opts = parseArgs(argv);
  if (opts.mode === 'stdio') {
    await createLaxMcpServer({ baseUrl: opts.baseUrl, log }).connect(new StdioServerTransport());
    log('ready on stdio');
    return;
  }
  // Stateless Streamable HTTP: a fresh server and transport per request.
  const http = createServer(async (req, res) => {
    if (req.url !== '/mcp') { res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"use /mcp"}'); return; }
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST', 'content-type': 'application/json' }).end('{"error":"method not allowed"}'); return; }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"invalid JSON"}'); return; }
    const server = createLaxMcpServer({ baseUrl: opts.baseUrl, log });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((ok) => http.listen(opts.port, ok));
  log(`ready on http://localhost:${opts.port}/mcp`);
}
