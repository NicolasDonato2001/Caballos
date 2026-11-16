import { test } from "node:test";
import assert from "node:assert/strict";
import { actualizarRatings, divisionDe, probGana, ratingInicial, ratingVisible, resumenRating } from "../src/domain/rating.ts";

const cerca = (a: number, b: number, e = 1e-3) => assert.ok(Math.abs(a - b) < e, `${a} ≉ ${b}`);

test("1 contra 1 coincide con la solución analítica de TrueSkill", () => {
  // c² = 2β² + 2(σ² + τ²); μ' = μ ± σ'²/c · v(0); σ'² = σ'²(1 − σ'²/c² · w(0))
  const [g, p] = actualizarRatings([ratingInicial(), ratingInicial()]);
  cerca(g.mu, 29.2055); cerca(p.mu, 20.7945); cerca(g.sigma, 7.1948); cerca(p.sigma, 7.1948);
});

test("todos contra todos: el orden de llegada se respeta y es simétrico", () => {
  const r = actualizarRatings([0, 1, 2, 3, 4, 5, 6, 7].map(ratingInicial));
  for (let k = 1; k < r.length; k++) assert.ok(r[k - 1].mu > r[k].mu);
  cerca(r.reduce((s, x) => s + x.mu, 0), 25 * 8, 1e-6);
  cerca(r[0].mu - 25, 25 - r[7].mu, 1e-6);
  for (const x of r) assert.ok(x.sigma < 8.3333);
});

test("ganarle a alguien mucho más fuerte sube más que ganarle a uno más débil", () => {
  const yo = { mu: 25, sigma: 3 };
  const [a] = actualizarRatings([yo, { mu: 35, sigma: 3 }]);
  const [b] = actualizarRatings([yo, { mu: 15, sigma: 3 }]);
  assert.ok(a.mu - 25 > b.mu - 25);
  assert.ok(b.mu - 25 > 0 && b.mu - 25 < 0.3); // analítico: 9/7,26 · v(1,377) ≈ 0,21
  assert.ok(probGana({ mu: 35, sigma: 3 }, yo) > 0.9);
});

test("rating visible, colocación y divisiones (§13)", () => {
  assert.equal(ratingVisible(ratingInicial()), 0);
  assert.equal(ratingVisible({ mu: 40, sigma: 1.3 }), 1805);
  assert.equal(divisionDe(0).nombre, "Bronce");
  assert.equal(divisionDe(799).nombre, "Bronce");
  assert.equal(divisionDe(800).nombre, "Plata");
  assert.equal(divisionDe(1349).nombre, "Oro");
  assert.equal(divisionDe(1750).nombre, "Maestro");
  assert.equal(divisionDe(2000).nombre, "Leyenda");
  assert.equal(resumenRating(ratingInicial(), 3).division, null);
  assert.equal(resumenRating(ratingInicial(), 10).division?.nombre, "Bronce");
});

test("el que gana seguido sube mucho y el que pierde seguido queda abajo, nunca negativo", () => {
  let bueno = ratingInicial(), malo = ratingInicial();
  for (let k = 0; k < 30; k++) {
    const r = actualizarRatings([bueno, { mu: 25, sigma: 2 }, { mu: 25, sigma: 2 }, malo]);
    bueno = r[0]; malo = r[3];
  }
  assert.ok(ratingVisible(bueno) > 1000);
  assert.ok(ratingVisible(malo) >= 0 && ratingVisible(malo) < 300 && malo.mu < 25);
  assert.ok(bueno.sigma < 3 && malo.sigma < 3);
});
