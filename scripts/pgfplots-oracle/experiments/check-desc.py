"""Check tick-label / description placement rules on an e04 desc.tsv.
Rules (see design/pgfplots-behaviour.md D1, E1-E3):
  tick label offset along outer normal: inside 0, outside L, center L/2 (L = major tick length, default 0.15cm)
  xlabel.north (incl. outer sep) = bottom of x tick label bounding box  -> north - min(tick south) = 0.2 (tick outer sep)
  ylabel.south (rotated, incl outer sep) = left of y tick label bbox    -> south.x - min(tick west) = 0.2
  title.south = (centre, top + 6pt)
"""
import csv, sys
rows = list(csv.DictReader(open(sys.argv[1]), delimiter='\t'))
L0 = 0.15 * 72.27 / 2.54
def length(v):
    if not v: return L0
    return float(v.replace('pt', ''))
worst = {}
def rec(k, e, i):
    if k not in worst or abs(e) > abs(worst[k][0]): worst[k] = (e, i)
for r in rows:
    L = length(r['len']); al = r['al'] or 'inside'
    off = {'inside': 0, 'outside': L, 'center': L / 2}[al]
    f = lambda k: float(r[k]) if r[k] not in ('', None) else None
    if f('nx'): rec('x ticklabel north.y - (y0 - off)', f('xlab_dy') + off, r['id']); 
    if f('ny') and f('ylab_dx') is not None: rec('y ticklabel east.x - (x0 - off)', f('ylab_dx') + off, r['id'])
    if f('xlab_dx') is not None: rec('x ticklabel north.x - tick X (unscaled)', f('xlab_dx'), r['id'])
    if f('xl_gap') is not None: rec('xlabel north - min tick south - 0.2', f('xl_gap') - 0.2, r['id']); rec('xlabel centre x', f('xl_north_x'), r['id'])
    if f('yl_gap') is not None: rec('ylabel south.x - min tick west - 0.2', f('yl_gap') - 0.2, r['id']); rec('ylabel centre y', f('yl_south_y'), r['id'])
    if f('ti_south_y') is not None: rec('title south - top - 6pt', f('ti_south_y') - 6, r['id']); rec('title centre x', f('ti_south_x'), r['id'])
for k, (e, i) in worst.items(): print(f"{k:45s} {e:+.5f} pt ({i})")
