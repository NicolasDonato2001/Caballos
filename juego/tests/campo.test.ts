// Pruebas de Campo 2.0: mover y girar piezas sin pisarse, dentro del alambrado y sin tapar la entrada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partidaNueva } from "../src/domain/partida.ts";
import { ponerObjeto } from "../src/domain/decoracion.ts";
import { ANCHO, DISPOSICION_INICIAL, disposicionDe, girar, moverPieza, PIEZAS, puedeUbicar, rectDe } from "../src/domain/campo.ts";

const T0 = 1_800_000_000_000;

test("La disposición inicial es válida y nada se pisa", () => {
  for (const pz of PIEZAS) assert.ok(puedeUbicar(DISPOSICION_INICIAL, pz, DISPOSICION_INICIAL[pz]).ok, pz);
});

test("Girar: un cuarto de vuelta cambia ancho por alto y gira el centro", () => {
  assert.deepEqual(girar(1, 0, 1), [0, -1]);
  const a = rectDe("establo", { x: 0, z: 0, rot: 0 }), b = rectDe("establo", { x: 0, z: 0, rot: 1 });
  assert.equal(a.w, b.h); assert.equal(a.h, b.w);
});

test("Mover: dentro del alambrado, sin pisar otra pieza, el patio ni la entrada", () => {
  const p = partidaNueva(T0);
  assert.equal(moverPieza(p, "establo", { x: ANCHO / 2, z: 0, rot: 0 }).ok, false);          // afuera
  const otro = DISPOSICION_INICIAL.entrenamiento;
  assert.equal(moverPieza(p, "establo", { x: otro.x, z: otro.z, rot: 0 }).ok, false);         // encima del picadero
  assert.equal(moverPieza(p, "establo", { x: 0, z: -2, rot: 0 }).ok, false);                  // patio
  assert.equal(moverPieza(p, "molino", { x: 0, z: -26, rot: 0 }).ok, false);                  // camino de entrada
  const r = moverPieza(p, "molino", { x: 38, z: -6, rot: 1 });
  assert.ok(r.ok);
  assert.deepEqual(disposicionDe(p).molino, { x: 38, z: -6, rot: 1 });
  assert.deepEqual(disposicionDe(p).establo, DISPOSICION_INICIAL.establo);
});

test("Los adornos que quedan debajo de una pieza movida van al depósito", () => {
  const p = partidaNueva(T0);
  p.oro = 10000;
  assert.ok(ponerObjeto(p, "banco", 0, 0, 0, new Map(), T0).ok);    // lejos
  assert.ok(ponerObjeto(p, "banco", 6, 12, 0, new Map(), T0).ok);   // x 12..14, z 24..26: queda debajo del molino
  const r = moverPieza(p, "molino", { x: 12, z: 26, rot: 0 });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.guardados, 1);
  assert.equal(p.decoracion!.deposito.banco, 1);
  assert.equal(p.decoracion!.puestos.length, 1);
});

test("Nombre del campo: el primer cambio es gratis y los siguientes cuestan Gemas", async () => {
  const { renombrarCampo, nombreCampo, costoNombre, NOMBRE_CAMPO } = await import("../src/domain/campo.ts");
  const p = partidaNueva(T0);
  p.gemas = NOMBRE_CAMPO.gemasCambio;
  assert.equal(nombreCampo(p), "El campo");
  assert.equal(costoNombre(p), 0);
  assert.equal(renombrarCampo(p, " x ", T0).ok, false);
  assert.ok(renombrarCampo(p, "La  Querencia", T0).ok);
  assert.equal(nombreCampo(p), "La Querencia");
  assert.equal(p.gemas, NOMBRE_CAMPO.gemasCambio);
  assert.equal(costoNombre(p), NOMBRE_CAMPO.gemasCambio);
  assert.ok(renombrarCampo(p, "Don Segundo", T0).ok);
  assert.equal(p.gemas, 0);
  assert.equal(renombrarCampo(p, "Otra", T0).ok, false);
  assert.equal(p.ledger?.[0].motivo, "nombre");
});
