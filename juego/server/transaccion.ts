// Transacción sobre varias partidas (Fases 8 y 9): las lee, aplica f y guarda todas con su versión, dentro de una sola
// transacción de la base. Si f aborta, no se guarda nada; si otra escritura ganó entre medio, se deshace y se reintenta.
import type { Base } from "./db.ts";
import type { Partida } from "../src/domain/partida.ts";

export type Resultado<T = object> = ({ ok: true } & T) | { ok: false; motivo: string };
/** Cómo se leen y guardan las partidas (las mismas funciones que usa el resto del servidor). */
export interface AccesoPartidas {
  leer: (u: number) => { partida: Partida; version: number };
  guardar: (u: number, p: Partida, version: number) => boolean;
}
/** Lanzarlo dentro de f deshace todo y devuelve { ok: false, motivo }. */
export class Abortar { motivo: string; constructor(motivo: string) { this.motivo = motivo; } }
class Conflicto {}

export function transaccionPartidas<T extends object>(db: Base, acceso: AccesoPartidas, usuarios: number[], f: (ps: Map<number, Partida>) => T): Resultado<T> {
  const us = [...new Set(usuarios)];
  for (let intento = 0; intento < 4; intento++) {
    try {
      return db.transaccion(() => {
        const leidas = new Map(us.map((u) => [u, acceso.leer(u)]));
        const r = f(new Map([...leidas].map(([u, x]) => [u, x.partida])));
        for (const [u, x] of leidas) if (!acceso.guardar(u, x.partida, x.version)) throw new Conflicto();
        return { ok: true as const, ...r };
      });
    } catch (e) {
      if (e instanceof Abortar) return { ok: false, motivo: e.motivo };
      if (e instanceof Conflicto) continue;
      throw e;
    }
  }
  return { ok: false, motivo: "El servidor está ocupado; probá de nuevo." };
}
