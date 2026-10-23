"""Lists an offer on LAX. POST <registry>/offers; on 402 calls pay(terms) for the header value and posts again with
PAYMENT-SIGNATURE (x402 v2 terms) or X-PAYMENT (v1). Returns {"id", "transaction"}. Never logs; the key stays with the caller."""
import base64, json, urllib.request, urllib.error


class ListOfferError(Exception):
    def __init__(self, message, status):
        super().__init__(message)
        self.status = status


def _http_post(url, body: bytes, headers: dict):
    r = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read().decode()


def list_offer(offer: dict, pay, registry_url: str = "https://lax.kognai.ai/registry", post=_http_post) -> dict:
    url = registry_url.rstrip("/") + "/offers"
    body = json.dumps(offer).encode()
    status, headers, text = post(url, body, {"content-type": "application/json"})
    if status == 402:
        terms = None
        if headers.get("payment-required"):
            try:
                terms = json.loads(base64.b64decode(headers["payment-required"]).decode())
            except Exception:
                terms = None
        if terms is None:
            try:
                parsed = json.loads(text)
                terms = parsed if isinstance(parsed.get("accepts"), list) else None
            except Exception:
                terms = None
        if terms is None:
            raise ListOfferError("the registry answered 402 without payment terms", 402)
        value = pay(terms)
        if not isinstance(value, str) or not value:
            raise ListOfferError("pay() returned no payment header", 402)
        h = {"content-type": "application/json", ("PAYMENT-SIGNATURE" if terms.get("x402Version") == 2 else "X-PAYMENT"): value}
        status, headers, text = post(url, body, h)
    try:
        out = json.loads(text)
    except Exception:
        out = None
    if status >= 400 or not isinstance(out, dict) or not isinstance(out.get("id"), str):
        raise ListOfferError((out or {}).get("error") or f"registry answered {status}", status)
    return {"id": out["id"], "transaction": out.get("transaction")}
