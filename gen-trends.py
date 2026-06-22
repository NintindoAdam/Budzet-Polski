#!/usr/bin/env python3
"""Regenerate trends-data.json from the per-year budget files.

trends-data.json is DERIVED — never hand-edit it. Run this after adding a year:
    python3 gen-trends.py
It reads every budget-*.json (all PLAN, not wykonanie), writes a compact
per-year series (totals + 7 expense types + normalized działy) consumed by the
Trendy dashboard, and verifies the data invariants (diff 0).
"""
import json, glob, os, sys

# Fix 2011-era encoding artifacts + merge spelling variants to one canonical name,
# so per-category lines stay continuous across years.
NORM = {
    "OĞwiata i wychowanie": "Oświata i wychowanie",
    "RóĪne rozliczenia": "Różne rozliczenia",
    "RóŜne rozliczenia": "Różne rozliczenia",
    "LeĞnictwo": "Leśnictwo",
    "Transport i łącznoĞü": "Transport i łączność",
    "DziałalnoĞü usługowa": "Działalność usługowa",
    "Gospodarka komunalna i ochrona Ğrodowiska": "Gospodarka komunalna i ochrona środowiska",
    "Szkolnictwo wyĪsze": "Szkolnictwo wyższe",
    "Szkolnictwo wyŜsze": "Szkolnictwo wyższe",
    "Wymiar sprawiedliwoĞci": "Wymiar sprawiedliwości",
    "BezpieczeĔstwo publiczne i ochrona przeciwpoĪarowa": "Bezpieczeństwo publiczne i ochrona przeciwpożarowa",
    "Bezpieczeństwo publiczne i ochrona przeciwpoŜarowa": "Bezpieczeństwo publiczne i ochrona przeciwpożarowa",
    "Bezpieczeństwo publiczne i ochrona ppoż.": "Bezpieczeństwo publiczne i ochrona przeciwpożarowa",
    "UrzĊdy naczelnych organów władzy paĔstwowej, kontroli i ochrony prawa oraz sądownictwa":
        "Urzędy naczelnych organów władzy państwowej, kontroli i ochrony prawa oraz sądownictwa",
    "Urzędy naczelnych organów władzy państwowej":
        "Urzędy naczelnych organów władzy państwowej, kontroli i ochrony prawa oraz sądownictwa",
    "Ogrody botaniczne i zoologiczne":
        "Ogrody botaniczne i zoologiczne oraz naturalne obszary i obiekty chronionej przyrody",
    "Dochody od osób prawnych, fizycznych i innych jednostek": "Różne rozliczenia",
}

HERE = os.path.dirname(os.path.abspath(__file__))
files = sorted(glob.glob(os.path.join(HERE, "budget-2*.json"))) + [os.path.join(HERE, "budget-data.json")]

out = {"meta": {"jednostka": "tys. zł", "typ": "plan",
                "zrodlo": "ustawy budżetowe 2011–2026 (plan, zał. nr 2)", "lata": []}, "lata": []}

for f in files:
    d = json.load(open(f, encoding="utf-8"))
    m = d["meta"]
    dz = {}
    for x in d.get("dzialy", []):
        nm = NORM.get(x["name"], x["name"])
        dz[nm] = dz.get(nm, 0) + x["plan"]
    out["lata"].append({
        "rok": m["rok"], "wydatki": m["wydatki"], "dochody": m["dochody"], "deficyt": m["deficyt"],
        "typy": [{"name": t["name"], "plan": t["plan"]} for t in d.get("typy", [])],
        "dzialy": [{"name": k, "plan": v} for k, v in sorted(dz.items(), key=lambda kv: -kv[1])],
    })

out["lata"].sort(key=lambda r: r["rok"])
out["meta"]["lata"] = [r["rok"] for r in out["lata"]]

# invariants — every year's typy and działy must sum to wydatki (diff 0)
bad = 0
for r in out["lata"]:
    if sum(t["plan"] for t in r["typy"]) != r["wydatki"] or sum(x["plan"] for x in r["dzialy"]) != r["wydatki"]:
        bad += 1
        print(f"  INVARIANT FAIL {r['rok']}", file=sys.stderr)
if bad:
    sys.exit(f"{bad} year(s) failed the invariant — trends-data.json NOT written")

json.dump(out, open(os.path.join(HERE, "trends-data.json"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print(f"trends-data.json written: {len(out['lata'])} years, all invariants OK")
