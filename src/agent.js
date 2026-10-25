// Landing en 24h agent: the x402 capabilities served at https://landingen24h.com/api/x402/
// Extracted from the production Cloudflare worker source by build_m1_agent.py.
// Source file sha256 prefix f5dfdabb0e72614e. Capability code is copied unchanged; the only edits are:
//   1. analytics counters (Cloudflare KV) removed, they never change an answer;
//   2. the facilitator can be injected through env.facilitator (a URL, or an object with verify and settle).
// Runs on Cloudflare Workers, Deno, Bun or Node 20+ (needs fetch, Response, URL, AbortSignal.timeout).
// MIT licence. Written and run by Landing en 24h, an AI agent.

const X4 = {
  payTo: "0xb6d00A148AD63Fd9CCDd484B687c6012bA1561E1",
  price: "250000", // 0.25 USDC (6 decimals)
  usd: "0.25",
  facilitator: "https://facilitator.payai.network",
  timeout: 300,
  nets: [
    { v1: "base", v2: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", extra: { name: "USD Coin", version: "2" } },
    { v1: "polygon", v2: "eip155:137", asset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", extra: { name: "USD Coin", version: "2" } }
  ],
  desc: "Generate a complete, responsive single-file HTML landing page for a small business: hero, services, WhatsApp/email call to action, contact section and footer, with inline CSS and SEO meta tags. Send business_name (required) plus optional tagline, description, services, city, whatsapp, email, language (es|en), color and cta_text. Returns JSON {html, filename}. Deterministic template, nothing is stored.",
};
// Experiment 62: USDC on Solana mainnet (x402 exact SVM scheme, PayAI facilitator sponsors fees as feePayer).
// OFF until the payTo USDC associated token account exists on-chain (the exact SVM scheme only allows
// ComputeBudget x2 + TransferChecked + Memo/Lighthouse, so the client cannot create the recipient ATA).
// payTo ATA (USDC, SPL Token): CP3dEnY2XLqS7V5NYXgcxFFSEaV1XYX2683kvtTwzeDg. Flip to true only after it exists.
const X4_SOLANA_ON = true;
const X4_SOL = { v1: "solana", v2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", payTo: "5aMaTc619f8oRyFcoYLFv3DoNPhyfVnVZbDWAaNDUmJY", extra: { feePayer: "CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww" } };
if (X4_SOLANA_ON) X4.nets.push(X4_SOL);
for (const n of X4.nets) if (!n.payTo) n.payTo = X4.payTo;
const X4_NETS_TXT = X4_SOLANA_ON ? "Base, Polygon or Solana" : "Base or Polygon";
function x4payToBy() { return Object.fromEntries(X4.nets.map(n => [n.v2, n.payTo])); }
const X4_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-PAYMENT, PAYMENT-SIGNATURE, Authorization",
  "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE, PAYMENT-REQUIRED, PAYMENT-RESPONSE",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};
const X4_FIELDS = {
  business_name: { type: "string", maxLength: 80, description: "Business or project name (required)" },
  tagline: { type: "string", maxLength: 140, description: "Short headline, e.g. 'Plumbing repairs in 24 hours'" },
  description: { type: "string", maxLength: 600, description: "One or two sentences about the business" },
  services: { type: "array", maxItems: 8, items: { type: "string", maxLength: 200 }, description: "Up to 8 services. Use 'Title: short description' to add a description. GET: comma-separated" },
  city: { type: "string", maxLength: 80, description: "City or area served" },
  whatsapp: { type: "string", maxLength: 24, description: "WhatsApp number in international format, digits only, e.g. 5491122334455" },
  email: { type: "string", maxLength: 120, description: "Contact email" },
  language: { type: "string", enum: ["es", "en"], default: "es", description: "Page language" },
  color: { type: "string", pattern: "^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$", description: "Brand color as hex, e.g. #0f766e" },
  cta_text: { type: "string", maxLength: 40, description: "Main button text" }
};
const X4_EXAMPLE = { business_name: "Plomeria Rapida", tagline: "Plumbing repairs in Buenos Aires, same day", description: "Leaks, water heaters and bathroom installations for homes and small shops.", services: ["Leak repair: detection and fix without breaking walls", "Water heaters: installation and maintenance", "Bathrooms and kitchens: new installations"], city: "Buenos Aires", whatsapp: "5491122334455", email: "hola@example.com", language: "en", color: "#0f766e", cta_text: "Message us on WhatsApp" };
const X4_OUT_EXAMPLE = { html: "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Plomeria Rapida - Plumbing repairs in Buenos Aires, same day</title>...</head><body>...</body></html>", filename: "plomeria-rapida.html" };
const X4_INPUT_SCHEMA = { type: "object", properties: X4_FIELDS, required: ["business_name"], additionalProperties: false };
const X4_OUTPUT_SCHEMA = { type: "object", properties: { html: { type: "string", description: "Complete single-file HTML document (UTF-8, inline CSS)" }, filename: { type: "string", description: "Suggested file name, e.g. my-business.html" } }, required: ["html", "filename"] };

function x4b64(s) { const b = new TextEncoder().encode(s); let bin = ""; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(bin); }
function x4unb64(s) { const bin = atob(String(s).trim()); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u); }
function x4json(o, st, h) { return new Response(JSON.stringify(o), { status: st || 200, headers: { "content-type": "application/json; charset=utf-8", ...X4_CORS, ...(h || {}) } }); }

function x4urls(origin) { return { landing: origin + "/api/x402/landing", docs: origin + "/api/", index: origin + "/api/x402" }; }

function x4reqV1(origin) {
  return X4.nets.map(n => ({
    scheme: "exact", network: n.v1, maxAmountRequired: X4.price, asset: n.asset, payTo: n.payTo,
    resource: x4urls(origin).landing, description: X4.desc, mimeType: "application/json",
    outputSchema: {
      input: { type: "http", method: "POST", bodyType: "json", discoverable: true,
        bodyFields: Object.fromEntries(Object.entries(X4_FIELDS).map(([k, v]) => [k, { ...v, required: k === "business_name" }])) },
      output: X4_OUTPUT_SCHEMA
    },
    maxTimeoutSeconds: X4.timeout, extra: { ...n.extra }
  }));
}
function x4reqV2() {
  return X4.nets.map(n => ({ scheme: "exact", network: n.v2, amount: X4.price, asset: n.asset, payTo: n.payTo, maxTimeoutSeconds: X4.timeout, extra: { ...n.extra } }));
}
function x4resource(origin) {
  return { url: x4urls(origin).landing, description: X4.desc, mimeType: "application/json", serviceName: "Landing en 24h", tags: ["landing-page", "html", "website", "small-business", "generator"], iconUrl: origin + "/favicon.ico" };
}
function x4bazaar() {
  return { bazaar: {
    info: { input: { type: "http", method: "POST", bodyType: "json", body: X4_EXAMPLE }, output: { type: "json", example: X4_OUT_EXAMPLE } },
    schema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: {
      input: { type: "object", properties: { type: { type: "string", const: "http" }, method: { type: "string", enum: ["POST", "PUT", "PATCH"] }, bodyType: { type: "string", enum: ["json", "form-data", "text"] }, body: X4_INPUT_SCHEMA, queryParams: { type: "object", additionalProperties: { type: "string" } }, headers: { type: "object", additionalProperties: { type: "string" } } }, required: ["type", "method", "bodyType", "body"], additionalProperties: false },
      output: { type: "object", properties: { type: { type: "string" }, example: { type: "object" } }, required: ["type"] }
    }, required: ["input"] }
  } };
}
function x402Required(origin, err, v2err) {
  const v2 = { x402Version: 2, error: v2err || err, resource: x4resource(origin), accepts: x4reqV2(), extensions: x4bazaar() };
  const body = { x402Version: 1, error: err, accepts: x4reqV1(origin) };
  return x4json(body, 402, { "PAYMENT-REQUIRED": x4b64(JSON.stringify(v2)) });
}

// ---------- input ----------
function x4clean(v, max) { return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
async function x4input(request, url) {
  let b = {};
  if (request.method === "POST") {
    const raw = await request.text();
    if (raw.length > 20000) return { err: "body_too_large" };
    if (raw.trim()) { try { b = JSON.parse(raw); } catch (e) { return { err: "invalid_json" }; } }
    if (!b || typeof b !== "object" || Array.isArray(b)) return { err: "body_must_be_object" };
  } else {
    for (const k of Object.keys(X4_FIELDS)) if (url.searchParams.has(k)) b[k] = k === "services" ? url.searchParams.getAll(k).join(",").split(",") : url.searchParams.get(k);
  }
  return x4norm(b);
}
function x4norm(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) return { err: "arguments_must_be_object" };
  const o = {};
  o.business_name = x4clean(b.business_name, 80);
  if (!o.business_name) return { err: "business_name_required" };
  o.tagline = x4clean(b.tagline, 140);
  o.description = x4clean(b.description, 600);
  o.city = x4clean(b.city, 80);
  o.cta_text = x4clean(b.cta_text, 40);
  o.language = String(b.language || "es").toLowerCase().startsWith("en") ? "en" : "es";
  let sv = b.services; if (typeof sv === "string") sv = sv.split(/[,\n]/); if (!Array.isArray(sv)) sv = [];
  o.services = sv.map(s => {
    if (s && typeof s === "object") return { t: x4clean(s.title || s.name, 60), d: x4clean(s.description || s.desc, 200) };
    const t = x4clean(s, 200), i = t.indexOf(":");
    const cap = x => x.charAt(0).toUpperCase() + x.slice(1);
    return i > 0 && i < 60 ? { t: t.slice(0, i).trim(), d: cap(t.slice(i + 1).trim()) } : { t: t.slice(0, 60), d: t.length > 60 ? t : "" };
  }).filter(s => s.t).slice(0, 8);
  const wa = String(b.whatsapp || "").replace(/\D/g, "");
  o.whatsapp = wa.length >= 7 && wa.length <= 15 ? wa : "";
  const em = x4clean(b.email, 120);
  o.email = /^[^@\s<>"'()]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}$/i.test(em) ? em : "";
  const c = String(b.color || "").trim().replace(/^#/, "");
  o.color = /^[0-9a-f]{6}$/i.test(c) ? "#" + c.toLowerCase() : /^[0-9a-f]{3}$/i.test(c) ? "#" + c.toLowerCase().split("").map(x => x + x).join("") : "#2563eb";
  return { o };
}

// ---------- landing template ----------
const x4esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function x4rgb(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }
function x4mix(h, t, w) { const a = x4rgb(h), b = x4rgb(t); return "#" + a.map((v, i) => Math.round(v * (1 - w) + b[i] * w).toString(16).padStart(2, "0")).join(""); }
function x4lum(h) { return x4rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); }
function x4slug(s) { return (s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)) || "landing"; }
const X4_TXT = {
  es: { lang: "es", nav_s: "Servicios", nav_c: "Contacto", cta_wa: "Escríbenos por WhatsApp", cta_mail: "Envíanos un email", cta_c: "Contactar", see: "Ver servicios", s_h: "Servicios", s_sub: "Lo que ofrecemos", c_h: "Hablemos", c_sub: "Cuéntanos qué necesitas y te respondemos por el canal que prefieras.", wa: "WhatsApp", mail: "Email", where: "Zona", rights: "Todos los derechos reservados.", band: "¿Listo para empezar?", wa_msg: "Hola, quiero hacer una consulta a ", top: "Volver arriba" },
  en: { lang: "en", nav_s: "Services", nav_c: "Contact", cta_wa: "Message us on WhatsApp", cta_mail: "Send us an email", cta_c: "Get in touch", see: "See services", s_h: "Services", s_sub: "What we offer", c_h: "Let's talk", c_sub: "Tell us what you need and we will reply on the channel you prefer.", wa: "WhatsApp", mail: "Email", where: "Area", rights: "All rights reserved.", band: "Ready to get started?", wa_msg: "Hi, I have a question for ", top: "Back to top" }
};
function x4landing(o) {
  const T = X4_TXT[o.language], e = x4esc;
  const acc = o.color, dark = x4mix(acc, "#000000", 0.35), tint = x4mix(acc, "#ffffff", 0.92), tint2 = x4mix(acc, "#ffffff", 0.82);
  const onAcc = x4lum(acc) > 0.45 ? "#0b1220" : "#ffffff";
  const accText = x4lum(acc) > 0.35 ? dark : acc; // readable accent on white
  const name = e(o.business_name), tag = e(o.tagline || o.description.slice(0, 140) || o.business_name);
  const waUrl = o.whatsapp ? "https://wa.me/" + o.whatsapp + "?text=" + encodeURIComponent(T.wa_msg + o.business_name) : "";
  const mailUrl = o.email ? "mailto:" + o.email + "?subject=" + encodeURIComponent(o.business_name) : "";
  const primaryUrl = waUrl || mailUrl || "#contacto";
  const primaryTxt = e(o.cta_text || (waUrl ? T.cta_wa : mailUrl ? T.cta_mail : T.cta_c));
  const ext = waUrl || mailUrl ? ' target="_blank" rel="noopener"' : "";
  const waIcon = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>';
  const btnIcon = waUrl && primaryUrl === waUrl ? waIcon : "";
  const svc = o.services.map((s, i) => `<article class="card"><span class="num">${String(i + 1).padStart(2, "0")}</span><h3>${e(s.t)}</h3>${s.d ? `<p>${e(s.d)}</p>` : ""}</article>`).join("");
  const chips = o.services.slice(0, 3).map(s => `<li>${e(s.t)}</li>`).join("");
  const initials = (o.business_name.split(/\s+/).map(w => (w.match(/[\p{L}\p{N}]/u) || [""])[0]).filter(Boolean).slice(0, 2).join("") || "•").toUpperCase();
  const ld = { "@context": "https://schema.org", "@type": "LocalBusiness", name: o.business_name };
  if (o.description || o.tagline) ld.description = o.description || o.tagline;
  if (o.city) ld.address = { "@type": "PostalAddress", addressLocality: o.city };
  if (o.whatsapp) ld.telephone = "+" + o.whatsapp;
  if (o.email) ld.email = o.email;
  if (o.services.length) ld.makesOffer = o.services.map(s => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s.t } }));
  const ldJson = JSON.stringify(ld).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  const metaDesc = e((o.description || o.tagline || o.business_name).slice(0, 160));
  const title = e(o.business_name + (o.tagline ? " - " + o.tagline : ""));
  const contactItems = [
    waUrl ? `<a class="contact" href="${e(waUrl)}" target="_blank" rel="noopener">${waIcon}<span><small>${T.wa}</small>+${e(o.whatsapp)}</span></a>` : "",
    mailUrl ? `<a class="contact" href="${e(mailUrl)}"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg><span><small>${T.mail}</small>${e(o.email)}</span></a>` : "",
    o.city ? `<div class="contact"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg><span><small>${T.where}</small>${e(o.city)}</span></div>` : ""
  ].join("");
  const year = new Date().getUTCFullYear();
  return `<!DOCTYPE html>
<html lang="${T.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${metaDesc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${metaDesc}">
<meta property="og:type" content="website">
<meta name="theme-color" content="${acc}">
<script type="application/ld+json">${ldJson}</script>
<style>
:root{--acc:${acc};--dark:${dark};--tint:${tint};--tint2:${tint2};--on:${onAcc};--acct:${accText};--ink:#0f172a;--muted:#475569;--line:#e2e8f0;--r:18px}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--ink);background:#fff;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit}
.wrap{max-width:1120px;margin:0 auto;padding:0 22px}
header{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.86);backdrop-filter:saturate(180%) blur(12px);-webkit-backdrop-filter:saturate(180%) blur(12px);border-bottom:1px solid var(--line)}
header .wrap{display:flex;align-items:center;justify-content:space-between;height:64px;gap:16px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.02em;text-decoration:none;font-size:1.05rem;min-width:0}
.brand span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mark{flex:none;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--acc);color:var(--on);font-size:.85rem;font-weight:800}
nav{display:flex;align-items:center;gap:22px;font-size:.95rem}
nav a{text-decoration:none;color:var(--muted)}
nav a:hover{color:var(--ink)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;padding:14px 22px;border-radius:12px;font-weight:700;text-decoration:none;font-size:1rem;transition:transform .15s ease,box-shadow .15s ease,background .15s ease}
.btn:hover{transform:translateY(-1px)}
.btn-p{background:var(--acc);color:var(--on);box-shadow:0 10px 30px -10px var(--acc)}
.btn-p:hover{background:var(--dark);color:#fff}
.btn-g{background:#fff;color:var(--ink);border:1px solid var(--line)}
.btn-sm{padding:9px 15px;font-size:.9rem;border-radius:10px}
.hero{position:relative;overflow:hidden;background:radial-gradient(1200px 500px at 85% -10%,var(--tint2),transparent 60%),linear-gradient(180deg,var(--tint),#fff 85%)}
.hero .wrap{display:grid;grid-template-columns:1.15fr .85fr;gap:48px;align-items:center;padding-top:88px;padding-bottom:96px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:.85rem;font-weight:600;color:var(--acct);background:#fff;border:1px solid var(--tint2);padding:6px 12px;border-radius:99px;margin-bottom:20px}
.eyebrow:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--acc)}
h1{font-size:clamp(2.1rem,5.2vw,3.6rem);line-height:1.06;letter-spacing:-.035em;margin-bottom:18px}
.lead{font-size:clamp(1.05rem,2vw,1.2rem);color:var(--muted);max-width:40em;margin-bottom:30px}
.actions{display:flex;gap:12px;flex-wrap:wrap}
.panel{background:#fff;border:1px solid var(--line);border-radius:24px;padding:28px;box-shadow:0 30px 60px -30px rgba(15,23,42,.25)}
.panel .big{width:64px;height:64px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(135deg,var(--acc),var(--dark));color:#fff;font-weight:800;font-size:1.4rem;margin-bottom:18px}
.panel h2{font-size:1.25rem;letter-spacing:-.02em;margin-bottom:4px}
.panel .city{color:var(--muted);font-size:.95rem;margin-bottom:16px}
.panel ul{list-style:none;display:grid;gap:10px}
.panel li{display:flex;gap:10px;align-items:flex-start;font-weight:600;font-size:.95rem}
.panel li:before{content:"";flex:none;margin-top:.45em;width:9px;height:9px;border-radius:3px;background:var(--acc)}
section{padding:88px 0}
.head{max-width:640px;margin-bottom:40px}
.kick{text-transform:uppercase;letter-spacing:.12em;font-size:.78rem;font-weight:700;color:var(--acct);margin-bottom:8px}
h2.t{font-size:clamp(1.7rem,3.4vw,2.4rem);letter-spacing:-.03em;line-height:1.15}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px}
.card{position:relative;background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:26px;transition:border-color .2s,box-shadow .2s,transform .2s}
.card:hover{border-color:var(--tint2);box-shadow:0 20px 40px -24px rgba(15,23,42,.3);transform:translateY(-2px)}
.num{display:inline-grid;place-items:center;width:40px;height:40px;border-radius:12px;background:var(--tint);color:var(--acct);font-weight:800;font-size:.9rem;margin-bottom:16px}
.card h3{font-size:1.1rem;letter-spacing:-.01em;margin-bottom:6px}
.card p{color:var(--muted);font-size:.96rem}
.band{background:linear-gradient(135deg,var(--acc),var(--dark));color:#fff;border-radius:28px;padding:48px;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}
.band h2{font-size:clamp(1.5rem,3vw,2.1rem);letter-spacing:-.03em;line-height:1.2;max-width:22em}
.band .btn{background:#fff;color:var(--ink)}
.band .btn:hover{background:#f1f5f9;color:var(--ink)}
.alt{background:#f8fafc;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.contacts{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.contact{display:flex;align-items:center;gap:14px;background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:20px;text-decoration:none;color:var(--ink);overflow-wrap:anywhere}
a.contact:hover{border-color:var(--acc)}
.contact svg{flex:none;color:var(--acct)}
.contact small{display:block;color:var(--muted);font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em}
.contact span{font-weight:700}
footer{padding:36px 0;color:var(--muted);font-size:.9rem}
footer .wrap{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
footer a{text-decoration:none}
.float{position:fixed;right:18px;bottom:18px;z-index:20;width:56px;height:56px;border-radius:50%;display:grid;place-items:center;background:#25d366;color:#fff;box-shadow:0 12px 30px -8px rgba(0,0,0,.35)}
.float svg{width:28px;height:28px}
:focus-visible{outline:3px solid var(--acc);outline-offset:3px}
@media (max-width:860px){.hero .wrap{grid-template-columns:1fr;padding-top:56px;padding-bottom:64px;gap:32px}nav a.hide{display:none}section{padding:64px 0}.band{padding:32px}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.btn,.card{transition:none}}
</style>
</head>
<body>
<header><div class="wrap"><a class="brand" href="#top"><span class="mark">${e(initials)}</span><span>${name}</span></a><nav>${o.services.length ? `<a class="hide" href="#servicios">${T.nav_s}</a>` : ""}<a class="hide" href="#contacto">${T.nav_c}</a><a class="btn btn-p btn-sm" href="${e(primaryUrl)}"${ext}>${T.cta_c}</a></nav></div></header>
<main id="top">
<section class="hero" style="padding:0"><div class="wrap"><div>
${o.city ? `<span class="eyebrow">${e(o.city)}</span>` : ""}
<h1>${o.tagline ? e(o.tagline) : name}</h1>
${o.description ? `<p class="lead">${e(o.description)}</p>` : ""}
<div class="actions"><a class="btn btn-p" href="${e(primaryUrl)}"${ext}>${btnIcon}${primaryTxt}</a>${o.services.length ? `<a class="btn btn-g" href="#servicios">${T.see}</a>` : ""}</div>
</div>
<aside class="panel" aria-label="${name}"><div class="big">${e(initials)}</div><h2>${name}</h2>${o.city ? `<p class="city">${e(o.city)}</p>` : ""}${chips ? `<ul>${chips}</ul>` : ""}</aside>
</div></section>
${o.services.length ? `<section id="servicios"><div class="wrap"><div class="head"><p class="kick">${T.s_h}</p><h2 class="t">${T.s_sub}</h2></div><div class="grid">${svc}</div></div></section>` : ""}
<section style="padding-top:${o.services.length ? 0 : 88}px"><div class="wrap"><div class="band"><h2>${T.band}</h2><a class="btn" href="${e(primaryUrl)}"${ext}>${btnIcon}${primaryTxt}</a></div></div></section>
<section id="contacto" class="alt"><div class="wrap"><div class="head"><p class="kick">${T.nav_c}</p><h2 class="t">${T.c_h}</h2><p class="lead" style="margin:12px 0 0">${T.c_sub}</p></div>${contactItems ? `<div class="contacts">${contactItems}</div>` : ""}</div></section>
</main>
<footer><div class="wrap"><span>&copy; ${year} ${name}. ${T.rights}</span><a href="#top">${T.top} &uarr;</a></div></footer>
${waUrl ? `<a class="float" href="${e(waUrl)}" target="_blank" rel="noopener" aria-label="${T.wa}">${waIcon}</a>` : ""}
</body>
</html>
`;
}

// ---------- facilitator ----------
async function x4fac(path, body, env) {
  const f = env && env.facilitator;
  if (f && typeof f === "object") { try { return await (path === "/settle" ? f.settle(body) : f.verify(body)); } catch (e) { return { _err: String(e && e.message || e).slice(0, 200) }; } }
  const base = typeof f === "string" ? f : X4.facilitator;
  try {
    const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(path === "/settle" ? 45000 : 15000) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
    return j || { _http: r.status, _raw: t.slice(0, 300) };
  } catch (e) { return { _err: String(e && e.message || e).slice(0, 200) }; }
}

// ---------- discovery docs (free, no KV) ----------
function x4index(origin) {
  const u = x4urls(origin);
  return { name: "Landing en 24h API", description: "Pay-per-call APIs: single-file HTML landing page generator, web page audit, currency exchange rates, Argentine CUIT/CBU validators. Payments use the x402 protocol (HTTP 402) in USDC on " + X4_NETS_TXT + "; no account or API key needed.", docs: u.docs, x402: { versions: [1, 2], facilitator: X4.facilitator },
    resources: [{ url: u.landing, methods: ["POST", "GET"], price: { amount: X4.usd, currency: "USDC", atomic: X4.price, decimals: 6 }, networks: X4.nets.map(n => ({ network: n.v1, caip2: n.v2, asset: n.asset, payTo: n.payTo })), payTo: X4.payTo, payToByNetwork: x4payToBy(), description: X4.desc, mimeType: "application/json", inputSchema: X4_INPUT_SCHEMA, outputSchema: X4_OUTPUT_SCHEMA, example: { request: X4_EXAMPLE, response: X4_OUT_EXAMPLE } }, ...x4uIndexRes(origin)],
    contact: "hola@landingen24h.com" };
}
function x4openapi(origin) {
  const u = x4urls(origin);
  return { openapi: "3.1.0", info: { title: "Landing en 24h API", version: "1.1.0", description: "Landing page generator, web audit, FX rates, Argentine validators. Paid per call with x402 (USDC on " + X4_NETS_TXT + "). Docs: " + u.docs, contact: { email: "hola@landingen24h.com" } },
    servers: [{ url: origin }],
    paths: { "/api/x402/landing": { post: { operationId: "generateLanding", summary: "Generate a landing page (0.25 USDC)", description: X4.desc,
      "x-payment-info": { protocols: ["x402"], price: { mode: "fixed", currency: "USD", amount: X4.usd }, networks: X4.nets.map(n => n.v2), asset: "USDC", payTo: X4.payTo, payToByNetwork: x4payToBy() },
      requestBody: { required: true, content: { "application/json": { schema: X4_INPUT_SCHEMA, example: X4_EXAMPLE } } },
      responses: { "200": { description: "Generated landing page", content: { "application/json": { schema: X4_OUTPUT_SCHEMA } } }, "400": { description: "Invalid input (no charge)" }, "402": { description: "Payment required (x402 challenge)" } } } }, ...x4uOpenapi() } };
}

// ---------- main handler ----------
async function x402Handle(request, env, ctx, url) {
  const origin = url.origin, p = url.pathname;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: X4_CORS });
  if (p === "/.well-known/x402") return x4json({ version: 1, resources: [x4urls(origin).landing, ...Object.keys(X4U).map(k => origin + k)], instructions: "Pay-per-call JSON APIs via x402 (USDC on " + X4_NETS_TXT + ", PayAI facilitator). POST JSON to a resource; prices and schemas at " + origin + "/api/x402 and " + origin + "/openapi.json. Landing page generator 0.25 USDC; web audit 0.02; Argentina CUIT/CBU validators and phone normalizer 0.01; FX rate and Argentina dolar quotes (oficial, blue, MEP, CCL) 0.002. Invalid input is never charged. Docs: " + x4urls(origin).docs });
  if (p === "/openapi.json") return x4json(x4openapi(origin));
  if (p === "/api/x402" || p === "/api/x402/") return x4json(x4index(origin));
  if (X4U[p]) return x4uHandle(request, env, ctx, url, p, X4U[p]);
  if (p !== "/api/x402/landing") return x4json({ error: "not_found", docs: x4urls(origin).docs }, 404);
  if (!["GET", "POST", "HEAD"].includes(request.method)) return x4json({ error: "method_not_allowed" }, 405, { Allow: "GET, POST, HEAD, OPTIONS" });

  const v2h = request.headers.get("payment-signature"), v1h = request.headers.get("x-payment");
  if (!v2h && !v1h) {
    const r = x402Required(origin, "X-PAYMENT header is required", "PAYMENT-SIGNATURE header is required");
    return request.method === "HEAD" ? new Response(null, { status: 402, headers: r.headers }) : r;
  }
  if (request.method === "HEAD") return x4json({ error: "use_get_or_post" }, 405);

  // decode payment
  let pay, ver;
  try { pay = JSON.parse(x4unb64(v2h || v1h)); ver = Number(pay && pay.x402Version) || (v2h ? 2 : 1); }
  catch (e) { return x402Required(origin, "invalid_payment_header"); }
  const net = ver >= 2 ? (pay.accepted && pay.accepted.network) : pay.network;
  const scheme = ver >= 2 ? (pay.accepted && pay.accepted.scheme) : pay.scheme;
  const n = X4.nets.find(x => (ver >= 2 ? x.v2 : x.v1) === net);
  if (!n || scheme !== "exact") return x402Required(origin, "unsupported_scheme_or_network");
  const reqs = ver >= 2 ? x4reqV2().find(x => x.network === n.v2) : x4reqV1(origin).find(x => x.network === n.v1);

  // validate input before touching the payment (invalid input = no charge)
  const inp = await x4input(request, url);
  if (inp.err) return x4json({ error: inp.err, inputSchema: X4_INPUT_SCHEMA, note: "No payment was taken." }, 400);

  const fb = { x402Version: ver >= 2 ? 2 : 1, paymentPayload: pay, paymentRequirements: reqs };
  const vr = await x4fac("/verify", fb, env);
  if (!vr || vr.isValid !== true) {
    const why = (vr && (vr.invalidReason || vr.error || vr._err || (vr._http && "facilitator_http_" + vr._http))) || "verification_failed";
    return x402Required(origin, String(why).slice(0, 200));
  }
  let out;
  try { const html = x4landing(inp.o); out = { html, filename: x4slug(inp.o.business_name) + ".html" }; }
  catch (e) { return x4json({ error: "generation_failed", note: "No payment was taken." }, 500); }

  const sr = await x4fac("/settle", fb, env);
  if (!sr || sr.success !== true) {
    const why = (sr && (sr.errorReason || sr.error || sr._err || (sr._http && "facilitator_http_" + sr._http))) || "settlement_failed";
    return x402Required(origin, String(why).slice(0, 200));
  }
  const receipt = { success: true, transaction: sr.transaction || "", network: sr.network || net, payer: sr.payer || vr.payer || "" };
  const rh = x4b64(JSON.stringify(receipt));
  return x4json(out, 200, { "X-PAYMENT-RESPONSE": rh, "PAYMENT-RESPONSE": rh });
}
const X4U_BANKS = { "007": "Banco de Galicia", "011": "Banco de la Nacion Argentina", "014": "Banco de la Provincia de Buenos Aires", "015": "ICBC Argentina", "017": "BBVA Argentina", "027": "Banco Supervielle", "029": "Banco de la Ciudad de Buenos Aires", "034": "Banco Patagonia", "044": "Banco Hipotecario", "072": "Banco Santander Argentina", "150": "HSBC Argentina", "191": "Banco Credicoop", "285": "Banco Macro", "299": "Banco Comafi" };
function x4uCuit(b) {
  const raw = x4clean(b.cuit != null ? b.cuit : (b.cuil != null ? b.cuil : b.value), 40);
  const s = raw.replace(/\D/g, "");
  if (!raw) return { err: "cuit_required" };
  const out = { input: raw, normalized: s, valid: false };
  if (s.length !== 11) return { o: { ...out, reason: "must_have_11_digits" } };
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = w.reduce((a, x, i) => a + x * Number(s[i]), 0);
  let dv = 11 - (sum % 11); if (dv === 11) dv = 0;
  const pre = s.slice(0, 2);
  const kind = ["20", "23", "24", "27"].includes(pre) ? "person" : ["30", "33", "34"].includes(pre) ? "company" : "unknown";
  out.formatted = s.slice(0, 2) + "-" + s.slice(2, 10) + "-" + s[10];
  out.prefix = pre; out.entity_type = kind; out.expected_check_digit = dv === 10 ? null : dv;
  out.valid = dv !== 10 && dv === Number(s[10]) && kind !== "unknown";
  if (!out.valid) out.reason = kind === "unknown" ? "unknown_prefix" : "check_digit_mismatch";
  out.note = "Checksum and prefix validation only (offline); does not query AFIP/ARCA.";
  return { o: out };
}
function x4uCbu(b) {
  const raw = x4clean(b.cbu != null ? b.cbu : (b.cvu != null ? b.cvu : b.value), 60);
  const s = raw.replace(/\D/g, "");
  if (!raw) return { err: "cbu_required" };
  const out = { input: raw, normalized: s, valid: false };
  if (s.length !== 22) return { o: { ...out, reason: "must_have_22_digits" } };
  const dvOf = (digits, w) => (10 - (digits.split("").reduce((a, c, i) => a + Number(c) * w[i % w.length], 0) % 10)) % 10;
  const ok1 = dvOf(s.slice(0, 7), [7, 1, 3, 9]) === Number(s[7]);
  const ok2 = dvOf(s.slice(8, 21), [3, 9, 7, 1]) === Number(s[21]);
  const isCvu = s.startsWith("000");
  out.type = isCvu ? "CVU" : "CBU";
  out.entity_code = s.slice(0, 3);
  if (isCvu) { out.psp_code = s.slice(3, 7); out.bank_name = null; }
  else { out.branch_code = s.slice(3, 7); out.bank_name = X4U_BANKS[s.slice(0, 3)] || null; }
  out.block1_ok = ok1; out.block2_ok = ok2; out.valid = ok1 && ok2;
  if (!out.valid) out.reason = "check_digit_mismatch";
  out.formatted = s.slice(0, 8) + " " + s.slice(8);
  out.note = "Check-digit validation only (offline); does not confirm the account exists or its owner.";
  return { o: out };
}
// /api/x402/web/audit {url}: quick technical + SEO audit of a public web page (0.02 USDC). Fetch happens only after payment is verified; settle only if the audit succeeded.
function x4aPre(b) {
  const raw = x4clean(b.url != null ? b.url : b.value, 500);
  if (!raw) return { err: "url_required" };
  let u; try { u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw); } catch (e) { return { err: "invalid_url" }; }
  if (!["http:", "https:"].includes(u.protocol)) return { err: "only_http_https" };
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^(10|127|0)\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) || h.includes(":") || h.startsWith("[")) return { err: "host_not_allowed" };
  if (u.port && !["80", "443"].includes(u.port)) return { err: "port_not_allowed" };
  return { o: { url: u.toString() } };
}
async function x4aRun(o) {
  const t0 = Date.now(); let r;
  try { r = await fetch(o.url, { redirect: "follow", headers: { "user-agent": "LandingEn24hAudit/1.0 (+https://landingen24h.com/api/)", accept: "text/html,*/*" }, signal: AbortSignal.timeout(10000) }); }
  catch (e) { return { err: "fetch_failed", detail: String(e && e.message || e).slice(0, 150), status: 502 }; }
  const ms = Date.now() - t0;
  const ct = r.headers.get("content-type") || "";
  let html = ""; try { html = (await r.text()).slice(0, 1500000); } catch (e) {}
  const H = k => r.headers.get(k);
  const m = re => { const x = html.match(re); return x ? x4clean(x[1], 300) : null; };
  const isHtml = /html/i.test(ct) || /<html/i.test(html.slice(0, 2000));
  const title = m(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const desc = m(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || m(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i);
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const noAlt = imgs.filter(t => !/\balt\s*=/i.test(t)).length;
  const final = new URL(r.url || o.url);
  let httpRedirect = null;
  if (final.protocol === "https:") { try { const hr = await fetch("http://" + final.host + "/", { redirect: "manual", signal: AbortSignal.timeout(5000) }); const loc = hr.headers.get("location") || ""; httpRedirect = hr.status >= 300 && hr.status < 400 && loc.startsWith("https://"); } catch (e) { httpRedirect = null; } }
  const c = {
    status: r.status, final_url: final.toString(), redirected: !!r.redirected, response_ms: ms, html_bytes: html.length, content_type: ct,
    https: final.protocol === "https:", http_redirects_to_https: httpRedirect,
    title, title_length: title ? title.length : 0, meta_description: desc, meta_description_length: desc ? desc.length : 0,
    viewport_meta: /<meta[^>]+name=["']viewport["']/i.test(html), html_lang: m(/<html[^>]*\slang=["']([^"']+)["']/i),
    h1_count: (html.match(/<h1\b/gi) || []).length, canonical: m(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i),
    open_graph: { title: !!m(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i), image: !!m(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']*)["']/i) },
    favicon: /<link[^>]+rel=["'][^"']*icon[^"']*["']/i.test(html), images: imgs.length, images_missing_alt: noAlt,
    structured_data: /application\/ld\+json/i.test(html), scripts: (html.match(/<script\b/gi) || []).length,
    security_headers: { hsts: !!H("strict-transport-security"), csp: !!H("content-security-policy"), x_frame_options: !!H("x-frame-options") || /frame-ancestors/i.test(H("content-security-policy") || ""), x_content_type_options: !!H("x-content-type-options"), referrer_policy: !!H("referrer-policy") },
    compression: H("content-encoding") || null, server: x4clean(H("server") || "", 60) || null
  };
  const issues = [];
  const add = (sev, code, msg) => issues.push({ severity: sev, code, message: msg });
  if (r.status >= 400) add("high", "http_error", "Page returns HTTP " + r.status + ".");
  if (!c.https) add("high", "no_https", "Page is not served over HTTPS.");
  if (c.https && httpRedirect === false) add("medium", "http_not_redirected", "http:// does not redirect to https://.");
  if (!isHtml) add("medium", "not_html", "Response is not an HTML page.");
  if (isHtml) {
    if (!title) add("high", "missing_title", "Missing <title>."); else if (title.length < 15 || title.length > 65) add("low", "title_length", "Title length " + title.length + " (aim for 15-65 chars).");
    if (!desc) add("medium", "missing_meta_description", "Missing meta description."); else if (desc.length < 50 || desc.length > 165) add("low", "meta_description_length", "Meta description length " + desc.length + " (aim for 50-165).");
    if (!c.viewport_meta) add("high", "no_viewport", "No viewport meta tag: page will not render well on mobile.");
    if (!c.html_lang) add("low", "no_lang", "Missing lang attribute on <html>.");
    if (c.h1_count === 0) add("medium", "no_h1", "No <h1> heading."); else if (c.h1_count > 1) add("low", "multiple_h1", c.h1_count + " <h1> headings.");
    if (!c.canonical) add("low", "no_canonical", "No canonical link.");
    if (!c.open_graph.title || !c.open_graph.image) add("low", "open_graph_incomplete", "Open Graph title/image missing: poor link previews on social and chat apps.");
    if (!c.favicon) add("low", "no_favicon", "No favicon link.");
    if (noAlt) add("medium", "images_missing_alt", noAlt + " of " + imgs.length + " images have no alt text.");
    if (!c.structured_data) add("low", "no_structured_data", "No JSON-LD structured data.");
  }
  if (ms > 3000) add("medium", "slow_response", "Server took " + ms + " ms to respond."); 
  if (html.length > 1000000) add("low", "heavy_html", "HTML is over 1 MB.");
  if (!c.compression && html.length > 20000) add("low", "no_compression", "Response is not compressed.");
  const sh = c.security_headers; const missing = Object.keys(sh).filter(k => !sh[k]);
  if (missing.length) add(missing.length >= 3 ? "medium" : "low", "security_headers_missing", "Missing security headers: " + missing.join(", ") + ".");
  const pen = { high: 20, medium: 8, low: 3 };
  const score = Math.max(0, 100 - issues.reduce((a, i) => a + pen[i.severity], 0));
  return { o: { url: o.url, score, grade: score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F", issues, checks: c, checked_at: new Date().toISOString(),
    note: "Single-page technical/SEO check from one fetch; no JavaScript rendering.", fix_offer: "Need it fixed? A rebuilt page in 24 hours: https://landingen24h.com/en/fix/?r=x402audit" } };
}
const X4A_OUT = { type: "object", properties: { url: { type: "string" }, score: { type: "integer" }, grade: { type: "string" }, issues: { type: "array", items: { type: "object", properties: { severity: { type: "string" }, code: { type: "string" }, message: { type: "string" } } } }, checks: { type: "object" } }, required: ["url", "score", "issues"] };
const X4A_EX = { url: "https://example.com/", score: 62, grade: "C", issues: [{ severity: "medium", code: "missing_meta_description", message: "Missing meta description." }, { severity: "medium", code: "no_h1", message: "No <h1> heading." }, { severity: "medium", code: "security_headers_missing", message: "Missing security headers: hsts, csp, x_frame_options, x_content_type_options, referrer_policy." }], checks: { status: 200, https: true, response_ms: 180, viewport_meta: true, h1_count: 0 } };
function x4fxPre(b) {
  const from = x4clean(b.from != null ? b.from : (b.base != null ? b.base : "USD"), 5).toUpperCase(), to = x4clean(b.to != null ? b.to : (b.quote != null ? b.quote : ""), 5).toUpperCase();
  if (!/^[A-Z]{3}$/.test(from)) return { err: "from_must_be_iso4217_code" }; if (!/^[A-Z]{3}$/.test(to)) return { err: "to_must_be_iso4217_code" };
  let amount = 1; if (b.amount !== undefined && b.amount !== null && b.amount !== "") { amount = Number(b.amount); if (!isFinite(amount) || amount < 0 || amount > 1e15) return { err: "amount_must_be_number_0_to_1e15" }; }
  return { o: { from, to, amount } };
}
async function x4fxRun(o) {
  const u = `https://api.frankfurter.dev/v2/rate/${o.from.toLowerCase()}/${o.to.toLowerCase()}`;
  let j, cache = null; try { cache = (typeof caches !== "undefined" && caches.default) || null; } catch (e) {}
  try {
    let r = cache ? await cache.match(u) : null;
    if (!r) { r = await fetch(u, { headers: { accept: "application/json", "user-agent": "LandingEn24hAPI/1.0 (+https://landingen24h.com/api/)" }, signal: AbortSignal.timeout(8000) }); if (r.ok && cache) { const c = new Response(r.clone().body, r); c.headers.set("Cache-Control", "public, max-age=900"); try { await cache.put(u, c); } catch (e) {} } }
    j = await r.json(); if (!r.ok) return { err: r.status === 422 || r.status === 404 ? "unsupported_currency" : "rates_source_error", detail: x4clean(j && j.message, 120), status: r.status === 422 || r.status === 404 ? 400 : 502 };
  } catch (e) { return { err: "rates_source_unavailable", status: 502 }; }
  if (!j || typeof j.rate !== "number") return { err: "rates_source_error", status: 502 };
  return { o: { from: o.from, to: o.to, amount: o.amount, rate: j.rate, converted: Math.round(o.amount * j.rate * 1e6) / 1e6, inverse_rate: j.rate ? Math.round(1e8 / j.rate) / 1e8 : null, date: j.date, rate_type: "mid-market daily reference (blended central-bank rates)", source: "Frankfurter (frankfurter.dev), data from central banks incl. ECB", note: "Daily reference rate, not a live trading quote." } };
}
// POST/GET /api/x402/ar/dolar {casa}: Argentine peso USD quotes (oficial, blue, MEP/bolsa, CCL, cripto, tarjeta, mayorista). Added 22/10:
// CDP Bazaar already lists paid Argentina FX resources (toolrail dolar-argentina, saylorinnovations fx/argentina); our first real sale was AR data.
const X4D_CASAS = ["oficial", "blue", "bolsa", "contadoconliqui", "mayorista", "cripto", "tarjeta"];
function x4dPre(b) {
  let c = x4clean(b.casa != null ? b.casa : (b.type != null ? b.type : "all"), 20).toLowerCase().replace(/[^a-z]/g, "");
  const al = { mep: "bolsa", ccl: "contadoconliqui", contadoconliquidacion: "contadoconliqui", crypto: "cripto", card: "tarjeta", official: "oficial", wholesale: "mayorista", todos: "all", "": "all" };
  if (al[c]) c = al[c];
  if (c !== "all" && !X4D_CASAS.includes(c)) return { err: "casa_must_be_one_of_all_" + X4D_CASAS.join("_") };
  return { o: { casa: c } };
}
async function x4dRun(o) {
  const u = "https://dolarapi.com/v1/dolares";
  let j, cache = null; try { cache = (typeof caches !== "undefined" && caches.default) || null; } catch (e) {}
  try {
    let r = cache ? await cache.match(u) : null;
    if (!r) { r = await fetch(u, { headers: { accept: "application/json", "user-agent": "LandingEn24hAPI/1.0 (+https://landingen24h.com/api/)" }, signal: AbortSignal.timeout(8000) }); if (r.ok && cache) { const c = new Response(r.clone().body, r); c.headers.set("Cache-Control", "public, max-age=300"); try { await cache.put(u, c); } catch (e) {} } }
    if (!r.ok) return { err: "rates_source_error", status: 502 };
    j = await r.json();
  } catch (e) { return { err: "rates_source_unavailable", status: 502 }; }
  if (!Array.isArray(j) || !j.length) return { err: "rates_source_error", status: 502 };
  const q = j.filter(x => x && (o.casa === "all" || x.casa === o.casa)).map(x => ({ casa: x.casa, nombre: x.nombre, compra: x.compra, venta: x.venta, spread: (typeof x.compra === "number" && typeof x.venta === "number") ? Math.round((x.venta - x.compra) * 100) / 100 : null, updated_at: x.fechaActualizacion }));
  if (!q.length) return { err: "casa_not_available", status: 502 };
  const by = {}; q.forEach(x => by[x.casa] = x);
  const out = { currency_pair: "USD/ARS", casa: o.casa, quotes: q, source: "DolarApi.com (public Argentine market quotes)", note: "ARS per 1 USD. Market quotes, not financial advice." };
  if (by.blue && by.oficial && by.oficial.venta) out.brecha_blue_vs_oficial_pct = Math.round((by.blue.venta / by.oficial.venta - 1) * 10000) / 100;
  return { o: out };
}
// 22/10 tarde: Argentina data endpoints (feriados + inflacion INDEC), source argentinadatos.com (public), cached. Extends the AR category (first real sale was AR).
async function x4adFetch(u, ttl) {
  let cache = null; try { cache = (typeof caches !== "undefined" && caches.default) || null; } catch (e) {}
  try {
    let r = cache ? await cache.match(u) : null;
    if (!r) { r = await fetch(u, { headers: { accept: "application/json", "user-agent": "LandingEn24hAPI/1.0 (+https://landingen24h.com/api/)" }, signal: AbortSignal.timeout(8000) }); if (r.ok && cache) { const c = new Response(r.clone().body, r); c.headers.set("Cache-Control", "public, max-age=" + ttl); try { await cache.put(u, c); } catch (e) {} } }
    if (!r.ok) return null; return await r.json();
  } catch (e) { return null; }
}
function x4fePre(b) {
  const o = {}; const now = new Date(Date.now() - 3 * 3600e3);
  if (b.date != null && b.date !== "") { const d = x4clean(b.date, 12); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d + "T00:00:00Z"))) return { err: "date_must_be_YYYY-MM-DD" }; o.date = d; }
  let y = b.year != null && b.year !== "" ? Number(b.year) : (o.date ? Number(o.date.slice(0, 4)) : now.getUTCFullYear());
  if (!Number.isInteger(y) || y < 2016 || y > now.getUTCFullYear() + 1) return { err: "year_must_be_2016_to_" + (now.getUTCFullYear() + 1) }; o.year = y;
  if (b.add_business_days != null && b.add_business_days !== "") { const n = Number(b.add_business_days); if (!Number.isInteger(n) || n < 1 || n > 60) return { err: "add_business_days_must_be_1_to_60" }; if (!o.date) return { err: "date_required_with_add_business_days" }; o.add = n; }
  return { o };
}
async function x4feRun(o) {
  const ys = [o.year]; if (o.date && (o.add || o.date.slice(5) >= "12-01")) ys.push(o.year + 1);
  const hol = {}; let list = null;
  for (const y of ys) { const j = await x4adFetch("https://api.argentinadatos.com/v1/feriados/" + y, 21600); if (!Array.isArray(j)) { if (y === o.year) return { err: "holidays_source_unavailable", status: 502 }; continue; } if (y === o.year) list = j.map(x => ({ date: x.fecha, name: x.nombre, type: x.tipo })); j.forEach(x => hol[x.fecha] = x.nombre); }
  const out = { country: "AR", year: o.year, holidays: list, count: list.length, source: "argentinadatos.com (official national holidays, incl. puentes turisticos)", note: "National holidays only; provincial/municipal holidays are not included." };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const biz = s => { const wd = new Date(s + "T00:00:00Z").getUTCDay(); return wd !== 0 && wd !== 6 && !hol[s]; };
  if (o.date) {
    const wd = new Date(o.date + "T00:00:00Z").getUTCDay();
    out.date_check = { date: o.date, weekday: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][wd], is_weekend: wd === 0 || wd === 6, is_holiday: !!hol[o.date], holiday_name: hol[o.date] || null, is_business_day: biz(o.date) };
    let t = Date.parse(o.date + "T00:00:00Z"), s; do { t += 864e5; s = iso(t); } while (!biz(s)); out.date_check.next_business_day = s;
    if (o.add) { let t2 = Date.parse(o.date + "T00:00:00Z"), k = 0, s2; while (k < o.add) { t2 += 864e5; s2 = iso(t2); if (biz(s2)) k++; } out.date_check.add_business_days = o.add; out.date_check.result_date = s2; }
    if (o.date_only) delete out.holidays;
  }
  return { o: out };
}
function x4inPre(b) {
  const o = {}; const m = v => { const s = x4clean(v, 8); return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : null; };
  if (b.from != null && b.from !== "") { o.from = m(b.from); if (!o.from) return { err: "from_must_be_YYYY-MM" }; }
  if (b.to != null && b.to !== "") { o.to = m(b.to); if (!o.to) return { err: "to_must_be_YYYY-MM" }; }
  if (o.to && !o.from) return { err: "from_required_with_to" };
  if (o.from && o.to && o.to < o.from) return { err: "to_must_be_after_from" };
  if (b.amount != null && b.amount !== "") { const a = Number(b.amount); if (!isFinite(a) || a < 0 || a > 1e15) return { err: "amount_must_be_number_0_to_1e15" }; o.amount = a; }
  return { o };
}
async function x4inRun(o) {
  const mo = await x4adFetch("https://api.argentinadatos.com/v1/finanzas/indices/inflacion", 21600);
  const ya = await x4adFetch("https://api.argentinadatos.com/v1/finanzas/indices/inflacionInteranual", 21600);
  if (!Array.isArray(mo) || !mo.length) return { err: "inflation_source_unavailable", status: 502 };
  const mm = mo.map(x => ({ month: String(x.fecha).slice(0, 7), pct: x.valor })).sort((a, b) => a.month < b.month ? -1 : 1);
  const last = mm[mm.length - 1]; const yy = Array.isArray(ya) && ya.length ? ya[ya.length - 1] : null;
  const out = { country: "AR", index: "IPC INDEC (consumer prices, national)", latest_month: last.month, latest_monthly_pct: last.pct, latest_yoy_pct: yy ? yy.valor : null, last_12_months: mm.slice(-12), source: "argentinadatos.com (INDEC CPI series)" };
  if (o.from) {
    const to = o.to || last.month; const sel = mm.filter(x => x.month >= o.from && x.month <= to);
    if (!sel.length) return { err: "no_data_for_range", status: 400 };
    const f = sel.reduce((a, x) => a * (1 + x.pct / 100), 1);
    out.range = { from: sel[0].month, to: sel[sel.length - 1].month, months: sel.length, cumulative_pct: Math.round((f - 1) * 10000) / 100, factor: Math.round(f * 1e6) / 1e6, note: "Compounded monthly CPI from the start of 'from' to the end of 'to'." };
    if (o.amount != null) { out.range.amount = o.amount; out.range.adjusted_amount = Math.round(o.amount * f * 100) / 100; }
  }
  return { o: out };
}
// POST/GET /api/x402/ar/phone {phone}: normalize an Argentine phone number (offline).
function x4uPhone(b) {
  const raw = x4clean(b.phone != null ? b.phone : (b.telefono != null ? b.telefono : b.value), 40);
  if (!raw) return { err: "phone_required" };
  let s = raw.replace(/\D/g, ""), intl = /^\s*(\+|00)/.test(raw), mobile = null, ac = null;
  if (!s) return { err: "phone_must_contain_digits" };
  if (s.startsWith("00")) { s = s.slice(2); intl = true; }
  const out = { input: raw, valid: false, normalized: s };
  if (s.startsWith("54") && (intl || s.length >= 12)) { s = s.slice(2); if (s.startsWith("9") && s.length === 11) { s = s.slice(1); mobile = true; } }
  if (s.startsWith("0")) s = s.slice(1);
  if (s.length === 12) { for (const L of (s.startsWith("11") ? [2] : [3, 4])) { if (s.slice(L, L + 2) === "15") { s = s.slice(0, L) + s.slice(L + 2); mobile = true; ac = s.slice(0, L); break; } } }
  else if (s.length === 8 && s.startsWith("15")) return { o: { ...out, reason: "missing_area_code", hint: "Mobile numbers need the area code, e.g. 11 15 1234-5678" } };
  else if (s.length === 8) return { o: { ...out, reason: "missing_area_code", hint: "Add the area code, e.g. 11 for Buenos Aires" } };
  if (s.length !== 10) return { o: { ...out, reason: "must_have_10_digit_national_number" } };
  if (!/^(11|[23])/.test(s)) return { o: { ...out, normalized: s, reason: "invalid_area_code_prefix" } };
  if (!ac) ac = s.startsWith("11") ? "11" : null;
  const local = ac ? s.slice(ac.length) : null;
  const e164 = "+54" + s, wa = "+549" + s;
  const o = { input: raw, valid: true, normalized: s, national_number: s, area_code: ac, area_code_note: ac ? undefined : "3 or 4 digit area code (Argentina uses variable-length area codes; prefix 2 = interior south/center, 3 = north/center)",
    mobile: mobile, e164: mobile === false ? e164 : (mobile ? wa : e164), e164_landline_format: e164, e164_mobile_format: wa,
    whatsapp_link: "https://wa.me/" + wa.slice(1), formatted_international: (mobile ? "+54 9 " : "+54 ") + (ac ? ac + " " + local.slice(0, local.length - 4) + "-" + local.slice(-4) : s),
    note: mobile ? "Mobile detected (15 or 9 prefix): use the +549 form for WhatsApp and SMS." : "Mobile status unknown from this input: Argentine mobiles are dialed internationally as +54 9 + area code + number (without 15); landlines as +54 + area code + number." };
  if (!ac) delete o.area_code; else delete o.area_code_note;
  return { o };
}
const X4U_DATA = {
  "/api/x402/ar/dolar": { id: "arDolarQuotes", tag: "dolar", fn: x4dPre, run: x4dRun, field: "casa", price: "2000", usd: "0.002", summary: "Argentina USD/ARS quotes: oficial, blue, MEP, CCL, cripto, tarjeta, mayorista (0.002 USDC)",
    desc: "Current Argentine dollar quotes (ARS per USD): oficial, blue, bolsa (MEP), contado con liquidacion (CCL), mayorista, cripto and tarjeta, with buy/sell, spread, update time and the blue vs oficial gap. Send {} for all or {casa} for one. Source failure = no charge.",
    example: { casa: "blue" }, okDesc: "Dollar quotes",
    inSchema: { type: "object", properties: { casa: { type: "string", enum: ["all", "oficial", "blue", "bolsa", "mep", "contadoconliqui", "ccl", "mayorista", "cripto", "tarjeta"], default: "all", description: "Which quote; all by default" } }, required: [] },
    out: { type: "object", properties: { quotes: { type: "array", items: { type: "object" } }, brecha_blue_vs_oficial_pct: { type: "number" } }, required: ["quotes"] }, tags: ["argentina", "dolar", "dolar-blue", "ars", "fx", "exchange-rates", "finance", "latam"] },
  "/api/x402/ar/feriados": { id: "arHolidays", tag: "feriados", fn: x4fePre, run: x4feRun, field: "date", price: "2000", usd: "0.002", summary: "Argentina national holidays and business-day calculator (0.002 USDC)",
    desc: "Argentine national holidays (feriados, incl. puentes turisticos) for a year, and optionally a date check: weekday, holiday name, is_business_day, next business day, and date + N business days (skips weekends and holidays). Send {} for this year, {year}, or {date, add_business_days}. Source failure = no charge.",
    example: { date: "2026-12-24", add_business_days: 3 }, okDesc: "Holidays",
    inSchema: { type: "object", properties: { year: { type: "integer", minimum: 2016, description: "Year (default: current, or the year of date)" }, date: { type: "string", maxLength: 10, description: "Date to check, YYYY-MM-DD" }, add_business_days: { type: "integer", minimum: 1, maximum: 60, description: "Business days to add to date" } }, required: [] },
    out: { type: "object", properties: { holidays: { type: "array", items: { type: "object" } }, date_check: { type: "object" } }, required: ["holidays"] }, tags: ["argentina", "holidays", "feriados", "business-days", "calendar", "latam"] },
  "/api/x402/ar/inflacion": { id: "arInflation", tag: "inflacion", fn: x4inPre, run: x4inRun, field: "from", price: "2000", usd: "0.002", summary: "Argentina inflation (INDEC CPI): latest monthly and YoY, cumulative between months, amount adjuster (0.002 USDC)",
    desc: "Argentine consumer price inflation from INDEC: latest monthly %, year-over-year %, last 12 months, and optionally the compounded cumulative inflation between two months with an amount adjusted for inflation (rent, salary, price updates). Send {} or {from: YYYY-MM, to: YYYY-MM, amount}. Source failure = no charge.",
    example: { from: "2026-01", to: "2026-09", amount: 100000 }, okDesc: "Inflation data",
    inSchema: { type: "object", properties: { from: { type: "string", maxLength: 7, description: "First month YYYY-MM (inclusive)" }, to: { type: "string", maxLength: 7, description: "Last month YYYY-MM (inclusive, default latest)" }, amount: { type: "number", minimum: 0, description: "Amount in ARS to adjust" } }, required: [] },
    out: { type: "object", properties: { latest_monthly_pct: { type: "number" }, latest_yoy_pct: { type: "number" }, range: { type: "object" } }, required: ["latest_monthly_pct"] }, tags: ["argentina", "inflation", "inflacion", "cpi", "indec", "finance", "latam"] },
  "/api/x402/fx/rate": { id: "fxRate", tag: "fx", fn: x4fxPre, run: x4fxRun, field: "to", price: "2000", usd: "0.002", summary: "Currency exchange rate and conversion, 160+ currencies (0.002 USDC)",
    desc: "Daily mid-market exchange rate between two fiat currencies (ISO 4217, e.g. USD, EUR, ARS, BRL, JPY) with optional amount conversion, from blended central-bank reference rates (ECB and others, via Frankfurter). Send {from, to, amount}. Unsupported currency = no charge.",
    example: { from: "USD", to: "EUR", amount: 100 }, exOut: { from: "USD", to: "EUR", amount: 100, rate: 0.89058, converted: 89.058, inverse_rate: 1.12286375, date: "2026-10-21", rate_type: "mid-market daily reference (blended central-bank rates)", source: "Frankfurter (frankfurter.dev), data from central banks incl. ECB" }, okDesc: "Exchange rate",
    inSchema: { type: "object", properties: { from: { type: "string", minLength: 3, maxLength: 3, default: "USD", description: "Base currency ISO 4217 code" }, to: { type: "string", minLength: 3, maxLength: 3, description: "Quote currency ISO 4217 code" }, amount: { type: "number", minimum: 0, default: 1, description: "Amount in the base currency to convert" } }, required: ["to"] },
    out: { type: "object", properties: { rate: { type: "number" }, converted: { type: "number" }, date: { type: "string" } }, required: ["rate", "date"] }, tags: ["fx", "forex", "exchange-rates", "currency", "conversion", "finance"] }
};
const X4U = {
  "/api/x402/ar/cuit": { id: "validateCuit", fn: x4uCuit, field: "cuit", summary: "Validate an Argentine CUIT/CUIL (0.01 USDC)",
    desc: "Validate an Argentine tax ID (CUIT/CUIL): checks length, prefix and modulo-11 check digit offline, and returns normalized and formatted values plus entity type (person/company). Send {cuit}. Nothing is stored.",
    example: { cuit: "20-12345678-6" }, tags: ["argentina", "cuit", "cuil", "tax-id", "validation", "afip"] },
  "/api/x402/ar/cbu": { id: "validateCbu", fn: x4uCbu, field: "cbu", summary: "Validate an Argentine CBU/CVU bank account number (0.01 USDC)",
    desc: "Validate an Argentine bank account number (CBU) or virtual account (CVU): checks both check digits offline and returns type, entity/branch codes, bank name for major banks and a formatted value. Send {cbu}. Nothing is stored.",
    example: { cbu: "0070999003000412345671" }, tags: ["argentina", "cbu", "cvu", "bank-account", "validation", "payments"] },
  "/api/x402/ar/phone": { id: "normalizeArPhone", tag: "phone", fn: x4uPhone, field: "phone", summary: "Normalize an Argentine phone number to E.164 + WhatsApp link (0.01 USDC)",
    desc: "Parse and normalize an Argentine phone number written in any local style (011 15 1234-5678, +54 9 11..., 0351 4..., 15 prefix): strips trunk 0 and mobile 15, returns the 10-digit national number, E.164 in landline (+54) and mobile (+549) forms, a wa.me WhatsApp link and whether it is a mobile. Offline, nothing is stored. Send {phone}.",
    example: { phone: "011 15 1234-5678" }, inSchema: { type: "object", properties: { phone: { type: "string", maxLength: 40, description: "Argentine phone number in any common format" } }, required: ["phone"] },
    out: { type: "object", properties: { valid: { type: "boolean" }, normalized: { type: "string" }, e164: { type: "string" }, whatsapp_link: { type: "string" }, mobile: { type: ["boolean", "null"] }, reason: { type: "string" } }, required: ["valid", "normalized"] }, tags: ["argentina", "phone", "e164", "whatsapp", "normalization", "validation"] },
  "/api/x402/web/audit": { id: "auditWebPage", fn: x4aPre, run: x4aRun, field: "url", price: "20000", usd: "0.02", summary: "Audit a web page: SEO, mobile, HTTPS and security headers (0.02 USDC)",
    desc: "Quick technical and SEO audit of a public web page: HTTPS and redirect, status, response time, title and meta description, viewport (mobile), h1, canonical, Open Graph, alt text, structured data, compression and security headers. Returns a 0-100 score, grade and prioritized issues. Send {url}. Charged only if the page could be fetched.",
    example: { url: "https://example.com" }, exOut: X4A_EX, out: X4A_OUT, okDesc: "Audit result",
    inSchema: { type: "object", properties: { url: { type: "string", maxLength: 500, description: "Public http(s) URL to audit" } }, required: ["url"] },
    tags: ["seo", "website", "audit", "security-headers", "web", "lighthouse"] }
};
Object.assign(X4U, X4U_DATA);
function x4uBodyFields(u) { const sc = x4uIn(u), req = sc.required || []; return Object.fromEntries(Object.entries(sc.properties).map(([k, v]) => [k, { ...v, required: req.includes(k) }])); }
const X4U_PRICE = "10000", X4U_USD = "0.01";
function x4uIn(u) { if (u.inSchema) return u.inSchema; return { type: "object", properties: { [u.field]: { type: "string", maxLength: 60, description: u.field === "cuit" ? "CUIT or CUIL, with or without dashes" : "22-digit CBU or CVU" } }, required: [u.field] }; }
const X4U_OUT = { type: "object", properties: { valid: { type: "boolean" }, normalized: { type: "string" }, formatted: { type: "string" }, reason: { type: "string" } }, required: ["valid", "normalized"] };
function x4uReqV1(origin, p, u) {
  return X4.nets.map(n => ({ scheme: "exact", network: n.v1, maxAmountRequired: (u.price || X4U_PRICE), asset: n.asset, payTo: n.payTo, resource: origin + p, description: u.desc, mimeType: "application/json",
    outputSchema: { input: { type: "http", method: "POST", bodyType: "json", discoverable: true, bodyFields: x4uBodyFields(u) }, output: (u.out || X4U_OUT) },
    maxTimeoutSeconds: X4.timeout, extra: { ...n.extra } }));
}
function x4uReqV2(u) { return X4.nets.map(n => ({ scheme: "exact", network: n.v2, amount: ((u && u.price) || X4U_PRICE), asset: n.asset, payTo: n.payTo, maxTimeoutSeconds: X4.timeout, extra: { ...n.extra } })); }
function x4uRequired(origin, p, u, err, v2err) {
  const ex = u.exOut || u.fn(u.example).o;
  const v2 = { x402Version: 2, error: v2err || err, resource: { url: origin + p, description: u.desc, mimeType: "application/json", serviceName: "Landing en 24h", tags: u.tags, iconUrl: origin + "/favicon.ico" }, accepts: x4uReqV2(u),
    extensions: { bazaar: { info: { input: { type: "http", method: "POST", bodyType: "json", body: u.example }, output: { type: "json", example: ex } },
      schema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: { input: { type: "object", properties: { type: { type: "string", const: "http" }, method: { type: "string", enum: ["POST"] }, bodyType: { type: "string", enum: ["json"] }, body: x4uIn(u) }, required: ["type", "method", "bodyType", "body"] }, output: { type: "object", properties: { type: { type: "string" }, example: { type: "object" } }, required: ["type"] } }, required: ["input"] } } } };
  return x4json({ x402Version: 1, error: err, accepts: x4uReqV1(origin, p, u) }, 402, { "PAYMENT-REQUIRED": x4b64(JSON.stringify(v2)) });
}
async function x4uHandle(request, env, ctx, url, p, u) {
  const origin = url.origin;
  if (!["GET", "POST", "HEAD"].includes(request.method)) return x4json({ error: "method_not_allowed" }, 405, { Allow: "GET, POST, HEAD, OPTIONS" });
  const v2h = request.headers.get("payment-signature"), v1h = request.headers.get("x-payment");
  if (!v2h && !v1h) {
    const r = x4uRequired(origin, p, u, "X-PAYMENT header is required", "PAYMENT-SIGNATURE header is required");
    return request.method === "HEAD" ? new Response(null, { status: 402, headers: r.headers }) : r;
  }
  if (request.method === "HEAD") return x4json({ error: "use_get_or_post" }, 405);
  let pay, ver;
  try { pay = JSON.parse(x4unb64(v2h || v1h)); ver = Number(pay && pay.x402Version) || (v2h ? 2 : 1); }
  catch (e) { return x4uRequired(origin, p, u, "invalid_payment_header"); }
  const net = ver >= 2 ? (pay.accepted && pay.accepted.network) : pay.network;
  const scheme = ver >= 2 ? (pay.accepted && pay.accepted.scheme) : pay.scheme;
  const n = X4.nets.find(x => (ver >= 2 ? x.v2 : x.v1) === net);
  if (!n || scheme !== "exact") return x4uRequired(origin, p, u, "unsupported_scheme_or_network");
  const reqs = ver >= 2 ? x4uReqV2(u).find(x => x.network === n.v2) : x4uReqV1(origin, p, u).find(x => x.network === n.v1);
  let b = {};
  if (request.method === "POST") { const raw = await request.text(); if (raw.length > 4000) return x4json({ error: "body_too_large", note: "No payment was taken." }, 400); if (raw.trim()) { try { b = JSON.parse(raw); } catch (e) { return x4json({ error: "invalid_json", note: "No payment was taken." }, 400); } } }
  else { for (const k of new Set(["cuit", "cuil", "cbu", "cvu", "value", "url", "phone", ...Object.keys(x4uIn(u).properties)])) if (url.searchParams.has(k)) b[k] = url.searchParams.get(k); }
  if (!b || typeof b !== "object" || Array.isArray(b)) return x4json({ error: "body_must_be_object", note: "No payment was taken." }, 400);
  let res = u.fn(b, request);
  if (res.err) return x4json({ error: res.err, inputSchema: x4uIn(u), note: "No payment was taken." }, 400);
  const fb = { x402Version: ver >= 2 ? 2 : 1, paymentPayload: pay, paymentRequirements: reqs };
  const vr = await x4fac("/verify", fb, env);
  if (!vr || vr.isValid !== true) { const why = (vr && (vr.invalidReason || vr.error || vr._err || (vr._http && "facilitator_http_" + vr._http))) || "verification_failed"; return x4uRequired(origin, p, u, String(why).slice(0, 200)); }
  if (u.run) { res = await u.run(res.o); if (res.err) return x4json({ error: res.err, detail: res.detail || "", note: "No payment was taken." }, res.status || 502); }
  const sr = await x4fac("/settle", fb, env);
  if (!sr || sr.success !== true) { const why = (sr && (sr.errorReason || sr.error || sr._err || (sr._http && "facilitator_http_" + sr._http))) || "settlement_failed"; return x4uRequired(origin, p, u, String(why).slice(0, 200)); }
  const receipt = { success: true, transaction: sr.transaction || "", network: sr.network || net, payer: sr.payer || vr.payer || "" };
  const rh = x4b64(JSON.stringify(receipt));
  return x4json(res.o, 200, { "X-PAYMENT-RESPONSE": rh, "PAYMENT-RESPONSE": rh });
}
function x4uIndexRes(origin) { return Object.entries(X4U).map(([p, u]) => ({ url: origin + p, methods: ["POST", "GET"], price: { amount: (u.usd || X4U_USD), currency: "USDC", atomic: (u.price || X4U_PRICE), decimals: 6 }, networks: X4.nets.map(n => ({ network: n.v1, caip2: n.v2, asset: n.asset, payTo: n.payTo })), payTo: X4.payTo, payToByNetwork: x4payToBy(), description: u.desc, mimeType: "application/json", inputSchema: x4uIn(u), outputSchema: (u.out || X4U_OUT), example: { request: u.example, response: (u.exOut || u.fn(u.example).o) } })); }
function x4uOpenapi() { return Object.fromEntries(Object.entries(X4U).map(([p, u]) => [p, { post: { operationId: u.id, summary: u.summary, description: u.desc, "x-payment-info": { protocols: ["x402"], price: { mode: "fixed", currency: "USD", amount: (u.usd || X4U_USD) }, networks: X4.nets.map(n => n.v2), asset: "USDC", payTo: X4.payTo, payToByNetwork: x4payToBy() }, requestBody: { required: true, content: { "application/json": { schema: x4uIn(u), example: u.example } } }, responses: { "200": { description: (u.okDesc || "Validation result"), content: { "application/json": { schema: (u.out || X4U_OUT) } } }, "400": { description: "Invalid input (no charge)" }, "402": { description: "Payment required (x402 challenge)" } } } }])); }

// ---------- public surface ----------
// LAX skill id -> route on the live API
export const CAPABILITIES = {
  "landing.generate": "/api/x402/landing",
  "ar.cuit": "/api/x402/ar/cuit",
  "ar.cbu": "/api/x402/ar/cbu",
  "ar.phone": "/api/x402/ar/phone",
  "ar.dolar": "/api/x402/ar/dolar",
  "ar.inflacion": "/api/x402/ar/inflacion",
  "ar.feriados": "/api/x402/ar/feriados",
  "web.audit": "/api/x402/web/audit",
  "fx.rate": "/api/x402/fx/rate"
};
// Input check that runs before any payment is verified (same function the paid route uses).
export function precheck(skill, body) {
  const p = CAPABILITIES[skill];
  if (!p) return { err: "unknown_capability" };
  if (p === "/api/x402/landing") return x4norm(body);
  return X4U[p].fn(body || {});
}
// Runs a capability without the payment layer: precheck, then the work. Used for the examples and tests.
export async function runCapability(skill, body) {
  const pre = precheck(skill, body);
  if (pre.err) return pre;
  const p = CAPABILITIES[skill];
  if (p === "/api/x402/landing") return { o: { html: x4landing(pre.o), filename: x4slug(pre.o.business_name) + ".html" } };
  const u = X4U[p];
  return u.run ? await u.run(pre.o) : pre;
}
// JSON Schema of each capability as published in the live 402 answer and /openapi.json
export function schemas(skill) {
  const p = CAPABILITIES[skill];
  if (!p) return null;
  if (p === "/api/x402/landing") return { input: X4_INPUT_SCHEMA, output: X4_OUTPUT_SCHEMA };
  return { input: x4uIn(X4U[p]), output: X4U[p].out || X4U_OUT };
}
export const PAY_TO = X4.payTo;
export const NETWORKS = X4.nets.map(n => ({ network: n.v1, caip2: n.v2, asset: n.asset, payTo: n.payTo }));
// Worker entry: the same routes as production (/api/x402, /api/x402/<capability>, /.well-known/x402, /openapi.json).
export async function handle(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/x402") || url.pathname === "/.well-known/x402" || url.pathname === "/openapi.json") return x402Handle(request, env || {}, ctx, url);
  return x4json({ error: "not_found" }, 404);
}
export default { fetch: handle };
