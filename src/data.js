// Argentine public-data functions behind the paid routes.
// Pure validators (CUIT, CBU) run offline. Market data comes from public sources:
//   dolar     -> dolarapi.com
//   inflacion -> api.argentinadatos.com (INDEC CPI series)
//   feriados  -> api.argentinadatos.com (national holidays)
// Every function returns { ok: true, data } or { ok: false, error, status }.
// Input is validated BEFORE payment, so a bad request is never charged.

const UA = 'ar-data-agent/1.0 (+https://github.com/landingen24h/ar-data-agent)';

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

// ---------- tiny TTL cache so upstreams are not hammered ----------
const cache = new Map();
export function clearCache() { cache.clear(); }
async function getJson(url, ttlSec, fetchImpl = fetch) {
  const hit = cache.get(url);
  if (hit && hit.exp > Date.now()) return hit.val;
  try {
    const r = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const val = await r.json();
    cache.set(url, { val, exp: Date.now() + ttlSec * 1000 });
    return val;
  } catch { return null; }
}

// ---------- CUIT / CUIL ----------
export function parseCuit(q) {
  const raw = clean(q.cuit ?? q.cuil ?? q.value, 40);
  if (!raw) return { ok: false, error: 'cuit_required', status: 400 };
  return { ok: true, input: { cuit: raw } };
}
export function validateCuit({ cuit: raw }) {
  const s = raw.replace(/\D/g, '');
  const out = { input: raw, normalized: s, valid: false };
  if (s.length !== 11) return { ...out, reason: 'must_have_11_digits' };
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = w.reduce((a, x, i) => a + x * Number(s[i]), 0);
  let dv = 11 - (sum % 11); if (dv === 11) dv = 0;
  const pre = s.slice(0, 2);
  const kind = ['20', '23', '24', '27'].includes(pre) ? 'person' : ['30', '33', '34'].includes(pre) ? 'company' : 'unknown';
  out.formatted = `${s.slice(0, 2)}-${s.slice(2, 10)}-${s[10]}`;
  out.prefix = pre; out.entity_type = kind; out.expected_check_digit = dv === 10 ? null : dv;
  out.valid = dv !== 10 && dv === Number(s[10]) && kind !== 'unknown';
  if (!out.valid) out.reason = kind === 'unknown' ? 'unknown_prefix' : 'check_digit_mismatch';
  out.note = 'Checksum and prefix validation only (offline); does not query ARCA (ex AFIP).';
  return out;
}

// ---------- CBU / CVU ----------
const BANKS = { '007': 'Banco de Galicia', '011': 'Banco de la Nacion Argentina', '014': 'Banco de la Provincia de Buenos Aires', '015': 'ICBC Argentina', '017': 'BBVA Argentina', '027': 'Banco Supervielle', '029': 'Banco de la Ciudad de Buenos Aires', '034': 'Banco Patagonia', '044': 'Banco Hipotecario', '072': 'Banco Santander Argentina', '150': 'HSBC Argentina', '191': 'Banco Credicoop', '285': 'Banco Macro', '299': 'Banco Comafi' };
export function parseCbu(q) {
  const raw = clean(q.cbu ?? q.cvu ?? q.value, 60);
  if (!raw) return { ok: false, error: 'cbu_required', status: 400 };
  return { ok: true, input: { cbu: raw } };
}
export function validateCbu({ cbu: raw }) {
  const s = raw.replace(/\D/g, '');
  const out = { input: raw, normalized: s, valid: false };
  if (s.length !== 22) return { ...out, reason: 'must_have_22_digits' };
  const dvOf = (d, w) => (10 - (d.split('').reduce((a, c, i) => a + Number(c) * w[i % w.length], 0) % 10)) % 10;
  const ok1 = dvOf(s.slice(0, 7), [7, 1, 3, 9]) === Number(s[7]);
  const ok2 = dvOf(s.slice(8, 21), [3, 9, 7, 1]) === Number(s[21]);
  const isCvu = s.startsWith('000');
  out.type = isCvu ? 'CVU' : 'CBU';
  out.entity_code = s.slice(0, 3);
  if (isCvu) { out.psp_code = s.slice(3, 7); out.bank_name = null; }
  else { out.branch_code = s.slice(3, 7); out.bank_name = BANKS[s.slice(0, 3)] || null; }
  out.block1_ok = ok1; out.block2_ok = ok2; out.valid = ok1 && ok2;
  if (!out.valid) out.reason = 'check_digit_mismatch';
  out.formatted = `${s.slice(0, 8)} ${s.slice(8)}`;
  out.note = 'Check-digit validation only (offline); does not confirm the account exists or its owner.';
  return out;
}

// ---------- Dolar (USD/ARS quotes) ----------
export const CASAS = ['oficial', 'blue', 'bolsa', 'contadoconliqui', 'mayorista', 'cripto', 'tarjeta'];
export function parseDolar(q) {
  let c = clean(q.casa ?? q.type ?? 'all', 20).toLowerCase().replace(/[^a-z]/g, '');
  const alias = { mep: 'bolsa', ccl: 'contadoconliqui', contadoconliquidacion: 'contadoconliqui', crypto: 'cripto', card: 'tarjeta', official: 'oficial', wholesale: 'mayorista', todos: 'all', '': 'all' };
  if (alias[c]) c = alias[c];
  if (c !== 'all' && !CASAS.includes(c)) return { ok: false, error: `casa_must_be_one_of_all_${CASAS.join('_')}`, status: 400 };
  return { ok: true, input: { casa: c } };
}
export async function getDolar({ casa }, fetchImpl) {
  const j = await getJson('https://dolarapi.com/v1/dolares', 300, fetchImpl);
  if (!Array.isArray(j) || !j.length) return { ok: false, error: 'rates_source_unavailable', status: 502 };
  const quotes = j.filter(x => x && (casa === 'all' || x.casa === casa)).map(x => ({
    casa: x.casa, nombre: x.nombre, compra: x.compra, venta: x.venta,
    spread: typeof x.compra === 'number' && typeof x.venta === 'number' ? Math.round((x.venta - x.compra) * 100) / 100 : null,
    updated_at: x.fechaActualizacion,
  }));
  if (!quotes.length) return { ok: false, error: 'casa_not_available', status: 502 };
  const by = Object.fromEntries(quotes.map(x => [x.casa, x]));
  const data = { currency_pair: 'USD/ARS', casa, quotes, source: 'DolarApi.com (public Argentine market quotes)', note: 'ARS per 1 USD. Market quotes, not financial advice.' };
  if (by.blue && by.oficial && by.oficial.venta) data.brecha_blue_vs_oficial_pct = Math.round((by.blue.venta / by.oficial.venta - 1) * 10000) / 100;
  return { ok: true, data };
}

// ---------- Inflacion (INDEC CPI) ----------
export function parseInflacion(q) {
  const input = {};
  const m = v => { const s = clean(v, 8); return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : null; };
  if (q.from != null && q.from !== '') { input.from = m(q.from); if (!input.from) return { ok: false, error: 'from_must_be_YYYY-MM', status: 400 }; }
  if (q.to != null && q.to !== '') { input.to = m(q.to); if (!input.to) return { ok: false, error: 'to_must_be_YYYY-MM', status: 400 }; }
  if (input.to && !input.from) return { ok: false, error: 'from_required_with_to', status: 400 };
  if (input.from && input.to && input.to < input.from) return { ok: false, error: 'to_must_be_after_from', status: 400 };
  if (q.amount != null && q.amount !== '') { const a = Number(q.amount); if (!Number.isFinite(a) || a < 0 || a > 1e15) return { ok: false, error: 'amount_must_be_number_0_to_1e15', status: 400 }; input.amount = a; }
  return { ok: true, input };
}
export async function getInflacion(input, fetchImpl) {
  const base = 'https://api.argentinadatos.com/v1/finanzas/indices/';
  const mo = await getJson(base + 'inflacion', 21600, fetchImpl);
  const ya = await getJson(base + 'inflacionInteranual', 21600, fetchImpl);
  if (!Array.isArray(mo) || !mo.length) return { ok: false, error: 'inflation_source_unavailable', status: 502 };
  const mm = mo.map(x => ({ month: String(x.fecha).slice(0, 7), pct: x.valor })).sort((a, b) => (a.month < b.month ? -1 : 1));
  const last = mm[mm.length - 1];
  const yy = Array.isArray(ya) && ya.length ? ya[ya.length - 1] : null;
  const data = { country: 'AR', index: 'IPC INDEC (consumer prices, national)', latest_month: last.month, latest_monthly_pct: last.pct, latest_yoy_pct: yy ? yy.valor : null, last_12_months: mm.slice(-12), source: 'argentinadatos.com (INDEC CPI series)' };
  if (input.from) {
    const to = input.to || last.month;
    const sel = mm.filter(x => x.month >= input.from && x.month <= to);
    if (!sel.length) return { ok: false, error: 'no_data_for_range', status: 400 };
    const f = sel.reduce((a, x) => a * (1 + x.pct / 100), 1);
    data.range = { from: sel[0].month, to: sel[sel.length - 1].month, months: sel.length, cumulative_pct: Math.round((f - 1) * 10000) / 100, factor: Math.round(f * 1e6) / 1e6, note: "Compounded monthly CPI from the start of 'from' to the end of 'to'." };
    if (input.amount != null) { data.range.amount = input.amount; data.range.adjusted_amount = Math.round(input.amount * f * 100) / 100; }
  }
  return { ok: true, data };
}

// ---------- Feriados + business days ----------
export function parseFeriados(q, now = new Date()) {
  const input = {};
  const ar = new Date(now.getTime() - 3 * 3600e3); // Argentina is UTC-3, no DST
  if (q.date != null && q.date !== '') {
    const d = clean(q.date, 12);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d + 'T00:00:00Z'))) return { ok: false, error: 'date_must_be_YYYY-MM-DD', status: 400 };
    input.date = d;
  }
  const y = q.year != null && q.year !== '' ? Number(q.year) : input.date ? Number(input.date.slice(0, 4)) : ar.getUTCFullYear();
  if (!Number.isInteger(y) || y < 2016 || y > ar.getUTCFullYear() + 1) return { ok: false, error: `year_must_be_2016_to_${ar.getUTCFullYear() + 1}`, status: 400 };
  input.year = y;
  if (q.add_business_days != null && q.add_business_days !== '') {
    const n = Number(q.add_business_days);
    if (!Number.isInteger(n) || n < 1 || n > 60) return { ok: false, error: 'add_business_days_must_be_1_to_60', status: 400 };
    if (!input.date) return { ok: false, error: 'date_required_with_add_business_days', status: 400 };
    input.add = n;
  }
  return { ok: true, input };
}
export async function getFeriados(input, fetchImpl) {
  const years = [input.year];
  if (input.date && (input.add || input.date.slice(5) >= '12-01')) years.push(input.year + 1);
  const hol = {}; let list = null;
  for (const y of years) {
    const j = await getJson(`https://api.argentinadatos.com/v1/feriados/${y}`, 21600, fetchImpl);
    if (!Array.isArray(j)) { if (y === input.year) return { ok: false, error: 'holidays_source_unavailable', status: 502 }; continue; }
    if (y === input.year) list = j.map(x => ({ date: x.fecha, name: x.nombre, type: x.tipo }));
    for (const x of j) hol[x.fecha] = x.nombre;
  }
  const data = { country: 'AR', year: input.year, holidays: list, count: list.length, source: 'argentinadatos.com (national holidays, incl. puentes turisticos)', note: 'National holidays only; provincial and municipal holidays are not included.' };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const biz = s => { const wd = new Date(s + 'T00:00:00Z').getUTCDay(); return wd !== 0 && wd !== 6 && !hol[s]; };
  if (input.date) {
    const wd = new Date(input.date + 'T00:00:00Z').getUTCDay();
    data.date_check = { date: input.date, weekday: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][wd], is_weekend: wd === 0 || wd === 6, is_holiday: !!hol[input.date], holiday_name: hol[input.date] || null, is_business_day: biz(input.date) };
    let t = Date.parse(input.date + 'T00:00:00Z'), s;
    do { t += 864e5; s = iso(t); } while (!biz(s));
    data.date_check.next_business_day = s;
    if (input.add) {
      let t2 = Date.parse(input.date + 'T00:00:00Z'), k = 0, s2;
      while (k < input.add) { t2 += 864e5; s2 = iso(t2); if (biz(s2)) k++; }
      data.date_check.add_business_days = input.add; data.date_check.result_date = s2;
    }
  }
  return { ok: true, data };
}
