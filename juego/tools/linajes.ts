// Herramienta de pruebas: le da a un usuario caballos de linaje raro (Fase 5.5).
// Uso:  node tools/linajes.ts NOMBRE LINAJE SEXO
//   LINAJE: dorado | barroco | relampago | pampa | todos
//   SEXO:   macho | hembra | ambos
// Cada caballo nace como en la crianza del juego (potrillo de un padre y una madre puros de las dos razas del linaje,
// repitiendo hasta que sale el linaje), así tiene la forma, el pelaje, los rasgos y el techo de verdad. Ya nace adulto.
// Si no hay lugar en el establo, se agrandan los espacios (y si hace falta el nivel del Establo): es solo para probar.
import { fileURLToPath } from "node:url";
import { Base } from "../server/db.ts";
import { migrar, capacidad, TECHO_ESTABLO, type Partida } from "../src/domain/partida.ts";
import { caballoDeRaza, type Caballo, type Sexo } from "../src/domain/caballo.ts";
import { potrillo } from "../src/domain/crianza.ts";
import { LINAJES } from "../src/domain/rasgos.ts";
import { Rng } from "../src/sim/rng.ts";

const [nombre, linajeTxt = "todos", sexoTxt = "macho"] = process.argv.slice(2);
const ids = linajeTxt === "todos" ? Object.keys(LINAJES) : [linajeTxt];
const sexos: Sexo[] = sexoTxt === "ambos" ? ["macho", "hembra"] : sexoTxt === "hembra" ? ["hembra"] : ["macho"];
if (!nombre || ids.some((id) => !LINAJES[id])) {
  console.error(`Uso: node tools/linajes.ts NOMBRE (${Object.keys(LINAJES).join(" | ")} | todos) (macho | hembra | ambos)`);
  process.exit(1);
}

/** Hace nacer potrillos de un padre y una madre puros hasta que sale el linaje pedido, con el sexo pedido. */
function nacerDeLinaje(id: string, sexo: Sexo, semilla: number, ahora: number): Caballo {
  const [a, b] = LINAJES[id].razas;
  for (let k = 0; k < 200_000; k++) {
    const rng = new Rng((semilla + k * 2654435761) >>> 0);
    const padre = caballoDeRaza(rng, { raza: a, sexo: "macho" }), madre = caballoDeRaza(rng, { raza: b, sexo: "hembra" });
    const h = potrillo(rng, padre, madre, LINAJES[id].nombre, ahora);
    if (h.linaje !== id || h.sexo !== sexo) continue;
    h.estado = "disponible"; h.finEstado = null; h.padreId = null; h.madreId = null; h.creado = ahora;
    return h;
  }
  throw new Error(`No salió el linaje ${id}`);
}

/** Si no entra, agranda los espacios (y el nivel del Establo si el techo no alcanza). */
function hacerLugar(p: Partida, cuantos: number): string | null {
  const hace = p.caballos.length + (p.cruza ? 1 : 0) + (p.pujasMercado?.length ?? 0) + cuantos;
  if (hace <= capacidad(p)) return null;
  while (TECHO_ESTABLO[p.edificios.establo.nivel] < hace && p.edificios.establo.nivel < TECHO_ESTABLO.length - 1) p.edificios.establo.nivel++;
  p.espacios = Math.max(p.espacios, Math.min(hace, TECHO_ESTABLO[p.edificios.establo.nivel]));
  return hace > capacidad(p) ? "No entra todo ni con el Establo al máximo: liberá algún caballo." : `Para que entren, el establo quedó con ${capacidad(p)} lugares (Establo nivel ${p.edificios.establo.nivel}).`;
}

const ruta = process.env.CABALLOS_DB ?? fileURLToPath(new URL("../server/datos/caballos.db", import.meta.url));
const db = new Base(ruta);
const u = db.usuarioPorNombre(nombre);
if (!u) { console.error(`No existe el usuario «${nombre}».`); db.cerrar(); process.exit(1); }
const ahora = Date.now();
const nuevos = ids.flatMap((id) => sexos.map((sexo, k) => nacerDeLinaje(id, sexo, (ahora + k * 7919 + id.length * 104729) >>> 0, ahora)));
for (let intento = 0; intento < 5; intento++) {
  const r = db.partida(u.id);
  if (!r) { console.error(`${u.nombre} todavía no tiene partida (tiene que entrar al juego una vez).`); break; }
  const p = migrar(r.partida);
  if (!p) { console.error("No se pudo leer la partida."); break; }
  const aviso = hacerLugar(p, nuevos.length);
  const entran = Math.max(0, capacidad(p) - (p.caballos.length + (p.cruza ? 1 : 0) + (p.pujasMercado?.length ?? 0)));
  const dados = nuevos.slice(0, entran);
  p.caballos.push(...dados.map((c) => structuredClone(c)));
  if (db.guardarPartida(u.id, p, r.version, ahora)) {
    for (const c of dados) {
      const l = LINAJES[c.linaje!];
      console.log(`  ✦ ${c.nombre} (${c.sexo}) · ${l.razas.join(" × ")} · ${l.descripcion} · atributos ${c.natural.join("/")} · techo ${c.techo.join("/")}`);
    }
    if (aviso) console.log(aviso);
    if (dados.length < nuevos.length) console.log(`Quedaron ${nuevos.length - dados.length} sin dar por falta de lugar.`);
    console.log(`Listo: ${dados.length} caballo(s) de linaje para ${u.nombre}. En el juego se ven al recargar la página (F5).`);
    break;
  }
}
db.cerrar();
