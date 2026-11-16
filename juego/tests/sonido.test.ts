// Fase 10: las cuentas del sonido (sin audio): ritmo del galope, volumen por distancia y público.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fuerzaGolpe, gananciaDistancia, GOLPES_TRANCO, intensidadPublico, ritmoGalope } from "../src/audio/sonidoCarrera.ts";

test("galope: quieto no suena; el ritmo sube con la velocidad y a fondo da ~2,5 trancos por segundo", () => {
  assert.equal(ritmoGalope(0), 0);
  assert.ok(ritmoGalope(2) < ritmoGalope(10) && ritmoGalope(10) < ritmoGalope(16));
  assert.ok(Math.abs(ritmoGalope(16.5) - 2.53) < 0.05);
  assert.ok(ritmoGalope(40) <= 2.7);
  assert.equal(GOLPES_TRANCO.length, 4, "cuatro tiempos");
  assert.ok(GOLPES_TRANCO.every((x, i) => i === 0 || x > GOLPES_TRANCO[i - 1]) && GOLPES_TRANCO[3] < 0.6, "y un vuelo al final del tranco");
  assert.ok(fuerzaGolpe(16) > fuerzaGolpe(4));
});

test("se oye fuerte al lado, la mitad a 9 m y casi nada a 60 m", () => {
  assert.equal(gananciaDistancia(0), 1);
  assert.ok(Math.abs(gananciaDistancia(9) - 0.5) < 1e-9);
  assert.ok(gananciaDistancia(60) < 0.025);
});

test("público: murmullo antes, sube en el último tramo, explota en la llegada y se calma", () => {
  const prev = intensidadPublico({ fase: "previa", restanLider: 1500, distancia: 1500, segDesdeLlegada: null });
  const lejos = intensidadPublico({ fase: "carrera", restanLider: 900, distancia: 1500, segDesdeLlegada: null });
  const recta = intensidadPublico({ fase: "carrera", restanLider: 200, distancia: 1500, segDesdeLlegada: null });
  const meta = intensidadPublico({ fase: "carrera", restanLider: 1, distancia: 1500, segDesdeLlegada: null });
  const llego = intensidadPublico({ fase: "final", restanLider: 0, distancia: 1500, segDesdeLlegada: 0 });
  const despues = intensidadPublico({ fase: "final", restanLider: 0, distancia: 1500, segDesdeLlegada: 8 });
  assert.ok(prev < lejos + 0.05 && lejos < recta && recta < meta && meta < llego && despues < llego);
  // En 500 m el último tramo es el 30 % (150 m)
  assert.ok(intensidadPublico({ fase: "carrera", restanLider: 200, distancia: 500, segDesdeLlegada: null }) < intensidadPublico({ fase: "carrera", restanLider: 50, distancia: 500, segDesdeLlegada: null }));
});
