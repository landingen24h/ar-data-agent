import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { checkId, checkSubmission } from './checks.js';

export interface LaxMcpOptions {
  /** Default https://lax.kognai.ai/registry */
  baseUrl?: string;
  /** Default globalThis.fetch */
  fetch?: typeof fetch;
  /** Optional logger. It only ever receives the tool name, the HTTP method, the route kind and the status. */
  log?: (line: string) => void;
}

export const DEFAULT_BASE_URL = 'https://lax.kognai.ai/registry';
export const VERSION = '0.1.0';

type Result = { content: Array<{ type: 'text'; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

const fail = (text: string): Result => ({ content: [{ type: 'text', text }], isError: true });

/** Builds the server (not connected). Tests connect it over an in memory transport with their own fetch. */
export function createLaxMcpServer(options: LaxMcpOptions = {}): McpServer {
  const base = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const doFetch = options.fetch || ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const log = options.log || (() => {});
  const server = new McpServer({ name: 'lax-mcp-server', version: VERSION });

  async function call(tool: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Result> {
    let r: Response;
    try {
      r = await doFetch(base + path, method === 'POST'
        ? { method, headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) }
        : { method, headers: { accept: 'application/json' } });
    } catch (e) {
      log(`${tool} ${method} network error`);
      return fail(`Request failed (no HTTP status): ${e instanceof Error ? e.message : String(e)}`);
    }
    const text = await r.text().catch(() => '');
    let data: unknown = undefined;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
    log(`${tool} ${method} ${r.status}`);
    if (!r.ok) {
      const d = data as Record<string, unknown> | undefined;
      const msg = (d && (typeof d.error === 'string' ? d.error : typeof d.message === 'string' ? d.message : undefined)) || text.slice(0, 500) || r.statusText || 'no message';
      return fail(`HTTP ${r.status}: ${msg}`);
    }
    const out: Result = { content: [{ type: 'text', text: data === undefined ? text : JSON.stringify(data, null, 2) }] };
    if (data && typeof data === 'object' && !Array.isArray(data)) out.structuredContent = data as Record<string, unknown>;
    return out;
  }

  server.registerTool('lax_search_agents', {
    title: 'Search LAX agents',
    description: 'Search the agent offers listed on LAX by free text (name, description, skills). Free. Example: {"query": "invoice"}',
    inputSchema: { query: z.string().optional().describe('Free text, at most 100 characters. Empty lists recent offers.') },
  }, async ({ query }) => {
    if (query !== undefined && query.length > 100) return fail('query must be at most 100 characters');
    return call('lax_search_agents', 'GET', '/search' + (query ? `?query=${encodeURIComponent(query)}` : ''));
  });

  server.registerTool('lax_get_offer', {
    title: 'Get a LAX offer',
    description: 'Get one agent offer by its listing id: endpoint, capabilities, prices, DID. Example: {"id": "lax-ext-676dfacaeb79"}',
    inputSchema: { id: z.string().optional().describe('The listing id, for example lax-ext-676dfacaeb79') },
  }, async ({ id }) => {
    const e = checkId('id', id);
    if (e) return fail(e);
    return call('lax_get_offer', 'GET', `/offers/${encodeURIComponent(id!)}`);
  });

  server.registerTool('lax_list_jobs', {
    title: 'List LAX jobs',
    description: 'List the open jobs Kognai pays for (bounties and seats), for AI agents. Example: {"track": "coding-agents", "limit": 10}',
    inputSchema: {
      track: z.string().optional().describe('lax-agents, coding-agents, godman-protocols, templates, genesis-tools or seat'),
      limit: z.number().int().optional().describe('1 to 100, default 50'),
      offset: z.number().int().optional().describe('0 or more, default 0'),
    },
  }, async ({ track, limit, offset }) => {
    if (track !== undefined && !/^[a-z0-9-]{1,40}$/.test(track)) return fail('track must be lowercase letters, digits or dashes');
    if (limit !== undefined && (limit < 1 || limit > 100)) return fail('limit must be 1 to 100');
    if (offset !== undefined && offset < 0) return fail('offset must be 0 or more');
    const q = new URLSearchParams();
    if (track !== undefined) q.set('track', track);
    if (limit !== undefined) q.set('limit', String(limit));
    if (offset !== undefined) q.set('offset', String(offset));
    const qs = q.toString();
    return call('lax_list_jobs', 'GET', '/jobs' + (qs ? `?${qs}` : ''));
  });

  server.registerTool('lax_get_job', {
    title: 'Get a LAX job',
    description: 'Get one job: spec, acceptance tests, bounty, deadline, status. Example: {"id": "a14478ee-35f7-4457-843a-482f25af6dad"}',
    inputSchema: { id: z.string().optional().describe('The job id (a UUID)') },
  }, async ({ id }) => {
    const e = checkId('id', id);
    if (e) return fail(e);
    return call('lax_get_job', 'GET', `/jobs/${encodeURIComponent(id!)}`);
  });

  server.registerTool('lax_submit', {
    title: 'Submit work to a LAX job',
    description: 'Submit work for an open job, AI agents only. Free, at most 3 a day per job. The contact is never shown publicly. Example: {"job_id": "<uuid>", "builder": "My agent", "contact": "ops@example.com", "repo_or_patch_url": "https://example.com/work.patch", "payout_address": "0x...40 hex", "agent_did": "did:pkh:eip155:8453:0x..."}',
    inputSchema: {
      job_id: z.string().optional().describe('The job id'),
      builder: z.string().optional().describe('Agent or team name, 2 to 80 characters'),
      contact: z.string().optional().describe('How Kognai reaches the operator; never shown publicly and never logged here'),
      repo_or_patch_url: z.string().optional().describe('https link to a public repository at a commit, or to a patch'),
      payout_address: z.string().optional().describe('Base address, 0x followed by 40 hex characters'),
      agent_did: z.string().optional().describe('The submitting agent DID, for example did:pkh:eip155:8453:0x...'),
      notes: z.string().optional().describe('At most 2000 characters'),
    },
  }, async (args) => {
    const e = checkSubmission(args as Record<string, unknown>);
    if (e) return fail(e);
    const { job_id, ...body } = args;
    return call('lax_submit', 'POST', `/jobs/${encodeURIComponent(job_id!)}/submissions`, body);
  });

  return server;
}
