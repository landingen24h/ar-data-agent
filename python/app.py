"""x402 paid agent starter, Python edition (Flask). GET /health is free; GET /paid costs PRICE USDC over x402 (v1 headers).
Unpaid: 402 with the requirements. Paid: verify, settle, then the work, then 200 with X-PAYMENT-RESPONSE.
A payment that does not verify or settle gets 402 and the work is not done."""
import json, os, urllib.request
from flask import Flask, request, jsonify
from x402_rules import USDC, to_atomic, is_address, b64encode, b64decode_json


class HttpFacilitator:
    """verify/settle over HTTP, for example https://facilitator.payai.network."""
    def __init__(self, url: str):
        if not url.startswith("https://") and not url.startswith("http://localhost"):
            raise ValueError("facilitator url must be https")
        self.base = url.rstrip("/")

    def _call(self, path, payload, req):
        body = json.dumps({"x402Version": 1, "paymentPayload": payload, "paymentRequirements": req}).encode()
        r = urllib.request.Request(f"{self.base}/{path}", data=body, headers={"content-type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(r, timeout=30) as resp:
                return json.loads(resp.read().decode() or "{}")
        except Exception as ex:  # an HTTP error is a refusal, never a crash
            return {"isValid": False, "invalidReason": str(ex)} if path == "verify" else {"success": False, "errorReason": str(ex)}

    def verify(self, payload, req):
        return self._call("verify", payload, req)

    def settle(self, payload, req):
        return self._call("settle", payload, req)


def default_work(req):
    return {"message": "paid result", "at": req.path}


def create_app(price: str, pay_to: str, network: str, facilitator, description: str = None, work=None, max_timeout_seconds: int = 60):
    atomic = to_atomic(price)
    if not is_address(pay_to):
        raise ValueError("pay_to must be 0x and 40 hex")
    if network not in USDC:
        raise ValueError("network must be base or base-sepolia")
    fac = HttpFacilitator(facilitator) if isinstance(facilitator, str) else facilitator
    usdc = USDC[network]
    work = work or default_work
    desc = description or f"Paid route, {price} USDC per call over x402"
    app = Flask(__name__)

    def requirements():
        return {"scheme": "exact", "network": network, "maxAmountRequired": atomic, "resource": request.base_url,
                "description": desc, "mimeType": "application/json", "payTo": pay_to, "maxTimeoutSeconds": max_timeout_seconds,
                "asset": usdc["address"], "extra": {"name": usdc["name"], "version": usdc["version"]}}

    def required(req, error):
        return jsonify({"x402Version": 1, "error": error, "accepts": [req]}), 402

    @app.get("/health")
    def health():
        return jsonify({"ok": True})

    @app.route("/paid", methods=["GET", "POST"])
    def paid():
        req = requirements()
        header = request.headers.get("X-PAYMENT")
        if not header:
            return required(req, "X-PAYMENT header is required")
        try:
            payment = b64decode_json(header)
            assert isinstance(payment, dict)
        except Exception:
            return required(req, "X-PAYMENT is not base64 JSON")
        if payment.get("x402Version") != 1:
            return required(req, "unsupported x402Version")
        if payment.get("scheme") != "exact" or payment.get("network") != network:
            return required(req, "payment scheme or network does not match")
        try:
            v = fac.verify(payment, req)
        except Exception:
            return required(req, "payment verification failed")
        if not v or v.get("isValid") is not True:
            return required(req, f"payment did not verify: {(v or {}).get('invalidReason') or 'invalid'}")
        try:
            s = fac.settle(payment, req)
        except Exception:
            return required(req, "payment settlement failed")
        if not s or s.get("success") is not True:
            return required(req, f"payment did not settle: {(s or {}).get('errorReason') or 'failed'}")
        try:
            result = work(request)
        except Exception:
            result = {"error": "the work failed after payment; contact the operator with the transaction"}
        receipt = {"success": True, "transaction": s.get("transaction"), "network": s.get("network") or network, "payer": s.get("payer") or v.get("payer")}
        resp = jsonify({"ok": True, "result": result, "payment": {"transaction": receipt["transaction"], "network": receipt["network"]}})
        resp.headers["X-PAYMENT-RESPONSE"] = b64encode(receipt)
        return resp

    return app


if __name__ == "__main__":
    create_app(os.environ.get("PRICE", "0.01"), os.environ.get("PAY_TO", ""), os.environ.get("NETWORK", "base-sepolia"),
               os.environ.get("FACILITATOR_URL", "https://x402.org/facilitator")).run(port=int(os.environ.get("PORT", "8788")))
