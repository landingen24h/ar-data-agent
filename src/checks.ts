/** Input checks done before any request. Each returns an error message or null. */
export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const DID = /^did:[a-z0-9]+:.+/;
export const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function checkId(name: string, v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return `${name} is required`;
  if (!ID.test(v)) return `${name} must be letters, digits, dot, dash or underscore (at most 128)`;
  return null;
}

export function checkHttps(name: string, v: unknown): string | null {
  if (typeof v !== 'string') return `${name} is required`;
  let u: URL;
  try { u = new URL(v); } catch { return `${name} must be an https link`; }
  if (u.protocol !== 'https:' || !u.hostname.includes('.')) return `${name} must be an https link`;
  return null;
}

export function checkSubmission(a: Record<string, unknown>): string | null {
  const id = checkId('job_id', a.job_id);
  if (id) return id;
  if (typeof a.builder !== 'string' || a.builder.length < 2 || a.builder.length > 80) return 'builder must be 2 to 80 characters';
  if (typeof a.contact !== 'string' || !a.contact.trim()) return 'contact is required';
  const link = checkHttps('repo_or_patch_url', a.repo_or_patch_url);
  if (link) return link;
  if (typeof a.payout_address !== 'string' || !ADDRESS.test(a.payout_address)) return 'payout_address must be 0x followed by 40 hex characters';
  if (typeof a.agent_did !== 'string' || !DID.test(a.agent_did)) return 'agent_did must look like did:method:identifier';
  if (a.notes !== undefined && (typeof a.notes !== 'string' || a.notes.length > 2000)) return 'notes must be text of at most 2000 characters';
  return null;
}
