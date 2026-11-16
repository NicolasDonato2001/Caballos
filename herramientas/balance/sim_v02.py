"""
Simulador de carreras v0.2 — prototipo de balance (Python/numpy, vectorizado por carreras).
Es la referencia de diseño para el simulador TypeScript de la Fase 1.
Todos los coeficientes viven en P (parámetros configurables).
Atributos: [Vel, Res, Pot, Tem, Int] en escala 0-100.
Estrategias: 0=Agresiva, 1=Equilibrada, 2=Conservadora.
"""
import numpy as np

P = dict(
    dt=0.05,
    lane_w=1.2,
    # Velocidad máxima y sostenible
    vmax_base=15.5, vmax_k=0.02281,
    vs_base=13.0, vs_res=0.01265, vs_vel=0.008439,
    # Aceleración / desaceleración (Potencia)
    amax_base=0.5, amax_k=0.1042,
    dec_base=1.8, dec_k=0.025,
    # Remate final (Potencia): permite superar Vmax en el tramo final
    kick_k=0.1917,              # Potencia: el remate permite superar Vmax en kick_k*Pot/100
    kick_min_f500=0.55, kick_min_f1500=0.60, kick_force_f=0.97,
    kick_margin=4.0,           # reserva que intenta conservar al llegar
    judge_bias=0.5307, judge_sd=0.5,  # error de cálculo del remate (Inteligencia lo reduce)
    # Ritmo objetivo
    pace500=[(0.10, 0.90), (0.70, 0.850), (0.88, 0.870), (1.01, 1.0)],
    pace1500=[(0.08, 0.10), (0.70, 0.18), (0.88, 0.35), (1.01, 0.90)],  # fracción entre Vs y Vmax
    # Estrategias
    agr_add=0.35, agr_until=0.55,
    agr_add500=0.0, con_sub500=0.15, agr_add1500=0.0, con_sub1500=0.15,  # calibrado v0.2 (Agresiva = prioridad de posición)
    agr_rail=1.5,              # Agresiva busca la cuerda/frente con más decisión
    con_sub=0.30, con_until=0.70, con_late_add=0.40, con_min_res=25.0,
    # Consumo de reserva
    acc_k=0.3137,                 # coste de reserva por acelerar (Potencia lo reduce)
    d0=0.4357, d1=5.399, d_exp=1.7,
    res_coef_a=1.30, res_coef_b=0.00659,
    # Penalización por reserva baja (Temple)
    pen_start=50.0, pen_max=0.5273, tem_k=0.8235,
    # Ruido de ritmo (Temple reduce irregularidad)
    noise_sd=0.010, noise_tem=0.6, noise_tau=1.5,
    # Rebufo (Inteligencia mejora el aprovechamiento)
    draft_min=0.8, draft_max=4.0, draft_k=0.6739, draft_int_base=0.20,
    seek_p=1.0,                # búsqueda activa de rebufo (escala con Int)
    antic_base=1.0, antic_int=5.0,  # metros de anticipación ante un rival lento
    # Bloqueo y tráfico
    check_k=0.09689, check_tem=0.9,  # pérdida de ritmo al quedar encerrado (Temple la reduce)
    block_gap=1.6, look_ahead=2.5, look_behind=2.0,
    decide_every=0.5,
    gap_p_base=0.20, gap_p_int=0.70,
    rail_p_base=0.10, rail_p_int=0.55,
    drift_p=0.50,              # deriva hacia afuera en curva (se reduce con Int)
    lat_speed=1.0,             # carriles por segundo
    curve_k=0.020,             # recorrido extra por carril en curva
    waste_k=0.04553,             # recorrido desperdiciado por malas líneas = waste_k*(1-Int/100)
    curves500=[(0.40, 0.72)],
    curves1500=[(0.12, 0.36), (0.62, 0.86)],
)

def _pace(table, f):
    out = np.zeros_like(f)
    done = np.zeros_like(f, dtype=bool)
    for lim, val in table:
        m = (~done) & (f < lim)
        out[m] = val
        done |= m
    out[~done] = table[-1][1]
    return out

def simulate(attrs, strat, dist, seed=0, p=P, return_detail=False):
    """attrs: (N,H,5); strat: (N,H) int. Devuelve tiempos (N,H)."""
    rng = np.random.default_rng(seed)
    attrs = np.asarray(attrs, float)
    N, H, _ = attrs.shape
    V, R, Po, T, I = [attrs[..., k] for k in range(5)]
    vmax = p['vmax_base'] + p['vmax_k'] * V
    vs = np.minimum(vmax - 0.5, p['vs_base'] + p['vs_res'] * R + p['vs_vel'] * (V - 50))
    amax = p['amax_base'] + p['amax_k'] * Po
    dec = p['dec_base'] + p['dec_k'] * Po
    rescoef = p['res_coef_a'] - p['res_coef_b'] * R
    vtop_kick = vmax * (1 + p['kick_k'] * Po / 100)
    noise_amp = p['noise_sd'] * (1 - p['noise_tem'] * T / 100)
    draft_eff = p['draft_k'] * (p['draft_int_base'] + (1 - p['draft_int_base']) * I / 100)
    gap_p = p['gap_p_base'] + p['gap_p_int'] * I / 100
    rail_p = p['rail_p_base'] + p['rail_p_int'] * I / 100
    drift_p = p['drift_p'] * (1 - I / 100)

    q = 1 - I / 100
    judge_err = -p['judge_bias'] * q + p['judge_sd'] * q * rng.standard_normal((N, H))
    kicking = np.zeros((N, H), bool)
    kick_min_f = p['kick_min_f500'] if dist <= 600 else p['kick_min_f1500']
    dk = '500' if dist <= 600 else '1500'
    agr_add = p.get('agr_add' + dk, p['agr_add']); con_sub = p.get('con_sub' + dk, p['con_sub'])
    # Sorteo de partidores
    lat = np.argsort(rng.random((N, H)), axis=1).astype(float)
    tgt_lane = lat.copy()
    s = np.zeros((N, H)); v = np.zeros((N, H)); res = np.full((N, H), 100.0)
    noise = np.zeros((N, H))
    t_fin = np.full((N, H), np.nan)
    finished = np.zeros((N, H), bool)
    dt = p['dt']
    curves = p['curves500'] if dist <= 600 else p['curves1500']
    pace_tab = p['pace500'] if dist <= 600 else p['pace1500']
    blocked_time = np.zeros((N, H)); draft_time = np.zeros((N, H)); extra_dist = np.zeros((N, H))
    step = 0
    max_steps = int((dist / 8.0) / dt)
    a_decide = dt / p['decide_every']
    while step < max_steps and not finished.all():
        step += 1
        t = step * dt
        f = np.clip(s / dist, 0, 1)
        # ---- velocidad objetivo
        if dist <= 600:
            tgt = vmax * _pace(pace_tab, f)
        else:
            tgt = vs + _pace(pace_tab, f) * (vmax - vs)
        agr = strat == 0; con = strat == 2
        tgt = tgt + np.where(agr & (f < p['agr_until']), agr_add, 0)
        tgt = tgt - np.where(con & (f < p['con_until']), con_sub, 0)
        tgt = tgt + np.where(con & (f >= p['con_until']) & (res > p['con_min_res']), p['con_late_add'], 0)
        # Remate: el caballo estima cuánto puede sostener el sprint con su reserva
        Ek = 1.0
        Dk = (p['d0'] + p['d1'] * Ek ** p['d_exp']) * rescoef
        est_range = np.maximum(res - p['kick_margin'], 0) / Dk * vtop_kick
        start_kick = (f >= kick_min_f) & ((dist - s) <= est_range * (1 + judge_err))
        kicking |= start_kick | (f >= p['kick_force_f'])
        kick = kicking
        cap = np.where(kick, vtop_kick, vmax)
        tgt = np.where(kick, cap, tgt)
        tgt = np.minimum(tgt, cap)
        # ruido de ritmo (AR1)
        alpha = dt / p['noise_tau']
        noise = (1 - alpha) * noise + np.sqrt(2 * alpha) * rng.standard_normal((N, H))
        tgt = tgt * (1 + noise_amp * noise)
        # penalización por reserva
        pen = np.maximum(0, p['pen_start'] - res) / p['pen_start'] * p['pen_max'] * (1 - p['tem_k'] * T / 100)
        tgt = tgt * (1 - pen)
        # ---- tráfico: horse ahead in same lane
        ds = s[:, None, :] - s[:, :, None]          # [n,i,j] = s_j - s_i
        dl = np.abs(lat[:, None, :] - lat[:, :, None])
        same = (dl < 0.6) & (ds > 0) & ~finished[:, None, :]
        gap = np.where(same, ds, np.inf).min(axis=2)
        idx_ahead = np.where(same, ds, np.inf).argmin(axis=2)
        v_ahead = np.take_along_axis(v, idx_ahead, axis=1)
        blocked = (gap < p['block_gap']) & (tgt > v_ahead)
        tgt = np.where(blocked, np.minimum(tgt, v_ahead * (1 - p['check_k'] * (1 - p['check_tem'] * T / 100))), tgt)
        drafting = (gap >= p['draft_min']) & (gap <= p['draft_max'])
        # ---- decisiones laterales
        decide = rng.random((N, H)) < a_decide
        def lane_free(cand):
            c = cand[:, :, None]
            occ = (np.abs(lat[:, None, :] - c) < 0.9) & (ds > -p['look_behind']) & (ds < p['look_ahead'])
            # excluirse a sí mismo
            eye = np.eye(H, dtype=bool)[None]
            occ = occ & ~eye
            return ~occ.any(axis=2)
        inner = np.maximum(tgt_lane - 1, 0); outer = np.minimum(tgt_lane + 1, H + 1)
        inner_free = lane_free(inner) & (tgt_lane > 0)
        outer_free = lane_free(outer)
        antic = p['antic_base'] + p['antic_int'] * I / 100
        want_pass = blocked | ((gap < antic) & (v_ahead < tgt - 0.1)) | ((f > 0.85) & (gap < 6) & (v_ahead < tgt))
        # rival en carril adyacente 1.5-5 m adelante (para buscar rebufo)
        def ahead_in(cand):
            c = cand[:, :, None]
            m = (np.abs(lat[:, None, :] - c) < 0.6) & (ds > 1.5) & (ds < 5.0) & ~finished[:, None, :]
            return m.any(axis=2)
        r = rng.random((N, H))
        go_in_pass = decide & want_pass & inner_free & (r < gap_p)
        go_out_pass = decide & want_pass & ~go_in_pass & outer_free & (r < gap_p)
        rail = decide & ~want_pass & inner_free & (r < rail_p * np.where(agr, p['agr_rail'], 1.0))
        r2 = rng.random((N, H))
        seek_ok = decide & ~want_pass & ~drafting & (f < 0.85) & (r2 < p['seek_p'] * I / 100)
        seek_in = seek_ok & ~rail & inner_free & ahead_in(inner)
        seek_out = seek_ok & ~rail & ~seek_in & outer_free & ahead_in(outer)
        in_curve = np.zeros_like(f, bool)
        for a, b in curves:
            in_curve |= (f >= a) & (f < b)
        drift = decide & ~want_pass & ~rail & ~seek_in & ~seek_out & in_curve & outer_free & (r < drift_p)
        tgt_lane = np.where(go_in_pass | rail | seek_in, inner, tgt_lane)
        tgt_lane = np.where(go_out_pass | drift | seek_out, outer, tgt_lane)
        lat = lat + np.clip(tgt_lane - lat, -p['lat_speed'] * dt, p['lat_speed'] * dt)
        # ---- dinámica longitudinal
        v_new = np.where(v < tgt, np.minimum(tgt, v + amax * dt), np.maximum(tgt, v - dec * dt))
        vbar = 0.5 * (v + v_new)
        v = v_new
        # el esfuerzo se mide sobre la velocidad que intenta sostener (la fatiga no ahorra reserva)
        E = np.clip((vbar / (1 - pen) - vs) / (vmax - vs), 0, 1.0)  # el plus de remate de Potencia no consume extra
        D = (p['d0'] + p['d1'] * E ** p['d_exp']) * rescoef
        D = D * np.where(drafting, 1 - draft_eff, 1.0)
        acc = np.maximum(2 * (v_new - vbar), 0) / dt  # aceleración del tick (v_new - v_anterior)
        D = D + p['acc_k'] * acc * (1.2 - Po / 100)
        res = np.where(finished, res, np.maximum(0, res - D * dt))
        path_mult = np.where(in_curve, 1 + p['curve_k'] * lat, 1.0) * (1 + p['waste_k'] * (1 - I / 100))
        adv = vbar * dt / path_mult
        extra_dist += np.where(finished, 0, vbar * dt - adv)
        blocked_time += np.where(finished, 0, blocked * dt)
        draft_time += np.where(finished, 0, drafting * dt)
        new_s = s + np.where(finished, 0, adv)
        cross = (~finished) & (new_s >= dist)
        frac = np.where(cross, (dist - s) / np.maximum(new_s - s, 1e-9), 0)
        t_fin = np.where(cross, (step - 1 + frac) * dt, t_fin)
        finished |= cross
        s = new_s
    if return_detail:
        return t_fin, dict(blocked=blocked_time, draft=draft_time, extra=extra_dist, res=res)
    return t_fin
