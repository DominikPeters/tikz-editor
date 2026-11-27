# Checker for E17 (log axis ticks): predicts the major tick list, \ticknum and
# minor tick count from rule Q3 of design/pgfplots-behaviour.md and compares
# with e17-log-ticks-*/ticks.json. Usage: python3 check-log-ticks.py <ticks.json>...
import json, math, sys
D=0.001/math.log(10)
def nice(raw):
    k=math.floor(math.log10(raw)); m=raw/10**k
    return 10**k*(1 if m<1.5 else 2 if m<3.5 else 5 if m<7.5 else 10)
def predict(lo,hi,L,msbt=35,tmt=4,tmtlog=3):
    tol=0.05*(hi-lo)/L
    n=max(math.floor(L/msbt+1e-9), tmt-1, 1)
    nl=max(math.floor(L/msbt+1e-9), tmtlog-1, 1)
    R=hi-lo+D
    lo2=lo*(1+1e-9)
    k=max(1, math.floor(R/nl))
    s=math.floor(lo2)+1
    c=0
    while s+c*k<=hi+D: c+=1
    if c>=(2 if k==1 else 3):
        if k>=2:
            ticks=[]; j=0
            while s+j*k<=hi+tol: ticks.append((s+j*k,j)); j+=1
            return ('int',k,ticks,0)
        step=1; mode='one'
    else:
        mode='frac'
        step=nice(R/max(math.floor(L/msbt+1e-9)-1, 2))
    f=math.floor(lo2/step+1e-9)
    ticks=[]
    j=math.floor((lo-tol)/step)
    while j*step<=hi+tol:
        v=j*step
        if v>=lo-tol: ticks.append((round(v,10) if step<1 else int(round(v)), j-f))
        j+=1
    minor=0
    if mode=='one' and ticks:
        for i in range(math.floor(lo2), math.floor(hi+D+0.5)):
            for m in range(1,10):
                v=i+math.log10(m)
                if lo-tol<=v<=hi+tol: minor+=1
    return (mode,step,ticks,minor)
if __name__=='__main__':
    for f in sys.argv[1:]:
        rows=json.load(open(f)); bad=0
        for r in rows:
            extra=r.get('extra') or ''
            kw={}
            import re
            for key,name in (('max space between ticks','msbt'),('try min ticks log','tmtlog'),('try min ticks','tmt')):
                mm=re.search(re.escape(key)+r'=(\d+)',extra)
                if mm and not (key=='try min ticks' and 'try min ticks log' in extra and mm.start()==extra.find('try min ticks log')): kw[name]=int(mm.group(1))
            reg,st,ticks,minor=predict(r['a'],r['b'],r['L'],**kw)
            pv=[t for t,_ in ticks]; pi=[i for _,i in ticks]
            ok=len(pv)==len(r["ticks"]) and all(abs(a-b)<2e-4+(6e-4*abs(a) if st<1 else 0) for a,b in zip(pv,r["ticks"])) and pi==r['idx'] and minor==r['minor']
            if not ok:
                bad+=1
                if bad<12: print('MISMATCH',r['id'],r['a'],r['b'],r['L'],extra,'pred',reg,st,pv[:6],pi[:4],minor,'act',r['step'],r['ticks'][:6],r['idx'][:4],r['minor'])
        print(f, 'mismatch',bad,'of',len(rows))
