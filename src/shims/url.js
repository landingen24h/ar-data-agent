// Minimal `url` shim for runtimes without Node built-ins (Workers without nodejs_compat).
// @x402/extensions only needs domainToASCII; WHATWG URL does IDNA -> punycode for us.
export function domainToASCII(domain) {
  try { return new URL(`http://${domain}`).hostname; } catch { return ''; }
}
export default { domainToASCII };
