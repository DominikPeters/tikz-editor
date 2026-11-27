"""Check the scaled-ticks rule and tick label strings (behaviour log J1-J3) on an e11 scaled.tsv.
J1: e = floor(log10(max(|min|, |max|))) of the final axis limits; scaled iff e >= 4 or e <= -2.
J2: label = \\pgfmathprintnumber(tick / 10^e) (tick / 1 when unscaled) with the PGF defaults
    (std, precision 2: fixed for exponents -1..4, else sci; 1000 sep ','; trailing zeros dropped).
J3: scale label text is '·10^{e}' (glyphs '·10' + exponent)."""
import csv, sys, math
rows = list(csv.DictReader(open(sys.argv[1]), delimiter='\t'))
def std(v):
    if v == 0: return '0'
    e = math.floor(math.log10(abs(v)))
    m = round(v / 10 ** e, 2)
    if abs(m) >= 10: m /= 10; e += 1
    if e < -1 or e > 4:
        ms = ('%.2f' % m).rstrip('0').rstrip('.')
        return (ms + '·10' + str(e)).replace('-', '−') if ms not in ('1', '-1') else (ms + '·10' + str(e)).replace('-', '−')
    s = ('%.2f' % round(v, 2)).rstrip('0').rstrip('.')
    neg = s.startswith('-'); s = s.lstrip('-')
    ip, _, fp = s.partition('.')
    ip = '{:,}'.format(int(ip))
    out = ip + ('.' + fp if fp else '')
    if out == '0' and neg: neg = False
    return ('−' if neg else '') + out
bad = {'scale': 0, 'labels': 0}; n = 0; shown = 0
for r in rows:
    for ax, lo, hi in (('x', 'lo', 'hi'), ('y', 'ylo', 'yhi')):
        if not r[ax + 'tick']: continue
        n += 1
        a, b = float(r[lo]), float(r[hi])
        e = math.floor(math.log10(max(abs(a), abs(b))))
        scaled = e >= 4 or e <= -2
        got = r[ax + 'scale']
        exp_scale = ('·10' + str(e).replace('-', '−')) if scaled else ''
        if got != exp_scale:
            bad['scale'] += 1
            if shown < 12: print('SCALE', r['id'], ax, a, b, 'got', repr(got), 'exp', repr(exp_scale)); shown += 1
            continue
        pos = [float(p) for p in r[ax + 'pos'].split()]
        exp_labels = [std(p / 10 ** e if scaled else p) for p in pos]
        # snap positions (TeX noise) to the tick step grid before printing
        if len(pos) > 1:
            step = pos[1] - pos[0]
            k = math.floor(math.log10(abs(step))); st = round(step / 10 ** k) * 10 ** k
            exp_labels = [std(round(p / st) * st / (10 ** e if scaled else 1)) for p in pos]
        got_labels = r[ax + 'labels'].split()
        if got_labels != exp_labels:
            bad['labels'] += 1
            if shown < 12: print('LABELS', r['id'], ax, a, b, 'got', got_labels, 'exp', exp_labels); shown += 1
print(f"axes {n}; scale-decision/exponent mismatches {bad['scale']}; label-string mismatches {bad['labels']}")
