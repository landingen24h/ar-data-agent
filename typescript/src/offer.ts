export const FIVE_LAWS = ['Solidarity Oath', 'Renewal Mandate', 'Treasury Equilibrium', 'Harm Shield', 'Transparency Covenant'] as const;

/** The checks the LAX registry runs on an offer (lax_offer section, AIAX 0.1), done locally with no network. */
export function validateOffer(o: any): string[] {
  const e: string[] = [];
  const str = (v: unknown, min: number, max: number) => typeof v === 'string' && v.length >= min && v.length <= max;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['offer must be an object'];
  if (o.lax_version !== undefined && o.lax_version !== '1.0') e.push('lax_version must be "1.0"');
  if (!str(o.name, 3, 80)) e.push('name must be 3 to 80 characters');
  if (!str(o.description, 20, 600)) e.push('description must be 20 to 600 characters');
  if (o.category !== undefined && !str(o.category, 2, 40)) e.push('category must be 2 to 40 characters');
  if (!o.endpoint && !o.pact_endpoint) e.push('endpoint or pact_endpoint is required');
  for (const k of ['endpoint', 'pact_endpoint']) if (o[k] !== undefined && !(typeof o[k] === 'string' && /^https:\/\/[^\s/]+\.[^\s/]+/.test(o[k]))) e.push(`${k} must be an https url`);
  if (o.agent_did !== undefined && !(typeof o.agent_did === 'string' && /^did:[a-z0-9]+:.+/.test(o.agent_did))) e.push('agent_did must be did:method:identifier');
  if (!Array.isArray(o.capabilities) || o.capabilities.length < 1 || o.capabilities.length > 10) e.push('capabilities must have 1 to 10 items');
  else o.capabilities.forEach((c: any, i: number) => {
    if (!c || typeof c.skill_id !== 'string' || !c.skill_id) e.push(`capabilities[${i}].skill_id is required`);
    if (!c || typeof c.description !== 'string' || !c.description) e.push(`capabilities[${i}].description is required`);
    const p = c && c.pricing;
    if (!p || !['per_call', 'per_minute', 'flat', 'free'].includes(p.model)) e.push(`capabilities[${i}].pricing.model must be per_call, per_minute, flat or free`);
    if (!p || typeof p.amount !== 'string' || !/^[0-9]+(\.[0-9]+)?$/.test(p.amount)) e.push(`capabilities[${i}].pricing.amount must be a decimal string`);
    if (!p || p.currency !== 'USDC') e.push(`capabilities[${i}].pricing.currency must be USDC`);
    if (!p || p.rail !== 'x402') e.push(`capabilities[${i}].pricing.rail must be x402`);
  });
  if (!Array.isArray(o.constitutional_constraints) || !FIVE_LAWS.every((l) => o.constitutional_constraints.includes(l))) e.push('constitutional_constraints must include the Five Laws');
  if (o.payment_rails !== undefined && !(Array.isArray(o.payment_rails) && o.payment_rails.every((r: unknown) => ['x402', 'usdc', 'usdc-base'].includes(r as string)))) e.push('payment_rails items must be x402, usdc or usdc-base');
  return e;
}
