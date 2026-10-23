// Runs the starter on Node: PRICE, PAY_TO, NETWORK and FACILITATOR_URL come from the environment.
import { createServer } from 'node:http';
import { createApp } from './app.ts';
import type { Network } from './types.ts';

const app = createApp({
  price: process.env.PRICE || '0.01',
  payTo: process.env.PAY_TO || '',
  network: (process.env.NETWORK || 'base-sepolia') as Network,
  facilitator: process.env.FACILITATOR_URL || 'https://x402.org/facilitator',
});
const port = Number(process.env.PORT || 8787);
createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body });
  const r = await app.fetch(request);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => process.stderr.write(`listening on ${port}\n`));
