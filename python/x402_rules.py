"""Pure helpers shared by app.py and list_offer.py."""
import base64, json, re

USDC = {
    "base": {"address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "name": "USD Coin", "version": "2"},
    "base-sepolia": {"address": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "name": "USDC", "version": "2"},
}
FIVE_LAWS = ["Solidarity Oath", "Renewal Mandate", "Treasury Equilibrium", "Harm Shield", "Transparency Covenant"]


def to_atomic(price: str) -> str:
    if not isinstance(price, str) or not re.fullmatch(r"(0|[1-9][0-9]*)(\.[0-9]{1,6})?", price):
        raise ValueError(f'price must be a decimal USDC string such as "0.01", got {price!r}')
    whole, _, frac = price.partition(".")
    atomic = int(whole) * 1_000_000 + int((frac or "").ljust(6, "0"))
    if atomic <= 0:
        raise ValueError("price must be above 0")
    return str(atomic)


def is_address(a) -> bool:
    return isinstance(a, str) and re.fullmatch(r"0x[0-9a-fA-F]{40}", a) is not None


def b64encode(o) -> str:
    return base64.b64encode(json.dumps(o).encode()).decode()


def b64decode_json(s: str):
    t = str(s).strip()
    if not re.fullmatch(r"[A-Za-z0-9+/_-]+={0,2}", t):
        raise ValueError("not base64")
    return json.loads(base64.b64decode(t.replace("-", "+").replace("_", "/")).decode())


def validate_offer(o) -> list:
    e = []
    s = lambda v, lo, hi: isinstance(v, str) and lo <= len(v) <= hi
    if not isinstance(o, dict):
        return ["offer must be an object"]
    if "lax_version" in o and o["lax_version"] != "1.0":
        e.append('lax_version must be "1.0"')
    if not s(o.get("name"), 3, 80):
        e.append("name must be 3 to 80 characters")
    if not s(o.get("description"), 20, 600):
        e.append("description must be 20 to 600 characters")
    if not o.get("endpoint") and not o.get("pact_endpoint"):
        e.append("endpoint or pact_endpoint is required")
    for k in ("endpoint", "pact_endpoint"):
        if k in o and not (isinstance(o[k], str) and re.match(r"https://[^\s/]+\.[^\s/]+", o[k])):
            e.append(f"{k} must be an https url")
    caps = o.get("capabilities")
    if not isinstance(caps, list) or not 1 <= len(caps) <= 10:
        e.append("capabilities must have 1 to 10 items")
    else:
        for i, c in enumerate(caps):
            p = (c or {}).get("pricing") or {}
            if not (c or {}).get("skill_id"):
                e.append(f"capabilities[{i}].skill_id is required")
            if not (c or {}).get("description"):
                e.append(f"capabilities[{i}].description is required")
            if p.get("model") not in ("per_call", "per_minute", "flat", "free"):
                e.append(f"capabilities[{i}].pricing.model is invalid")
            if not (isinstance(p.get("amount"), str) and re.fullmatch(r"[0-9]+(\.[0-9]+)?", p["amount"])):
                e.append(f"capabilities[{i}].pricing.amount must be a decimal string")
            if p.get("currency") != "USDC" or p.get("rail") != "x402":
                e.append(f"capabilities[{i}].pricing must be USDC over x402")
    cc = o.get("constitutional_constraints")
    if not isinstance(cc, list) or not all(l in cc for l in FIVE_LAWS):
        e.append("constitutional_constraints must include the Five Laws")
    return e
