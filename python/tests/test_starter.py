import base64, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pytest
from app import create_app
from list_offer import list_offer, ListOfferError
from x402_rules import validate_offer, to_atomic

PAY_TO = "0x1111111111111111111111111111111111111111"
b64 = lambda o: base64.b64encode(json.dumps(o).encode()).decode()
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Fac:
    def __init__(self, valid=True, settled=True):
        self.valid, self.settled, self.calls = valid, settled, []

    def verify(self, p, r):
        self.calls.append("verify")
        return {"isValid": True, "payer": "0xp"} if self.valid else {"isValid": False, "invalidReason": "insufficient_funds"}

    def settle(self, p, r):
        self.calls.append("settle")
        return {"success": True, "transaction": "0xabc", "network": r["network"]} if self.settled else {"success": False, "errorReason": "reverted"}


def pay(**kw):
    return {"x402Version": 1, "scheme": "exact", "network": "base-sepolia", "payload": {}, **kw}


def client(fac, work=None, network="base-sepolia"):
    return create_app("0.01", PAY_TO, network, fac, "test route", work).test_client()


def test_A1_unpaid_call_answers_402_with_requirements():
    r = client(Fac()).get("/paid")
    assert r.status_code == 402
    a = r.get_json()["accepts"][0]
    assert r.get_json()["x402Version"] == 1
    assert a["scheme"] == "exact" and a["network"] == "base-sepolia" and a["maxAmountRequired"] == "10000"
    assert a["payTo"] == PAY_TO and a["asset"] == "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    assert a["resource"].endswith("/paid") and a["mimeType"] == "application/json"
    assert client(Fac(), network="base").get("/paid").get_json()["accepts"][0]["asset"] == "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    assert to_atomic("0.01") == "10000" and to_atomic("2.5") == "2500000"
    for bad in ("0", "-1", "1e3", "0.0000001", ""):
        with pytest.raises(ValueError):
            to_atomic(bad)
    assert client(Fac()).get("/health").status_code == 200


def test_A2_paid_call_verified_settled_then_200():
    f, worked = Fac(), []
    r = client(f, lambda req: worked.append(1) or {"answer": 42}).get("/paid", headers={"X-PAYMENT": b64(pay())})
    assert r.status_code == 200 and f.calls == ["verify", "settle"] and worked == [1]
    assert r.get_json()["result"] == {"answer": 42}
    receipt = json.loads(base64.b64decode(r.headers["X-PAYMENT-RESPONSE"]))
    assert receipt["success"] is True and receipt["transaction"] == "0xabc"


@pytest.mark.parametrize("fac,calls", [(Fac(valid=False), ["verify"]), (Fac(settled=False), ["verify", "settle"])])
def test_A2_failed_payment_gets_402_and_no_work(fac, calls):
    worked = []
    r = client(fac, lambda req: worked.append(1)).get("/paid", headers={"X-PAYMENT": b64(pay())})
    assert r.status_code == 402 and worked == [] and fac.calls == calls and "X-PAYMENT-RESPONSE" not in r.headers


def test_A2_bad_header_never_reaches_facilitator():
    for h in ("%%%", b64("x"), b64(pay(x402Version=2)), b64(pay(network="base"))):
        f = Fac()
        assert client(f).get("/paid", headers={"X-PAYMENT": h}).status_code == 402 and f.calls == []


def test_A3_offer_passes_validation_with_the_five_laws():
    offer = json.load(open(os.path.join(HERE, "lax-offer.json")))
    assert validate_offer(offer) == []
    assert any("Five Laws" in e for e in validate_offer({**offer, "constitutional_constraints": []}))


def test_A4_listing_pays_through_the_given_function(capsys):
    terms = {"x402Version": 2, "accepts": [{"amount": "10000"}]}
    sent = []

    def post(url, body, headers):
        sent.append(headers)
        if "PAYMENT-SIGNATURE" not in headers:
            return 402, {"payment-required": b64(terms)}, json.dumps({"error": "pay"})
        return 201, {}, json.dumps({"ok": True, "id": "lax-ext-1", "transaction": "0xt"})

    got = []
    out = list_offer({"name": "x"}, lambda t: got.append(t) or "SIGNED-SECRET", "https://reg.example/registry/", post)
    assert out == {"id": "lax-ext-1", "transaction": "0xt"} and got == [terms]
    assert sent[1]["PAYMENT-SIGNATURE"] == "SIGNED-SECRET"
    cap = capsys.readouterr()
    assert cap.out == "" and cap.err == ""


def test_A4_refused_offer_raises_and_pays_nothing():
    paid = []
    with pytest.raises(ListOfferError, match="description"):
        list_offer({"name": "x"}, lambda t: paid.append(1) or "x", post=lambda u, b, h: (400, {}, json.dumps({"error": "description must be 20 to 600 characters"})))
    assert paid == []


@pytest.mark.skip(reason="M2: live Base Sepolia paid call, transaction hash goes in the README")
def test_A5_base_sepolia_paid_call():
    pass
