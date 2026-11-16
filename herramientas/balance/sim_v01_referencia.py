breeds={"PSI":(75,58,68,58,61),"Arabe":(62,78,55,72,65),"CuartoMilla":(67,48,85,55,55),"AkhalTeke":(67,76,62,62,61),"Appaloosa":(57,66,63,66,66),"Criollo":(56,77,57,76,63),"Andaluz":(58,62,75,67,67),"Frison":(50,58,76,68,61)}
def run(st,dist,strat="eq"):
    V,R,P,T,I=st
    vmax=15.5+.035*V; amax=1.6+.035*P; dec=1.8+.025*P
    vs=min(vmax-.5,13+.035*R+.015*(V-50))
    x=0;v=0;res=100;t=0;dt=.05;minres=100
    while x<dist:
        f=x/dist
        if dist==500:
            tg=vmax*(.9 if f<.1 else .96 if f<.7 else .985 if f<.88 else 1)
        else:
            tg=vs+(.3 if f<.08 else .6 if f<.7 else 1.2 if f<.88 else 2.0)
        if strat=="ag" and f<.6: tg+=.35
        if strat=="co":
            if f<.7: tg-=.25
            elif res>30: tg+=.35
        tg=min(tg,vmax)
        E=max(0,min(1,(tg-vs)/(vmax-vs)))
        D=(.85+.85*E**1.7)*(1.15-.003*R)
        res=max(0,res-D*dt); minres=min(minres,res)
        pen=max(0,80-res)/80*.32*(1-.55*T/100)
        tg*=(1-pen)
        if v<tg: v=min(tg,v+amax*dt)
        else: v=max(tg,v-dec*dt)
        x+=v*dt;t+=dt
    return t,minres
for d in (500,1500):
    print(f"--- {d} m (equilibrada) ---")
    for k,s in sorted(breeds.items(),key=lambda kv:run(kv[1],d)[0]):
        t,m=run(s,d); print(f"{k:12s} {t:7.2f}s reserva_min={m:5.1f}")
print("--- 1500 estrategias PSI / Criollo ---")
for b in ("PSI","Criollo","CuartoMilla"):
    print(b,[ (s,round(run(breeds[b],1500,s)[0],2)) for s in ("ag","eq","co")])
print("--- 500 estrategias ---")
for b in ("PSI","Criollo","CuartoMilla"):
    print(b,[ (s,round(run(breeds[b],500,s)[0],2)) for s in ("ag","eq","co")])
