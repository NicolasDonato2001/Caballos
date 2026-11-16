// Servidor del juego (Fase 7, GDD §2 y §18). Node puro: http + SQLite (node:sqlite), sin dependencias.
// El servidor es la autoridad: guarda la partida, pone la hora y el azar, ejecuta las acciones y simula las carreras.
// Uso:  node server/servidor.ts   (puerto 8787; Vite reenvía /api a este puerto)
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Base } from "./db.ts";
import { entrar, hashToken, nuevaSesion, registrar } from "./cuentas.ts";
import { correr } from "./carrera.ts";
import { CarrerasOnline, type CambioRating, type TipoOnline } from "./online.ts";
import { actualizarRatings, RATING, resumenRating } from "../src/domain/rating.ts";
import { claveSecreta, emitirTokens, sincronizar, type PedidoOffline } from "./offline.ts";
import { MercadoJugadores } from "./mercado.ts";
import { Clanes } from "./clanes.ts";
import type { Rol } from "../src/domain/clanes.ts";
import type { TipoPublicacion } from "../src/domain/mercadoJugadores.ts";
import cfgOnline from "../config/balance/online.json" with { type: "json" };
import { ejecutar } from "../src/domain/acciones.ts";
import { actualizar } from "../src/domain/edificios.ts";
import { migrar, partidaNueva, type Partida } from "../src/domain/partida.ts";
import { Rng } from "../src/sim/rng.ts";
import { randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import type { Modo } from "../src/domain/carreras.ts";
import type { Strategy } from "../src/sim/types.ts";

export interface Opciones {
  puerto?: number; base?: string; reloj?: () => number;
  online?: Partial<Omit<typeof cfgOnline, "ranked">> & { ranked?: Partial<typeof cfgOnline.ranked> };
  /** Carpeta con el juego ya armado (vite build → dist). Si está, el servidor también entrega el juego: así se juega por internet con una sola dirección. */
  juego?: string;
}

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".wasm": "application/wasm", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".env": "application/octet-stream",
  ".ktx2": "image/ktx2", ".txt": "text/plain; charset=utf-8",
};

/** Entrega un archivo del juego armado. Devuelve false si no existe. */
function entregarArchivo(raiz: string, ruta: string, req: IncomingMessage, res: ServerResponse): boolean {
  let rel: string;
  try { rel = decodeURIComponent(ruta); } catch { return false; }
  const archivo = normalize(join(raiz, rel));
  if (archivo !== raiz && !archivo.startsWith(raiz.endsWith(sep) ? raiz : raiz + sep)) return false; // nada fuera de la carpeta
  let st;
  try { st = statSync(archivo); } catch { return false; }
  if (!st.isFile()) return false;
  // Los archivos de assets/ llevan un código en el nombre: se pueden guardar mucho tiempo. index.html no.
  const cache = rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
  res.writeHead(200, { "Content-Type": TIPOS[extname(archivo).toLowerCase()] ?? "application/octet-stream", "Content-Length": st.size, "Cache-Control": cache });
  if (req.method === "HEAD") { res.end(); return true; }
  createReadStream(archivo).pipe(res);
  return true;
}

/** Arma el servidor (sin escuchar todavía): lo usan el arranque y las pruebas. */
export function crearServidor(o: Opciones = {}) {
  const db = new Base(o.base ?? fileURLToPath(new URL("./datos/caballos.db", import.meta.url)));
  // 7.5: clave para firmar los tokens offline (en las pruebas, en memoria)
  const clave = claveSecreta(o.base === ":memory:" ? undefined : fileURLToPath(new URL("./datos/secreto.key", import.meta.url)));
  const reloj = o.reloj ?? Date.now;
  const azar = () => new Rng(randomInt(0, 2 ** 32 - 1) >>> 0);
  // Una acción por vez por usuario (las acciones de un mismo jugador no se pisan)
  const colas = new Map<number, Promise<unknown>>();
  const enCola = <T>(u: number, f: () => T | Promise<T>): Promise<T> => {
    const prev = colas.get(u) ?? Promise.resolve();
    const sig = prev.then(f, f);
    colas.set(u, sig.catch(() => {}));
    return sig;
  };
  // Freno a los intentos de entrar: 10 por minuto por dirección
  const intentos = new Map<string, number[]>();
  const frenar = (ip: string) => {
    const t = reloj(), l = (intentos.get(ip) ?? []).filter((x) => t - x < 60_000);
    l.push(t); intentos.set(ip, l);
    return l.length > 10;
  };

  const partidaDe = (u: number): { partida: Partida; version: number } => {
    const r = db.partida(u);
    if (!r) return { partida: partidaNueva(reloj()), version: 0 };
    return { partida: migrar(r.partida) ?? partidaNueva(reloj()), version: r.version };
  };
  /** Lee, aplica f y guarda; si otra escritura ganó, reintenta. */
  const modificar = async <T extends { ok: boolean }>(u: number, f: (p: Partida) => T) => enCola(u, () => {
    for (let k = 0; k < 3; k++) {
      const { partida, version } = partidaDe(u);
      const r = f(partida);
      if (!r.ok) return { r, partida };
      if (db.guardarPartida(u, partida, version, reloj())) return { r, partida };
    }
    return { r: { ok: false, motivo: "La partida cambió mientras tanto; probá de nuevo." } as unknown as T, partida: partidaDe(u).partida };
  });

  // Carreras entre jugadores (7.2)
  const online = new CarrerasOnline({
    leer: (u) => { const p = partidaDe(u).partida; actualizar(p, reloj()); return p; },
    modificar: (u, f) => modificar(u, (p) => { actualizar(p, reloj()); return f(p); }),
    reloj,
    rating: (u) => resumenRating(db.rating(u), db.rating(u).carreras).visible,
    alTerminar: (orden) => {
      const antes = orden.map((u) => db.rating(u));
      const nuevos = actualizarRatings(antes);
      db.guardarRatings(orden.map((u, k) => ({ usuario: u, r: nuevos[k], carreras: antes[k].carreras + 1 })), reloj());
      return new Map(orden.map((u, k): [number, CambioRating] => {
        const a = resumenRating(antes[k], antes[k].carreras), d = resumenRating(nuevos[k], antes[k].carreras + 1);
        return [u, { antes: a.visible, despues: d.visible, carreras: d.carreras, colocacion: d.colocacion,
          division: d.division ? { nombre: d.division.nombre, color: d.division.color } : null }];
      }));
    },
  }, { ...cfgOnline, ...(o.online ?? {}), ranked: { ...cfgOnline.ranked, ...(o.online?.ranked ?? {}) } });
  online.arrancar();

  // Mercado entre jugadores y subastas (Fase 8): lee la partida con el reloj al día y guarda con su versión
  const mercado = new MercadoJugadores(db, {
    leer: (u) => { const x = partidaDe(u); actualizar(x.partida, reloj()); return x; },
    guardar: (u, p, version) => db.guardarPartida(u, p, version, reloj()),
  }, reloj);
  // Cada 5 s se cierran las publicaciones vencidas (también al consultar el mercado)
  // Clanes y guerras (Fase 9): el mismo acceso a las partidas que el mercado
  const clanes = new Clanes(db, {
    leer: (u) => { const x = partidaDe(u); actualizar(x.partida, reloj()); return x; },
    guardar: (u, p, version) => db.guardarPartida(u, p, version, reloj()),
  }, reloj);
  const cierres = setInterval(() => {
    try { mercado.cerrarVencidas(); } catch (e) { console.error(e); }
    try { clanes.paso(); } catch (e) { console.error(e); }
  }, 5000);
  cierres.unref?.();

  async function leerCuerpo(req: IncomingMessage): Promise<Record<string, unknown>> {
    let datos = "";
    for await (const trozo of req) { datos += trozo; if (datos.length > 200_000) throw new Error("Pedido demasiado grande"); }
    if (!datos) return {};
    const v = JSON.parse(datos);
    return v && typeof v === "object" ? v : {};
  }
  const responder = (res: ServerResponse, estado: number, cuerpo: unknown) => {
    res.writeHead(estado, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(cuerpo));
  };
  // Por el túnel todos llegan desde esta misma compu (127.0.0.1): la dirección real la pasa Cloudflare
  const ipDe = (req: IncomingMessage): string => {
    const local = req.socket.remoteAddress ?? "?";
    const cf = req.headers["cf-connecting-ip"];
    return (local === "127.0.0.1" || local === "::1" || local === "::ffff:127.0.0.1") && typeof cf === "string" && cf ? cf : local;
  };
  const raizJuego = o.juego ? normalize(o.juego) : null;
  const usuarioDe = (req: IncomingMessage): number | null => {
    const h = req.headers.authorization ?? "";
    // EventSource no puede mandar encabezados: para /api/online/eventos el token va en la dirección
    const t = h.startsWith("Bearer ") ? h.slice(7) : new URL(req.url ?? "/", "http://x").searchParams.get("token") ?? "";
    return t ? db.sesion(hashToken(t), reloj()) : null;
  };

  const servidor = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const ruta = `${req.method} ${url.pathname}`;
      // El juego armado (solo si se pidió): todo lo que no es /api
      if (raizJuego && !url.pathname.startsWith("/api/") && (req.method === "GET" || req.method === "HEAD")) {
        if (entregarArchivo(raizJuego, url.pathname === "/" ? "/index.html" : url.pathname, req, res)) return;
        if (!extname(url.pathname) && entregarArchivo(raizJuego, "/index.html", req, res)) return;
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("No existe."); return;
      }
      if (ruta === "GET /api/salud") return responder(res, 200, { ok: true, hora: reloj() });
      if (ruta === "POST /api/registro" || ruta === "POST /api/entrar") {
        if (frenar(ipDe(req))) return responder(res, 429, { ok: false, motivo: "Demasiados intentos: esperá un minuto." });
        const b = await leerCuerpo(req);
        const r = ruta.endsWith("registro") ? registrar(db, String(b.nombre ?? ""), String(b.clave ?? ""), reloj())
          : entrar(db, String(b.nombre ?? ""), String(b.clave ?? ""));
        if (!r.ok) return responder(res, ruta.endsWith("registro") ? 400 : 401, r);
        // Al crear la cuenta se puede subir la partida local (la que ya se venía jugando en este navegador)
        if (ruta.endsWith("registro") && b.partida) {
          const p = migrar(b.partida);
          if (p) db.guardarPartida(r.usuario, p, 0, reloj());
        }
        const token = nuevaSesion(db, r.usuario, reloj());
        return responder(res, 200, { ok: true, token, nombre: db.usuario(r.usuario)!.nombre, partida: partidaDe(r.usuario).partida });
      }
      const u = usuarioDe(req);
      if (!u) return responder(res, 401, { ok: false, motivo: "Tenés que entrar con tu cuenta." });
      if (ruta === "POST /api/salir") { db.borrarSesion(hashToken((req.headers.authorization ?? "").slice(7))); return responder(res, 200, { ok: true }); }
      if (ruta === "GET /api/partida") {
        const { r, partida } = await modificar(u, (p) => { const sucesos = actualizar(p, reloj()); return { ok: true, sucesos }; });
        return responder(res, 200, { ...r, nombre: db.usuario(u)!.nombre, partida });
      }
      if (ruta === "POST /api/accion") {
        const b = await leerCuerpo(req);
        const nombre = String(b.nombre ?? "");
        const { r, partida } = await modificar(u, (p) => ejecutar(p, nombre, (b.args ?? {}) as Record<string, unknown>, { ahora: reloj(), rng: azar() }));
        db.anotar(u, nombre, r.ok, reloj());
        return responder(res, r.ok ? 200 : 400, { ...r, partida });
      }
      if (ruta === "POST /api/correr") {
        const b = await leerCuerpo(req);
        const { r, partida } = await modificar(u, (p) => {
          actualizar(p, reloj());
          return correr(p, String(b.caballoId ?? ""), b.modo as Modo, b.estrategia as Strategy, reloj());
        });
        db.anotar(u, "correr", r.ok, reloj());
        return responder(res, r.ok ? 200 : 400, { ...r, partida });
      }
      if (ruta === "GET /api/online/eventos") return online.escuchar(u, res);
      if (ruta === "GET /api/online/estado") {
        // También sirve de respaldo si los avisos en vivo se demoran (el túnel): trae la carrera si hay una por ver
        const carrera = online.carreraReciente(u);
        return responder(res, 200, { ok: true, ...online.estado(u), hora: reloj(), ...(carrera ? { carrera: { ...carrera, hora: reloj() } } : {}) });
      }
      if (ruta === "GET /api/offline/tokens") return responder(res, 200, { ok: true, tokens: emitirTokens(db, clave, u, reloj()) });
      if (ruta === "POST /api/offline/sincronizar") {
        const b = await leerCuerpo(req);
        // Puede llegar mucho: las carreras offline de varios días
        const r = await sincronizar(db, clave, u, (b.carreras ?? []) as PedidoOffline[], reloj(), modificar);
        db.anotar(u, "sincronizar", true, reloj());
        return responder(res, 200, { ok: true, ...r, tokens: emitirTokens(db, clave, u, reloj()) });
      }
      if (ruta === "GET /api/mercado") return responder(res, 200, { ok: true, ...mercado.listar(u) });
      if (ruta.startsWith("POST /api/mercado/")) {
        const b = await leerCuerpo(req);
        const accionMercado = url.pathname.slice("/api/mercado/".length);
        const r = accionMercado === "publicar" ? mercado.publicar(u, String(b.caballoId ?? ""), b.tipo as TipoPublicacion, Number(b.precio), Number(b.duracionMin ?? 0))
          : accionMercado === "cancelar" ? mercado.cancelar(u, String(b.id ?? ""))
          : accionMercado === "comprar" ? mercado.comprar(u, String(b.id ?? ""))
          : accionMercado === "pujar" ? mercado.pujar(u, String(b.id ?? ""), Number(b.monto))
          : { ok: false as const, motivo: "No existe." };
        db.anotar(u, `mercado:${accionMercado}`, r.ok, reloj());
        return responder(res, r.ok ? 200 : 400, r.ok ? { ...r, partida: partidaDe(u).partida, ...mercado.listar(u) } : r);
      }
      if (ruta === "GET /api/clan") { clanes.paso(); return responder(res, 200, { ok: true, ...clanes.estado(u) }); }
      if (ruta.startsWith("POST /api/clan/")) {
        const b = await leerCuerpo(req);
        const a = url.pathname.slice("/api/clan/".length);
        const r = a === "crear" ? clanes.crear(u, String(b.nombre ?? ""))
          : a === "unirse" ? clanes.unirse(u, Number(b.id))
          : a === "salir" ? clanes.salir(u)
          : a === "rol" ? clanes.cambiarRol(u, String(b.nombre ?? ""), b.rol as Rol)
          : a === "expulsar" ? clanes.expulsar(u, String(b.nombre ?? ""))
          : a === "buscarGuerra" ? clanes.buscarGuerra(u)
          : a === "cancelarBusqueda" ? clanes.cancelarBusqueda(u)
          : a === "representante" ? clanes.representante(u, b.anotar !== false)
          : a === "quitarRepresentante" ? clanes.quitarRepresentante(u, String(b.nombre ?? ""))
          : a === "anotarCaballo" ? clanes.anotarCaballo(u, Number(b.carrera), String(b.caballoId ?? ""), b.estrategia as Strategy)
          : { ok: false as const, motivo: "No existe." };
        db.anotar(u, `clan:${a}`, r.ok, reloj());
        return responder(res, r.ok ? 200 : 400, r.ok ? { ...r, ...clanes.estado(u), partida: partidaDe(u).partida } : r);
      }
      if (ruta === "GET /api/ranking") {
        const min = RATING.carrerasColocacion;
        const top = db.ranking(50, min).map((f, k) => {
          const r = resumenRating(f, f.carreras);
          return { puesto: k + 1, nombre: f.nombre, rating: r.visible, carreras: f.carreras, division: r.division, yo: f.usuario === u };
        });
        const mio = db.rating(u);
        return responder(res, 200, { ok: true, top, yo: { ...resumenRating(mio, mio.carreras), puesto: db.puesto(u, min), nombre: db.usuario(u)!.nombre } });
      }
      if (ruta === "POST /api/online/cola") {
        const b = await leerCuerpo(req);
        const r = online.entrarCola(u, db.usuario(u)!.nombre, (b.tipo ?? "casual") as TipoOnline);
        return responder(res, r.ok ? 200 : 400, r);
      }
      if (ruta === "POST /api/online/salir") { online.salirCola(u); return responder(res, 200, { ok: true }); }
      if (ruta === "POST /api/online/apostar") {
        const b = await leerCuerpo(req);
        const r = await online.apostar(u, String(b.en ?? ""), Number(b.monto));
        return responder(res, r.ok ? 200 : 400, r.ok ? { ok: true, partida: partidaDe(u).partida } : r);
      }
      if (ruta === "POST /api/online/elegir") {
        const b = await leerCuerpo(req);
        const r = online.elegir(u, String(b.caballoId ?? ""), b.estrategia as Strategy);
        return responder(res, r.ok ? 200 : 400, r);
      }
      return responder(res, 404, { ok: false, motivo: "No existe." });
    } catch (e) {
      console.error(e);
      return responder(res, 500, { ok: false, motivo: "Error del servidor." });
    }
  });
  servidor.on("close", () => { online.parar(); clearInterval(cierres); });
  return { servidor, db, online, mercado, clanes };
}

// Arranque directo: node server/servidor.ts
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const puerto = Number(process.env.PUERTO ?? 8787);
  // --juego: además entrega el juego armado (carpeta dist, hecha con vite build). Lo usa JUGAR_POR_INTERNET.bat.
  const juego = process.argv.includes("--juego") ? fileURLToPath(new URL("../dist", import.meta.url)) : undefined;
  if (juego) {
    try { statSync(join(juego, "index.html")); }
    catch { console.error("[caballos] Falta el juego armado (dist). Corré primero:  npx vite build"); process.exit(1); }
  }
  const { servidor } = crearServidor({ juego });
  servidor.listen(puerto, "127.0.0.1", () => {
    console.log(`[caballos] servidor en http://127.0.0.1:${puerto}`);
    if (juego) {
      console.log(`[caballos] el juego también se abre en http://127.0.0.1:${puerto} (SOLO desde esta compu)`);
      console.log("[caballos] A tus amigos pasales la dirección .trycloudflare.com que aparece en la otra ventana.");
      console.log("[caballos] Esta ventana no se cierra mientras juegan.");
    }
  });
}
