// Node entry: X402_API_KEY=... PAY_TO=0x... node src/node.js
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const app = createApp({
  payTo: process.env.PAY_TO,
  apiKey: process.env.X402_API_KEY,
  facilitatorUrl: process.env.FACILITATOR_URL,
  publicUrl: process.env.PUBLIC_URL,
  basePath: process.env.BASE_PATH || '',
  agent: process.env.AGENT_ID ? { agentId: process.env.AGENT_ID, registry: process.env.AGENT_REGISTRY } : undefined,
});
const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port });
console.log(`ar-data-agent listening on :${port}`);
