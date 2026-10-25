// Cloudflare Workers entry. Secrets/vars: X402_API_KEY (secret), PAY_TO, PUBLIC_URL, BASE_PATH, AGENT_ID, AGENT_REGISTRY,
// and for "Build with buy": BUY_ENABLED=1, BUY_PRIVATE_KEY (secret), BUY_ASSET (USAT/USDT/USDC), BUY_MAX_PER_DAY.
import { createApp } from './app.js';
import supported from './supported.celo.json';

let app;
export default {
  fetch(req, env, ctx) {
    app ||= createApp({
      payTo: env.PAY_TO, apiKey: env.X402_API_KEY, facilitatorUrl: env.FACILITATOR_URL,
      publicUrl: env.PUBLIC_URL, supported, basePath: env.BASE_PATH || '',
      agent: env.AGENT_ID ? { agentId: env.AGENT_ID, registry: env.AGENT_REGISTRY } : undefined,
      buy: { enabled: env.BUY_ENABLED === '1', privateKey: env.BUY_PRIVATE_KEY, asset: env.BUY_ASSET || 'USAT', maxCallsPerDay: env.BUY_MAX_PER_DAY },
    });
    return app.fetch(req, env, ctx);
  },
};
