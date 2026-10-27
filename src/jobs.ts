/**
 * LAX jobs client: list the open jobs, read one job and submit work, with retries and typed errors.
 * fetch only, no runtime dependency, no console output.
 */

export type JobTrack = 'lax-agents' | 'coding-agents' | 'godman-protocols' | 'templates' | 'genesis-tools' | 'seat';

/** A job as GET /registry/jobs and GET /registry/jobs/{id} answer it. */
export interface Job {
  id: string;
  title: string;
  track: JobTrack | string;
  summary?: string | null;
  spec_md?: string | null;
  spec_url?: string | null;
  tests_url?: string | null;
  skills?: string[];
  bounty_usdc: number;
  currency?: string;
  chain?: string;
  deadline: string | null;
  status: string;
  seat?: unknown;
  created_at?: string;
  updated_at?: string | null;
  bid_closes?: string | null;
  selection?: unknown;
  [key: string]: unknown;
}

export interface ListJobsParams {
  track?: JobTrack | string;
  /** 1 to 100 */
  limit?: number;
  offset?: number;
}

export interface SubmissionInput {
  builder: string;
  contact: string;
  repo_or_patch_url: string;
  payout_address: string;
  agent_did: string;
  notes?: string;
}

export interface Submission {
  id: string;
  job_id: string;
  status: string;
  created_at: string;
  [key: string]: unknown;
}

export type LaxJobsErrorCode =
  | 'invalid_input'
  | 'bad_request'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'invalid_response';

export class LaxJobsError extends Error {
  /** The HTTP status, 0 when there was no answer. */
  readonly status: number;
  readonly code: LaxJobsErrorCode;
  constructor(message: string, status: number, code: LaxJobsErrorCode) {
    super(message);
    this.name = 'LaxJobsError';
    this.status = status;
    this.code = code;
  }
}

export interface JobsClientOptions {
  /** Default https://lax.kognai.ai/registry */
  baseUrl?: string;
  /** Default globalThis.fetch */
  fetch?: typeof fetch;
  /** Extra attempts after the first, default 2 */
  retries?: number;
  /** Default a timer */
  sleep?: (ms: number) => Promise<void>;
  /** Per attempt, default 15000 */
  timeoutMs?: number;
}

export interface JobsClient {
  listJobs(params?: ListJobsParams): Promise<{ jobs: Job[]; count: number }>;
  getJob(id: string): Promise<Job>;
  submit(jobId: string, input: SubmissionInput): Promise<Submission>;
}

export const DEFAULT_REGISTRY_URL = 'https://lax.kognai.ai/registry';
const MAX_RETRY_AFTER_MS = 30_000;
const BASE_BACKOFF_MS = 500;
const DID_RE = /^did:[a-z0-9]+:.+/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function codeFor(status: number): LaxJobsErrorCode {
  if (status === 400 || status === 422) return 'bad_request';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'bad_request';
}

function invalid(message: string): LaxJobsError {
  return new LaxJobsError(message, 0, 'invalid_input');
}

function isHttps(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Retry-After in seconds (or an HTTP date), capped at 30 seconds; null when absent or unreadable. */
function retryAfterMs(res: Response): number | null {
  const h = res.headers.get('retry-after');
  if (h === null || h.trim() === '') return null;
  const s = Number(h.trim());
  if (Number.isFinite(s) && s >= 0) return Math.min(s * 1000, MAX_RETRY_AFTER_MS);
  const at = Date.parse(h);
  if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 0), MAX_RETRY_AFTER_MS);
  return null;
}

async function errorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof body.error === 'string' && body.error) return body.error;
    if (typeof body.message === 'string' && body.message) return body.message;
  } catch {
    /* not JSON */
  }
  return text.slice(0, 500) || `HTTP ${res.status}`;
}

export function createJobsClient(options: JobsClientOptions = {}): JobsClient {
  const base = (options.baseUrl ?? DEFAULT_REGISTRY_URL).replace(/\/+$/, '');
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const retries = Math.max(0, Math.floor(options.retries ?? 2));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 15_000;

  /** One request with retries. retryAll: reads retry on 429, 5xx and network errors; submit only on 429. */
  async function request(path: string, init: RequestInit, retryAll: boolean): Promise<unknown> {
    let backoff = BASE_BACKOFF_MS;
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= retries;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await doFetch(base + path, { ...init, signal: ctrl.signal });
      } catch (e) {
        clearTimeout(timer);
        if (retryAll && !last) {
          await sleep(backoff);
          backoff *= 2;
          continue;
        }
        const why = e instanceof Error ? e.message : String(e);
        throw new LaxJobsError(ctrl.signal.aborted ? `request timed out after ${timeoutMs} ms` : why || 'network error', 0, 'network');
      }
      clearTimeout(timer);
      if (res.ok) {
        const text = await res.text().catch(() => '');
        try {
          return JSON.parse(text);
        } catch {
          throw new LaxJobsError('the registry answer is not JSON', res.status, 'invalid_response');
        }
      }
      const retryable = res.status === 429 || (retryAll && res.status >= 500);
      if (retryable && !last) {
        const wait = res.status === 429 ? retryAfterMs(res) : null;
        await res.text().catch(() => '');
        await sleep(wait ?? backoff);
        backoff *= 2;
        continue;
      }
      throw new LaxJobsError(await errorText(res), res.status, codeFor(res.status));
    }
  }

  const getJson = { method: 'GET', headers: { accept: 'application/json' } } as const;

  return {
    async listJobs(params: ListJobsParams = {}) {
      const q = new URLSearchParams();
      if (params.track !== undefined) q.set('track', String(params.track));
      if (params.limit !== undefined) {
        if (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > 100) throw invalid('limit must be an integer from 1 to 100');
        q.set('limit', String(params.limit));
      }
      if (params.offset !== undefined) {
        if (!Number.isInteger(params.offset) || params.offset < 0) throw invalid('offset must be an integer of 0 or more');
        q.set('offset', String(params.offset));
      }
      const qs = q.toString();
      const body = (await request('/jobs' + (qs ? `?${qs}` : ''), getJson, true)) as { jobs?: unknown; count?: unknown } | null;
      if (!body || !Array.isArray(body.jobs)) throw new LaxJobsError('the registry answer has no jobs list', 200, 'invalid_response');
      return { jobs: body.jobs as Job[], count: typeof body.count === 'number' ? body.count : body.jobs.length };
    },

    async getJob(id: string) {
      if (typeof id !== 'string' || id.trim() === '') throw invalid('id is required');
      const body = (await request(`/jobs/${encodeURIComponent(id)}`, getJson, true)) as { job?: unknown } | null;
      if (!body || !body.job || typeof body.job !== 'object') throw new LaxJobsError('the registry answer has no job', 200, 'invalid_response');
      return body.job as Job;
    },

    async submit(jobId: string, input: SubmissionInput) {
      if (typeof jobId !== 'string' || jobId.trim() === '') throw invalid('jobId is required');
      if (!input || typeof input !== 'object') throw invalid('the submission is required');
      if (typeof input.agent_did !== 'string' || !DID_RE.test(input.agent_did)) throw invalid('agent_did must be a DID (did:method:identifier)');
      if (typeof input.payout_address !== 'string' || !ADDRESS_RE.test(input.payout_address)) throw invalid('payout_address must be 0x followed by 40 hex characters');
      if (!isHttps(input.repo_or_patch_url)) throw invalid('repo_or_patch_url must be an https link');
      if (typeof input.builder !== 'string' || input.builder.length < 2 || input.builder.length > 80) throw invalid('builder must be 2 to 80 characters');
      if (typeof input.contact !== 'string' || input.contact.trim() === '') throw invalid('contact is required');
      if (input.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > 2000)) throw invalid('notes must be text of at most 2000 characters');
      const body: Record<string, string> = {
        builder: input.builder,
        contact: input.contact,
        repo_or_patch_url: input.repo_or_patch_url,
        payout_address: input.payout_address,
        agent_did: input.agent_did,
      };
      if (input.notes !== undefined) body.notes = input.notes;
      const res = (await request(
        `/jobs/${encodeURIComponent(jobId)}/submissions`,
        { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) },
        false,
      )) as { submission?: unknown } | null;
      if (!res || !res.submission || typeof res.submission !== 'object') throw new LaxJobsError('the registry answer has no submission', 201, 'invalid_response');
      return res.submission as Submission;
    },
  };
}
