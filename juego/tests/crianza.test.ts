// Pruebas de la Fase 5: Mercado del juego (§12) y crianza (§10).
import { test } from "node:test";
import assert from "node:assert/strict";
import razas from "../config/balance/razas.json" with { type: "json" };
import { Rng } from "../src/sim/rng.ts";
import { caballoDeRaza, caballoInicial, techoDe, type Caballo } from "../src/domain/caballo.ts";
import { agregarCaballo, capacidad, hayLugar, partidaNueva } from "../src/domain/partida.ts";
import { actualizar, liberarCaballo, puedeCorrer, puedeEntrenar } from "../src/domain/edificios.ts";
import { comprarOferta, diaDe, generarOfertas, mercadoDelDia, naturalesConSuma, precioSugerido } from "../src/domain/mercado.ts";
import { composicionHija, iniciarCruza, naturalesHijo, potrillo, puedeCruzar } from "../src/domain/crianza.ts";

const T0 = 1_800_000_000_000;
const HORA = 3_600_000;
const suma = (v: number[]) => v.reduce((s, x) => s + x, 0);
const conNat = (rng: Rng, raza: string, natural: number[], sexo: "macho" | "hembra"): Caballo => caballoDeRaza(rng, { raza, natural, sexo });

test("Precio sugerido §12.2: ejemplos del GDD", () => {
  const rng = new Rng(1);
  const c = caballoDeRaza(rng, { raza: "Criollo", natural: [60, 60, 60, 60, 60] });
  assert.equal(precioSugerido(c), 2500);
  c.natural = [65, 65, 65, 65, 65]; assert.ok(Math.abs(precioSugerido(c) - 5900) <= 100);
  c.natural = [69, 69, 69, 69, 69]; assert.ok(Math.abs(precioSugerido(c) - 11700) <= 300);
  c.natural = [60, 60, 60, 60, 60]; c.entreno = [2, 2, 2, 2, 2]; c.victorias = 40;
  assert.equal(precioSugerido(c), 2500 + 600 + 4500);
});

test("Mercado: 4 ofertas fijas por día, macho y hembra, precios cerca de §11.5", () => {
  const a = generarOfertas(123, 20000), b = generarOfertas(123, 20000), c = generarOfertas(123, 20001);
  assert.deepEqual(a.map((o) => o.caballo.natural), b.map((o) => o.caballo.natural));
  assert.notDeepEqual(a.map((o) => o.caballo.natural), c.map((o) => o.caballo.natural));
  const precios: Record<string, number[]> = { basica: [], especializada: [], destacada: [] };
  for (let d = 0; d < 300; d++) {
    const of = generarOfertas(7, d);
    assert.equal(of.length, 4);
    assert.ok(of.some((o) => o.caballo.sexo === "macho") && of.some((o) => o.caballo.sexo === "hembra"));
    for (const o of of) {
      precios[o.tipo].push(o.precio);
      const t = o.caballo.techo;
      o.caballo.natural.forEach((v, i) => assert.ok(v >= razas.minimoNatural && v <= t[i], `natural ${v} fuera de [30, ${t[i]}]`));
      assert.ok(suma(o.caballo.natural) <= razas.presupuestoNatural);
    }
  }
  const media = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  // §11.5: básico unos 2.500, especializado unos 6.000, genética destacada unos 12.000.
  assert.ok(Math.abs(media(precios.basica) - 2500) < 500, `básico ${media(precios.basica)}`);
  assert.ok(Math.abs(media(precios.especializada) - 6000) < 1200, `especializado ${media(precios.especializada)}`);
  assert.ok(Math.abs(media(precios.destacada) - 12000) < 2500, `destacada ${media(precios.destacada)}`);
});

test("Especializada: concentra en los atributos fuertes de la raza", () => {
  const rng = new Rng(5);
  const perfil = (razas.razas as Record<string, { perfil: number[] }>)["Pura Sangre Inglés"].perfil;
  const fuertes = perfil.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 2).map(([, i]) => i);
  let difF = 0, difD = 0;
  for (let k = 0; k < 200; k++) {
    const v = naturalesConSuma(rng, "Pura Sangre Inglés", 325, "especializada");
    v.forEach((x, i) => { if (fuertes.includes(i)) difF += x - perfil[i]; else difD += x - perfil[i]; });
  }
  assert.ok(difF / 400 > 3 && difD / 600 < 0, `fuertes ${difF / 400}, resto ${difD / 600}`);
});

test("Comprar: cobra, agrega el caballo, no se vende dos veces y respeta oro y espacio", () => {
  const rng = new Rng(9);
  const p = partidaNueva(T0);
  agregarCaballo(p, caballoInicial(rng, "Pampero", "macho"));
  p.oro = 100_000;
  const m = mercadoDelDia(p, T0);
  assert.equal(m.dia, diaDe(T0));
  const precio = m.ofertas[0].precio;
  assert.ok(comprarOferta(p, 0, T0).ok);
  assert.equal(p.oro, 100_000 - precio);
  assert.equal(p.caballos.length, 2);
  assert.equal(comprarOferta(p, 0, T0).ok, false);
  p.oro = 0;
  assert.equal(comprarOferta(p, 1, T0).ok, false);
  p.oro = 100_000;
  while (hayLugar(p)) p.caballos.push(caballoInicial(rng, "Relleno", "hembra"));
  assert.equal(comprarOferta(p, 2, T0).ok, false);
  // Al día siguiente hay ofertas nuevas.
  assert.equal(mercadoDelDia(p, T0 + 24 * HORA).ofertas.every((o) => !o.vendida), true);
});

test("Composición, techo y herencia §10.2", () => {
  assert.deepEqual(composicionHija({ Criollo: 1 }, { "Árabe": 1 }), { Criollo: 0.5, "Árabe": 0.5 });
  const comp = composicionHija({ Criollo: 0.5, "Árabe": 0.5 }, { Frisón: 1 });
  assert.deepEqual(comp, { Criollo: 0.25, "Árabe": 0.25, Frisón: 0.5 });
  const rng = new Rng(3);
  const techo = techoDe(comp);
  let mayor = 0, n = 0;
  for (let k = 0; k < 4000; k++) {
    const p = [50, 70, 40, 80, 60], m = [60, 60, 60, 60, 60];
    const h = naturalesHijo(rng, p, m, techo);
    h.forEach((v, i) => {
      const lo = Math.min(p[i], m[i]), hi = Math.max(p[i], m[i]);
      assert.ok(v >= Math.max(30, lo - 2) && v <= Math.min(techo[i], hi + 2));
      if (p[i] !== m[i]) { n++; if (Math.abs(v - hi) <= 2) mayor++; }
    });
  }
  assert.ok(Math.abs(mayor / n - 0.55) < 0.03, `heredó el mayor ${mayor / n}`);
  // Suma máxima 360 aunque los padres sean muy buenos.
  for (let k = 0; k < 200; k++) assert.ok(suma(naturalesHijo(rng, [80, 80, 80, 80, 80], [80, 80, 80, 80, 80], [90, 90, 90, 90, 90])) <= 360);
});

test("Sin escalada: cría selectiva de 30 generaciones no supera techo ni presupuesto", () => {
  const rng = new Rng(11);
  let a = conNat(rng, "Pura Sangre Inglés", [80, 70, 75, 65, 70], "macho"), b = conNat(rng, "Árabe", [70, 80, 65, 75, 72], "hembra");
  for (let g = 0; g < 30; g++) {
    const hijos = Array.from({ length: 6 }, () => potrillo(rng, a, b, "x", T0));
    for (const h of hijos) {
      assert.ok(suma(h.natural) <= 360);
      h.natural.forEach((v, i) => assert.ok(v <= h.techo[i] && v >= 30));
      assert.ok(Math.abs(suma(h.predisposicion) - 1) < 1e-9);
      assert.ok(Math.abs(Object.values(h.composicion).reduce((s, x) => s + x, 0) - 1) < 1e-9);
    }
    hijos.sort((x, y) => suma(y.natural) - suma(x.natural));
    const m = hijos.find((h) => h.sexo === "macho") ?? hijos[0], f = hijos.find((h) => h.sexo === "hembra") ?? hijos[1];
    m.sexo = "macho"; f.sexo = "hembra"; a = m; b = f;
  }
});

test("Pelaje: el potrillo recibe un alelo de cada padre", () => {
  const rng = new Rng(21);
  const padre = caballoDeRaza(rng, { raza: "Frisón", sexo: "macho" });   // EE aa: negro puro
  const madre = caballoDeRaza(rng, { raza: "Frisón", sexo: "hembra" });
  for (let k = 0; k < 50; k++) {
    const h = potrillo(rng, padre, madre, "x", T0);
    assert.deepEqual(h.pelaje.genotipo.E, [true, true]);
    assert.deepEqual(h.pelaje.genotipo.A, [false, false]);
    assert.equal(h.padreId, padre.id); assert.equal(h.madreId, madre.id);
  }
});

test("Cruza: requisitos, 500 Oro, espacio reservado, 8 h de cruza y 24 h de crecimiento", () => {
  const rng = new Rng(31);
  const p = partidaNueva(T0);
  const m = caballoInicial(rng, "Pampero", "macho"), h = caballoDeRaza(rng, { raza: "Árabe", sexo: "hembra" });
  agregarCaballo(p, m); agregarCaballo(p, h);
  assert.equal(puedeCruzar(p, m.id, m.id).ok, false);
  p.oro = 400;
  assert.equal(puedeCruzar(p, m.id, h.id).ok, false);
  p.oro = 1000;
  // Sin espacio no se puede.
  const relleno = Array.from({ length: capacidad(p) - 2 }, () => caballoInicial(rng, "R", "macho"));
  p.caballos.push(...relleno);
  assert.equal(puedeCruzar(p, m.id, h.id).ok, false);
  p.caballos = p.caballos.filter((c) => !relleno.includes(c));
  assert.ok(iniciarCruza(p, m.id, h.id, "Lucerito", T0, rng).ok);
  assert.equal(p.oro, 500);
  assert.equal(m.estado, "cruza");
  assert.equal(puedeEntrenar(p, m).ok, false);
  assert.equal(puedeCorrer(h, T0).ok, false);
  assert.equal(liberarCaballo(p, m.id).ok, false);
  assert.equal(p.caballos.length, 2);
  // El lugar del potrillo queda reservado y no se permite otra cruza.
  p.caballos.push(...Array.from({ length: capacidad(p) - 3 }, () => caballoInicial(rng, "R", "macho")));
  assert.equal(hayLugar(p), false);
  // A las 8 h nace y crece; a las 24 h más queda disponible. Se resuelve aunque el juego estuviera cerrado.
  const s = actualizar(p, T0 + 40 * HORA);
  assert.deepEqual(s.map((x) => x.tipo), ["nacimiento", "crecido"]);
  const hijo = p.caballos.find((c) => c.nombre === "Lucerito")!;
  assert.equal(hijo.estado, "disponible");
  assert.equal(m.estado, "disponible");
  assert.equal(p.cruza, undefined);
  // Mientras crece no entrena ni corre.
  const p2 = partidaNueva(T0); const m2 = caballoInicial(rng, "A", "macho"), h2 = caballoInicial(rng, "B", "hembra");
  agregarCaballo(p2, m2); agregarCaballo(p2, h2);
  iniciarCruza(p2, m2.id, h2.id, "C", T0, rng);
  actualizar(p2, T0 + 9 * HORA);
  const c2 = p2.caballos.find((c) => c.nombre === "C")!;
  assert.equal(c2.estado, "creciendo");
  assert.equal(c2.finEstado, T0 + 32 * HORA);
  assert.equal(puedeEntrenar(p2, c2).ok, false);
  assert.equal(puedeCorrer(c2, T0 + 9 * HORA).ok, false);
});


// ---- Fase 5.5: rasgos y linajes
import { formaVisible, LINAJES, rasgoDePar, rasgosVisibles } from "../src/domain/rasgos.ts";
import rasgosCfg from "../config/balance/rasgos.json" with { type: "json" };

test("Fase 5.5: cada cruza de dos razas tiene su rasgo, y los potrillos mestizos lo muestran seguido", async () => {
  const { caballoDeRaza } = await import("../src/domain/caballo.ts");
  const { potrillo } = await import("../src/domain/crianza.ts");
  const razas = ["Pura Sangre Inglés", "Árabe", "Cuarto de Milla", "Akhal-Teke", "Appaloosa", "Criollo", "Andaluz", "Frisón"];
  for (const a of razas) for (const b of razas) if (a !== b) assert.ok(rasgoDePar(a, b), `${a} × ${b}`);
  const rng = new Rng(77);
  let conRasgo = 0;
  const N = 300;
  for (let k = 0; k < N; k++) {
    const p = caballoDeRaza(rng, { raza: "Árabe", sexo: "macho" }), m = caballoDeRaza(rng, { raza: "Pura Sangre Inglés", sexo: "hembra" });
    const h = potrillo(rng, p, m, "x", 0);
    if (h.rasgos?.includes("cuelloCisne")) conRasgo++;
    assert.ok((h.rasgos ?? []).length <= rasgosCfg.maximoRasgos);
    assert.ok(formaVisible(h).cuello > 1 || !h.rasgos?.includes("cuelloCisne"));
  }
  const f = conRasgo / N;
  assert.ok(f > 0.6 && f < 0.8, `frecuencia ${f}`);
  // Un puro no muestra rasgos de cruza
  const p = caballoDeRaza(rng, { raza: "Criollo", sexo: "macho" }), m = caballoDeRaza(rng, { raza: "Criollo", sexo: "hembra" });
  assert.equal(potrillo(rng, p, m, "x", 0).rasgos, undefined);
});

test("Fase 5.5: los linajes raros salen cerca del 1 %, suben el techo y la suma natural sigue ≤ 360", async () => {
  const { caballoDeRaza } = await import("../src/domain/caballo.ts");
  const { potrillo } = await import("../src/domain/crianza.ts");
  const rng = new Rng(2024);
  let raros = 0;
  const N = 6000;
  for (let k = 0; k < N; k++) {
    const p = caballoDeRaza(rng, { raza: "Andaluz", sexo: "macho" }), m = caballoDeRaza(rng, { raza: "Frisón", sexo: "hembra" });
    const h = potrillo(rng, p, m, "x", 0);
    if (h.linaje) {
      raros++;
      assert.equal(h.linaje, "barroco");
      assert.ok(h.techo[2] > 88 && h.techo[3] > 83, `techo ${h.techo}`);
      assert.ok(h.natural.reduce((a, b) => a + b, 0) <= 360);
      assert.ok(rasgosVisibles(h).includes("cabezaAcarnerada"));
    }
  }
  const f = raros / N;
  assert.ok(f > 0.006 && f < 0.015, `frecuencia ${f}`);
  // Hijo de un padre de linaje: mucho más probable
  let hered = 0;
  for (let k = 0; k < 400; k++) {
    const p = caballoDeRaza(rng, { raza: "Andaluz", sexo: "macho" }), m = caballoDeRaza(rng, { raza: "Frisón", sexo: "hembra" });
    p.linaje = "barroco";
    if (potrillo(rng, p, m, "x", 0).linaje === "barroco") hered++;
  }
  assert.ok(hered / 400 > 0.18 && hered / 400 < 0.32, `heredado ${hered / 400}`);
  assert.equal(Object.keys(LINAJES).length, 4);
});
