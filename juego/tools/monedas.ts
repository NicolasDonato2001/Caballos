// Herramienta de prueba: deja a un usuario con una cantidad de Oro y de Gemas (queda en su ledger como «ajuste de prueba»).
// Uso:  node tools/monedas.ts NOMBRE ORO GEMAS      (o «4 - DAR ORO Y GEMAS.bat», que lo pregunta)
// Se puede usar con el servidor prendido: guarda con la versión de la partida, igual que el servidor.
import { fileURLToPath } from "node:url";
import { Base } from "../server/db.ts";
import { migrar } from "../src/domain/partida.ts";
import { mover } from "../src/domain/economia.ts";

const [nombre, oroTxt, gemasTxt] = process.argv.slice(2);
const oro = Number(oroTxt), gemas = Number(gemasTxt);
if (!nombre || !Number.isInteger(oro) || !Number.isInteger(gemas) || oro < 0 || gemas < 0) {
  console.error("Uso: node tools/monedas.ts NOMBRE ORO GEMAS   (números enteros, sin puntos)");
  process.exit(1);
}
const ruta = process.env.CABALLOS_DB ?? fileURLToPath(new URL("../server/datos/caballos.db", import.meta.url));
const db = new Base(ruta);
const u = db.usuarioPorNombre(nombre);
if (!u) { console.error(`No existe el usuario «${nombre}».`); db.cerrar(); process.exit(1); }
for (let intento = 0; intento < 5; intento++) {
  const r = db.partida(u.id);
  if (!r) { console.error(`${u.nombre} todavía no tiene partida (tiene que entrar al juego una vez).`); break; }
  const p = migrar(r.partida);
  if (!p) { console.error("No se pudo leer la partida."); break; }
  const antes = { oro: p.oro, gemas: p.gemas }, ahora = Date.now();
  mover(p, "oro", oro - p.oro, "ajuste de prueba", ahora);
  mover(p, "gemas", gemas - p.gemas, "ajuste de prueba", ahora);
  if (db.guardarPartida(u.id, p, r.version, ahora)) {
    console.log(`${u.nombre}: Oro ${antes.oro.toLocaleString("es-AR")} → ${oro.toLocaleString("es-AR")} · Gemas ${antes.gemas.toLocaleString("es-AR")} → ${gemas.toLocaleString("es-AR")}`);
    console.log("Listo. En el juego se ve al recargar la página (F5) o con la próxima acción.");
    break;
  }
}
db.cerrar();
