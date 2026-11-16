// Base de datos del servidor (Fase 7). SQLite incluido en Node (node:sqlite) para desarrollo; antes de publicar (Fase 11)
// se pasa a PostgreSQL (GDD §2) cambiando solo este archivo: el resto del servidor usa estas funciones.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Partida } from "../src/domain/partida.ts";
import { ratingInicial, type Rating } from "../src/domain/rating.ts";

export interface FilaPublicacion {
  id: string; vendedor: number; caballoId: string; caballo: string; tipo: "venta" | "subasta"; precio: number; creada: number; fin: number;
  estado: "activa" | "vendida" | "cancelada" | "vencida" | "sin_ofertas" | "fallida";
  mejorPuja: number | null; mejorPostor: number | null; comprador: number | null; precioFinal: number | null; cerrada: number | null;
}
export interface FilaToken { id: string; usuario: number; dia: number; seed: number; emitido: number; vence: number; }
export interface FilaRanking { usuario: number; nombre: string; mu: number; sigma: number; carreras: number; }

export interface Usuario { id: number; nombre: string; hash: string; sal: string; creado: number; }

export class Base {
  private db: DatabaseSync;
  constructor(ruta: string) {
    if (ruta !== ":memory:") mkdirSync(dirname(ruta), { recursive: true });
    this.db = new DatabaseSync(ruta);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE COLLATE NOCASE, hash TEXT NOT NULL, sal TEXT NOT NULL, creado INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sesiones (token TEXT PRIMARY KEY, usuario INTEGER NOT NULL REFERENCES usuarios(id), vence INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS partidas (usuario INTEGER PRIMARY KEY REFERENCES usuarios(id), datos TEXT NOT NULL, version INTEGER NOT NULL, actualizada INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS acciones (id INTEGER PRIMARY KEY, usuario INTEGER NOT NULL, nombre TEXT NOT NULL, ok INTEGER NOT NULL, fecha INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ratings (usuario INTEGER PRIMARY KEY REFERENCES usuarios(id), mu REAL NOT NULL, sigma REAL NOT NULL, carreras INTEGER NOT NULL, actualizado INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS ratings_orden ON ratings ((mu - 3 * sigma));
      CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, usuario INTEGER NOT NULL REFERENCES usuarios(id), dia INTEGER NOT NULL, seed INTEGER NOT NULL,
        emitido INTEGER NOT NULL, vence INTEGER NOT NULL, usado INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS tokens_usuario ON tokens (usuario, dia);
      CREATE TABLE IF NOT EXISTS publicaciones (id TEXT PRIMARY KEY, vendedor INTEGER NOT NULL REFERENCES usuarios(id), caballoId TEXT NOT NULL,
        caballo TEXT NOT NULL, tipo TEXT NOT NULL, precio INTEGER NOT NULL, creada INTEGER NOT NULL, fin INTEGER NOT NULL,
        estado TEXT NOT NULL, mejorPuja INTEGER, mejorPostor INTEGER, comprador INTEGER, precioFinal INTEGER, cerrada INTEGER);
      CREATE INDEX IF NOT EXISTS publicaciones_estado ON publicaciones (estado, fin);
      CREATE INDEX IF NOT EXISTS publicaciones_vendedor ON publicaciones (vendedor, creada);
      CREATE TABLE IF NOT EXISTS pujas (id INTEGER PRIMARY KEY, publicacion TEXT NOT NULL, usuario INTEGER NOT NULL, monto INTEGER NOT NULL, fecha INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS clanes (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE COLLATE NOCASE, elo REAL NOT NULL, creado INTEGER NOT NULL,
        guerras INTEGER NOT NULL DEFAULT 0, victorias INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS miembros (usuario INTEGER PRIMARY KEY REFERENCES usuarios(id), clan INTEGER NOT NULL REFERENCES clanes(id), rol TEXT NOT NULL, desde INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS miembros_clan ON miembros (clan);
      CREATE TABLE IF NOT EXISTS cola_guerras (clan INTEGER PRIMARY KEY, desde INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS guerras (id INTEGER PRIMARY KEY, clanA INTEGER NOT NULL, clanB INTEGER NOT NULL, inicio INTEGER NOT NULL, fin INTEGER NOT NULL,
        estado TEXT NOT NULL, carreras TEXT NOT NULL, puntosA INTEGER NOT NULL DEFAULT 0, puntosB INTEGER NOT NULL DEFAULT 0, ganador INTEGER,
        eloA0 REAL NOT NULL, eloB0 REAL NOT NULL, eloA1 REAL, eloB1 REAL, terminada INTEGER);
      CREATE INDEX IF NOT EXISTS guerras_estado ON guerras (estado);
      CREATE TABLE IF NOT EXISTS guerra_reps (guerra INTEGER NOT NULL, clan INTEGER NOT NULL, usuario INTEGER NOT NULL, PRIMARY KEY (guerra, usuario));
      CREATE TABLE IF NOT EXISTS guerra_entradas (guerra INTEGER NOT NULL, carrera INTEGER NOT NULL, usuario INTEGER NOT NULL, caballoId TEXT NOT NULL,
        estrategia TEXT NOT NULL, PRIMARY KEY (guerra, carrera, usuario));
    `);
  }
  crearUsuario(nombre: string, hash: string, sal: string, ahora: number): number {
    const r = this.db.prepare("INSERT INTO usuarios (nombre, hash, sal, creado) VALUES (?, ?, ?, ?)").run(nombre, hash, sal, ahora);
    return Number(r.lastInsertRowid);
  }
  usuarioPorNombre(nombre: string): Usuario | undefined {
    return this.db.prepare("SELECT * FROM usuarios WHERE nombre = ?").get(nombre) as Usuario | undefined;
  }
  usuario(id: number): Usuario | undefined { return this.db.prepare("SELECT * FROM usuarios WHERE id = ?").get(id) as Usuario | undefined; }
  guardarSesion(token: string, usuario: number, vence: number): void {
    this.db.prepare("INSERT INTO sesiones (token, usuario, vence) VALUES (?, ?, ?)").run(token, usuario, vence);
  }
  sesion(token: string, ahora: number): number | null {
    const r = this.db.prepare("SELECT usuario FROM sesiones WHERE token = ? AND vence > ?").get(token, ahora) as { usuario: number } | undefined;
    return r ? r.usuario : null;
  }
  borrarSesion(token: string): void { this.db.prepare("DELETE FROM sesiones WHERE token = ?").run(token); }
  partida(usuario: number): { partida: Partida; version: number } | null {
    const r = this.db.prepare("SELECT datos, version FROM partidas WHERE usuario = ?").get(usuario) as { datos: string; version: number } | undefined;
    return r ? { partida: JSON.parse(r.datos) as Partida, version: r.version } : null;
  }
  /** Guarda si la versión no cambió desde que se leyó (si no, otra acción ganó: se reintenta). */
  guardarPartida(usuario: number, p: Partida, version: number, ahora: number): boolean {
    if (version === 0) {
      this.db.prepare("INSERT INTO partidas (usuario, datos, version, actualizada) VALUES (?, ?, 1, ?)").run(usuario, JSON.stringify(p), ahora);
      return true;
    }
    const r = this.db.prepare("UPDATE partidas SET datos = ?, version = version + 1, actualizada = ? WHERE usuario = ? AND version = ?").run(JSON.stringify(p), ahora, usuario, version);
    return Number(r.changes) === 1;
  }
  anotar(usuario: number, nombre: string, ok: boolean, ahora: number): void {
    this.db.prepare("INSERT INTO acciones (usuario, nombre, ok, fecha) VALUES (?, ?, ?, ?)").run(usuario, nombre, ok ? 1 : 0, ahora);
  }
  // ---- Rating (7.3). Vive solo en el servidor, fuera de la partida: el cliente no lo puede tocar.
  rating(usuario: number): Rating & { carreras: number } {
    const r = this.db.prepare("SELECT mu, sigma, carreras FROM ratings WHERE usuario = ?").get(usuario) as { mu: number; sigma: number; carreras: number } | undefined;
    return r ? { mu: r.mu, sigma: r.sigma, carreras: r.carreras } : { ...ratingInicial(), carreras: 0 };
  }
  /** Guarda varios ratings juntos (los de una misma carrera): o todos o ninguno. */
  guardarRatings(filas: { usuario: number; r: Rating; carreras: number }[], ahora: number): void {
    const st = this.db.prepare(`INSERT INTO ratings (usuario, mu, sigma, carreras, actualizado) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(usuario) DO UPDATE SET mu = excluded.mu, sigma = excluded.sigma, carreras = excluded.carreras, actualizado = excluded.actualizado`);
    this.db.exec("BEGIN");
    try { for (const f of filas) st.run(f.usuario, f.r.mu, f.r.sigma, f.carreras, ahora); this.db.exec("COMMIT"); }
    catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  /** Los mejores por rating visible (μ − 3σ), solo los que terminaron la colocación. */
  ranking(limite: number, minCarreras: number): FilaRanking[] {
    return this.db.prepare(`SELECT r.usuario, u.nombre, r.mu, r.sigma, r.carreras FROM ratings r JOIN usuarios u ON u.id = r.usuario
      WHERE r.carreras >= ? ORDER BY (r.mu - 3 * r.sigma) DESC, r.carreras DESC, u.id LIMIT ?`).all(minCarreras, limite) as unknown as FilaRanking[];
  }
  /** Puesto en el ranking (1 = el mejor), o null si no terminó la colocación. */
  puesto(usuario: number, minCarreras: number): number | null {
    const yo = this.rating(usuario);
    if (yo.carreras < minCarreras) return null;
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM ratings WHERE carreras >= ? AND (mu - 3 * sigma) > ?").get(minCarreras, yo.mu - 3 * yo.sigma) as { n: number };
    return Number(r.n) + 1;
  }
  // ---- Tokens de carreras offline (7.5)
  tokensDelDia(usuario: number, dia: number): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM tokens WHERE usuario = ? AND dia = ?").get(usuario, dia) as { n: number }).n);
  }
  crearToken(t: FilaToken): void {
    this.db.prepare("INSERT INTO tokens (id, usuario, dia, seed, emitido, vence) VALUES (?, ?, ?, ?, ?, ?)").run(t.id, t.usuario, t.dia, t.seed, t.emitido, t.vence);
  }
  tokensLibres(usuario: number, ahora: number): FilaToken[] {
    return this.db.prepare("SELECT * FROM tokens WHERE usuario = ? AND usado = 0 AND vence > ? ORDER BY dia, emitido").all(usuario, ahora) as unknown as FilaToken[];
  }
  token(id: string): (FilaToken & { usado: number }) | undefined {
    return this.db.prepare("SELECT * FROM tokens WHERE id = ?").get(id) as (FilaToken & { usado: number }) | undefined;
  }
  /** Marca el token como usado si todavía no lo estaba. Devuelve true solo la primera vez (nadie lo usa dos veces). */
  usarToken(id: string, usuario: number): boolean {
    return Number(this.db.prepare("UPDATE tokens SET usado = 1 WHERE id = ? AND usuario = ? AND usado = 0").run(id, usuario).changes) === 1;
  }
  // ---- Mercado entre jugadores (Fase 8)
  /** Corre f dentro de una transacción: o se guarda todo o nada. Si f lanza, se deshace. */
  transaccion<T>(f: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const r = f(); this.db.exec("COMMIT"); return r; }
    catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  crearPublicacion(x: Omit<FilaPublicacion, "mejorPuja" | "mejorPostor" | "comprador" | "precioFinal" | "cerrada">): void {
    this.db.prepare("INSERT INTO publicaciones (id, vendedor, caballoId, caballo, tipo, precio, creada, fin, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(x.id, x.vendedor, x.caballoId, x.caballo, x.tipo, x.precio, x.creada, x.fin, x.estado);
  }
  publicacion(id: string): FilaPublicacion | undefined {
    return this.db.prepare("SELECT * FROM publicaciones WHERE id = ?").get(id) as FilaPublicacion | undefined;
  }
  /** Cambia campos de una publicación solo si sigue en el estado esperado (así nadie la vende dos veces). */
  actualizarPublicacion(id: string, estadoEsperado: string, cambios: Partial<FilaPublicacion>): boolean {
    const claves = Object.keys(cambios) as (keyof FilaPublicacion)[];
    const sql = `UPDATE publicaciones SET ${claves.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND estado = ?`;
    return Number(this.db.prepare(sql).run(...claves.map((k) => cambios[k] as number | string | null), id, estadoEsperado).changes) === 1;
  }
  publicacionesActivas(): FilaPublicacion[] {
    return this.db.prepare("SELECT * FROM publicaciones WHERE estado = 'activa' ORDER BY fin").all() as unknown as FilaPublicacion[];
  }
  publicacionesVencidas(ahora: number): FilaPublicacion[] {
    return this.db.prepare("SELECT * FROM publicaciones WHERE estado = 'activa' AND fin <= ? ORDER BY fin").all(ahora) as unknown as FilaPublicacion[];
  }
  /** Las del vendedor y las que compró o ganó, las más nuevas primero. */
  publicacionesDe(usuario: number, limite: number): FilaPublicacion[] {
    return this.db.prepare("SELECT * FROM publicaciones WHERE vendedor = ? OR comprador = ? ORDER BY creada DESC LIMIT ?").all(usuario, usuario, limite) as unknown as FilaPublicacion[];
  }
  anotarPuja(publicacion: string, usuario: number, monto: number, fecha: number): void {
    this.db.prepare("INSERT INTO pujas (publicacion, usuario, monto, fecha) VALUES (?, ?, ?, ?)").run(publicacion, usuario, monto, fecha);
  }
  cantidadPujas(publicacion: string): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM pujas WHERE publicacion = ?").get(publicacion) as { n: number }).n);
  }
  // ---- Clanes y guerras (Fase 9). Consultas simples: las reglas están en server/clanes.ts
  sql<T = unknown>(consulta: string, ...args: (string | number | null)[]): T[] { return this.db.prepare(consulta).all(...args) as T[]; }
  uno<T = unknown>(consulta: string, ...args: (string | number | null)[]): T | undefined { return this.db.prepare(consulta).get(...args) as T | undefined; }
  hacer(consulta: string, ...args: (string | number | null)[]): { cambios: number; id: number } {
    const r = this.db.prepare(consulta).run(...args);
    return { cambios: Number(r.changes), id: Number(r.lastInsertRowid) };
  }
  cerrar(): void { this.db.close(); }
}
