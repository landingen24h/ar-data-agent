// Local validation of a LAX offer, following the registry schema published at
// https://lax.kognai.ai/aiax/sections/lax_offer.json and the POST /registry/offers
// request body in the LAX OpenAPI document. Pure function, no network.
import { LAW_NAMES } from './laws.js';

const MODELS = ['per_call', 'per_minute', 'flat', 'free'];
const RAILS = ['x402', 'usdc', 'usdc-base'];
const AMOUNT = /^[0-9]+(\.[0-9]+)?$/;
const DID = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/;
const isStr = (v) => typeof v === 'string';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function httpsUrl(v) {
  if (!isStr(v)) return false;
  try { return new URL(v).protocol === 'https:'; } catch { return false; }
}

/**
 * @param {unknown} offer
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateOffer(offer) {
  const errors = [];
  const e = (m) => errors.push(m);
  if (!isObj(offer)) return { ok: false, errors: ['offer must be an object'] };
  const o = /** @type {Record<string, any>} */ (offer);

  if (o.lax_version !== undefined && o.lax_version !== '1.0') e('lax_version must be 1.0');
  if (!isStr(o.name) || o.name.length < 3) e('name must be at least 3 characters');
  else if (o.name.length > 80) e('name must be at most 80 characters');
  if (!isStr(o.description) || o.description.length < 20) e('description must be at least 20 characters');
  else if (o.description.length > 600) e('description must be at most 600 characters');
  if (o.category !== undefined && (!isStr(o.category) || o.category.length < 2 || o.category.length > 40)) e('category must be 2 to 40 characters');
  if (o.endpoint === undefined && o.pact_endpoint === undefined) e('endpoint or pact_endpoint is required');
  if (o.endpoint !== undefined && !httpsUrl(o.endpoint)) e('endpoint must be an https url');
  if (o.pact_endpoint !== undefined && !httpsUrl(o.pact_endpoint)) e('pact_endpoint must be an https url');
  if (o.agent_did !== undefined && (!isStr(o.agent_did) || !DID.test(o.agent_did))) e('agent_did must be did:method:identifier');
  if (o.erc8004_identity !== undefined && !isStr(o.erc8004_identity)) e('erc8004_identity must be a string');

  if (!Array.isArray(o.capabilities) || o.capabilities.length < 1) e('capabilities must have at least 1 item');
  else if (o.capabilities.length > 10) e('capabilities must have at most 10 items');
  else {
    const seen = new Set();
    o.capabilities.forEach((c, i) => {
      const at = `capabilities[${i}]`;
      if (!isObj(c)) return e(`${at} must be an object`);
      if (!isStr(c.skill_id) || !c.skill_id) e(`${at}.skill_id is required`);
      else if (seen.has(c.skill_id)) e(`${at}.skill_id is duplicated`);
      else seen.add(c.skill_id);
      if (!isStr(c.description) || !c.description) e(`${at}.description is required`);
      const p = c.pricing;
      if (!isObj(p)) return e(`${at}.pricing is required`);
      if (!MODELS.includes(p.model)) e(`${at}.pricing.model must be one of ${MODELS.join(', ')}`);
      if (!isStr(p.amount) || !AMOUNT.test(p.amount)) e(`${at}.pricing.amount must be a decimal string like 0.05`);
      if (p.currency !== 'USDC') e(`${at}.pricing.currency must be USDC`);
      if (p.rail !== 'x402') e(`${at}.pricing.rail must be x402`);
      if (c.input_schema !== undefined && !isObj(c.input_schema)) e(`${at}.input_schema must be an object`);
      if (c.output_schema !== undefined && !isObj(c.output_schema)) e(`${at}.output_schema must be an object`);
    });
  }

  if (!Array.isArray(o.constitutional_constraints) || !o.constitutional_constraints.every(isStr)) e('constitutional_constraints must be an array of strings');
  else for (const law of LAW_NAMES) if (!o.constitutional_constraints.includes(law)) e(`constitutional_constraints must include ${law}`);

  if (o.payment_rails !== undefined) {
    if (!Array.isArray(o.payment_rails) || !o.payment_rails.every((r) => RAILS.includes(r))) e(`payment_rails items must be one of ${RAILS.join(', ')}`);
  }
  return { ok: errors.length === 0, errors };
}
