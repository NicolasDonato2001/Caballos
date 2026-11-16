// Pruebas de las skins (aspecto): se compran con Gemas, se ponen y no cambian atributos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/sim/rng.ts";
import { atributos, caballoInicial } from "../src/domain/caballo.ts";
import { agregarCaballo, partidaNueva } from "../src/domain/partida.ts";
import { comprarMontura, equiparMontura } from "../src/domain/economia.ts";
import { COLOR_MONTURA, comprarAspecto, coloresDe, pintarMontura, vestirCaballo } from "../src/domain/aspecto.ts";

const T0 = 1_800_000_000_000;

test("Aspecto: se compra una vez con Gemas, se pone, se saca y no cambia atributos", () => {
  const rng = new Rng(3), p = partidaNueva(T0), c = caballoInicial(rng, "Pampero", "macho");
  agregarCaballo(p, c);
  const antes = atributos(c);
  assert.equal(vestirCaballo(p, c.id, "manta", "mantaAzul").ok, false);   // no comprada
  assert.equal(comprarAspecto(p, "mantaAzul", T0).ok, false);             // sin Gemas
  p.gemas = 100;
  assert.ok(comprarAspecto(p, "mantaAzul", T0).ok);
  assert.equal(p.gemas, 75);
  assert.equal(comprarAspecto(p, "mantaAzul", T0).ok, false);             // ya la tiene
  assert.ok(vestirCaballo(p, c.id, "manta", "mantaAzul").ok);
  assert.equal(vestirCaballo(p, c.id, "crin", "mantaAzul").ok, false);    // no va en la crin
  assert.deepEqual(atributos(c), antes);
  assert.equal(coloresDe(c, p).manta, "#1f3f75");
  assert.ok(vestirCaballo(p, c.id, "manta", null).ok);
  assert.equal(coloresDe(c, p).manta, undefined);
});

test("Montura: se ve con su cuero; el color va con la montura al cambiarla de caballo", () => {
  const rng = new Rng(4), p = partidaNueva(T0), a = caballoInicial(rng, "A", "macho"), b = caballoInicial(rng, "B", "hembra");
  agregarCaballo(p, a); agregarCaballo(p, b);
  p.oro = 3000; p.gemas = 50;
  assert.ok(comprarMontura(p, "sprint", "oro", T0).ok);
  const m = p.monturas![0];
  assert.equal(coloresDe(a, p).montura, undefined);
  assert.ok(equiparMontura(p, a.id, m.id).ok);
  assert.equal(coloresDe(a, p).montura, COLOR_MONTURA);
  assert.ok(comprarAspecto(p, "monturaRoja", T0).ok);
  assert.ok(pintarMontura(p, m.id, "monturaRoja").ok);
  assert.equal(coloresDe(a, p).montura, "#8e2420");
  assert.ok(equiparMontura(p, b.id, m.id).ok);
  assert.equal(coloresDe(b, p).montura, "#8e2420");
  assert.equal(coloresDe(a, p).montura, undefined);
});
