// Cloudflare Workers entry. Secrets/vars: X402_API_KEY (secret), PAY_TO, PUBLIC_URL, BASE_PATH, AGENT_ID, AGENT_REGISTRY,
// and for "Build with buy": BUY_ENABLED=1, BUY_PRIVATE_KEY (secret), BUY_ASSET (USAT/USDT/USDC), BUY_MAX_PER_DAY,
// plus the BRIEF_GUARD Durable Object binding (class BriefGuard). Without BRIEF_GUARD, /ar/brief stays off.
import { createApp } from './app.js';
import { durableGuard } from './guard.js';
export { BriefGuard } from './guard.js';
import supported from './supported.celo.json';

let app;
export default {
  fetch(req, env, ctx) {
    app ||= createApp({
      payTo: env.PAY_TO, apiKey: env.X402_API_KEY, facilitatorUrl: env.FACILITATOR_URL,
      publicUrl: env.PUBLIC_URL, supported, basePath: env.BASE_PATH || '',
      agent: env.AGENT_ID ? { agentId: env.AGENT_ID, registry: env.AGENT_REGISTRY } : undefined,
      buy: { enabled: env.BUY_ENABLED === '1', privateKey: env.BUY_PRIVATE_KEY, asset: env.BUY_ASSET || 'USAT', maxCallsPerDay: env.BUY_MAX_PER_DAY,
        guard: env.BRIEF_GUARD ? durableGuard(env.BRIEF_GUARD, Number(env.BUY_MAX_PER_DAY) || 20) : undefined },
    });
    return app.fetch(req, env, ctx);
  },
};
