import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crearServidor } from "../server/servidor.ts";

test("con --juego el servidor entrega el juego armado y sigue atendiendo /api", async () => {
  const d = mkdtempSync(join(tmpdir(), "cab-"));
  mkdirSync(join(d, "assets")); mkdirSync(join(d, "modelos"));
  writeFileSync(join(d, "index.html"), "<!doctype html><title>Caballos</title>");
  writeFileSync(join(d, "assets", "app-abc.js"), "console.log(1)");
  writeFileSync(join(d, "modelos", "caballo.glb"), Buffer.from([1, 2, 3]));
  writeFileSync(join(d, "..", "secreto.txt"), "no");
  const { servidor, db } = crearServidor({ base: ":memory:", juego: d });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`;
  try {
    let r = await fetch(b + "/");
    assert.equal(r.status, 200); assert.match(await r.text(), /Caballos/);
    r = await fetch(b + "/assets/app-abc.js");
    assert.match(r.headers.get("content-type")!, /javascript/); assert.match(r.headers.get("cache-control")!, /immutable/);
    r = await fetch(b + "/modelos/caballo.glb", { method: "HEAD" });
    assert.equal(r.status, 200); assert.equal(r.headers.get("content-length"), "3");
    r = await fetch(b + "/carreras"); // ruta sin archivo → index.html
    assert.match(await r.text(), /Caballos/);
    r = await fetch(b + "/..%2Fsecreto.txt");
    assert.equal(r.status, 404);
    r = await fetch(b + "/no-existe.js");
    assert.equal(r.status, 404);
    r = await fetch(b + "/api/salud");
    assert.equal((await r.json()).ok, true);
  } finally { servidor.close(); db.cerrar(); }
});

test("el freno de intentos usa la dirección real que manda Cloudflare", async () => {
  const { servidor } = crearServidor({ base: ":memory:" });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`;
  const entrar = (ip: string) => fetch(b + "/api/entrar", { method: "POST", headers: { "cf-connecting-ip": ip }, body: JSON.stringify({ nombre: "nadie", clave: "12345678" }) });
  try {
    for (let k = 0; k < 10; k++) await entrar("1.1.1.1");
    assert.equal((await entrar("1.1.1.1")).status, 429);
    assert.equal((await entrar("2.2.2.2")).status, 401); // otro amigo no queda frenado
  } finally { servidor.close(); }
});
