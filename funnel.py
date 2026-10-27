#!/usr/bin/env python3
"""Builder BD funnel from a contact log (one JSON line per contact: date, builder, channel, step, next).
Deterministic: every number is a count of distinct builders read from the log. Nothing else is printed.
Usage: python3 funnel.py contacts.jsonl [--as-of YYYY-MM-DD]   (default as-of = last date in the log)"""
import sys, json, datetime
STEPS = ["reached", "tried", "listed", "bid", "shipped", "earning"]
def load(path):
    rows, bad = [], []
    for i, line in enumerate(open(path, encoding="utf-8"), 1):
        line = line.strip()
        if not line: continue
        try:
            r = json.loads(line); d = datetime.date.fromisoformat(r["date"][:10]); s = str(r["step"]).strip().lower(); b = str(r["builder"]).strip().lower()
            if s not in STEPS or not b: raise ValueError("unknown step or empty builder")
            rows.append((d, b, s, r.get("channel", ""), r.get("next", "")))
        except Exception as e:
            bad.append((i, str(e)))
    return rows, bad
def funnel(rows, since=None, until=None):
    out = {s: set() for s in STEPS}
    for d, b, s, *_ in rows:
        if (since is None or d >= since) and (until is None or d <= until): out[s].add(b)
    return {s: len(v) for s, v in out.items()}
def main():
    a = sys.argv[1:]; path = a[0]
    rows, bad = load(path)
    asof = datetime.date.fromisoformat(a[a.index("--as-of") + 1]) if "--as-of" in a else max(r[0] for r in rows)
    since = asof - datetime.timedelta(days=6); prev = (since - datetime.timedelta(days=7), since - datetime.timedelta(days=1))
    w, t, p = funnel(rows, since, asof), funnel(rows, None, asof), funnel(rows, *prev)
    print(f"Funnel, distinct builders per step. Week {since} to {asof}; total up to {asof}.")
    print("step      week  total")
    for s in STEPS: print(f"{s:<9}{w[s]:>5}{t[s]:>7}")
    print("What moved:")
    up = [s for s in STEPS if w[s] > p[s]]; down = [s for s in STEPS if w[s] < p[s]]
    print("1. Steps above the previous week (" + f"{prev[0]} to {prev[1]}" + "): " + (", ".join(f"{s} {p[s]} to {w[s]}" for s in up) or "none") + ".")
    print("2. Steps below the previous week: " + (", ".join(f"{s} {p[s]} to {w[s]}" for s in down) or "none") + ".")
    adv = sorted({b for d, b, s, *_ in rows if since <= d <= asof and s != "reached"})
    print(f"3. Builders who moved past reached this week: {len(adv)}" + (f" ({', '.join(adv)})." if adv else "."))
    if bad: print(f"Skipped lines (not counted): {len(bad)}: " + "; ".join(f"line {i}: {e}" for i, e in bad))
if __name__ == "__main__": main()
