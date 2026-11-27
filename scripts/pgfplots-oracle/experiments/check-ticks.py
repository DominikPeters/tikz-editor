"""Check the automatic linear tick rule (behaviour log I1) on an e08 ticks.tsv.
  n    = max(floor(L / msbt), tmt - 1)  msbt = max space between ticks (35), tmt = try min ticks (4)
  raw  = (hi - lo) / n ; k = floor(log10 raw) ; m = raw / 10^k
  step = 10^k * (1 if m < 1.5 else 2 if m < 3.5 else 5 if m < 7.5 else 10)
  fallback (I1b): while #{k*step : trunc(lo/step) <= k, k*step <= hi} < 2, step = next smaller of 1,2,5 x 10^k
  ticks = every integer multiple of step in [lo - tol, hi + tol], tol = 0.05pt in data units
Usage: check-ticks.py ticks.tsv [--verbose]"""
import csv, sys, math, re
rows = list(csv.DictReader(open(sys.argv[1]), delimiter='\t'))
verbose = '--verbose' in sys.argv
def rule(lo, hi, L, msbt=35, tmt=4):
    n = max(math.floor(L / msbt), tmt - 1)
    raw = (hi - lo) / n
    k = math.floor(math.log10(raw)); m = raw / 10 ** k
    mult = 1 if m < 1.5 else 2 if m < 3.5 else 5 if m < 7.5 else 10
    step = mult * 10 ** k
    # I1b few-ticks fallback: count grid points from trunc-toward-zero(lo/step) up to hi;
    # while fewer than 2, use the next smaller nice step (10 -> 5 -> 2 -> 1 -> 0.5 ...).
    def count(st):
        start = math.trunc(lo / st); return math.floor(hi / st + 1e-9) - start + 1
    seq = [1, 2, 5]
    while count(step) < 2:
        e = math.floor(math.log10(step) + 1e-9); mm = round(step / 10 ** e)
        step = (2 * 10 ** e) if mm == 5 else (1 * 10 ** e) if mm == 2 else (5 * 10 ** (e - 1))
    tol = 0.05 * (hi - lo) / L
    first = math.ceil((lo - tol) / step); last = math.floor((hi + tol) / step)
    return step, [i * step for i in range(first, last + 1)], m
ok = bad = 0; near = 0
for r in rows:
    extra = r.get('extra', '') or ''
    msbt = int(re.search(r'max space between ticks=(\d+)', extra).group(1)) if 'max space' in extra else 35
    tmt = int(re.search(r'try min ticks=(\d+)', extra).group(1)) if 'try min' in extra else 4
    for ax in 'xy':
        lo, hi, L = float(r[ax + 'lo']), float(r[ax + 'hi']), float(r['L' + ax])
        got = [float(v) for v in r[ax + 'ticks'].split()]
        step, exp, m = rule(lo, hi, L, msbt, tmt)
        same = len(got) == len(exp) and all(abs(g - e) <= 1e-6 * max(hi - lo, abs(e)) + 1e-12 for g, e in zip(got, exp))
        if same: ok += 1
        else:
            bad += 1
            if verbose or bad <= 15: print(f"MISMATCH {r['id']} {ax} [{lo},{hi}] L={L} {extra} m={m:.5f}\n   got {got}\n   exp {exp}")
print(f"axes checked: {ok + bad}, match {ok}, mismatch {bad}")
