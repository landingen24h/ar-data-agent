import { describe, it, expect, beforeEach } from 'vitest';
import * as d from '../src/data.js';

const mockFetch = routes => async url => {
  const body = routes[url];
  if (body === undefined) return new Response('nope', { status: 404 });
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};
beforeEach(() => d.clearCache());

describe('CUIT', () => {
  it('accepts a valid CUIT with dashes', () => {
    const r = d.validateCuit({ cuit: '20-12345678-6' });
    expect(r.valid).toBe(true); expect(r.entity_type).toBe('person'); expect(r.formatted).toBe('20-12345678-6');
  });
  it('rejects a wrong check digit and reports the expected one', () => {
    const r = d.validateCuit({ cuit: '20123456785' });
    expect(r.valid).toBe(false); expect(r.reason).toBe('check_digit_mismatch'); expect(r.expected_check_digit).toBe(6);
  });
  it('flags a company prefix and bad length', () => {
    expect(d.validateCuit({ cuit: '30-71234567-1' }).entity_type).toBe('company');
    expect(d.validateCuit({ cuit: '123' }).reason).toBe('must_have_11_digits');
  });
  it('requires input', () => expect(d.parseCuit({}).ok).toBe(false));
});

describe('CBU', () => {
  it('validates both check digits and names the bank', () => {
    const r = d.validateCbu({ cbu: '0070999003000412345671' });
    expect(r.type).toBe('CBU'); expect(r.bank_name).toBe('Banco de Galicia');
    expect(typeof r.valid).toBe('boolean'); expect(r.block1_ok).toBe(true);
  });
  it('detects CVU and bad length', () => {
    expect(d.validateCbu({ cbu: '0000003100010000000001' }).type).toBe('CVU');
    expect(d.validateCbu({ cbu: '1234' }).reason).toBe('must_have_22_digits');
  });
  it('a one-digit change breaks validity', () => {
    const good = '2850590940090418135201';
    const g = d.validateCbu({ cbu: good });
    const bad = d.validateCbu({ cbu: good.slice(0, 21) + String((Number(good[21]) + 1) % 10) });
    if (g.valid) expect(bad.valid).toBe(false);
  });
});

describe('dolar', () => {
  const src = { 'https://dolarapi.com/v1/dolares': [
    { casa: 'oficial', nombre: 'Oficial', compra: 1000, venta: 1050, fechaActualizacion: '2026-10-24T12:00:00Z' },
    { casa: 'blue', nombre: 'Blue', compra: 1200, venta: 1260, fechaActualizacion: '2026-10-24T12:00:00Z' },
  ] };
  it('maps aliases and rejects unknown casas', () => {
    expect(d.parseDolar({ casa: 'MEP' }).input.casa).toBe('bolsa');
    expect(d.parseDolar({ casa: 'ccl' }).input.casa).toBe('contadoconliqui');
    expect(d.parseDolar({ casa: 'euro' }).ok).toBe(false);
  });
  it('computes spread and brecha', async () => {
    const r = await d.getDolar({ casa: 'all' }, mockFetch(src));
    expect(r.ok).toBe(true); expect(r.data.quotes).toHaveLength(2);
    expect(r.data.brecha_blue_vs_oficial_pct).toBe(20); expect(r.data.quotes[0].spread).toBe(50);
  });
  it('returns 502 when the source is down', async () => {
    const r = await d.getDolar({ casa: 'all' }, mockFetch({}));
    expect(r).toMatchObject({ ok: false, status: 502 });
  });
});

describe('inflacion', () => {
  const base = 'https://api.argentinadatos.com/v1/finanzas/indices/';
  const src = { [base + 'inflacion']: [{ fecha: '2026-07-31', valor: 2 }, { fecha: '2026-08-31', valor: 3 }, { fecha: '2026-09-30', valor: 1 }], [base + 'inflacionInteranual']: [{ fecha: '2026-09-30', valor: 30.5 }] };
  it('compounds a range and adjusts an amount', async () => {
    const p = d.parseInflacion({ from: '2026-07', to: '2026-08', amount: '1000' });
    const r = await d.getInflacion(p.input, mockFetch(src));
    expect(r.data.range.cumulative_pct).toBe(5.06); expect(r.data.range.adjusted_amount).toBe(1050.6);
    expect(r.data.latest_month).toBe('2026-09'); expect(r.data.latest_yoy_pct).toBe(30.5);
  });
  it('validates input', () => {
    expect(d.parseInflacion({ from: '2026-13' }).ok).toBe(false);
    expect(d.parseInflacion({ to: '2026-01' }).ok).toBe(false);
    expect(d.parseInflacion({ from: '2026-05', to: '2026-01' }).ok).toBe(false);
  });
});

describe('feriados', () => {
  const src = { 'https://api.argentinadatos.com/v1/feriados/2026': [{ fecha: '2026-11-23', nombre: 'Dia de la Soberania Nacional', tipo: 'trasladable' }, { fecha: '2026-12-08', nombre: 'Inmaculada Concepcion', tipo: 'inamovible' }, { fecha: '2026-12-25', nombre: 'Navidad', tipo: 'inamovible' }], 'https://api.argentinadatos.com/v1/feriados/2027': [{ fecha: '2027-01-01', nombre: 'Anio nuevo', tipo: 'inamovible' }] };
  const now = new Date('2026-10-24T15:00:00Z');
  it('skips weekends and holidays when adding business days', async () => {
    const p = d.parseFeriados({ date: '2026-11-20', add_business_days: '2' }, now);
    const r = await d.getFeriados(p.input, mockFetch(src));
    // Fri 20 -> (Sat, Sun, Mon 23 holiday) -> Tue 24 (1), Wed 25 (2)
    expect(r.data.date_check.next_business_day).toBe('2026-11-24');
    expect(r.data.date_check.result_date).toBe('2026-11-25');
    expect(r.data.count).toBe(3);
  });
  it('crosses the year end', async () => {
    const p = d.parseFeriados({ date: '2026-12-31' }, now);
    const r = await d.getFeriados(p.input, mockFetch(src));
    expect(r.data.date_check.next_business_day).toBe('2027-01-04');
  });
  it('validates input', () => {
    expect(d.parseFeriados({ date: '24/10/2026' }, now).ok).toBe(false);
    expect(d.parseFeriados({ add_business_days: '3' }, now).ok).toBe(false);
    expect(d.parseFeriados({ year: '2030' }, now).ok).toBe(false);
  });
});
