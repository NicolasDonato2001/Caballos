import itertools, numpy as np, json, sys
from multiprocessing import Pool
import sim_v02
from bench_final import strategies_by_archetype
d=int(sys.argv[1])
def ev(args):
    a,c=args
    sim_v02.P[f'agr_add{d}']=a; sim_v02.P[f'con_sub{d}']=c
    r=strategies_by_archetype(d,N=500,seed=13)
    vals=np.array([list(v.values()) for v in r.values()])
    return a,c,float(((vals-0.125)**2).sum()),r
grid=list(itertools.product([0.0,0.08,0.15,0.25],[0.0,0.15,0.3,0.5]))
with Pool(2) as pl:
    res=sorted(pl.map(ev,grid),key=lambda x:x[2])
for a,c,sc,r in res[:3]: print(d,'agr',a,'con',c,'score',round(sc,4),json.dumps(r,ensure_ascii=False))
