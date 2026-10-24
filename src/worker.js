// Cloudflare Workers entry. Secrets/vars: X402_API_KEY (secret), PAY_TO, PUBLIC_URL, BASE_PATH, AGENT_ID, AGENT_REGISTRY.
import { createApp } from './app.js';
import supported from './supported.celo.json';

let app;
export default {
  fetch(req, env, ctx) {
    app ||= createApp({
      payTo: env.PAY_TO, apiKey: env.X402_API_KEY, facilitatorUrl: env.FACILITATOR_URL,
      publicUrl: env.PUBLIC_URL, supported, basePath: env.BASE_PATH || '',
      agent: env.AGENT_ID ? { agentId: env.AGENT_ID, registry: env.AGENT_REGISTRY } : undefined,
    });
    return app.fetch(req, env, ctx);
  },
};
