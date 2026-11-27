"""Check the size-model rule on an e02 rect.tsv table. Usage: python3 check-size.py artifacts/.../rect.tsv"""
import csv, sys
rows = list(csv.DictReader(open(sys.argv[1]), delimiter='\t'))
DW, DH = 240.0, 207.0
worst = {}
def rec(mode, err, r):
    if abs(err) > abs(worst.get(mode, (0, None))[0]): worst[mode] = (err, r['id'])
    else: worst.setdefault(mode, (err, r['id']))
for r in rows:
    f = lambda k: float(r[k]) if r.get(k) else None
    soa = r['soa'] == 'true'; m = r['mode']; sub = 0 if soa else 45
    if m == 'wh': ew, eh = f('w') - sub, f('h') - sub
    elif m == 'wonly': ew, eh = f('w') - sub, f('w') * DH / DW - sub
    elif m == 'honly': ew, eh = f('h') * DW / DH - sub, f('h') - sub
    elif m == 'units': ew, eh = 5 * f('ux'), 4 * f('uy')
    elif m == 'xunit': ew, eh = 5 * f('ux'), DH - 45
    elif m == 'scale': ew, eh = (DW - 45) * f('scale'), (DH - 45) * f('scale')
    elif m == 'scale-soa': ew, eh = 150 * f('scale'), 100 * f('scale')
    else: continue
    key = m + ('/' + r['decor'] if r.get('decor') else '') + ('/soa' if soa else '')
    rec(key + ' w', f('rw') - ew, r); rec(key + ' h', f('rh') - eh, r)
    rec('origin', max(abs(f('x0')), abs(f('y0'))), r)
for k, (e, i) in sorted(worst.items()): print(f"{k:32s} max err {e:+.5f} pt ({i})")
