"""Check the automatic-limit rule (behaviour log H1-H3) on an e07 limits.tsv.
Error is reported as canvas distance: |limit error| / (final range) * axis length (pt)."""
import csv, sys, re
rows = list(csv.DictReader(open(sys.argv[1]), delimiter='\t'))
ONECM = 72.27 / 2.54
def predict(lo, hi, opt, axis):
    """lo/hi: data range on this axis. opt: option string. Returns (min, max)."""
    mode = 'auto'; value = 0.1; lower = upper = True; absval = None
    # most specific key wins: enlarge <axis> limits over enlargelimits
    m = re.search(r'enlarge %s limits=(\{[^}]*\}|[^,]*)' % axis, opt) or re.search(r'enlargelimits=(\{[^}]*\}|[^,]*)', opt)
    if m:
        v = m.group(1).strip('{}')
        for part in v.split(','):
            part = part.strip()
            if part == 'false': return lo, hi
            elif part in ('true', 'auto'): pass
            elif part == 'upper': lower, upper = False, True
            elif part == 'lower': lower, upper = True, False
            elif part.startswith('value='): value = float(part[6:])
            elif part.startswith('rel='): value = float(part[4:])
            elif part.startswith('abs='):
                a = part[4:]
                absval = a
            else: value = float(part)
    r = hi - lo
    def widen(a, b):  # H2: still degenerate after enlargement -> +-20% of |v| (or +-1 at 0)
        if a != b: return a, b
        d = 0.2 * abs(a) if a != 0 else 1.0
        return a - d, b + d
    if absval is not None:
        if absval.endswith('cm'): return ('abs-dim', float(absval[:-2]) * ONECM, *widen(lo, hi))
        d = float(absval); return widen(lo - (d if lower else 0), hi + (d if upper else 0))
    return widen(lo - (value * r if lower else 0), hi + (value * r if upper else 0))
worst = {}
for r in rows:
    if not r['id'].startswith('l') or not r.get('xmin'): continue
    a, b, c, d = (float(r[k]) for k in 'abcd')
    opt = r['opt']
    for axis, lo, hi, kmin, kmax, L in (('x', a, b, 'xmin', 'xmax', 'W'), ('y', c, d, 'ymin', 'ymax', 'H')):
        if hi != lo and (hi - lo) / max(abs(lo), abs(hi)) < 1e-4:
            key = 'SKIPPED: relative data range < 1e-4 (precision regime)'
            worst.setdefault(key, (0, r['id'])); continue
        p = predict(lo, hi, opt, axis)
        gmin, gmax, length = float(r[kmin]), float(r[kmax]), float(r[L])
        if p[0] == 'abs-dim':
            # enlarge by a dimension: limits grow so that the data range keeps length - 2*dim on canvas
            got = (p[3] - p[2]) / (gmax - gmin) * length; exp = length - 2 * p[1]
            e = got - exp; key = 'abs=1cm (data span on canvas)'
        else:
            e = max(abs(gmin - p[0]), abs(gmax - p[1])) / (gmax - gmin) * length; key = opt or '(default)'
        if key not in worst or abs(e) > abs(worst[key][0]): worst[key] = (e, r['id'])
for k, (e, i) in sorted(worst.items()): print(f"{k:40s} max canvas err {e:+.5f} pt ({i})")
