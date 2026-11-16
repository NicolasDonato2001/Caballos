// Pruebas de la decoración (Fase 6): comprar, ubicar sin superponer, rotar, mover y guardar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partidaNueva } from "../src/domain/partida.ts";
import { CATALOGO, celdasDe, guardarObjeto, moverObjeto, ponerObjeto, puedePoner } from "../src/domain/decoracion.ts";

const T0 = 1_800_000_000_000;
const vacio = new Map<string, "camino" | "fijo">();

test("Catálogo §11.5: de 200 a 20.000 Oro y algunos de Gemas", () => {
  // los tramos de camino se venden de a uno (100 Oro cada uno); el resto va de 200 a 20.000
  const oro = CATALOGO.filter((o) => o.oro !== undefined && o.id !== "camino").map((o) => o.oro!);
  assert.equal(Math.min(...oro), 200);
  assert.equal(Math.max(...oro), 20000);
  assert.ok(CATALOGO.some((o) => o.gemas !== undefined));
  assert.equal(new Set(CATALOGO.map((o) => o.id)).size, CATALOGO.length);
});

test("Celdas: el tamaño se gira con la rotación", () => {
  assert.equal(celdasDe("tranquera", 0, 0, 0).length, 3);
  assert.deepEqual(celdasDe("tranquera", 0, 0, 0), [[0, 0], [1, 0], [2, 0]]);
  assert.deepEqual(celdasDe("tranquera", 0, 0, 1), [[0, 0], [0, 1], [0, 2]]);
});

test("Poner: cobra, no se superpone, respeta lo fijo y los límites", () => {
  const p = partidaNueva(T0);
  p.oro = 5000;
  assert.ok(ponerObjeto(p, "carreta", 0, 0, 0, vacio, T0).ok);
  assert.equal(p.oro, 3500);
  assert.equal(puedePoner(p, "banco", 1, 1, 0, vacio).ok, false);       // encima de la carreta
  assert.ok(puedePoner(p, "banco", 2, 0, 0, vacio).ok);
  assert.equal(puedePoner(p, "banco", 5, 5, 0, new Map([["5,5", "fijo"]]) as Map<string, "camino" | "fijo">).ok, false);   // edificio o camino
  assert.equal(puedePoner(p, "banco", 100, 0, 0, vacio).ok, false);     // fuera del alambrado
  assert.equal(ponerObjeto(p, "portal", 4, 4, 0, vacio, T0).ok, false); // no alcanza
  assert.equal(ponerObjeto(p, "estatuaOro", 4, 4, 0, vacio, T0).ok, false);
  p.gemas = 200;
  assert.ok(ponerObjeto(p, "estatuaOro", 4, 4, 0, vacio, T0).ok);
  assert.equal(p.gemas, 80);
});

test("Mover, rotar y guardar: lo guardado se vuelve a poner gratis", () => {
  const p = partidaNueva(T0);
  p.oro = 1000;
  assert.ok(ponerObjeto(p, "tranquera", 0, 0, 0, vacio, T0).ok);
  const uid = p.decoracion!.puestos[0].uid;
  assert.ok(moverObjeto(p, uid, 1, 0, 0, vacio).ok);                    // se puede mover sobre sí mismo
  assert.ok(moverObjeto(p, uid, 5, 5, 1, vacio).ok);
  assert.deepEqual(p.decoracion!.puestos[0], { uid, id: "tranquera", cx: 5, cz: 5, rot: 1 });
  assert.ok(guardarObjeto(p, uid).ok);
  assert.equal(p.decoracion!.deposito.tranquera, 1);
  const oro = p.oro;
  assert.ok(ponerObjeto(p, "tranquera", -3, -3, 0, vacio, T0).ok);
  assert.equal(p.oro, oro);
  assert.equal(p.decoracion!.deposito.tranquera, undefined);
});

test("Caminos: el portal puede ir sobre el camino; un banco no. Los tramos de camino puestos cuentan como camino", () => {
  const p = partidaNueva(T0);
  p.oro = 50000;
  const fijo = new Map<string, "camino" | "fijo">([["0,0", "camino"], ["1,0", "camino"], ["3,3", "fijo"]]);
  assert.equal(puedePoner(p, "banco", 0, 0, 0, fijo).ok, false);
  assert.ok(puedePoner(p, "portal", -1, 0, 0, fijo).ok);
  assert.equal(puedePoner(p, "portal", 2, 3, 0, fijo).ok, false);           // edificio
  assert.ok(ponerObjeto(p, "camino", 6, 6, 0, fijo, T0).ok);
  assert.equal(puedePoner(p, "banco", 6, 6, 0, fijo).ok, false);
  assert.ok(puedePoner(p, "tranquera", 5, 6, 0, fijo).ok);                   // la tranquera cruza el camino
});
