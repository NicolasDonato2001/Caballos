// Interfaz del establo (GDD v0.2 §3, §5, §8.1, §16). React solo dibuja menús; el 3D lo hace Babylon (FichaView).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import razas from "../../config/balance/razas.json";
import { atributos, caballoInicial, descripcionRaza, type Caballo, type EstadoCaballo, type Sexo } from "../domain/caballo.ts";
import { fenotipo } from "../domain/pelaje.ts";
import { capacidad, ocupados, partidaNueva, TECHO_ESTABLO, type Almacen, type Partida, type TipoEdificio } from "../domain/partida.ts";
import { finDelDia, mercadoDelDia, NOMBRE_OFERTA } from "../domain/mercado.ts";
import { composicionHija, COSTO_CRUZA, HORAS_CRECIMIENTO, HORAS_CRUZA, puedeCruzar } from "../domain/crianza.ts";
import { BIENESTAR, cargaDe, herradura, HERRADURAS, nivelRiesgo, riesgoDe, type TipoHerradura } from "../domain/bienestar.ts";
import { linaje as linajeDe, pronosticoCruza, RASGOS, rasgosVisibles } from "../domain/rasgos.ts";
import { indiceDe, objetivoRivales, tierDe, tierDeIndice } from "../domain/tiers.ts";
import { costoNombre, disposicionDe, NOMBRE_CAMPO, NOMBRE_PIEZA, nombreCampo, puedeUbicar } from "../domain/campo.ts";
import { CATALOGO, objeto, puedePoner } from "../domain/decoracion.ts";
import { ASPECTOS, aspecto, NOMBRE_TIPO, tiene, type TipoAspecto } from "../domain/aspecto.ts";
import { bonoMontura, CARRERAS_COMPLETAS, costoAcelerar, diarioDe, finDeLaSemana, gemasConvertiblesHoy, MONTURAS, OBJETIVOS, ORO_POR_GEMA, portador, PRECIO_MONTURA, precioVentaAlJuego, precioSugerido, semanalDe, TIPOS_MONTURA, type TipoMontura, estadoEntrada, PAQUETES_GEMAS } from "../domain/economia.ts";
import { actualizar, clonar, costoMejora, puedeCorrer, lugaresEntrenamiento, lugaresRecuperacion, precioEspacio, proximoFin, puedeEntrenar, topeEntrenamiento, type Suceso } from "../domain/edificios.ts";
import cfgEdificios from "../../config/balance/edificios.json";
import { ejecutar, type ResultadoAccion } from "../domain/acciones.ts";
import * as red from "../red/conexion.ts";
import { APUESTAS } from "../domain/apuestas.ts";
import { MERCADO_JUGADORES, neto, rangoPrecio, validarPublicacion } from "../domain/mercadoJugadores.ts";
import { CLANES, NOMBRE_ROL } from "../domain/clanes.ts";
import { carreraDeToken, correrConToken, proximoToken, quedanHoy, type TokenCarrera } from "../domain/offline.ts";
import carreraCfg from "../../config/balance/carrera.json";
import type { RaceParams } from "../sim/race.ts";
import type { RaceSetup } from "../game/field.ts";
import { Rng } from "../sim/rng.ts";
import type { FichaView } from "../render/fichaView.ts";
import type { CampoView, Seleccion } from "../render/campoView.ts";
import { campeonatoDeLaSemana, ENTRENO_RIVALES_CAMPEONATO, esFinDeSemana, INSCRIPCION_CAMPEONATO, MODOS, NOMBRE_MODO, participantes, PREMIOS_CAMPEONATO, proximoCambioCampeonato, recompensa, registrarCarrera, type Modo } from "../domain/carreras.ts";
import type { Strategy } from "../sim/types.ts";

/** Lo que devuelve la carrera al terminar (lo arma main.ts a partir del simulador). */
export interface ResultadoJugador {
  posicion: number; tiempo: number; diferencia: number; fotoFinal: boolean; seed: number; simVersion: string; lesion?: boolean;
  participantes: number; distancia: number; superficie: string;
}
export interface OpcionesCorrer {
  modo: Modo; participantes: number; distancia: 500 | 1500; superficie: "cesped" | "tierra"; estrategia: Strategy;
  /** Entrenamiento máximo por atributo de los rivales (campeonato). */ entrenoRivales?: number;
}

/** Lo que la interfaz necesita del resto del juego (lo arma main.ts). */
export interface Juego {
  almacen: Almacen;
  ficha: FichaView;
  campo: CampoView;
  /** Qué escena 3D se ve detrás de los menús. */
  mostrar3D(v: "campo" | "ficha"): void;
  /** Corre con ese caballo. `terminada` se llama una vez al completar la carrera (no en repeticiones) y devuelve lo cobrado. */
  correr(c: Caballo, o: OpcionesCorrer, terminada: (r: ResultadoJugador) => { oro: number; bonoTutorial: number; reducido: boolean }, volver: () => void): Promise<void>;
  /** Fase 7: reproduce una carrera que ya simuló (y cobró) el servidor. */
  reproducir(setup: RaceSetup, cobro: red.Cobro, volver: () => void): Promise<void>;
  /** Fase 9: ver una carrera ya corrida (repetición, no cobra). */
  verCarrera(setup: RaceSetup, volver: () => void): Promise<void>;
}

/** Una acción del jugador por nombre (ver domain/acciones.ts): local o en el servidor, según haya cuenta. */
export type Hacer = (nombre: string, args?: Record<string, unknown>) => Promise<ResultadoAccion>;

const ATRIBUTOS = ["Velocidad", "Resistencia", "Potencia", "Temple", "Inteligencia"];
const ESTADOS: Record<EstadoCaballo, string> = {
  disponible: "Disponible", recuperacion: "En recuperación", colaRecuperacion: "En cola de recuperación",
  entrenando: "Entrenando", cruza: "En cruza", creciendo: "Creciendo", publicado: "Publicado en mercado",
};
const SUGERIDOS = ["Pampero", "Lucero", "Malacara", "Tropilla", "Baqueano", "Centella", "Calandria", "Vidala", "Zorzal", "Morena"];

/** Rango visible de un atributo (GDD §6). */
export function rango(v: number): string {
  if (v < 30) return "Muy bajo";
  if (v < 45) return "Bajo";
  if (v < 60) return "Normal";
  if (v < 75) return "Bueno";
  if (v < 85) return "Excelente";
  if (v < 95) return "Superior";
  return "Extraordinario";
}
const miles = (n: number) => n.toLocaleString("es-AR");
const EDIF: Record<TipoEdificio, string> = { establo: "Establo", entrenamiento: "Centro de entrenamiento", recuperacion: "Centro de recuperación" };

/** Tiempo restante legible: 45 s · 12:05 · 2 h 05 min. */
export function restante(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const h = Math.floor(s / 3600), m = Math.ceil((s % 3600) / 60);
  return m === 60 ? `${h + 1} h` : `${h} h ${String(m).padStart(2, "0")} min`;
}

/** Hora actual que se renueva cada segundo (para relojes y barras). */
function useAhora(): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setT(Date.now()), 1000); return () => clearInterval(id); }, []);
  return t;
}

/** Parámetros del simulador (para las carreras offline, que corre el cliente con el token). */
const PARAMS_CARRERA = carreraCfg as unknown as RaceParams;

const NOMBRE_ATR = ["Velocidad", "Resistencia", "Potencia", "Temple", "Inteligencia"];
function textoSuceso(s: Suceso, p: Partida): string {
  const nombre = (id: string) => p.caballos.find((c) => c.id === id)?.nombre ?? "Un caballo";
  if (s.tipo === "mejora") return `${EDIF[s.edificio]}: ¡nivel ${s.nivel}!`;
  if (s.tipo === "recuperado") return `${nombre(s.caballoId)} ya se recuperó y está disponible.`;
  if (s.tipo === "nacimiento") return `¡Nació ${nombre(s.caballoId)}! Crece durante ${HORAS_CRECIMIENTO} h antes de poder entrenar y correr.`;
  if (s.tipo === "crecido") return `${nombre(s.caballoId)} terminó de crecer: ya puede entrenar y correr.`;
  const ganado = s.puntos.map((v, i) => v > 0 ? `+${v} ${NOMBRE_ATR[i]}` : "").filter(Boolean).join(", ");
  return `${nombre(s.caballoId)} terminó de entrenar: ${ganado || "sin cambios"}.`;
}
const rgb = (c: number[]) => `rgb(${c.map((x) => Math.round(x * 255)).join(",")})`;

// ------------------------------------------------------------------ escenario 3D

/** Hueco transparente del layout: el caballo 3D se dibuja ahí (se mide y se le pasa a la cámara). */
function Escenario({ ficha, caballo }: { ficha: FichaView; caballo: Caballo | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => {
      const r = el.getBoundingClientRect();
      ficha.encuadrar({ izquierda: r.left, derecha: window.innerWidth - r.right, arriba: r.top, abajo: window.innerHeight - r.bottom });
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    window.addEventListener("resize", medir);
    document.addEventListener("scroll", medir, true);   // en pantallas angostas la página se desplaza
    return () => { ro.disconnect(); window.removeEventListener("resize", medir); document.removeEventListener("scroll", medir, true); };
  }, [ficha]);
  useEffect(() => { void ficha.mostrar(caballo); }, [ficha, caballo]);
  return <div className="escenario" ref={ref} aria-hidden="true" />;
}

// ------------------------------------------------------------------ aplicación

export function App({ juego }: { juego: Juego }) {
  const [partida, setPartida] = useState<Partida | null>(null);
  const [error, setError] = useState("");
  // Fase 7: con cuenta, la partida vive en el servidor; sin cuenta, en este navegador (como hasta ahora).
  const [sesion, setSesion] = useState<red.Sesion | null>(() => red.sesionGuardada());
  const ultima = useRef(partida);
  ultima.current = partida;

  const [avisos, setAvisos] = useState<{ id: number; texto: string }[]>([]);
  const mostrarSucesos = useCallback((sucesos: unknown, p: Partida) => {
    const l = (Array.isArray(sucesos) ? sucesos : []) as Suceso[];
    if (!l.length) return;
    const nuevos = l.map((x, i) => ({ id: Date.now() + i, texto: textoSuceso(x, p) }));
    setAvisos((a) => [...a, ...nuevos].slice(-4));
    setTimeout(() => setAvisos((a) => a.filter((x) => !nuevos.includes(x))), 7000);
  }, []);

  const cargarLocal = useCallback(() => {
    juego.almacen.cargar()
      .then((p) => setPartida(p ?? partidaNueva()))
      .catch((e) => { console.error(e); setError("No se pudo leer la partida guardada."); setPartida(partidaNueva()); });
  }, [juego]);
  /** Salas online cuya carrera ya se reprodujo. */
  const vistas = useRef(new Set<string>());

  // ---- 7.5: modo offline (con cuenta y sin servidor): carreras Casual con tokens, el Oro se cobra al reconectar
  const [offline, setOffline] = useState(false);
  const enOffline = useRef(offline);
  enOffline.current = offline;
  const [datosOff, setDatosOff] = useState<red.DatosOffline | null>(null);
  const avisar = useCallback((texto: string) => {
    const a = { id: Date.now() + Math.random(), texto };
    setAvisos((l) => [...l, a].slice(-4));
    setTimeout(() => setAvisos((l) => l.filter((x) => x !== a)), 9000);
  }, []);
  const guardarOff = useCallback((s: red.Sesion, d: red.DatosOffline) => { red.guardarOffline(s, d); setDatosOff(d); }, []);
  const renovarTokens = useCallback(async (s: red.Sesion) => {
    const r = await red.pedirTokens(s);
    if (r.ok) guardarOff(s, { ...red.datosOffline(s), tokens: r.tokens });
  }, [guardarOff]);
  /** Pasa al modo offline con la última copia de la partida de la cuenta (si este navegador tiene una). */
  const entrarOffline = useCallback((s: red.Sesion): boolean => {
    const d = red.datosOffline(s);
    setDatosOff(d);
    if (!d.partida) return false;
    setPartida(d.partida);
    setOffline(true);
    return true;
  }, []);
  /** Manda al servidor las carreras corridas sin conexión. "sinServidor" si todavía no hay conexión. */
  const sincronizar = useCallback(async (s: red.Sesion): Promise<Partida | null | "sinServidor"> => {
    const d = red.datosOffline(s);
    if (!d.pendientes.length) return null;
    const r = await red.sincronizarOffline(s, d.pendientes);
    if (!r.ok) {
      if (r.sinServidor) return "sinServidor";
      setError(r.motivo);
      return null;
    }
    guardarOff(s, { tokens: r.tokens, pendientes: [], partida: r.partida });
    const bien = r.resultados.filter((x) => x.ok), mal = r.resultados.filter((x) => !x.ok);
    const oro = bien.reduce((t, x) => t + (x.oro ?? 0), 0);
    avisar(`Se cobraron ${bien.length} ${bien.length === 1 ? "carrera" : "carreras"} sin conexión: +${miles(oro)} Oro.`
      + (mal.length ? ` ${mal.length} no se ${mal.length === 1 ? "pudo" : "pudieron"} validar: ${mal[0].motivo}` : ""));
    return r.partida;
  }, [guardarOff, avisar]);

  useEffect(() => {
    if (!sesion) { cargarLocal(); return; }
    void (async () => {
      // Primero se cobran las carreras offline que hayan quedado de antes
      const sync = await sincronizar(sesion);
      if (sync === "sinServidor") { if (!entrarOffline(sesion)) { setError("No hay conexión con el servidor del juego."); cargarLocal(); } return; }
      const r = await red.leerPartida(sesion);
      if (r.ok) { setPartida(r.partida); setOffline(false); mostrarSucesos(r.sucesos, r.partida); void renovarTokens(sesion); return; }
      if ("sinSesion" in r && r.sinSesion) { setError(r.motivo); red.olvidarSesion(); setSesion(null); return; }
      if ("sinServidor" in r && r.sinServidor && entrarOffline(sesion)) return;
      setError(r.motivo);
      cargarLocal();               // sin servidor y sin copia de la cuenta: se sigue jugando la partida local
    })();
  }, [sesion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Con cuenta, este navegador guarda una copia de la partida para poder seguir sin conexión
  useEffect(() => {
    if (sesion && partida) red.guardarOffline(sesion, { ...red.datosOffline(sesion), partida });
  }, [sesion, partida]);

  // Sin conexión: cada 10 s se prueba si volvió el servidor; si volvió, se cobran las carreras y se sigue online
  useEffect(() => {
    if (!sesion || !offline) return;
    let vivo = true;
    const probar = async () => {
      if (!(await red.servidorDisponible()) || !vivo) return;
      const sync = await sincronizar(sesion);
      if (sync === "sinServidor" || !vivo) return;
      const r = await red.leerPartida(sesion);
      if (!r.ok || !vivo) return;
      setPartida(r.partida);
      setOffline(false);
      void renovarTokens(sesion);
      avisar("Volvió la conexión con el servidor del juego.");
    };
    const id = setInterval(() => void probar(), 10_000);
    return () => { vivo = false; clearInterval(id); };
  }, [sesion, offline, sincronizar, renovarTokens, avisar]);

  /** Solo modo local: guarda en este navegador. */
  const guardar = useCallback((p: Partida) => {
    setPartida(p);
    juego.almacen.guardar(p).catch((e) => { console.error(e); setError("No se pudo guardar la partida."); });
  }, [juego]);

  const hacer: Hacer = useCallback(async (nombre, args = {}) => {
    if (sesion) {
      if (enOffline.current) {
        // Sin conexión solo corre el reloj (recuperaciones, entrenamientos que terminan) sobre la copia local
        if (nombre === "reloj") {
          const q = clonar(ultima.current!);
          const sucesos = actualizar(q, Date.now());
          setPartida(q);
          mostrarSucesos(sucesos, q);
          return { ok: true, sucesos };
        }
        const no = { ok: false as const, motivo: "Sin conexión con el servidor: por ahora solo se pueden correr carreras Casual. Lo demás vuelve al reconectar." };
        setError(no.motivo);
        return no;
      }
      const r = await red.accion(sesion, nombre, args);
      if (!r.ok && "sinServidor" in r && r.sinServidor) {
        // Un corte cortito (pasa con el túnel) no es quedarse sin servidor: se confirma antes de pasar al modo offline
        const vuelve = await red.servidorDisponible() || (await new Promise((t) => setTimeout(t, 2000)), await red.servidorDisponible());
        if (vuelve) { setError("Se cortó la conexión un momento: probá de nuevo."); return r; }
        if (entrarOffline(sesion)) {
          setError("Se perdió la conexión con el servidor: pasaste al modo offline. Podés seguir corriendo carreras Casual.");
          return r;
        }
      }
      if (r.partida) setPartida(r.partida);
      if (!r.ok) { setError(r.motivo); if (r.sinSesion) { red.olvidarSesion(); setSesion(null); } }
      else if (r.partida) mostrarSucesos(r.sucesos, r.partida);
      return r;
    }
    const q = clonar(ultima.current!);
    const r = ejecutar(q, nombre, args, { ahora: Date.now(), rng: new Rng((Math.random() * 4294967296) >>> 0) });
    if (r.ok) { guardar(q); mostrarSucesos(r.sucesos, q); } else setError(r.motivo);
    return r;
  }, [sesion, guardar, mostrarSucesos, entrarOffline]);

  // Reloj: aplica lo que terminó (entrenamientos, recuperaciones, mejoras), también lo ocurrido con el juego cerrado.
  const ahora = useAhora();
  useEffect(() => {
    if (!partida) return;
    const fin = proximoFin(partida);
    if (fin === null || fin > Date.now()) return;
    if (sesion) { void hacer("reloj"); return; }
    const q = clonar(partida);
    const sucesos = actualizar(q, Date.now());
    if (sucesos.length) { guardar(q); mostrarSucesos(sucesos, q); }
  }, [ahora, partida, guardar, sesion, hacer, mostrarSucesos]);

  const quedan = sesion && offline && datosOff ? quedanHoy(datosOff.tokens, ahora) : 0;
  const pendientes = datosOff?.pendientes.length ?? 0;
  const cuenta = <Cuenta sesion={sesion} partida={partida} alEntrar={(s, p) => { setSesion(s); setPartida(p); }}
    offline={sesion && offline ? { quedan, pendientes } : null}
    alSalir={() => { if (sesion) void red.salir(sesion); setSesion(null); setPartida(null); setOffline(false); cargarLocal(); }} />;

  if (!partida) return <div className="cargando">Cargando…</div>;
  return (
    <>
      {error && <div className="aviso" role="alert" onClick={() => setError("")}>{error}</div>}
      {avisos.length > 0 && <div className="avisos" role="status">{avisos.map((a) => <p key={a.id}>{a.texto}</p>)}</div>}
      {partida.caballos.length === 0
        ? <Bienvenida juego={juego} alRecibir={(c) => void hacer("primerCaballo", { nombre: c.nombre, sexo: c.sexo, pelaje: c.pelaje })} cuenta={cuenta} />
        : <Establo juego={juego} partida={partida} guardar={guardar} hacer={hacer} ahora={ahora} alError={setError} cuenta={cuenta}
            online={sesion ? {
              sesion,
              /** 7.2: la carrera entre jugadores llega por aviso del servidor; larga a la misma hora para todos. */
              actualizar: (p) => setPartida(p),
              reproducirOnline: (d, volver) => {
                // La misma carrera puede llegar por el aviso en vivo y por la consulta de respaldo: se ve una sola vez
                if (d.sala) { if (vistas.current.has(d.sala)) return; vistas.current.add(d.sala); }
                setPartida(d.partida);
                const espera = Math.max(0, d.inicio - d.hora);
                setTimeout(() => { void juego.reproducir(d.setup, d.cobro, volver); }, espera);
              },
              offline: offline ? { quedan, token: datosOff ? proximoToken(datosOff.tokens, ahora) : null } : null,
              correr: async (c, o, volver) => {
                if (enOffline.current) {
                  // 7.5: sin conexión, la carrera la arma el token y se corre acá; el servidor la repite al sincronizar
                  const d = red.datosOffline(sesion), t = Date.now();
                  const tk = proximoToken(d.tokens, t);
                  if (!tk) { setError("No te quedan carreras offline para hoy. Las que corriste se cobran cuando vuelva la conexión."); return; }
                  const q = clonar(ultima.current!);
                  const r = correrConToken(q, tk, c.id, o.estrategia, t, PARAMS_CARRERA);
                  if (!r.ok) { setError(r.motivo); return; }
                  if (!red.guardarOffline(sesion, { tokens: d.tokens.filter((x) => x.id !== tk.id), pendientes: [...d.pendientes, { token: tk, caballoId: c.id, estrategia: o.estrategia, jugadoEn: t }], partida: q })) {
                    setError("No se pudo guardar la carrera en este navegador."); return;
                  }
                  setDatosOff(red.datosOffline(sesion));
                  setPartida(q);
                  await juego.reproducir(r.setup, { ...r.cobro, pendiente: true }, volver);
                  return;
                }
                const r = await red.correrEnServidor(sesion, c.id, o.modo, o.estrategia);
                if (!r.ok) { setError(r.motivo); return; }
                setPartida(r.partida);
                await juego.reproducir(r.setup, r.cobro, volver);
              },
            } : null} />}
    </>
  );
}

/** Cuenta (Fase 7): crear una, entrar o salir. Sin cuenta se juega igual, guardado solo en este navegador. */
function Cuenta({ sesion, partida, alEntrar, alSalir, offline }: {
  sesion: red.Sesion | null; partida: Partida | null; alEntrar: (s: red.Sesion, p: Partida) => void; alSalir: () => void;
  /** 7.5: sin conexión con el servidor (carreras offline que quedan hoy y las que esperan cobrarse). */ offline?: { quedan: number; pendientes: number } | null;
}) {
  const [abierta, setAbierta] = useState(false);
  const [modo, setModo] = useState<"crear" | "entrar">("crear");
  const [nombre, setNombre] = useState("");
  const [clave, setClave] = useState("");
  const [subir, setSubir] = useState(true);
  const [error, setError] = useState("");
  const [esperando, setEsperando] = useState(false);
  if (sesion) {
    return (
      <div className="cuenta">
        <span title="Tu partida se guarda en el servidor">👤 {sesion.nombre}</span>
        <button className="enlace" onClick={alSalir}>Salir</button>
        {offline && <p className="sin-conexion" role="status">
          <b>Sin conexión · modo offline.</b> Podés correr carreras Casual ({offline.quedan ? `quedan ${offline.quedan} hoy` : "no quedan más hoy"}).
          {offline.pendientes > 0 ? ` ${offline.pendientes} por cobrar al reconectar.` : " El Oro se cobra al reconectar."}
        </p>}
      </div>
    );
  }
  const enviar = async () => {
    setEsperando(true); setError("");
    const r = modo === "crear" ? await red.crearCuenta(nombre, clave, subir && partida?.caballos.length ? partida : undefined) : await red.entrarCuenta(nombre, clave);
    setEsperando(false);
    if (!r.ok) { setError(r.motivo); return; }
    setAbierta(false); setClave("");
    alEntrar({ token: r.token, nombre: r.nombre }, r.partida);
  };
  return (
    <div className="cuenta">
      <span>Sin cuenta</span>
      <button className="enlace" onClick={() => setAbierta(true)}>Crear cuenta o entrar</button>
      {abierta && (
        <div className="cuenta-fondo" onClick={() => setAbierta(false)}>
          <form className="hoja cuenta-panel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
            <button type="button" className="cerrar" aria-label="Cerrar" onClick={() => setAbierta(false)}>×</button>
            <div className="segmentado">
              <button type="button" className={modo === "crear" ? "on" : ""} onClick={() => setModo("crear")}>Crear cuenta</button>
              <button type="button" className={modo === "entrar" ? "on" : ""} onClick={() => setModo("entrar")}>Entrar</button>
            </div>
            <p className="nota">Con una cuenta tu partida se guarda en el servidor del juego y vas a poder jugar online. Solo pedimos un nombre de usuario y una contraseña.</p>
            <label className="campo"><span>Nombre de usuario</span>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="username" maxLength={20} /></label>
            <label className="campo"><span>Contraseña</span>
              <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete={modo === "crear" ? "new-password" : "current-password"} /></label>
            {modo === "crear" && (partida?.caballos.length ?? 0) > 0 && (
              <label className="check"><input type="checkbox" checked={subir} onChange={(e) => setSubir(e.target.checked)} /> Llevar a la cuenta la partida que tengo en este navegador</label>
            )}
            {error && <p className="aviso-error">{error}</p>}
            <button className="primary ancho" disabled={esperando || nombre.trim().length < 3 || clave.length < (modo === "crear" ? 8 : 1)}>
              {esperando ? "Un momento…" : modo === "crear" ? "Crear cuenta" : "Entrar"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function Bienvenida({ juego, alRecibir, cuenta }: { juego: Juego; alRecibir: (c: Caballo) => void; cuenta: ReactNode }) {
  // Tres Criollos con los mismos atributos (GDD §5.4) y pelajes distintos: la estética no da ventajas.
  const opciones = useMemo(() => {
    const rng = new Rng((Math.random() * 4294967296) >>> 0);
    const vistos = new Set<string>();
    const out: Caballo[] = [];
    for (let k = 0; k < 40 && out.length < 3; k++) {
      const c = caballoInicial(rng, "", "macho");
      const n = fenotipo(c.pelaje).nombre;
      if (!vistos.has(n)) { vistos.add(n); out.push(c); }
    }
    return out;
  }, []);
  const [elegido, setElegido] = useState(0);
  const [nombre, setNombre] = useState(() => SUGERIDOS[Math.floor(Math.random() * SUGERIDOS.length)]);
  const [sexo, setSexo] = useState<Sexo>("macho");
  const limpio = nombre.trim().replace(/\s+/g, " ");
  const valido = limpio.length >= 2 && limpio.length <= 20;
  const actual = opciones[elegido];
  const attrs = razas.caballoInicial.attrs;

  return (
    <div className="layout bienvenida">
      <Escenario ficha={juego.ficha} caballo={actual} />
      <section className="hoja derecha">
        {cuenta}
        <div className="eyebrow">Tu primer caballo</div>
        <h1>Un Criollo para empezar</h1>
        <p className="muted">Duro y constante, ideal para aprender. Elegí su nombre, su sexo y su pelaje: nada de esto cambia cómo corre.</p>
        <label className="campo">
          <span>Nombre</span>
          <input value={nombre} maxLength={20} onChange={(e) => setNombre(e.target.value)} autoComplete="off" />
        </label>
        {!valido && <p className="error">El nombre debe tener entre 2 y 20 letras.</p>}
        <div className="campo">
          <span>Sexo</span>
          <div className="segmentado">
            {(["macho", "hembra"] as Sexo[]).map((s) => (
              <button key={s} className={s === sexo ? "on" : ""} onClick={() => setSexo(s)}>{s === "macho" ? "Macho" : "Hembra"}</button>
            ))}
          </div>
        </div>
        <div className="campo">
          <span>Pelaje</span>
          <div className="pelajes">
            {opciones.map((c, i) => {
              const f = fenotipo(c.pelaje);
              return (
                <button key={c.id} className={i === elegido ? "on" : ""} onClick={() => setElegido(i)}>
                  <i style={{ background: rgb(f.cuerpo), borderColor: rgb(f.crin) }} />{f.nombre}
                </button>
              );
            })}
          </div>
        </div>
        <h3>Atributos</h3>
        {attrs.map((v, i) => <Barra key={i} nombre={ATRIBUTOS[i]} natural={v} entreno={0} techo={actual?.techo[i] ?? v} />)}
        <p className="nota">Para criar vas a necesitar un caballo del sexo opuesto: el mercado siempre ofrece al menos un macho y una hembra.</p>
        <button className="primary ancho" disabled={!valido || !actual}
          onClick={() => actual && alRecibir({ ...actual, nombre: limpio, sexo, creado: Date.now() })}>
          Recibir a {valido ? limpio : "tu caballo"}
        </button>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ establo

function Establo({ juego, partida, guardar, hacer, ahora, alError, cuenta, online }: {
  juego: Juego; partida: Partida; guardar: (p: Partida) => void; hacer: Hacer; ahora: number; alError: (m: string) => void; cuenta: ReactNode;
  /** Con cuenta: la carrera la corre el servidor. */
  online: {
    sesion: red.Sesion;
    correr: (c: Caballo, o: OpcionesCorrer, volver: () => void) => Promise<void>;
    reproducirOnline: (d: red.CarreraOnline, volver: () => void) => void;
    /** 7.4: la partida que devuelve el servidor (por ejemplo, después de apostar). */ actualizar: (p: Partida) => void;
    /** 7.5: sin conexión: carreras offline que quedan hoy y el próximo token. */ offline: { quedan: number; token: TokenCarrera | null } | null;
  } | null;
}) {
  const [selId, setSelId] = useState(partida.caballos[0]?.id ?? "");
  const [vista, setVista] = useState<"caballos" | "edificios">("caballos");
  const [pantalla, setPantalla] = useState<"campo" | "caballos" | "carreras" | "mercado" | "objetivos" | "clan">("campo");
  const [pestanaMercado, setPestanaMercado] = useState<PestanaMercado>("caballos");
  const [decorarCon, setDecorarCon] = useState<string | null>(null);
  const irMercado = (t: PestanaMercado) => { setPestanaMercado(t); setPantalla("mercado"); };
  useEffect(() => { juego.mostrar3D(pantalla === "campo" || pantalla === "objetivos" || pantalla === "clan" ? "campo" : "ficha"); }, [juego, pantalla]);
  const [borrando, setBorrando] = useState(false);
  const [creditos, setCreditos] = useState(false);
  const sel = partida.caballos.find((c) => c.id === selId) ?? partida.caballos[0] ?? null;
  const cap = capacidad(partida);
  const techo = TECHO_ESTABLO[partida.edificios.establo.nivel];
  // La carrera termina mientras esta pantalla está oculta: siempre se actualiza sobre la última partida.
  const ultima = useRef(partida);
  ultima.current = partida;

  const correr = (c: Caballo, o: OpcionesCorrer) => {
    if (online) { void online.correr(c, o, () => setPantalla("campo")); return; }
    void juego.correr(c, o, (r) => {
      const q = clonar(ultima.current);
      const cobro = registrarCarrera(q, {
        modo: o.modo, distancia: r.distancia, superficie: r.superficie, caballoId: c.id, caballoNombre: c.nombre, estrategia: o.estrategia,
        posicion: r.posicion, participantes: r.participantes, tiempo: r.tiempo, diferencia: r.diferencia, fotoFinal: r.fotoFinal,
        seed: r.seed, simVersion: r.simVersion, ...(r.lesion ? { lesion: true } : {}),
      }, Date.now());
      guardar(q);
      return cobro;
    }, () => setPantalla("campo"));
  };
  const entrenar = (c: Caballo) => hacer("entrenar", { id: c.id });

  if (pantalla === "campo") {
    return <Campo juego={juego} partida={partida} ahora={ahora} hacer={hacer} cuenta={cuenta}
      alVerCaballos={(id) => { if (id) setSelId(id); setVista("caballos"); setPantalla("caballos"); }}
      alCarreras={() => setPantalla("carreras")} alMercado={() => irMercado("caballos")} alMercadoDeco={() => irMercado("decoracion")} alObjetivos={() => setPantalla("objetivos")} alClan={() => setPantalla("clan")}
      decorarCon={decorarCon} alDecorarIniciado={() => setDecorarCon(null)} />;
  }
  if (pantalla === "objetivos") {
    return <Objetivos partida={partida} ahora={ahora} hacer={hacer} alVolver={() => setPantalla("campo")} />;
  }
  if (pantalla === "clan") {
    return <PantallaClan juego={juego} partida={partida} ahora={ahora} alVolver={() => setPantalla("campo")}
      enLinea={online && !online.offline ? { sesion: online.sesion, alPartida: online.actualizar } : null} />;
  }
  if (pantalla === "mercado") {
    return <MercadoJuego juego={juego} partida={partida} ahora={ahora} hacer={hacer} alVolver={() => setPantalla("campo")}
      jugadores={online && !online.offline ? { sesion: online.sesion, alPartida: online.actualizar } : null}
      pestana={pestanaMercado} alPestana={setPestanaMercado}
      alVerCaballo={(id) => { setSelId(id); setVista("caballos"); setPantalla("caballos"); }}
      alPonerDeco={(id) => { setDecorarCon(id); setPantalla("campo"); }} />;
  }
  if (pantalla === "carreras") {
    return <Carreras juego={juego} partida={partida} ahora={ahora} hacer={hacer} inicial={sel?.id} offline={online?.offline ?? null}
      enLinea={online ? { sesion: online.sesion, alCarrera: (d) => online.reproducirOnline(d, () => setPantalla("campo")), alPartida: online.actualizar } : null}
      alVolver={() => setPantalla("campo")} alCorrer={correr} />;
  }

  return (
    <div className="layout establo">
      <section className="hoja izquierda">
        <header className="cabecera">
          <div>
            <button className="volver" onClick={() => setPantalla("campo")}>← Campo</button>
            <h1>{vista === "caballos" ? "Mis caballos" : "Edificios"}</h1>
          </div>
          <div className="monedas">
            <span title="Oro"><i className="oro" />{miles(partida.oro)}</span>
            <span title="Gemas"><i className="gema" />{miles(partida.gemas)}</span>
          </div>
        </header>
        <div className="segmentado pestanas">
          <button className={vista === "caballos" ? "on" : ""} onClick={() => setVista("caballos")}>Caballos</button>
          <button className={vista === "edificios" ? "on" : ""} onClick={() => setVista("edificios")}>Edificios</button>
        </div>
        {vista === "caballos" ? (
          <>
            <div className="fila-capacidad">
              <p className="capacidad">{ocupados(partida)} de {cap} espacios ocupados <small>· máximo del nivel: {techo}</small></p>
              <button className="secundario chico" onClick={() => irMercado("caballos")}>Comprar caballo</button>
            </div>
            <ul className="lista">
              {partida.caballos.map((c) => {
                const f = fenotipo(c.pelaje);
                return (
                  <li key={c.id}>
                    <button className={`tarjeta ${sel?.id === c.id ? "on" : ""}`} onClick={() => setSelId(c.id)}>
                      <i className="muestra" style={{ background: rgb(f.cuerpo), borderColor: rgb(f.crin) }} />
                      <span className="t-nombre">{c.nombre}</span>
                      <span className="t-sub">{descripcionRaza(c.composicion)} · {c.sexo === "macho" ? "Macho" : "Hembra"}</span>
                      <span className={`estado e-${c.estado}`}>{ESTADOS[c.estado]}{c.finEstado ? ` · ${restante(c.finEstado - ahora)}` : ""}</span>
                    </button>
                  </li>
                );
              })}
              {partida.cruza && (
                <li><div className="tarjeta reservado">
                  <span className="t-nombre">Potrillo en camino</span>
                  <span className="t-sub">Hijo de {partida.caballos.find((c) => c.id === partida.cruza!.padreId)?.nombre} y {partida.caballos.find((c) => c.id === partida.cruza!.madreId)?.nombre}</span>
                  <span className="estado e-cruza">Nace en {restante(partida.cruza.fin - ahora)}</span>
                  <button className="acelerar" disabled={partida.gemas < costoAcelerar(partida.cruza.fin - ahora)}
                    onClick={() => hacer("acelerarCruza")}>Que nazca ya · <i className="gema" />{costoAcelerar(partida.cruza.fin - ahora)}</button>
                </div></li>
              )}
              {Array.from({ length: Math.max(0, cap - ocupados(partida)) }, (_, i) => (
                <li key={`libre${i}`}><div className="tarjeta libre">Espacio libre</div></li>
              ))}
            </ul>
          </>
        ) : (
          <Edificios partida={partida} ahora={ahora} hacer={hacer} />
        )}
        <div className="pie">
          <button className="enlace" onClick={() => setCreditos((v) => !v)}>Créditos</button>
          {creditos && (
            <p className="creditos">
              Modelo base del caballo: «Low Poly Horse Standing», de LowPolyFigures (Printables), licencia{" "}
              <a href="https://creativecommons.org/licenses/by/4.0/deed.es" target="_blank" rel="noreferrer">CC BY 4.0</a>.
              Modificado para el juego: esqueleto, ocho razas, pelajes y animaciones.
            </p>
          )}
          {!borrando
            ? <button className="enlace" onClick={() => setBorrando(true)}>Empezar una partida nueva</button>
            : <span className="confirmar">Se borra todo el progreso.
                <button className="peligro" onClick={() => { if (online) { alError("Con cuenta, la partida está en el servidor: no se borra desde acá."); setBorrando(false); return; } void juego.almacen.borrar().then(() => guardar(partidaNueva())); setBorrando(false); }}>Borrar</button>
                <button className="enlace" onClick={() => setBorrando(false)}>Cancelar</button></span>}
        </div>
      </section>
      <Escenario ficha={juego.ficha} caballo={sel} />
      {sel && <Ficha caballo={sel} partida={partida} ahora={ahora} alCorrer={() => setPantalla("carreras")} alEntrenar={() => entrenar(sel)}
        alDetener={() => hacer(sel.estado === "entrenando" ? "detenerEntrenamiento" : "sacarDeRecuperacion", { id: sel.id })}
        alLiberar={() => hacer("liberar", { id: sel.id })}
        alCruzar={(parejaId, nombre) => hacer("cruzar", { padreId: sel.sexo === "macho" ? sel.id : parejaId, madreId: sel.sexo === "macho" ? parejaId : sel.id, nombre })}
        alVer={(id) => setSelId(id)}
        alHerrar={(id) => hacer("herrar", { id: sel.id, tipo: id })}
        alAcelerar={() => sel.estado === "cruza" ? hacer("acelerarCruza") : hacer("acelerarCaballo", { id: sel.id })}
        alMontura={(m) => hacer("equiparMontura", { id: sel.id, monturaId: m })}
        alVender={() => hacer("venderAlJuego", { id: sel.id })}
        alVestir={(t, id) => hacer("vestir", { id: sel.id, tipo: t, aspecto: id })}
        alPintarMontura={(m, id) => hacer("pintarMontura", { monturaId: m, aspecto: id })} />}
    </div>
  );
}

// ------------------------------------------------------------------ edificios

function Progreso({ inicio, fin, ahora, texto, gemas, alAcelerar }: {
  inicio: number; fin: number; ahora: number; texto: string; gemas?: number; alAcelerar?: () => void;
}) {
  const f = Math.min(1, Math.max(0, (ahora - inicio) / Math.max(1, fin - inicio)));
  const costo = costoAcelerar(fin - ahora);
  return (
    <div className="progreso">
      <div className="bar"><i style={{ width: `${f * 100}%` }} /></div>
      <span>{texto} · faltan {restante(fin - ahora)}</span>
      {alAcelerar && fin > ahora && (
        <button className="acelerar" disabled={(gemas ?? 0) < costo} onClick={alAcelerar} title="1 Gema por cada 30 minutos que faltan">
          Terminar ya · <i className="gema" />{costo}
        </button>
      )}
    </div>
  );
}

/** «Terminar ya» con Gemas para un tiempo que no tiene barra (descanso en cola o después de salir antes). */
function BotonAcelerar({ ms, gemas, alAcelerar, texto }: { ms: number; gemas: number; alAcelerar: () => void; texto: string }) {
  const costo = costoAcelerar(ms);
  return (
    <button className="acelerar" disabled={gemas < costo} onClick={alAcelerar} title="1 Gema por cada 30 minutos que faltan">
      {texto} · <i className="gema" />{costo}
    </button>
  );
}

function Edificios({ partida, ahora, hacer }: { partida: Partida; ahora: number; hacer: Hacer }) {
  return (
    <div className="edificios">
      {(Object.keys(EDIF) as TipoEdificio[]).map((t) => <TarjetaEdificio key={t} tipo={t} partida={partida} ahora={ahora} hacer={hacer} />)}
    </div>
  );
}

function TarjetaEdificio({ tipo: t, partida: p, ahora, hacer }: { tipo: TipoEdificio; partida: Partida; ahora: number; hacer: Hacer }) {
  const cuantos = (e: Caballo["estado"]) => p.caballos.filter((c) => c.estado === e).length;
  const detalle: Record<TipoEdificio, string[]> = {
    establo: [`Capacidad: ${capacidad(p)} espacios`, `Máximo con este nivel: ${TECHO_ESTABLO[p.edificios.establo.nivel]}`],
    entrenamiento: [`Lugares: ${cuantos("entrenando")} de ${lugaresEntrenamiento(p)} ocupados`, `Tope por atributo: +${topeEntrenamiento(p)} puntos`],
    recuperacion: [`Lugares: ${cuantos("recuperacion")} de ${lugaresRecuperacion(p)} ocupados`, `En cola: ${cuantos("colaRecuperacion")}`],
  };
  const precio = precioEspacio(p);
  const e = p.edificios[t];
  const c = costoMejora(e.nivel);
  return (
    <article className="edificio">
      <header><b>{EDIF[t]}</b><span className="nivel">Nivel {e.nivel}</span></header>
      {detalle[t].map((d) => <p key={d}>{d}</p>)}
      {e.mejoraFin !== null && c
        ? <Progreso inicio={e.mejoraFin - c.minutos * 60_000} fin={e.mejoraFin} ahora={ahora} texto={`Mejorando a nivel ${e.nivel + 1}`}
            gemas={p.gemas} alAcelerar={() => hacer("acelerarMejora", { tipo: t })} />
        : c
          ? <button className="secundario" disabled={p.oro < c.oro} onClick={() => hacer("mejorar", { tipo: t })}>
              Mejorar a nivel {e.nivel + 1} · {miles(c.oro)} Oro · {c.minutos < 60 ? `${c.minutos} min` : `${c.minutos / 60} h`}
            </button>
          : <p className="max">Nivel máximo</p>}
      {t === "establo" && (precio !== null
        ? <div className="dos">
            <button className="secundario" disabled={p.oro < precio} onClick={() => hacer("comprarEspacio", { moneda: "oro" })}>Comprar espacio · {miles(precio)} Oro</button>
            <button className="secundario" disabled={p.gemas < cfgEdificios.establo.precioEspacioGemas} onClick={() => hacer("comprarEspacio", { moneda: "gemas" })}>{cfgEdificios.establo.precioEspacioGemas} Gemas</button>
          </div>
        : capacidad(p) < 20 && <p className="nota">Mejorá el establo para comprar más espacios.</p>)}
    </article>
  );
}

// ------------------------------------------------------------------ campo

const QUIEN: Record<TipoEdificio, Caballo["estado"][]> = {
  establo: ["disponible"], entrenamiento: ["entrenando"], recuperacion: ["recuperacion", "colaRecuperacion"],
};

function Campo({ juego, partida: p, ahora, hacer, cuenta, alVerCaballos, alCarreras, alMercado, alMercadoDeco, alObjetivos, alClan, decorarCon, alDecorarIniciado }: {
  juego: Juego; partida: Partida; ahora: number; hacer: Hacer; cuenta: ReactNode; alVerCaballos: (id?: string) => void;
  alCarreras: () => void; alMercado: () => void; alMercadoDeco: () => void; alObjetivos: () => void; alClan: () => void; decorarCon: string | null; alDecorarIniciado: () => void;
}) {
  const [elegido, setElegido] = useState<TipoEdificio | null>(null);
  const capa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    juego.campo.alElegir = (t) => setElegido(t);
    juego.campo.ponerCapa(capa.current);
    return () => { juego.campo.alElegir = () => {}; juego.campo.ponerCapa(null); };
  }, [juego]);
  useEffect(() => { void juego.campo.mostrarCaballos(p.caballos); }, [juego, p.caballos]);
  // Carteles sobre los edificios: nombre, nivel y qué está pasando
  useEffect(() => {
    for (const t of Object.keys(EDIF) as TipoEdificio[]) {
      const e = p.edificios[t];
      const enUso = p.caballos.filter((c) => QUIEN[t].includes(c.estado)).length;
      const estado = e.mejoraFin !== null ? `Mejorando · ${restante(e.mejoraFin - ahora)}`
        : t === "establo" ? `${ocupados(p)}/${capacidad(p)} caballos`
        : t === "entrenamiento" ? `${enUso}/${lugaresEntrenamiento(p)} entrenando`
        : `${enUso} descansando`;
      juego.campo.textoCartel(t, `<b>${EDIF[t]}</b><span>Nivel ${e.nivel} · ${estado}</span>`);
    }
  }, [juego, p, ahora]);

  // ---- mover y poner cosas como en Clash of Clans (§11.5, §24.4): tocar elige, arrastrar mueve, soltar deja
  const [sel, setSel] = useState<Seleccion | null>(null);
  const [colocando, setColocando] = useState<{ id: string; rot: 0 | 1 | 2 | 3 } | null>(null);
  const [celda, setCelda] = useState<[number, number] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const botonera = useRef<HTMLDivElement>(null);
  const puestos = p.decoracion?.puestos ?? [];
  const deposito = p.decoracion?.deposito ?? {};
  const bloqueadas = () => juego.campo.celdasBloqueadas();
  const rotar = (r: number) => ((r + 1) % 4) as 0 | 1 | 2 | 3;
  useEffect(() => { void juego.campo.mostrarDecoracion(puestos); }, [juego, puestos]);
  useEffect(() => { juego.campo.aplicarDisposicion(disposicionDe(p)); }, [juego, p.disposicion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    juego.campo.ponerBotonera(botonera.current);
    juego.campo.alSeleccionar = (s) => { setSel(s); setAviso(null); setElegido(null); };
    juego.campo.alMoverNuevo = (cx, cz) => setCelda([cx, cz]);
    return () => { juego.campo.ponerBotonera(null); juego.campo.ponerNuevo(null); juego.campo.seleccionar(null, false); };
  }, [juego]);
  // Las reglas y lo que pasa al soltar usan siempre la partida actual
  useEffect(() => {
    juego.campo.validarPieza = (pz, u) => puedeUbicar(disposicionDe(p), pz, u).ok;
    juego.campo.validarDeco = (id, cx, cz, rot, uid) => puedePoner(p, id, cx, cz, rot as 0 | 1 | 2 | 3, bloqueadas(), uid).ok;
    juego.campo.alSoltarPieza = (pz, u) => {
      void hacer("moverPieza", { pieza: pz, ...u }).then((r) => {
        const g = r.ok ? Number(r.guardados ?? 0) : 0;
        setAviso(g > 0 ? `${g} adorno${g > 1 ? "s" : ""} que quedaban debajo pasaron al depósito.` : null);
      });
    };
    juego.campo.alSoltarDeco = (uid, cx, cz) => {
      const x = puestos.find((q) => q.uid === uid);
      if (x) hacer("moverObjeto", { uid, cx, cz, rot: x.rot, ocupacion: [...bloqueadas()] });
    };
  }, [juego, p]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    juego.campo.ponerNuevo(colocando?.id ?? null, colocando?.rot ?? 0, celda?.[0], celda?.[1]);
    setCelda(juego.campo.celdaNuevo);
  }, [juego, colocando]); // eslint-disable-line react-hooks/exhaustive-deps
  // Desde el Mercado: con un objeto, aparece en el campo para ubicarlo; sin objeto, solo explica cómo acomodar.
  useEffect(() => {
    if (decorarCon === null) return;
    setElegido(null); setCelda(null);
    if (decorarCon) { setColocando({ id: decorarCon, rot: 0 }); setAviso(null); }
    else { setColocando(null); setAviso("Tocá un adorno, un edificio, el potrero o el molino para elegirlo, y arrastralo para moverlo. Se deja donde lo soltás."); }
    alDecorarIniciado();
  }, [decorarCon]); // eslint-disable-line react-hooks/exhaustive-deps

  const okNuevo = colocando && celda ? puedePoner(p, colocando.id, celda[0], celda[1], colocando.rot, bloqueadas()) : null;
  const selDeco = sel?.tipo === "deco" ? puestos.find((x) => x.uid === sel.uid) ?? null : null;
  const selPieza = sel?.tipo === "pieza" ? sel.pieza : null;
  const nuevoObj = colocando ? objeto(colocando.id) : null;
  const gratis = !!nuevoObj && (deposito[nuevoObj.id] ?? 0) > 0;
  const entrada = estadoEntrada(clonar(p), ahora);
  const decorar = !!colocando;

  const caballosDe = elegido ? p.caballos.filter((c) => QUIEN[elegido].includes(c.estado)) : [];
  return (
    <div className="campo-ui">
      <div className="carteles" ref={capa} />
      <header className="hoja campo-cabecera">
        <div>
          <div className="eyebrow">Mi establecimiento</div>
          <h1>{nombreCampo(p)}</h1>
          {cuenta}
        </div>
        <div className="monedas">
          <span title="Oro"><i className="oro" />{miles(p.oro)}</span>
          <span title="Gemas"><i className="gema" />{miles(p.gemas)}</span>
        </div>
      </header>
      {!decorar && entrada.disponible && (
        <section className="hoja recompensa-diaria">
          <div className="eyebrow">Recompensa por entrar · día {entrada.dia} de 7</div>
          <b>+{miles(entrada.oro)} Oro{entrada.gemas ? ` y ${entrada.gemas} Gemas` : ""}</b>
          <button className="primary" onClick={() => hacer("cobrarEntrada")}>Cobrar</button>
        </section>
      )}
      {!decorar && <div className="campo-botones">
        <button className="primary" onClick={() => alVerCaballos()}>Caballos</button>
        <button className="primary dorado" onClick={alCarreras}>Carreras</button>
        <button className="primary" onClick={alMercado}>Mercado</button>
        <button className="primary" onClick={alClan}>Clan</button>
        <button className="primary" onClick={alObjetivos}>Objetivos{OBJETIVOS.some((o) => { const s = semanalDe(clonar(p), ahora); return s[o.id] >= o.meta && !s.cobrados.includes(o.id); }) ? " ●" : ""}</button>

        <button className="redondo" aria-label="Acercar" onClick={() => juego.campo.acercar(0.85)}>+</button>
        <button className="redondo" aria-label="Alejar" onClick={() => juego.campo.acercar(1.18)}>−</button>
      </div>}
      {decorar && <div className="campo-botones">
        <button className="redondo" aria-label="Acercar" onClick={() => juego.campo.acercar(0.85)}>+</button>
        <button className="redondo" aria-label="Alejar" onClick={() => juego.campo.acercar(1.18)}>−</button>
      </div>}
      {/* Botonera flotante sobre el objeto (la ubica la vista 3D) */}
      <div className="botonera-3d" ref={botonera}>
        {colocando && nuevoObj ? (
          <>
            <div className="bt-titulo">{nuevoObj.nombre}{okNuevo && !okNuevo.ok ? <small className="bt-error">{okNuevo.motivo}</small> : <small>Arrastralo o tocá dónde va</small>}</div>
            <div className="bt-fila">
              <button className="bt bt-no" aria-label="Cancelar" onClick={() => { setColocando(null); setCelda(null); }}>✕</button>
              <button className="bt" aria-label="Girar" onClick={() => setColocando({ ...colocando, rot: rotar(colocando.rot) })}>⟳</button>
              <button className="bt bt-si" aria-label="Comprar" disabled={!okNuevo?.ok} onClick={() => {
                if (!celda) return;
                hacer("ponerObjeto", { id: colocando.id, cx: celda[0], cz: celda[1], rot: colocando.rot, ocupacion: [...bloqueadas()] });
                setColocando(null); setCelda(null);
              }}>✓ {gratis ? "Gratis" : nuevoObj.gemas !== undefined ? <><i className="gema" />{nuevoObj.gemas}</> : <><i className="oro" />{miles(nuevoObj.oro ?? 0)}</>}</button>
            </div>
          </>
        ) : selDeco ? (
          <>
            <div className="bt-titulo">{objeto(selDeco.id)?.nombre}<small>Arrastralo para moverlo</small></div>
            <div className="bt-fila">
              <button className="bt" aria-label="Girar" onClick={() => hacer("moverObjeto", { uid: selDeco.uid, cx: selDeco.cx, cz: selDeco.cz, rot: rotar(selDeco.rot), ocupacion: [...bloqueadas()] })}>⟳</button>
              <button className="bt" aria-label="Guardar en el depósito" title="Guardar en el depósito (se vuelve a poner gratis)" onClick={() => { hacer("guardarObjeto", { uid: selDeco.uid }); juego.campo.seleccionar(null); }}>📦</button>
            </div>
          </>
        ) : selPieza ? (
          <>
            <div className="bt-titulo">{NOMBRE_PIEZA[selPieza]}<small>Arrastralo para moverlo</small></div>
            <div className="bt-fila">
              <button className="bt" aria-label="Girar" onClick={() => { const u = disposicionDe(p)[selPieza]; juego.campo.alSoltarPieza(selPieza, { ...u, rot: rotar(u.rot) }); }}>⟳</button>
            </div>
          </>
        ) : null}
      </div>
      {aviso && !decorar && (
        <div className="aviso-campo" role="status">{aviso}<button className="enlace" onClick={() => setAviso(null)}>Entendido</button></div>
      )}
      {elegido && !decorar && (
        <section className="hoja derecha panel-edificio">
          <button className="cerrar" aria-label="Cerrar" onClick={() => setElegido(null)}>×</button>
          <TarjetaEdificio tipo={elegido} partida={p} ahora={ahora} hacer={hacer} />
          <h3>{elegido === "establo" ? "Disponibles" : elegido === "entrenamiento" ? "Entrenando" : "Recuperándose"}</h3>
          {caballosDe.length === 0 && <p className="nota">{elegido === "establo" ? "No hay caballos disponibles ahora." : "Ninguno por ahora."}</p>}
          <ul className="lista">
            {caballosDe.map((c) => (
              <li key={c.id}>
                <button className="tarjeta" onClick={() => alVerCaballos(c.id)}>
                  <i className="muestra" style={{ background: rgb(fenotipo(c.pelaje).cuerpo), borderColor: rgb(fenotipo(c.pelaje).crin) }} />
                  <span className="t-nombre">{c.nombre}</span>
                  <span className="t-sub">{descripcionRaza(c.composicion)}</span>
                  <span className={`estado e-${c.estado}`}>{ESTADOS[c.estado]}{c.finEstado ? ` · ${restante(c.finEstado - ahora)}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
          {elegido === "establo" && <button className="primary ancho" onClick={() => alVerCaballos()}>Ver todos mis caballos</button>}
          {elegido === "entrenamiento" && <p className="nota">Elegí un caballo y tocá «Entrenar» en su ficha. Cada sesión dura {cfgEdificios.entrenamiento.minutos} min.</p>}
          {elegido === "recuperacion" && <p className="nota">Después de cada carrera los caballos descansan acá: 15 min tras 500 m y 30 min tras 1.500 m.</p>}
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ carreras (§9.1)

const ESTRATEGIAS: { id: Strategy; nombre: string; texto: string }[] = [
  { id: "agresiva", nombre: "Agresiva", texto: "Busca la cuerda y la posición con decisión" },
  { id: "equilibrada", nombre: "Equilibrada", texto: "Ritmo estándar, sin modificadores" },
  { id: "conservadora", nombre: "Conservadora", texto: "Guarda reserva y acelera en el final" },
];

function Carreras({ juego, partida: p, ahora, hacer, inicial, alVolver, alCorrer, enLinea, offline }: {
  juego: Juego; partida: Partida; ahora: number; hacer: Hacer; inicial?: string;
  /** 7.5: sin conexión solo hay Casual, con la distancia del token. */ offline: { quedan: number; token: TokenCarrera | null } | null;
  /** 7.2: con cuenta, carreras contra otros jugadores. */ enLinea: { sesion: red.Sesion; alCarrera: (d: red.CarreraOnline) => void; alPartida: (p: Partida) => void } | null;
  alVolver: () => void; alCorrer: (c: Caballo, o: OpcionesCorrer) => void;
}) {
  const [modo, setModo] = useState<Modo>("casual");
  const [estrategia, setEstrategia] = useState<Strategy>("equilibrada");
  const listos = p.caballos.filter((c) => puedeCorrer(c, ahora).ok);
  // Se muestra un caballo aunque ninguno esté listo, para que el centro no quede vacío; correr exige que esté listo.
  const [selId, setSelId] = useState(() => (listos.find((c) => c.id === inicial) ?? listos[0] ?? p.caballos[0])?.id ?? "");
  const sel = p.caballos.find((c) => c.id === selId) ?? null;
  const camp = campeonatoDeLaSemana(p, ahora);
  const abierto = esFinDeSemana(ahora);
  const campListo = !!camp && !camp.corrido;
  // En el campeonato la distancia es la de la inscripción; en los otros modos, la del sorteo pendiente.
  const tokenCarrera = offline?.token ? carreraDeToken(offline.token.seed) : undefined;
  const sorteo = offline ? tokenCarrera : modo === "campeonato" ? (campListo ? camp : undefined) : p.sorteo;
  useEffect(() => { if (offline && modo !== "casual") setModo("casual"); }, [offline, modo]);
  const inscribir = () => { void hacer("inscribirCampeonato"); };
  const sortear = () => { void hacer("sortearCarrera"); };
  const dist = (d: number) => d === 500 ? "500 m" : "1.500 m";
  const historial = (p.historial ?? []).slice(0, 8);
  return (
    <div className="layout establo">
      <section className="hoja izquierda">
        <button className="volver" onClick={alVolver}>← Campo</button>
        <h1>Carreras</h1>
        <h3>1 · Modo</h3>
        <div className="modos">
          {MODOS.map((m) => (
            <button key={m} className={`modo ${m === modo ? "on" : ""}`} onClick={() => setModo(m)}>
              <b>{NOMBRE_MODO[m]}</b><span>{participantes(m)} caballos contra la IA</span>
              <small>1.º: {recompensa(m, 500, 1)} Oro (500 m) · {recompensa(m, 1500, 1)} Oro (1.500 m)</small>
            </button>
          ))}
          <button className={`modo online ${modo === "online" ? "on" : ""}`} disabled={!!offline} onClick={() => setModo("online")}>
            <b>Online casual</b><span>De 2 a 8 jugadores (bots completan) · no cambia tu rating</span>
            <small>{enLinea ? `1.º: ${recompensa("online", 500, 1)} Oro (500 m) · ${recompensa("online", 1500, 1)} Oro (1.500 m)` : "Necesitás una cuenta (en el campo: «Crear cuenta o entrar»)"}</small>
          </button>
          <button className={`modo ranked ${modo === "ranked" ? "on" : ""}`} disabled={!!offline} onClick={() => setModo("ranked")}>
            <b>Ranked</b><span>Al menos 4 jugadores · suma o resta rating · divisiones y ranking</span>
            <small>{enLinea ? `1.º: ${recompensa("ranked", 500, 1)} Oro (500 m) · ${recompensa("ranked", 1500, 1)} Oro (1.500 m)` : "Necesitás una cuenta (en el campo: «Crear cuenta o entrar»)"}</small>
          </button>
          <button className={`modo campeonato ${modo === "campeonato" ? "on" : ""}`} disabled={!!offline} onClick={() => setModo("campeonato")}>
            <b>Campeonato semanal</b><span>12 caballos · rivales entrenados · fin de semana</span>
            <small>{PREMIOS_CAMPEONATO[0].toLocaleString("es-AR")} · {PREMIOS_CAMPEONATO[1].toLocaleString("es-AR")} · {PREMIOS_CAMPEONATO[2].toLocaleString("es-AR")} Oro al podio · inscripción {INSCRIPCION_CAMPEONATO} Oro</small>
          </button>
        </div>
        <p className="nota">Hoy: {Math.min(diarioDe(clonar(p), ahora).carrerasPagadas, CARRERAS_COMPLETAS)} de {CARRERAS_COMPLETAS} carreras con premio completo; después pagan el 25 %.</p>
        <h3>2 · Distancia</h3>
        {offline
          ? (tokenCarrera
              ? <div className="sorteo"><b>{dist(tokenCarrera.distancia)}</b><span>{tokenCarrera.superficie === "cesped" ? "Césped" : "Tierra"} · carrera offline</span>
                  <small>Sin conexión, cada carrera trae su distancia. Quedan {offline.quedan} hoy. El Oro se cobra al reconectar.</small></div>
              : <p className="nota">No te quedan carreras offline para hoy. Cuando vuelva la conexión se cobran las que corriste y se habilita todo.</p>)
          : modo === "online" || modo === "ranked"
          ? (enLinea ? <PanelOnline key={modo} tipo={modo === "ranked" ? "ranked" : "casual"} sesion={enLinea.sesion} caballo={sel} estrategia={estrategia} ahora={ahora}
              oro={p.oro} alCarrera={enLinea.alCarrera} alPartida={enLinea.alPartida} alPasarACasual={() => setModo("online")} />
            : <p className="nota">Para correr contra otros jugadores creá una cuenta o entrá con la tuya desde el campo, con el servidor del juego prendido.</p>)
          : modo === "campeonato" && !campListo
          ? (camp?.corrido
              ? <p className="nota">Ya corriste el campeonato de esta semana. El próximo abre el sábado a las 00:00.</p>
              : !abierto
                ? <p className="nota">El campeonato se juega sábado y domingo. Abre en {restante(proximoCambioCampeonato(ahora) - ahora)}.</p>
                : <><p className="nota">Una inscripción por semana. Al inscribirte se sortea la distancia. Cierra en {restante(proximoCambioCampeonato(ahora) - ahora)}.
                      Puestos 4.º a 6.º: {PREMIOS_CAMPEONATO[3]} Oro; 7.º a 12.º: {PREMIOS_CAMPEONATO[11]} Oro. No cuenta para el límite diario.</p>
                    <button className="primary" disabled={p.oro < INSCRIPCION_CAMPEONATO} onClick={inscribir}>Inscribirme · {INSCRIPCION_CAMPEONATO} Oro</button></>)
          : sorteo
          ? <div className="sorteo"><b>{dist(sorteo.distancia)}</b><span>{sorteo.superficie === "cesped" ? "Césped" : "Tierra"}</span>
              <small>Premio al ganador: {miles(recompensa(modo, sorteo.distancia, 1))} Oro · el último cobra {miles(recompensa(modo, sorteo.distancia, participantes(modo)))} Oro</small></div>
          : <><p className="nota">La distancia se sortea antes de elegir caballo (mitad 500 m, mitad 1.500 m) y queda fija hasta que corras.</p>
              <button className="secundario" onClick={sortear}>Sortear la distancia</button></>}
        <h3>Últimas carreras</h3>
        {historial.length === 0 && <p className="nota">Todavía no corriste ninguna.</p>}
        <ul className="historial">
          {historial.map((r) => (
            <li key={r.id}>
              <b className={r.posicion === 1 ? "oro" : ""}>{r.posicion}.º</b>
              <span>{r.caballoNombre} · {NOMBRE_MODO[r.modo]} · {dist(r.distancia)}{r.fotoFinal ? " · foto final" : ""}</span>
              <em>+{miles(r.oro)}</em>
            </li>
          ))}
        </ul>
      </section>
      <Escenario ficha={juego.ficha} caballo={sel} />
      <section className="hoja derecha">
        <h3>3 · Caballo</h3>
        {listos.length === 0 && <p className="nota">No hay caballos listos para correr: están entrenando o descansando.</p>}
        <ul className="lista">
          {p.caballos.map((c) => {
            const r = puedeCorrer(c, ahora);
            return (
              <li key={c.id}>
                <button className={`tarjeta ${sel?.id === c.id ? "on" : ""}`} disabled={!r.ok} onClick={() => setSelId(c.id)}>
                  <i className="muestra" style={{ background: rgb(fenotipo(c.pelaje).cuerpo), borderColor: rgb(fenotipo(c.pelaje).crin) }} />
                  <span className="t-nombre">{c.nombre}</span>
                  <span className="t-sub">{atributos(c).join(" · ")} · <b style={{ color: tierDe(c).color }}>{tierDe(c).nombre}</b></span>
                  <span className={`estado e-${c.estado}`}>{r.ok ? "Listo" : ESTADOS[c.estado]}{c.finEstado ? ` · ${restante(c.finEstado - ahora)}` : ""}</span>
                  {r.ok && <span className={`riesgo r-${nivelRiesgo(riesgoDe(c, ahora))}`} title="Riesgo de lesión">Riesgo {TXT_RIESGO[nivelRiesgo(riesgoDe(c, ahora))].toLowerCase()}{c.herraduras ? "" : " · sin herraduras"}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {sel && <p className="nota">Rivales de tu nivel: <b style={{ color: tierDe(sel).color }}>{tierDe(sel).nombre}</b>{modo === "campeonato" ? " (en el campeonato, de la parte alta del nivel)" : ""}.
          {(() => { const [a, b] = objetivoRivales(sel, modo === "campeonato"); return tierDeIndice(a).id !== tierDeIndice(b).id ? " Algunos pueden ser del nivel siguiente." : ""; })()}</p>}
        <h3>4 · Estrategia</h3>
        <div className="strats">
          {ESTRATEGIAS.map((e) => (
            <button key={e.id} className={`strat ${e.id === estrategia ? "on" : ""}`} onClick={() => setEstrategia(e.id)}><b>{e.nombre}</b><span>{e.texto}</span></button>
          ))}
        </div>
        {modo !== "online" && modo !== "ranked" && <button className="primary ancho" disabled={!sorteo || !sel || !puedeCorrer(sel, ahora).ok}
          onClick={() => sel && sorteo && alCorrer(sel, { modo, participantes: participantes(modo), distancia: sorteo.distancia, superficie: sorteo.superficie, estrategia,
            entrenoRivales: modo === "campeonato" ? ENTRENO_RIVALES_CAMPEONATO : undefined })}>
          {!sorteo ? (offline ? "No quedan carreras offline hoy" : modo === "campeonato" ? "Primero inscribite en el campeonato" : "Primero sorteá la distancia")
            : `${modo === "campeonato" ? "Correr el campeonato" : "Correr"}: ${dist(sorteo.distancia)} con ${sel?.nombre ?? "…"}`}
        </button>}
        <p className="nota">Después de correr, el caballo descansa en el Centro de recuperación: 15 min tras 500 m y 30 min tras 1.500 m.
          Cada carrera le suma carga: si lo corrés seguido sin descanso, sube el riesgo de lesión. Conviene turnar caballos.</p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ ficha

/** 7.2 y 7.3: buscar carrera online (Casual o Ranked), sala de espera (distancia revelada, tiempo para elegir) y largada. */
function PanelOnline({ tipo, sesion, caballo, estrategia, ahora, oro, alCarrera, alPartida, alPasarACasual }: {
  tipo: red.TipoOnline; sesion: red.Sesion; caballo: Caballo | null; estrategia: Strategy; ahora: number; oro: number;
  alCarrera: (d: red.CarreraOnline) => void; alPartida: (p: Partida) => void; alPasarACasual: () => void;
}) {
  const [estado, setEstado] = useState<red.EstadoOnline | null>(null);
  const [sala, setSala] = useState<red.SalaOnline | null>(null);
  const [desfase, setDesfase] = useState(0);            // hora del servidor − hora local
  const [msj, setMsj] = useState("");
  const [largada, setLargada] = useState<number | null>(null);
  const [conectado, setConectado] = useState(true);
  const [vuelta, setVuelta] = useState(0);              // para releer el rating después de cada carrera
  const yo = sesion.nombre;
  const alCarreraRef = useRef(alCarrera);
  alCarreraRef.current = alCarrera;
  useEffect(() => red.escucharOnline(sesion, {
    estado: (e) => { setConectado(true); setEstado(e); setDesfase(e.hora - Date.now()); setSala(e.donde === "sala" ? e.sala ?? null : null); },
    sala: (s, hora) => { setSala(s); setDesfase(hora - Date.now()); setMsj(""); },
    carrera: (d) => { setLargada(Date.now() + Math.max(0, d.inicio - d.hora)); setSala(null); setVuelta((v) => v + 1); alCarreraRef.current(d); },
    afuera: (m, r, a) => { setSala(null); setVuelta((v) => v + 1);
      setMsj([m, r ? `Rating: ${r.antes} → ${r.despues}.` : "", a ? textoApuesta(a) : ""].filter(Boolean).join(" ")); },
    error: () => setConectado(false),
  }), [sesion]); // eslint-disable-line react-hooks/exhaustive-deps
  // Consulta del estado: los túneles gratis de Cloudflare (trycloudflare.com) no dejan pasar los avisos en vivo (SSE),
  // así que para los amigos que entran por el túnel este es el canal principal. Cada 1 s en la cola o en una sala; si no, cada 3 s.
  // Importante: el temporizador NO depende de funciones que cambian en cada dibujo (la pantalla se redibuja cada segundo por el
  // reloj); si dependiera, se reiniciaría todo el tiempo y por el túnel, más lento, las respuestas llegarían siempre tarde.
  const aplicar = useCallback((e: red.EstadoOnline & { carrera?: red.CarreraOnline }) => {
    setConectado(true);
    setEstado(e);
    setDesfase(e.hora - Date.now());
    setSala(e.donde === "sala" ? e.sala ?? null : null);
    if (e.carrera && e.donde !== "sala") { setLargada(Date.now() + Math.max(0, e.carrera.inicio - e.carrera.hora)); setSala(null); alCarreraRef.current(e.carrera); }
  }, []);
  const atento = estado?.donde === "cola" || estado?.donde === "sala";
  useEffect(() => {
    let vivo = true, enCurso = false, fallas = 0;
    const consultar = () => {
      if (enCurso) return;                  // una consulta a la vez: si el túnel está lento, no se apilan
      enCurso = true;
      void red.leerEstadoOnline(sesion).then((r) => {
        enCurso = false;
        if (!vivo) return;
        if (r.ok) { fallas = 0; aplicar(r); }
        else if (++fallas >= 3) setConectado(false);
      });
    };
    consultar();
    const id = setInterval(consultar, atento ? 1000 : 3000);
    return () => { vivo = false; clearInterval(id); };
  }, [sesion, aplicar, atento]);
  const buscar = (t: red.TipoOnline) => red.entrarCola(sesion, t).then(async (r) => {
    setMsj(r.ok ? "" : r.motivo);
    if (r.ok) { const e = await red.leerEstadoOnline(sesion); if (e.ok) aplicar(e); }
    return r;
  });
  const dist = (d: number) => d === 500 ? "500 m" : "1.500 m";
  const nombreTipo = (t: red.TipoOnline) => t === "ranked" ? "Ranked" : "Online casual";
  const rating = tipo === "ranked" ? <PanelRating sesion={sesion} vuelta={vuelta} /> : null;
  if (!estado) return <p className="nota">{conectado ? "Conectando con el servidor del juego…" : "No hay conexión con el servidor del juego. Reintentando…"}</p>;
  const reconectando = !conectado && <p className="nota">Reconectando con el servidor…</p>;
  if (largada && largada > ahora) return <div className="sorteo"><b>¡Largan en {Math.ceil((largada - ahora) / 1000)}!</b><span>Todos ven la misma carrera</span></div>;
  if (sala) {
    const resta = Math.max(0, Math.ceil((sala.venceEleccion - (ahora + desfase)) / 1000));
    const listo = sala.jugadores.find((j) => j.nombre === yo)?.listo;
    return (
      <div className="sala-online">
        <div className="sorteo"><b>{dist(sala.distancia)}</b><span>{sala.superficie === "cesped" ? "Césped" : "Tierra"} · {nombreTipo(sala.tipo)}</span>
          <small>Elegí caballo y estrategia: quedan {resta} s. Si no elegís, corre tu mejor caballo listo.</small></div>
        <ul className="jugadores-sala">
          {sala.jugadores.map((j) => <li key={j.nombre} className={j.listo ? "listo" : ""}>{j.listo ? "✓" : "…"} {j.nombre}{j.nombre === yo ? " (vos)" : ""}</li>)}
        </ul>
        <button className="primary ancho" disabled={!caballo}
          onClick={() => caballo && void red.elegirOnline(sesion, caballo.id, estrategia).then((r) => setMsj(r.ok ? "" : r.motivo))}>
          {listo ? `Cambiar a ${caballo?.nombre ?? "…"}` : `Estoy listo con ${caballo?.nombre ?? "…"}`}
        </button>
        {msj && <p className="aviso-error">{msj}</p>}
        <PizarraApuestas sala={sala} yo={yo} oro={oro} alApostar={(en, monto) => red.apostar(sesion, en, monto).then((r) => {
          if (r.ok) alPartida(r.partida);
          return r.ok ? "" : r.motivo;
        })} />
      </div>
    );
  }
  if (estado?.donde === "cola") {
    const t = estado.tipo ?? "casual";
    const esperando = Math.max(0, (ahora + desfase - (estado.desde ?? ahora + desfase)) / 1000);
    const sinRivales = t === "ranked" && estado.avisoSinRivalesSeg !== undefined && esperando >= estado.avisoSinRivalesSeg;
    const pasarACasual = async () => { await red.salirCola(sesion); const r = await buscar("casual"); if (r.ok) alPasarACasual(); };
    return (
      <div className="sala-online">
        <div className="sorteo"><b>Buscando rivales…</b>
          <span>{nombreTipo(t)}: {estado.enCola} en la cola{t === "ranked" && estado.minJugadores ? ` (hacen falta ${estado.minJugadores})` : ""}</span>
          <small>{t === "ranked" ? "Se juntan jugadores de rating y establo parecidos; si tardan, se abre el rango."
            : estado.armaEn && estado.enCola >= (estado.minJugadores ?? 2)
              ? `La carrera se arma en ${Math.max(0, Math.ceil((estado.armaEn - (ahora + desfase)) / 1000))} s con todos los que estén en la cola.`
              : "Esperando a otro jugador: la carrera se arma con todos los que estén en la cola."}</small></div>
        {estado.enEspera && estado.enEspera.length > 0 && <ul className="jugadores-sala">
          {estado.enEspera.map((n) => <li key={n} className="listo">{n}{n === yo ? " (vos)" : ""}</li>)}
        </ul>}
        {t !== tipo && <p className="nota">Estás en la cola de {nombreTipo(t)}. Cancelá para buscar en {nombreTipo(tipo)}.</p>}
        {sinRivales && <div className="aviso-ranked">
          <p>No hay suficientes jugadores para una Ranked: hacen falta {estado.minJugadores}. ¿Querés correr una Online casual con los que hay?</p>
          <button className="primary" onClick={() => void pasarACasual()}>Pasar a Online casual</button>
        </div>}
        <button className="secundario" onClick={() => void red.salirCola(sesion)}>Cancelar</button>
        {reconectando}
        {msj && <p className="aviso-error">{msj}</p>}
        {rating}
      </div>
    );
  }
  return (
    <div className="sala-online">
      {tipo === "ranked"
        ? <p className="nota">Carrera de 8 con al menos 4 jugadores; los bots completan. Durante la elección se puede apostar Oro. Tu rating cambia solo según en qué puesto llegás frente a los otros jugadores: los bots no cuentan.
            Las primeras 10 son de colocación.{estado ? ` Ahora hay ${estado.colas?.ranked ?? 0} en la cola Ranked.` : ""}</p>
        : <p className="nota">Juntan a todos los que estén en la cola (de 2 a 8 jugadores); los bots completan hasta 8. Entren todos a la cola: la carrera se arma 15 s después de que entra el primero. La distancia se sortea al armarse la carrera y tenés unos segundos para elegir caballo y estrategia, y para apostar Oro si querés.
            {estado ? ` Ahora hay ${estado.colas?.casual ?? 0} en la cola.` : ""}</p>}
      {reconectando}
      <button className="primary ancho" onClick={() => void buscar(tipo)}>
        {tipo === "ranked" ? "Buscar carrera Ranked" : "Buscar carrera online"}
      </button>
      {msj && <p className="aviso-error">{msj}</p>}
      {rating}
    </div>
  );
}

/** 7.4: texto de cómo le fue a la apuesta. */
function textoApuesta(a: red.ResultadoApuesta): string {
  if (a.devuelta) return `Apuesta de ${miles(a.monto)} Oro a ${a.en}: se te devolvió.`;
  return a.pago > 0 ? `¡Apuesta a ${a.en} ganada! Cobrás ${miles(a.pago)} Oro.` : `Apuesta de ${miles(a.monto)} Oro a ${a.en}: perdida.`;
}

/** 7.4: pizarra de apuestas de la sala (pozo común) y el formulario para apostar. */
function PizarraApuestas({ sala, yo, oro, alApostar }: {
  sala: red.SalaOnline; yo: string; oro: number; alApostar: (en: string, monto: number) => Promise<string>;
}) {
  const [en, setEn] = useState(yo);
  const [monto, setMonto] = useState(APUESTAS.minima * 10);
  const [msj, setMsj] = useState("");
  const [enviando, setEnviando] = useState(false);
  const cuota = (c: number | null) => c === null ? "—" : `×${c.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const valido = Number.isInteger(monto) && monto >= APUESTAS.minima && monto <= APUESTAS.maximaPorCarrera && monto <= oro;
  return (
    <div className="pizarra">
      <h4>Apuestas · pozo {miles(sala.pozo)} Oro</h4>
      <p className="nota">Se apuesta a qué jugador llega primero entre los jugadores. Los que aciertan se reparten el pozo (el juego se queda el {Math.round(APUESTAS.comision * 100)} %).
        Si nadie acierta, se devuelve todo.</p>
      <ul className="pizarra-lista">
        {sala.jugadores.map((j) => (
          <li key={j.nombre}>
            <button className={en === j.nombre ? "on" : ""} disabled={!!sala.miApuesta} onClick={() => setEn(j.nombre)}>
              <span>{j.nombre}{j.nombre === yo ? " (vos)" : ""}</span><em>{miles(j.pozo)} Oro</em><b>{cuota(j.cuota)}</b>
            </button>
          </li>
        ))}
      </ul>
      {sala.miApuesta
        ? <p className="apuesta-hecha">Apostaste {miles(sala.miApuesta.monto)} Oro a {sala.miApuesta.en}.</p>
        : <div className="apostar">
            <input type="number" min={APUESTAS.minima} max={APUESTAS.maximaPorCarrera} step={10} value={monto}
              onChange={(e) => setMonto(Math.floor(Number(e.target.value)))} aria-label="Oro a apostar" />
            <button className="secundario" disabled={!valido || enviando}
              onClick={() => { setEnviando(true); void alApostar(en, monto).then((m) => { setMsj(m); setEnviando(false); }); }}>
              Apostar {miles(monto || 0)} a {en}
            </button>
          </div>}
      <small className="nota">De {APUESTAS.minima} a {APUESTAS.maximaPorCarrera} Oro por carrera, hasta {miles(APUESTAS.maximaPorDia)} por día. Tenés {miles(oro)} Oro.</small>
      {msj && <p className="aviso-error">{msj}</p>}
    </div>
  );
}

/** 7.3: mi rating, división o colocación, y el ranking. */
function PanelRating({ sesion, vuelta }: { sesion: red.Sesion; vuelta: number }) {
  const [datos, setDatos] = useState<{ top: red.FilaRanking[]; yo: red.MiRating } | null>(null);
  const [error, setError] = useState("");
  const [ver, setVer] = useState(false);
  useEffect(() => {
    let vivo = true;
    void red.leerRanking(sesion).then((r) => { if (!vivo) return; if (r.ok) { setDatos({ top: r.top, yo: r.yo }); setError(""); } else setError(r.motivo); });
    return () => { vivo = false; };
  }, [sesion, vuelta]);
  if (error) return <p className="aviso-error">{error}</p>;
  if (!datos) return <p className="nota">Cargando tu rating…</p>;
  const y = datos.yo;
  return (
    <div className="mi-rating">
      <div className="rating-tarjeta">
        <span className="rating-numero">{y.visible.toLocaleString("es-AR")}</span>
        <span className="rating-texto">
          {y.colocacion
            ? <><b>Colocación</b> · {y.colocadas} de {y.totalColocacion} carreras</>
            : <><b style={{ color: y.division!.color }}>{y.division!.nombre}</b> · puesto {y.puesto} del ranking</>}
          <small>El rating arranca en 0 y sube a medida que el juego conoce tu nivel.</small>
        </span>
      </div>
      <button className="secundario" onClick={() => setVer(!ver)}>{ver ? "Ocultar ranking" : "Ver ranking"}</button>
      {ver && (datos.top.length === 0
        ? <p className="nota">Todavía nadie terminó las 10 carreras de colocación.</p>
        : <ol className="ranking">
            {datos.top.map((f) => (
              <li key={f.puesto} className={f.yo ? "yo" : ""}>
                <b>{f.puesto}.º</b><span>{f.nombre}{f.yo ? " (vos)" : ""}</span>
                <em style={{ color: f.division?.color }}>{f.division?.nombre}</em><i>{f.rating.toLocaleString("es-AR")}</i>
              </li>
            ))}
          </ol>)}
    </div>
  );
}

function Ficha({ caballo: c, partida, ahora, alCorrer, alEntrenar, alDetener, alLiberar, alCruzar, alVer, alAcelerar, alMontura, alVender, alVestir, alPintarMontura, alHerrar }: {
  caballo: Caballo; partida: Partida; ahora: number; alCorrer: () => void; alEntrenar: () => void; alDetener: () => void; alLiberar: () => void;
  alCruzar: (parejaId: string, nombre: string) => void; alVer: (id: string) => void; alAcelerar: () => void;
  alMontura: (monturaId: string | null) => void; alVender: () => void;
  alVestir: (tipo: "crin" | "cascos" | "manta", id: string | null) => void; alPintarMontura: (monturaId: string, id: string | null) => void;
  alHerrar: (id: TipoHerradura) => void;
}) {
  const [liberando, setLiberando] = useState(false);
  const [vendiendo, setVendiendo] = useState(false);
  useEffect(() => setVendiendo(false), [c.id]);
  const bono = bonoMontura(c.montura);
  const [cruzando, setCruzando] = useState(false);
  useEffect(() => { setLiberando(false); setCruzando(false); }, [c.id]);
  const padre = partida.caballos.find((x) => x.id === c.padreId), madre = partida.caballos.find((x) => x.id === c.madreId);
  const f = fenotipo(c.pelaje);
  const efectivos = atributos(c);
  const comp = Object.entries(c.composicion).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
  const disponible = c.estado === "disponible";
  return (
    <section className="hoja derecha ficha">
      <div className="eyebrow">{descripcionRaza(c.composicion)}</div>
      <h1>{c.nombre}</h1>
      <div className="chips">
        <span className="chip">{c.sexo === "macho" ? "Macho" : "Hembra"}</span>
        <span className="chip"><i style={{ background: rgb(f.cuerpo), borderColor: rgb(f.crin) }} />{f.nombre}</span>
        <span className={`chip estado e-${c.estado}`}>{ESTADOS[c.estado]}</span>
        <ChipTier caballo={c} />
        {c.linaje && <span className="chip linaje" title={linajeDe(c.linaje)?.descripcion}>✦ {linajeDe(c.linaje)?.nombre}</span>}
      </div>
      {rasgosVisibles(c).length > 0 && (
        <p className="rasgos">{rasgosVisibles(c).map((r) => <span key={r} className="rasgo" title={RASGOS[r]?.descripcion}>{RASGOS[r]?.nombre}</span>)}</p>
      )}
      <h3>Atributos</h3>
      {efectivos.map((v, i) => <Barra key={i} nombre={ATRIBUTOS[i]} natural={c.natural[i]} entreno={Math.min(c.entreno[i], 100 - c.natural[i])}
        montura={v - c.natural[i] - Math.min(c.entreno[i], 100 - c.natural[i])} techo={c.techo[i]} />)}
      <p className="nota">La marca dorada es el techo genético de su sangre: hasta ahí puede llegar su valor natural.
        {bono.some((x) => x > 0) ? " En azul, lo que suma la montura." : ""}</p>
      <Bienestar caballo={c} partida={partida} ahora={ahora} alHerrar={alHerrar} />
      <h3>Montura</h3>
      <SelectorMontura caballo={c} partida={partida} alElegir={alMontura} />
      {c.monturaId && <SelectorAspecto titulo="Cuero" opciones={ASPECTOS.filter((a) => a.tipo === "montura" && tiene(partida, a.id))} actual={c.monturaColor}
        alElegir={(id) => alPintarMontura(c.monturaId!, id)} />}
      <h3>Aspecto</h3>
      {(["crin", "cascos", "manta"] as const).map((t) => {
        const ops = ASPECTOS.filter((a) => a.tipo === t && tiene(partida, a.id));
        return ops.length ? <SelectorAspecto key={t} titulo={NOMBRE_TIPO[t]} opciones={ops} actual={c.aspecto?.[t]} alElegir={(id) => alVestir(t, id)} /> : null;
      })}
      {!(partida.aspectos ?? []).some((id) => aspecto(id)?.tipo !== "montura") && <p className="nota">Mantas, crines teñidas y cascos se compran con Gemas en Mercado → Aspecto.</p>}
      <h3>Sangre</h3>
      {comp.map(([r, w]) => (
        <div className="sangre" key={r}><span>{r}</span><div className="bar"><i style={{ width: `${w * 100}%` }} /></div><b>{Math.round(w * 100)} %</b></div>
      ))}
      <h3>Historial</h3>
      <div className="record">
        <div><b>{c.carreras}</b><span>{c.carreras === 1 ? "carrera" : "carreras"}</span></div>
        <div><b>{c.victorias}</b><span>{c.victorias === 1 ? "victoria" : "victorias"}</span></div>
        {!!c.lesiones && <div><b>{c.lesiones}</b><span>{c.lesiones === 1 ? "lesión" : "lesiones"}</span></div>}
      </div>
      {(c.padreId || c.madreId) && (
        <p className="linaje">{c.sexo === "macho" ? "Hijo" : "Hija"} de{" "}
          {padre ? <button className="enlace" onClick={() => alVer(padre.id)}>{padre.nombre}</button> : <span>un padre que ya no está</span>} y{" "}
          {madre ? <button className="enlace" onClick={() => alVer(madre.id)}>{madre.nombre}</button> : <span>una madre que ya no está</span>}
        </p>
      )}
      {c.finEstado !== null && c.inicioEstado !== undefined && (
        <Progreso inicio={c.inicioEstado} fin={c.finEstado} ahora={ahora} texto={ESTADOS[c.estado]} gemas={partida.gemas}
          alAcelerar={alAcelerar} />
      )}
      {c.estado === "colaRecuperacion" && c.cola && <>
        <p className="nota">Espera un lugar libre en el Centro de recuperación.</p>
        <BotonAcelerar ms={c.cola.minutos * 60_000} gemas={partida.gemas} alAcelerar={alAcelerar} texto="Terminar el descanso ya" />
      </>}
      {c.descansoHasta !== undefined && c.descansoHasta > ahora && <>
        <p className="nota">Salió antes de la recuperación: puede entrenar, pero podrá correr en {restante(c.descansoHasta - ahora)}.</p>
        <BotonAcelerar ms={c.descansoHasta - ahora} gemas={partida.gemas} alAcelerar={alAcelerar} texto="Terminar el descanso ya" />
      </>}
      {c.estado === "entrenando" && (
        <button className="secundario" onClick={alDetener}>Detener el entrenamiento (no gana los puntos de esta sesión)</button>
      )}
      {(c.estado === "recuperacion" || c.estado === "colaRecuperacion") && (
        <button className="secundario" onClick={alDetener}>Sacar de la recuperación (podrá entrenar, no correr)</button>
      )}
      {(() => {
        const r = puedeEntrenar(partida, c);
        const rc = puedeCorrer(c, ahora);
        return (
          <>
            <div className="dos acciones-ficha">
              <button className="secundario" disabled={!r.ok} onClick={alEntrenar}>Entrenar · {cfgEdificios.entrenamiento.minutos} min</button>
              <button className="primary" disabled={!rc.ok} onClick={alCorrer}>Ir a correr</button>
            </div>
            {!r.ok && disponible && <p className="nota">{r.motivo}</p>}
          </>
        );
      })()}
      {disponible && !cruzando && (
        <button className="secundario" disabled={!!partida.cruza} onClick={() => setCruzando(true)}>
          {partida.cruza ? "Ya hay una cruza en curso" : "Cruzar…"}
        </button>
      )}
      {cruzando && <PanelCruza caballo={c} partida={partida} alCruzar={(id, n) => { setCruzando(false); alCruzar(id, n); }} alCancelar={() => setCruzando(false)} />}
      <div className="pie">
        {!vendiendo
          ? <button className="enlace" disabled={partida.caballos.length <= 1 || !disponible} onClick={() => setVendiendo(true)}>Vender al juego por {miles(precioVentaAlJuego(c))} Oro</button>
          : <span className="confirmar">El juego paga un precio mínimo y {c.nombre} se va del establo.
              <button className="peligro" onClick={() => { setVendiendo(false); alVender(); }}>Vender · {miles(precioVentaAlJuego(c))} Oro</button>
              <button className="enlace" onClick={() => setVendiendo(false)}>Cancelar</button></span>}
        {!liberando
          ? <button className="enlace" disabled={partida.caballos.length <= 1 || !disponible} onClick={() => setLiberando(true)}>Liberar a {c.nombre}</button>
          : <span className="confirmar">Se va del establo para siempre.
              <button className="peligro" onClick={() => { setLiberando(false); alLiberar(); }}>Liberar</button>
              <button className="enlace" onClick={() => setLiberando(false)}>Cancelar</button></span>}
        {partida.caballos.length <= 1 && <p className="nota">No se puede liberar tu único caballo.</p>}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ crianza (§10)

function PanelCruza({ caballo: c, partida: p, alCruzar, alCancelar }: {
  caballo: Caballo; partida: Partida; alCruzar: (parejaId: string, nombre: string) => void; alCancelar: () => void;
}) {
  const parejas = p.caballos.filter((x) => x.sexo !== c.sexo);
  const [pareja, setPareja] = useState(() => parejas.find((x) => x.estado === "disponible")?.id ?? "");
  const [nombre, setNombre] = useState(() => SUGERIDOS[Math.floor(Math.random() * SUGERIDOS.length)]);
  const macho = c.sexo === "macho" ? c.id : pareja, hembra = c.sexo === "macho" ? pareja : c.id;
  const r = puedeCruzar(p, macho, hembra);
  const otra = p.caballos.find((x) => x.id === pareja);
  return (
    <div className="cruza">
      <h3>Cruza</h3>
      {parejas.length === 0
        ? <p className="nota">Necesitás {c.sexo === "macho" ? "una hembra" : "un macho"}. En el Mercado siempre hay al menos un macho y una hembra.</p>
        : <>
            <p className="nota">Elegí {c.sexo === "macho" ? "la madre" : "el padre"}:</p>
            <div className="parejas">
              {parejas.map((x) => {
                const f = fenotipo(x.pelaje);
                return (
                  <button key={x.id} className={`pareja ${x.id === pareja ? "on" : ""}`} disabled={x.estado !== "disponible"} onClick={() => setPareja(x.id)}>
                    <i className="muestra" style={{ background: rgb(f.cuerpo), borderColor: rgb(f.crin) }} />
                    <b>{x.nombre}</b><small>{descripcionRaza(x.composicion)}{x.estado !== "disponible" ? ` · ${ESTADOS[x.estado]}` : ""}</small>
                  </button>
                );
              })}
            </div>
            {otra && (
              <p className="nota">El potrillo tendrá {Object.entries(composicionTexto(c, otra)).map(([k, v]) => `${k} ${v} %`).join(" · ")} de sangre.
                Cada atributo sale del padre o de la madre (más a menudo del mejor), con una pequeña variación y sin pasar el techo de su sangre.</p>
            )}
            {otra && (() => {
              const pr = pronosticoCruza(c.sexo === "macho" ? c : otra, c.sexo === "macho" ? otra : c, composicionHija(c.composicion, otra.composicion));
              return <>
                {pr.rasgos.length > 0 && <p className="nota">Rasgo de esta cruza (7 de cada 10 potrillos lo muestran): <b>{pr.rasgos.map((r) => RASGOS[r].nombre).join(", ")}</b>.</p>}
                {pr.heredables.length > 0 && <p className="nota">Puede heredar de sus padres: {pr.heredables.map((r) => RASGOS[r].nombre).join(", ")}.</p>}
                {pr.linajes.map((l) => <p key={l.id} className="nota linaje-aviso">✦ Puede nacer de linaje raro <b>{linajeDe(l.id)!.nombre}</b> ({pct(l.prob)}): {linajeDe(l.id)!.descripcion.toLowerCase()}, con más techo genético.</p>)}
              </>;
            })()}
            <label className="campo-texto">Nombre del potrillo
              <input value={nombre} maxLength={20} onChange={(e) => setNombre(e.target.value)} />
            </label>
            <p className="nota">Cuesta {miles(COSTO_CRUZA)} Oro. Los padres quedan ocupados {HORAS_CRUZA} h; después el potrillo crece {HORAS_CRECIMIENTO} h. Su lugar en el establo queda reservado desde ahora.</p>
            {!r.ok && pareja && <p className="aviso-error">{r.motivo}</p>}
          </>}
      <div className="dos">
        <button className="secundario" onClick={alCancelar}>Cancelar</button>
        <button className="primary" disabled={!r.ok || !nombre.trim()} onClick={() => alCruzar(pareja, nombre)}>Cruzar · {miles(COSTO_CRUZA)} Oro</button>
      </div>
    </div>
  );
}

function composicionTexto(a: Caballo, b: Caballo): Record<string, number> {
  const r: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a.composicion), ...Object.keys(b.composicion)])) {
    const w = ((a.composicion[k] ?? 0) + (b.composicion[k] ?? 0)) / 2;
    if (w > 0) r[k] = Math.round(w * 100);
  }
  return Object.fromEntries(Object.entries(r).sort((x, y) => y[1] - x[1]));
}

// ------------------------------------------------------------------ mercado del juego (§12.1)

export type PestanaMercado = "caballos" | "jugadores" | "monturas" | "herraduras" | "decoracion" | "aspecto" | "oro" | "gemas";
const PESTANAS: [PestanaMercado, string][] = [["caballos", "Caballos"], ["jugadores", "Jugadores"], ["monturas", "Monturas"], ["herraduras", "Herraduras"], ["decoracion", "Decoración"], ["aspecto", "Aspecto"], ["oro", "Oro"], ["gemas", "Gemas"]];

function MercadoJuego({ juego, partida: p, ahora, hacer, alVolver, alVerCaballo, pestana, alPestana, alPonerDeco, jugadores }: {
  juego: Juego; partida: Partida; ahora: number; hacer: Hacer; alVolver: () => void; alVerCaballo: (id: string) => void;
  pestana: PestanaMercado; alPestana: (t: PestanaMercado) => void; alPonerDeco: (id: string) => void;
  /** Fase 8: con cuenta y conexión, el mercado entre jugadores. */ jugadores: { sesion: red.Sesion; alPartida: (p: Partida) => void } | null;
}) {
  const pestanas = (
    <div className="segmentado pestanas pestanas-mercado">
      {PESTANAS.map(([t, n]) => <button key={t} className={pestana === t ? "on" : ""} onClick={() => alPestana(t)}>{n}</button>)}
    </div>
  );
  const cabecera = (
    <header className="cabecera">
      <div>
        <button className="volver" onClick={alVolver}>← Campo</button>
        <h1>Mercado</h1>
      </div>
      <div className="monedas">
        <span title="Oro"><i className="oro" />{miles(p.oro)}</span>
        <span title="Gemas"><i className="gema" />{miles(p.gemas)}</span>
      </div>
    </header>
  );
  if (pestana === "jugadores") {
    if (jugadores) return <MercadoJugadores juego={juego} partida={p} ahora={ahora} sesion={jugadores.sesion} alPartida={jugadores.alPartida}
      alVerCaballo={alVerCaballo} cabecera={cabecera} pestanas={pestanas} />;
    return (
      <div className="layout central">
        <section className="hoja">
          {cabecera}
          {pestanas}
          <p className="nota">El mercado entre jugadores necesita una cuenta y conexión con el servidor del juego: ahí se venden y se subastan caballos entre jugadores.
            Creá una cuenta o entrá con la tuya desde el campo («Crear cuenta o entrar»).</p>
        </section>
      </div>
    );
  }
  if (pestana !== "caballos") {
    return (
      <div className="layout central">
        <section className="hoja">
          {cabecera}
          {pestanas}
          {pestana === "monturas" && <TiendaMonturas partida={p} hacer={hacer} />}
          {pestana === "herraduras" && <TiendaHerraduras partida={p} hacer={hacer} />}
          {pestana === "decoracion" && <TiendaDecoracion partida={p} alPoner={alPonerDeco} hacer={hacer} />}
          {pestana === "aspecto" && <TiendaAspecto partida={p} hacer={hacer} />}
          {pestana === "oro" && <TiendaOro partida={p} ahora={ahora} hacer={hacer} />}
          {pestana === "gemas" && <TiendaGemas />}
        </section>
      </div>
    );
  }
  return <MercadoCaballos juego={juego} partida={p} ahora={ahora} hacer={hacer} alVerCaballo={alVerCaballo} cabecera={cabecera} pestanas={pestanas} />;
}

function MercadoCaballos({ juego, partida: p, ahora, hacer, alVerCaballo, cabecera, pestanas }: {
  juego: Juego; partida: Partida; ahora: number; hacer: Hacer; alVerCaballo: (id: string) => void;
  cabecera: ReactNode; pestanas: ReactNode;
}) {
  // Se calcula sobre una copia: el mercado del día se guarda recién al comprar (es determinista, sale igual).
  const m = useMemo(() => mercadoDelDia(clonar(p), ahora), [p, Math.floor(finDelDia(ahora) / 1000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const [i, setI] = useState(0);
  const o = m.ofertas[i];
  const [comprado, setComprado] = useState<string | null>(null);
  const c = o?.caballo ?? null;
  const f = c ? fenotipo(c.pelaje) : null;
  const libre = ocupados(p) < capacidad(p);
  return (
    <div className="layout establo">
      <section className="hoja izquierda">
        {cabecera}
        {pestanas}
        <p className="nota">Cuatro caballos por día. Ofertas nuevas en {restante(finDelDia(ahora) - ahora)}.</p>
        <ul className="lista">
          {m.ofertas.map((x, k) => {
            const fx = fenotipo(x.caballo.pelaje);
            return (
              <li key={x.caballo.id}>
                <button className={`tarjeta ${k === i ? "on" : ""}`} onClick={() => { setI(k); setComprado(null); }}>
                  <i className="muestra" style={{ background: rgb(fx.cuerpo), borderColor: rgb(fx.crin) }} />
                  <span className="t-nombre">{x.caballo.nombre}</span>
                  <span className="t-sub">{NOMBRE_OFERTA[x.tipo]} · {descripcionRaza(x.caballo.composicion)} · {x.caballo.sexo === "macho" ? "Macho" : "Hembra"}</span>
                  <span className={`estado ${x.vendida ? "e-vendida" : "e-oferta"}`}>{x.vendida ? "Vendido" : `${miles(x.precio)} Oro`}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="capacidad">{ocupados(p)} de {capacidad(p)} espacios ocupados</p>
      </section>
      <Escenario ficha={juego.ficha} caballo={c} />
      {c && o && f && (
        <section className="hoja derecha ficha">
          <div className="eyebrow">{NOMBRE_OFERTA[o.tipo]} · {descripcionRaza(c.composicion)}</div>
          <h1>{c.nombre}</h1>
          <div className="chips">
            <span className="chip">{c.sexo === "macho" ? "Macho" : "Hembra"}</span>
            <span className="chip"><i style={{ background: rgb(f.cuerpo), borderColor: rgb(f.crin) }} />{f.nombre}</span>
          </div>
          <h3>Atributos</h3>
          {c.natural.map((v, k) => <Barra key={k} nombre={ATRIBUTOS[k]} natural={v} entreno={0} techo={c.techo[k]} />)}
          <p className="nota">Suma natural {c.natural.reduce((s, x) => s + x, 0)} · sin entrenar. El precio sale de la genética, no de que sea mejor en todo: mirá qué distancia le conviene.</p>
          <div className="precio"><span>Precio</span><b>{miles(o.precio)} Oro</b></div>
          {comprado === c.id
            ? <><p className="premio">¡{c.nombre} ya está en tu establo!</p>
                <button className="secundario" onClick={() => alVerCaballo(c.id.replace(/^m-/, "c-"))}>Ver en mis caballos</button></>
            : <button className="primary ancho" disabled={o.vendida || p.oro < o.precio || !libre}
                onClick={() => { void hacer("comprarOferta", { indice: i }).then((r) => { if (r.ok) setComprado(c.id); }); }}>
                {o.vendida ? "Vendido" : !libre ? "No hay espacio libre en el establo" : p.oro < o.precio ? "No te alcanza el Oro" : `Comprar · ${miles(o.precio)} Oro`}
              </button>}
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ mercado entre jugadores y subastas (Fase 8, §12.3 y §12.4)

const ESTADO_PUBLICACION: Record<red.PublicacionVista["estado"], string> = {
  activa: "Publicado", vendida: "Vendido", cancelada: "Cancelado", vencida: "Venció sin venderse", sin_ofertas: "Terminó sin ofertas", fallida: "No se pudo completar",
};

function MercadoJugadores({ juego, partida: p, ahora, sesion, alPartida, alVerCaballo, cabecera, pestanas }: {
  juego: Juego; partida: Partida; ahora: number; sesion: red.Sesion; alPartida: (p: Partida) => void; alVerCaballo: (id: string) => void;
  cabecera: ReactNode; pestanas: ReactNode;
}) {
  const [datos, setDatos] = useState<red.DatosMercado | null>(null);
  const [desfase, setDesfase] = useState(0);
  const [vista, setVista] = useState<"comprar" | "mias" | "publicar">("comprar");
  const [selId, setSelId] = useState<string | null>(null);
  const [msj, setMsj] = useState<{ texto: string; ok: boolean } | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Publicar
  const [tipo, setTipo] = useState<"venta" | "subasta">("venta");
  const [precio, setPrecio] = useState(0);
  const [duracion, setDuracion] = useState(MERCADO_JUGADORES.duracionesSubastaMin[2]);
  const [puja, setPuja] = useState(0);

  const recibir = useCallback((d: red.DatosMercado) => { setDatos(d); setDesfase(d.hora - Date.now()); }, []);
  useEffect(() => {
    let vivo = true;
    const leer = () => { void red.leerMercado(sesion).then((r) => { if (!vivo) return; if (r.ok) recibir(r); else setMsj({ texto: r.motivo, ok: false }); }); };
    leer();
    const id = setInterval(leer, 5000);           // las pujas de otros y los cierres aparecen solos
    return () => { vivo = false; clearInterval(id); };
  }, [sesion, recibir]);

  const hora = ahora + desfase;
  const lista: red.PublicacionVista[] = vista === "comprar" ? datos?.activas ?? [] : vista === "mias" ? datos?.mias ?? [] : [];
  const pub = lista.find((x) => x.id === selId) ?? lista[0] ?? null;
  const misCaballos = p.caballos;
  const propio = vista === "publicar" ? (misCaballos.find((c) => c.id === selId) ?? misCaballos.find((c) => c.estado === "disponible") ?? null) : null;
  const caballo = vista === "publicar" ? propio : pub?.caballo ?? null;

  // Al cambiar de caballo, el precio arranca en el sugerido y la puja en la mínima
  useEffect(() => { if (propio) { const [min, max] = rangoPrecio(propio); setPrecio(Math.min(max, Math.max(min, Math.round(precioSugerido(propio) / 10) * 10))); } }, [propio?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (pub?.minimaPuja) setPuja(pub.minimaPuja); }, [pub?.id, pub?.minimaPuja]);

  const hacerMercado = async (accion: "publicar" | "cancelar" | "comprar" | "pujar", d: Record<string, unknown>, ok: string) => {
    setEnviando(true);
    const r = await red.accionMercado(sesion, accion, d);
    setEnviando(false);
    if (!r.ok) { setMsj({ texto: r.motivo, ok: false }); return null; }
    alPartida(r.partida);
    recibir(r);
    setMsj({ texto: ok, ok: true });
    return r;
  };
  const cambiarVista = (v: typeof vista) => { setVista(v); setSelId(null); setMsj(null); };
  const libre = ocupados(p) < capacidad(p);
  const c = datos?.compras;
  const etiqueta = (x: red.PublicacionVista) => x.estado !== "activa" ? ESTADO_PUBLICACION[x.estado]
    : x.tipo === "venta" ? `${miles(x.precio)} Oro` : x.mejorPuja ? `Oferta ${miles(x.mejorPuja)}` : `Desde ${miles(x.precio)}`;

  return (
    <div className="layout establo">
      <section className="hoja izquierda">
        {cabecera}
        {pestanas}
        <div className="segmentado tres">
          <button className={vista === "comprar" ? "on" : ""} onClick={() => cambiarVista("comprar")}>En venta</button>
          <button className={vista === "mias" ? "on" : ""} onClick={() => cambiarVista("mias")}>Mis publicaciones</button>
          <button className={vista === "publicar" ? "on" : ""} onClick={() => cambiarVista("publicar")}>Publicar</button>
        </div>
        {!datos && <p className="nota">Cargando el mercado…</p>}
        {datos && vista !== "publicar" && lista.length === 0 && (
          <p className="nota">{vista === "comprar" ? "Ahora no hay caballos de otros jugadores a la venta. Volvé más tarde." : "Todavía no publicaste ni compraste caballos."}</p>
        )}
        {vista !== "publicar" && (
          <ul className="lista">
            {lista.map((x) => {
              const f = fenotipo(x.caballo.pelaje);
              return (
                <li key={x.id}>
                  <button className={`tarjeta ${pub?.id === x.id ? "on" : ""}`} onClick={() => { setSelId(x.id); setMsj(null); }}>
                    <i className="muestra" style={{ background: rgb(f.cuerpo), borderColor: rgb(f.crin) }} />
                    <span className="t-nombre">{x.caballo.nombre}{x.caballo.linaje ? " ✦" : ""}</span>
                    <span className="t-sub">{x.tipo === "subasta" ? "Subasta" : "Venta"} · {descripcionRaza(x.caballo.composicion)} · {x.caballo.sexo === "macho" ? "Macho" : "Hembra"}
                      {x.estado === "activa" ? ` · ${restante(x.fin - hora)}` : ""}</span>
                    <span className={`estado ${x.estado === "activa" ? (x.liderando ? "e-ganando" : "e-oferta") : "e-vendida"}`}>{x.liderando ? "Vas ganando" : etiqueta(x)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {vista === "publicar" && (
          <ul className="lista">
            {misCaballos.map((x) => {
              const f = fenotipo(x.pelaje);
              return (
                <li key={x.id}>
                  <button className={`tarjeta ${propio?.id === x.id ? "on" : ""}`} disabled={x.estado !== "disponible"} onClick={() => { setSelId(x.id); setMsj(null); }}>
                    <i className="muestra" style={{ background: rgb(f.cuerpo), borderColor: rgb(f.crin) }} />
                    <span className="t-nombre">{x.nombre}</span>
                    <span className="t-sub">{descripcionRaza(x.composicion)} · sugerido {miles(precioSugerido(x))} Oro</span>
                    <span className={`estado e-${x.estado}`}>{ESTADOS[x.estado]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {c && <p className="capacidad">Compras esta semana: {c.usadas + c.ganando} de {c.maximo}{c.ganando ? ` (${c.ganando} en subastas que vas ganando)` : ""}
          {c.quedan === 0 && c.proxima ? ` · se libera una en ${restante(c.proxima - hora)}` : ""}</p>}
      </section>
      <Escenario ficha={juego.ficha} caballo={caballo} />
      {caballo && (
        <section className="hoja derecha ficha">
          <div className="eyebrow">{vista === "publicar" ? "Publicar" : pub?.tipo === "subasta" ? "Subasta" : "Venta"} · {descripcionRaza(caballo.composicion)}</div>
          <h1>{caballo.nombre}</h1>
          <div className="chips">
            <span className="chip">{caballo.sexo === "macho" ? "Macho" : "Hembra"}</span>
            <span className="chip"><i style={{ background: rgb(fenotipo(caballo.pelaje).cuerpo), borderColor: rgb(fenotipo(caballo.pelaje).crin) }} />{fenotipo(caballo.pelaje).nombre}</span>
            <ChipTier caballo={caballo} />
            {caballo.linaje && <span className="chip linaje" title={linajeDe(caballo.linaje)?.descripcion}>✦ {linajeDe(caballo.linaje)?.nombre}</span>}
          </div>
          <h3>Atributos</h3>
          {caballo.natural.map((v, k) => <Barra key={k} nombre={ATRIBUTOS[k]} natural={v} entreno={caballo.entreno[k]} techo={caballo.techo[k]} />)}
          <p className="nota">{caballo.carreras} {caballo.carreras === 1 ? "carrera" : "carreras"} · {caballo.victorias} {caballo.victorias === 1 ? "victoria" : "victorias"}
            {caballo.herraduras ? ` · herraduras para ${caballo.herraduras.carreras} carreras` : ""}. Precio sugerido: {miles(precioSugerido(caballo))} Oro.</p>

          {vista === "comprar" && pub && (pub.tipo === "venta" ? <>
            <div className="precio"><span>Precio · vende {pub.vendedor}</span><b>{miles(pub.precio)} Oro</b></div>
            <button className="primary ancho" disabled={enviando || p.oro < pub.precio || !libre || (c?.quedan ?? 0) <= 0}
              onClick={() => void hacerMercado("comprar", { id: pub.id }, `¡${pub.caballo.nombre} ya está en tu establo!`)}>
              {p.oro < pub.precio ? "No te alcanza el Oro" : !libre ? "No hay espacio libre en el establo" : (c?.quedan ?? 0) <= 0 ? "Ya usaste tus compras de la semana" : `Comprar · ${miles(pub.precio)} Oro`}
            </button>
          </> : <>
            <div className="precio"><span>{pub.mejorPuja ? `Mejor oferta · ${pub.pujas} ${pub.pujas === 1 ? "puja" : "pujas"}` : "Precio inicial · sin ofertas"} · vende {pub.vendedor}</span>
              <b>{miles(pub.mejorPuja ?? pub.precio)} Oro</b></div>
            <p className="nota">Termina en {restante(pub.fin - hora)}. Tu puja reserva el Oro y un lugar en el establo; si alguien la supera, se te devuelve.
              Una puja en los últimos 2 minutos estira la subasta.</p>
            {pub.liderando
              ? <p className="premio">Vas ganando con {miles(pub.mejorPuja ?? 0)} Oro.</p>
              : <div className="apostar">
                  <input type="number" min={pub.minimaPuja ?? 0} max={pub.maximo} step={10} value={puja} aria-label="Oro a ofertar"
                    onChange={(e) => setPuja(Math.floor(Number(e.target.value)))} />
                  <button className="primary" disabled={enviando || puja < (pub.minimaPuja ?? 0) || puja > pub.maximo || p.oro < puja || !libre || (c?.quedan ?? 0) <= 0}
                    onClick={() => void hacerMercado("pujar", { id: pub.id, monto: puja }, `Pujaste ${miles(puja)} Oro: vas ganando.`)}>
                    {p.oro < puja ? "No te alcanza" : !libre ? "Sin lugar en el establo" : `Ofertar ${miles(puja || 0)}`}
                  </button>
                </div>}
            {!pub.liderando && <small className="nota">Mínimo {miles(pub.minimaPuja ?? 0)} · máximo {miles(pub.maximo)} Oro (300 % del sugerido).</small>}
          </>)}

          {vista === "mias" && pub && <>
            <div className="precio"><span>{ESTADO_PUBLICACION[pub.estado]}{pub.compradaPorMi ? ` · lo compraste a ${pub.vendedor}` : pub.comprador ? ` · a ${pub.comprador}` : ""}</span>
              <b>{miles(pub.precioFinal ?? pub.mejorPuja ?? pub.precio)} Oro</b></div>
            {pub.estado === "activa" && <p className="nota">{pub.tipo === "subasta" ? `Subasta: ${pub.pujas} ${pub.pujas === 1 ? "puja" : "pujas"}.` : "Venta a precio fijo."} Termina en {restante(pub.fin - hora)}.
              Si se vende cobrás {miles(neto(pub.mejorPuja ?? pub.precio).vendedor)} Oro (comisión del {Math.round(MERCADO_JUGADORES.comision * 100)} %).</p>}
            {pub.estado === "activa" && pub.mia && (pub.tipo === "venta" || pub.pujas === 0) &&
              <button className="secundario" disabled={enviando} onClick={() => void hacerMercado("cancelar", { id: pub.id }, `${pub.caballo.nombre} volvió a tu establo.`)}>Sacar del mercado</button>}
            {pub.estado === "vendida" && pub.compradaPorMi && <button className="secundario" onClick={() => {
              const nuevo = p.caballos.find((x) => x.nombre === pub.caballo.nombre && (x.id === pub.caballo.id || x.id.startsWith(pub.caballo.id)));
              if (nuevo) alVerCaballo(nuevo.id);
            }}>Ver en mis caballos</button>}
          </>}

          {vista === "publicar" && propio && (() => {
            const [min, max] = rangoPrecio(propio);
            const v = validarPublicacion(p, propio.id, tipo, precio, duracion);
            return <>
              <div className="segmentado">
                <button className={tipo === "venta" ? "on" : ""} onClick={() => setTipo("venta")}>Precio fijo</button>
                <button className={tipo === "subasta" ? "on" : ""} onClick={() => setTipo("subasta")}>Subasta</button>
              </div>
              <label className="campo-form">{tipo === "venta" ? "Precio" : "Precio inicial"} (de {miles(min)} a {miles(max)} Oro)
                <input type="number" min={min} max={max} step={10} value={precio} onChange={(e) => setPrecio(Math.floor(Number(e.target.value)))} />
              </label>
              {tipo === "subasta" && <label className="campo-form">Duración
                <select value={duracion} onChange={(e) => setDuracion(Number(e.target.value))}>
                  {MERCADO_JUGADORES.duracionesSubastaMin.map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
                </select>
              </label>}
              <p className="nota">{tipo === "venta" ? `Queda publicado ${MERCADO_JUGADORES.duracionVentaHoras} h.` : "Gana la puja más alta al terminar; si nadie oferta, vuelve a tu establo."}
                {" "}Mientras está publicado no puede correr ni entrenar y su montura vuelve a tu inventario. Si se vende, cobrás {miles(neto(precio || 0).vendedor)} Oro (comisión del {Math.round(MERCADO_JUGADORES.comision * 100)} %, solo si se vende).</p>
              <button className="primary ancho" disabled={enviando || !v.ok}
                onClick={() => void hacerMercado("publicar", { caballoId: propio.id, tipo, precio, duracionMin: duracion }, `${propio.nombre} quedó publicado.`).then((r) => { if (r) cambiarVista("mias"); })}>
                {v.ok ? (tipo === "venta" ? `Publicar a ${miles(precio)} Oro` : `Subastar desde ${miles(precio)} Oro`) : "No se puede publicar"}
              </button>
              {!v.ok && <p className="nota">{v.motivo}</p>}
            </>;
          })()}
          {msj && <p className={msj.ok ? "premio" : "aviso-error"}>{msj.texto}</p>}
        </section>
      )}
      {!caballo && vista === "publicar" && <section className="hoja derecha"><p className="nota">No tenés caballos disponibles para publicar.</p></section>}
    </div>
  );
}

// ------------------------------------------------------------------ clanes y guerras (Fase 9, §14)

function PantallaClan({ juego, partida: p, ahora, alVolver, enLinea }: {
  juego: Juego; partida: Partida; ahora: number; alVolver: () => void;
  enLinea: { sesion: red.Sesion; alPartida: (p: Partida) => void } | null;
}) {
  const [e, setE] = useState<red.EstadoClan | null>(null);
  const [desfase, setDesfase] = useState(0);
  const [msj, setMsj] = useState<{ texto: string; ok: boolean } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [saliendo, setSaliendo] = useState(false);
  const [verHist, setVerHist] = useState<number | null>(null);
  const sesion = enLinea?.sesion ?? null;
  const recibir = useCallback((d: red.EstadoClan) => { setE(d); setDesfase(d.hora - Date.now()); }, []);
  useEffect(() => {
    if (!sesion) return;
    let vivo = true;
    const leer = () => { void red.leerClan(sesion).then((r) => { if (!vivo) return; if (r.ok) recibir(r); else setMsj({ texto: r.motivo, ok: false }); }); };
    leer();
    const id = setInterval(leer, 5000);
    return () => { vivo = false; clearInterval(id); };
  }, [sesion, recibir]);
  const accion = async (a: string, datos: Record<string, unknown> = {}, ok = "") => {
    if (!sesion) return;
    setEnviando(true);
    const r = await red.accionClan(sesion, a, datos);
    setEnviando(false);
    if (!r.ok) { setMsj({ texto: r.motivo, ok: false }); return; }
    recibir(r); enLinea!.alPartida(r.partida);
    setMsj(ok ? { texto: ok, ok: true } : null);
  };
  const hora = ahora + desfase;
  const cabecera = (
    <header className="cabecera">
      <div><button className="volver" onClick={alVolver}>← Campo</button><h1>{e?.clan ? e.clan.nombre : "Clan"}</h1></div>
      {e?.clan && <div className="monedas"><span title="Elo del clan">Elo {miles(e.clan.elo)}</span></div>}
    </header>
  );
  const aviso = msj && <p className={msj.ok ? "premio" : "aviso-error"} role="status">{msj.texto}</p>;

  if (!sesion) return (
    <div className="layout central"><section className="hoja">{cabecera}
      <p className="nota">Los clanes necesitan una cuenta y conexión con el servidor del juego. Creá una cuenta o entrá con la tuya desde el campo («Crear cuenta o entrar»).</p>
    </section></div>
  );
  if (!e) return <div className="layout central"><section className="hoja">{cabecera}<p className="nota">Cargando…</p>{aviso}</section></div>;

  // ---- sin clan: crear o unirse
  if (!e.clan) return (
    <div className="layout central"><section className="hoja">
      {cabecera}
      <p className="nota">Un clan junta hasta {CLANES.maxMiembros} jugadores para competir en guerras contra otros clanes: 3 carreras, hasta {CLANES.representantes} representantes por clan, y premios para los que corren.</p>
      <h3>Crear un clan</h3>
      <div className="apostar">
        <input type="text" maxLength={CLANES.nombre.maximo} placeholder="Nombre del clan" value={nombreNuevo} onChange={(x) => setNombreNuevo(x.target.value)} aria-label="Nombre del clan" />
        <button className="primary" disabled={enviando || nombreNuevo.trim().length < CLANES.nombre.minimo}
          onClick={() => void accion("crear", { nombre: nombreNuevo }, `Creaste el clan ${nombreNuevo.trim()}.`)}>Crear</button>
      </div>
      <h3>Unirse a un clan</h3>
      {(e.clanes ?? []).length === 0 && <p className="nota">Todavía no hay clanes. ¡Creá el primero!</p>}
      <ul className="lista-clanes">
        {(e.clanes ?? []).map((c) => (
          <li key={c.id}><b>{c.nombre}</b><span>Elo {miles(c.elo)} · {c.miembros} de {CLANES.maxMiembros}</span>
            <button className="secundario" disabled={enviando || c.lleno} onClick={() => void accion("unirse", { id: c.id }, `Entraste a ${c.nombre}.`)}>{c.lleno ? "Lleno" : "Unirme"}</button></li>
        ))}
      </ul>
      {aviso}
    </section></div>
  );

  // ---- en un clan
  const c = e.clan, mando = c.miRol !== "miembro";
  const yo = c.miembros.find((m) => m.yo)!.nombre;
  const g = e.guerra ?? null;
  const soyRep = !!g?.representantes.nuestros.some((r) => r.yo);
  const listos = p.caballos.filter((x) => puedeCorrer(x, ahora).ok);
  const ver = (setup: RaceSetup | null, resultado: red.PuestoGuerraVista[] | null) => {
    if (!setup) return;
    // Se marca mi caballo; si no corrí, el mejor de mi clan
    const mio = setup.entrants.findIndex((x) => x.dueno === yo);
    const nuestro = resultado?.find((x) => x.nuestro && x.dueno) ? setup.entrants.findIndex((x) => x.dueno === resultado!.find((y) => y.nuestro && y.dueno)!.dueno) : -1;
    void juego.verCarrera({ ...setup, playerIndex: mio >= 0 ? mio : Math.max(0, nuestro) }, alVolver);
  };
  const tablaResultado = (cr: red.CarreraGuerraVista) => cr.resultado && (
    <table className="res guerra"><tbody>
      {cr.resultado.map((x) => (
        <tr key={x.puesto} className={x.nuestro ? "nuestro" : x.rival ? "rival" : ""}>
          <td>{x.lesion ? "—" : `${x.puesto}.º`}</td><td>{x.caballo}{x.dueno ? <small> ({x.dueno})</small> : <small> (bot)</small>}</td>
          <td>{x.lesion ? "Se lesionó" : x.tiempo !== null ? `${x.tiempo.toFixed(2)} s` : ""}</td><td>{x.nuestro || x.rival ? `${x.puntos} pts` : ""}</td>
        </tr>
      ))}
    </tbody></table>
  );
  return (
    <div className="layout central"><section className="hoja clan">
      {cabecera}
      <p className="nota">{NOMBRE_ROL[c.miRol]} · {c.guerras} {c.guerras === 1 ? "guerra" : "guerras"} · {c.victorias} {c.victorias === 1 ? "victoria" : "victorias"} · {c.miembros.length} de {CLANES.maxMiembros} miembros</p>

      <h3>Guerra</h3>
      {!g && (e.buscando
        ? <div className="sala-online"><div className="sorteo"><b>Buscando rival…</b><span>Clanes de Elo ±{e.buscando.ventana}</span>
            <small>El rango se abre con la espera (hasta ±{CLANES.emparejamiento.ventanaMax} a los {CLANES.emparejamiento.abrirEnMin} min).</small></div>
            {mando && <button className="secundario" disabled={enviando} onClick={() => void accion("cancelarBusqueda")}>Cancelar</button>}</div>
        : <>
            <p className="nota">Una guerra dura {CLANES.duracionHoras} h: {CLANES.carreras} carreras de {CLANES.participantesPorCarrera} caballos, hasta {CLANES.representantes} representantes por clan.
              Puntos por puesto {CLANES.puntos.join("-")}; los bots completan y no suman. Premio: {miles(CLANES.premios.participacion)} Oro a cada uno que corre y {miles(CLANES.premios.victoria)} más si gana su clan.</p>
            {mando ? <button className="primary ancho" disabled={enviando} onClick={() => void accion("buscarGuerra", {}, "Buscando un clan rival…")}>Buscar guerra</button>
              : <p className="nota">El líder o un oficial buscan la guerra.</p>}
          </>)}
      {g && <div className="guerra">
        <div className="marcador"><div><span>{c.nombre}</span><b>{g.puntos.nuestros}</b></div><em>contra</em><div><span>{g.rival}</span><b>{g.puntos.rival}</b></div></div>
        <p className="nota">Termina en {restante(g.fin - hora)}. Representantes: {g.representantes.nuestros.map((r) => r.nombre).join(", ") || "ninguno todavía"}
          {" "}· del rival: {g.representantes.rival.join(", ") || "ninguno todavía"}.</p>
        {soyRep
          ? <button className="secundario" disabled={enviando} onClick={() => void accion("representante", { anotar: false }, "Ya no sos representante.")}>Dejar de ser representante</button>
          : <button className="primary" disabled={enviando || g.representantes.nuestros.length >= CLANES.representantes}
              onClick={() => void accion("representante", { anotar: true }, "Sos representante: anotá un caballo en cada carrera.")}>
              {g.representantes.nuestros.length >= CLANES.representantes ? "Ya hay 4 representantes" : "Anotarme como representante"}</button>}
        {g.carreras.map((cr) => <CarreraGuerra key={cr.n} cr={cr} hora={hora} soyRep={soyRep} listos={listos} enviando={enviando}
          alAnotar={(caballoId, estrategia) => void accion("anotarCaballo", { carrera: cr.n, caballoId, estrategia }, "Caballo anotado.")}
          alVer={() => ver(cr.setup, cr.resultado)} tabla={tablaResultado(cr)} />)}
        {mando && g.representantes.nuestros.filter((r) => !r.yo).length > 0 && <p className="nota">Sacar representante:{" "}
          {g.representantes.nuestros.filter((r) => !r.yo).map((r) => <button key={r.nombre} className="enlace" onClick={() => void accion("quitarRepresentante", { nombre: r.nombre })}>{r.nombre}</button>)}</p>}
      </div>}
      {aviso}

      <h3>Miembros</h3>
      <ul className="lista-clanes">
        {c.miembros.map((m) => (
          <li key={m.nombre}><b>{m.nombre}{m.yo ? " (vos)" : ""}</b><span className={`rol r-${m.rol}`}>{NOMBRE_ROL[m.rol]}</span>
            {!m.yo && c.miRol === "lider" && <span className="acciones-miembro">
              {m.rol === "miembro" && <button className="enlace" onClick={() => void accion("rol", { nombre: m.nombre, rol: "oficial" })}>Hacer oficial</button>}
              {m.rol === "oficial" && <button className="enlace" onClick={() => void accion("rol", { nombre: m.nombre, rol: "miembro" })}>Quitar oficial</button>}
              <button className="enlace" onClick={() => void accion("rol", { nombre: m.nombre, rol: "lider" }, `${m.nombre} es el nuevo líder.`)}>Pasar liderazgo</button>
              <button className="enlace peligro" onClick={() => void accion("expulsar", { nombre: m.nombre })}>Expulsar</button>
            </span>}
            {!m.yo && c.miRol === "oficial" && m.rol === "miembro" && <span className="acciones-miembro">
              <button className="enlace peligro" onClick={() => void accion("expulsar", { nombre: m.nombre })}>Expulsar</button></span>}
          </li>
        ))}
      </ul>

      {(e.historial ?? []).length > 0 && <>
        <h3>Guerras anteriores</h3>
        <ul className="lista-clanes">
          {e.historial!.map((h) => (
            <li key={h.id} className="historial-guerra">
              <button className="enlace" onClick={() => setVerHist(verHist === h.id ? null : h.id)}>
                <b className={`res-${h.resultado}`}>{h.resultado === "victoria" ? "Victoria" : h.resultado === "derrota" ? "Derrota" : "Empate"}</b> contra {h.rival} · {h.puntos.nuestros} a {h.puntos.rival}
                {h.elo ? ` · Elo ${miles(h.elo.antes)} → ${miles(h.elo.despues)}` : ""}</button>
              {verHist === h.id && h.carreras.map((cr) => <div key={cr.n} className="carrera-guerra">
                <div className="cg-cab"><b>Carrera {cr.n}</b><span>{cr.distancia === 500 ? "500 m" : "1.500 m"} · {cr.superficie === "cesped" ? "Césped" : "Tierra"}</span>
                  {cr.setup && <button className="secundario" onClick={() => ver(cr.setup, cr.resultado)}>Ver carrera</button>}</div>
                {tablaResultado(cr)}
                {cr.setup && <small className="nota">Semilla {cr.setup.input.seed} · {cr.setup.input.simVersion}: con esta entrada cualquiera repite la carrera y obtiene el mismo resultado.</small>}
              </div>)}
            </li>
          ))}
        </ul>
      </>}

      {saliendo
        ? <div className="dos"><button className="peligro" disabled={enviando} onClick={() => { setSaliendo(false); void accion("salir", {}, "Saliste del clan."); }}>Sí, salir del clan</button>
            <button className="secundario" onClick={() => setSaliendo(false)}>Cancelar</button></div>
        : <button className="enlace" onClick={() => setSaliendo(true)}>Salir del clan</button>}
    </section></div>
  );
}

/** Una carrera de la guerra: pendiente (anotar caballo) o corrida (resultado, puntos y repetición). */
function CarreraGuerra({ cr, hora, soyRep, listos, enviando, alAnotar, alVer, tabla }: {
  cr: red.CarreraGuerraVista; hora: number; soyRep: boolean; listos: Caballo[]; enviando: boolean;
  alAnotar: (caballoId: string, estrategia: Strategy) => void; alVer: () => void; tabla: ReactNode;
}) {
  const [cab, setCab] = useState(cr.mia?.caballoId ?? listos[0]?.id ?? "");
  const [est, setEst] = useState<Strategy>((cr.mia?.estrategia as Strategy) ?? "equilibrada");
  const dist = cr.distancia === 500 ? "500 m" : "1.500 m";
  return (
    <div className="carrera-guerra">
      <div className="cg-cab"><b>Carrera {cr.n}</b><span>{dist} · {cr.superficie === "cesped" ? "Césped" : "Tierra"}
        {cr.corrida ? " · corrió" : ` · cierra en ${restante(cr.cierra - hora)}`}</span>
        {cr.corrida && cr.setup && <button className="secundario" onClick={alVer}>Ver carrera</button>}</div>
      {!cr.corrida && <>
        <p className="nota">Anotados: {cr.anotados.nuestros.join(", ") || "nadie de tu clan"} · del rival: {cr.anotados.rival}.
          {" "}Corre cuando se anotan todos los representantes o al cerrar; el que no anotó corre con su mejor caballo listo.</p>
        {soyRep && <>
          {cr.mia && <p className="nota">Anotaste a <b>{cr.mia.caballo}</b> ({cr.mia.estrategia}). Podés cambiarlo hasta que corra.</p>}
          <div className="anotar-guerra">
            <select value={cab} onChange={(x) => setCab(x.target.value)} aria-label="Caballo">
              {listos.length === 0 && <option value="">No tenés caballos listos</option>}
              {listos.map((x) => <option key={x.id} value={x.id}>{x.nombre} · {tierDe(x).nombre}</option>)}
            </select>
            <select value={est} onChange={(x) => setEst(x.target.value as Strategy)} aria-label="Estrategia">
              {ESTRATEGIAS.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
            <button className="primary" disabled={enviando || !cab} onClick={() => alAnotar(cab, est)}>{cr.mia ? "Cambiar" : "Anotar"}</button>
          </div>
        </>}
      </>}
      {tabla}
    </div>
  );
}

// ------------------------------------------------------------------ monturas (§11.7)

function SelectorAspecto({ titulo, opciones, actual, alElegir }: {
  titulo: string; opciones: { id: string; nombre: string; color: string }[]; actual?: string; alElegir: (id: string | null) => void;
}) {
  return (
    <div className="selector-aspecto">
      <span>{titulo}</span>
      <div className="monturas">
        <button className={`chip-boton ${!actual ? "on" : ""}`} onClick={() => alElegir(null)}>Natural</button>
        {opciones.map((o) => (
          <button key={o.id} className={`chip-boton ${actual === o.id ? "on" : ""}`} onClick={() => alElegir(o.id)}>
            <i className="muestra-aspecto chica" style={{ background: o.color }} />{o.nombre.replace(/^(Crin y cola|Manta|Cascos|Cuero) /, "")}
          </button>
        ))}
      </div>
    </div>
  );
}

function SelectorMontura({ caballo: c, partida: p, alElegir }: { caballo: Caballo; partida: Partida; alElegir: (id: string | null) => void }) {
  const ms = p.monturas ?? [];
  if (ms.length === 0) return <p className="nota">Sin montura. Se compran en Objetivos y Gemas → Monturas.</p>;
  return (
    <div className="monturas">
      <button className={`chip-boton ${!c.monturaId ? "on" : ""}`} onClick={() => alElegir(null)}>Ninguna</button>
      {ms.map((m) => {
        const otro = portador(p, m.id);
        return (
          <button key={m.id} className={`chip-boton ${c.monturaId === m.id ? "on" : ""}`} onClick={() => alElegir(m.id)}
            title={otro && otro.id !== c.id ? `La tiene ${otro.nombre}: pasa a ${c.nombre}` : ""}>
            {MONTURAS[m.tipo].nombre.replace("Montura ", "")}{otro && otro.id !== c.id ? ` (de ${otro.nombre})` : ""}
          </button>
        );
      })}
    </div>
  );
}

const BONO_TXT = (b: number[]) => b.map((v, i) => (v ? `+${v} ${ATRIBUTOS[i]}` : "")).filter(Boolean).join(", ");

// ------------------------------------------------------------------ objetivos, gemas y monturas (§11.2, §11.4, §11.6, §11.7)

const MOTIVOS: Record<string, string> = {
  carrera: "Premio de carrera", "carrera:reducida": "Premio de carrera (reducido)", tutorial: "Bono de bienvenida", mejora: "Mejora de edificio",
  espacio: "Espacio del establo", cruza: "Cruza", "mercado:compra": "Compra en el mercado", "venta:juego": "Venta al juego",
  montura: "Montura", conversion: "Gemas a Oro", "objetivo:carreras": "Objetivo semanal", "objetivo:podios": "Objetivo semanal",
  "objetivo:entrenamientos": "Objetivo semanal", "acelerar:mejora": "Acelerar mejora", "acelerar:entrenando": "Acelerar entrenamiento",
  "acelerar:creciendo": "Acelerar crecimiento", "acelerar:cruza": "Acelerar cruza", entrada: "Recompensa por entrar", decoracion: "Decoración",
  "campeonato:inscripcion": "Inscripción al campeonato", "campeonato:premio": "Premio del campeonato", prueba: "Regalo para probar", nombre: "Nombre del campo", herraduras: "Herraduras",
};

/** Objetivos: solo misiones (§11.4), la recompensa por entrar, las carreras del día y los movimientos. */
function Objetivos({ partida: p, ahora, hacer, alVolver }: {
  partida: Partida; ahora: number; hacer: Hacer; alVolver: () => void;
}) {
  const copia = clonar(p);
  const sem = semanalDe(copia, ahora), dia = diarioDe(copia, ahora), entrada = estadoEntrada(copia, ahora);
  return (
    <div className="layout central">
      <section className="hoja">
        <header className="cabecera">
          <div>
            <button className="volver" onClick={alVolver}>← Campo</button>
            <h1>Objetivos</h1>
          </div>
          <div className="monedas">
            <span title="Oro"><i className="oro" />{miles(p.oro)}</span>
            <span title="Gemas"><i className="gema" />{miles(p.gemas)}</span>
          </div>
        </header>
        <div className="columnas">
          <div>
            <h3>Objetivos de la semana</h3>
            <p className="nota">Se reinician el lunes a las 00:00 (faltan {restante(finDeLaSemana(ahora) - ahora)}).</p>
            {OBJETIVOS.map((o) => {
              const v = Math.min(o.meta, sem[o.id]), hecho = sem.cobrados.includes(o.id);
              return (
                <div className="objetivo" key={o.id}>
                  <div><b>{o.texto}</b><small>{miles(o.oro)} Oro + {o.gemas} {o.gemas === 1 ? "Gema" : "Gemas"}</small></div>
                  <div className="bar"><i style={{ width: `${(v / o.meta) * 100}%` }} /></div>
                  <span className="cuenta">{v}/{o.meta}</span>
                  {hecho ? <span className="cobrado">Cobrado</span>
                    : <button className="primary" disabled={v < o.meta} onClick={() => hacer("cobrarObjetivo", { id: o.id })}>Cobrar</button>}
                </div>
              );
            })}
            <h3>Recompensa por entrar</h3>
            <div className="racha">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <span key={d} className={d < entrada.dia || (d === entrada.dia && !entrada.disponible) ? "hecho" : d === entrada.dia ? "hoy" : ""}>{d}</span>
              ))}
            </div>
            <p className="nota">{entrada.disponible ? `Hoy toca el día ${entrada.dia}: ${miles(entrada.oro)} Oro${entrada.gemas ? ` y ${entrada.gemas} Gemas` : ""}.` : "Ya cobraste la de hoy. Mañana sigue la racha; si salteás un día, vuelve al día 1."}</p>
            {entrada.disponible && <button className="primary" onClick={() => hacer("cobrarEntrada")}>Cobrar</button>}
            <h3>Carreras de hoy</h3>
            <p className="nota"><b>{Math.min(dia.carrerasPagadas, CARRERAS_COMPLETAS)} de {CARRERAS_COMPLETAS}</b> con premio completo.
              Después de {CARRERAS_COMPLETAS}, los premios del día pagan el 25 %. Se reinicia en {restante(finDelDia(ahora) - ahora)}.</p>
          </div>
          <div>
            <h3>Últimos movimientos</h3>
            {(p.ledger ?? []).length === 0 && <p className="nota">Todavía no hay movimientos.</p>}
            <ul className="movimientos">
              {(p.ledger ?? []).slice(0, 16).map((m, k) => (
                <li key={k}><span>{MOTIVOS[m.motivo] ?? m.motivo}</span>
                  <b className={m.cantidad > 0 ? "mas" : "menos"}>{m.cantidad > 0 ? "+" : ""}{miles(m.cantidad)} {m.moneda === "oro" ? "Oro" : "Gemas"}</b></li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ pestañas del Mercado

/** Fase 6.5: herraduras. Bajan el riesgo de lesión; no dan velocidad ni se ven en el caballo. */
/** Tier del caballo (Fase 5.5): Bronce a Diamante según su tiempo esperado en las dos distancias. */
function ChipTier({ caballo: c }: { caballo: Caballo }) {
  const t = tierDe(c);
  return <span className="chip tier" style={{ borderColor: t.color, color: t.color }} title={`Índice ${indiceDe(atributos(c)).toLocaleString("es-AR", { maximumFractionDigits: 1 })}: cuánto más rápido es que un caballo de 60 en todo. Las carreras contra la IA ponen rivales de tu mismo nivel.`}>{t.nombre}</span>;
}

const BIENESTAR_TXT = `${BIENESTAR.carga.bajaPorHora} puntos por hora`;
const TXT_RIESGO = { bajo: "Bajo", medio: "Medio", alto: "Alto" } as const;
const pct = (r: number) => `${(r * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;

/** Ficha → Bienestar: carga, riesgo de lesión y herraduras (Fase 6.5). */
function Bienestar({ caballo: c, partida: p, ahora, alHerrar }: { caballo: Caballo; partida: Partida; ahora: number; alHerrar: (id: TipoHerradura) => void }) {
  const carga = cargaDe(c, ahora), r = riesgoDe(c, ahora), nivel = nivelRiesgo(r);
  const inv = p.herraduras ?? {};
  const h = c.herraduras ? herradura(c.herraduras.id) : null;
  return (
    <>
      <h3>Bienestar</h3>
      <div className="sangre"><span>Carga</span><div className={`bar carga c-${nivel}`}><i style={{ width: `${carga}%` }} /></div><b>{Math.round(carga)}</b></div>
      <p className="nota">Riesgo de lesión en la próxima carrera: <b className={`riesgo r-${nivel}`}>{TXT_RIESGO[nivel]} ({pct(r)})</b>.
        {carga > 0 ? ` La carga baja ${BIENESTAR_TXT}.` : " Descansado."}</p>
      <p className="nota">{h ? <>Herraduras: <b>{h.nombre}</b>, les quedan {c.herraduras!.carreras} carrera{c.herraduras!.carreras === 1 ? "" : "s"}.</>
        : <>Sin herraduras: el riesgo es más alto.</>}</p>
      {(Object.keys(inv) as TipoHerradura[]).filter((id) => inv[id]).map((id) => (
        <button key={id} className="secundario" onClick={() => alHerrar(id)}>
          Poner {herradura(id)?.nombre.toLowerCase()} ({inv[id]} sin poner){h ? " · reemplaza las actuales" : ""}
        </button>
      ))}
      {!Object.values(inv).some(Boolean) && !h && <p className="nota">Las herraduras se compran en Mercado → Herraduras.</p>}
    </>
  );
}

function TiendaHerraduras({ partida: p, hacer }: { partida: Partida; hacer: Hacer }) {
  const inv = p.herraduras ?? {};
  const [para, setPara] = useState<string>(() => p.caballos.find((c) => !c.herraduras)?.id ?? p.caballos[0]?.id ?? "");
  const destino = p.caballos.find((c) => c.id === para) ?? null;
  return (
    <>
      <label className="para-caballo">
        <span>Comprar para</span>
        <select value={para} onChange={(e) => setPara(e.target.value)} aria-label="Caballo al que se le ponen las herraduras">
          {p.caballos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre} · {c.herraduras ? `${herradura(c.herraduras.id)?.nombre.toLowerCase()} (${c.herraduras.carreras} carreras)` : "sin herraduras"}
            </option>
          ))}
          <option value="">Guardar sin poner (se ponen después desde la ficha)</option>
        </select>
      </label>
      {destino?.herraduras && <p className="nota">{destino.nombre} ya tiene herraduras puestas: las nuevas reemplazan a las actuales y se pierden las carreras que les quedaban.</p>}
      <p className="nota">Cada carrera suma <b>carga</b> al caballo, y la carga baja descansando. Con mucha carga sube el riesgo de lesionarse:
        el lesionado no termina la carrera, no cobra premio y pasa más tiempo en el Centro de recuperación. Las herraduras bajan ese riesgo
        (sin herraduras es un 50 % más alto). No dan velocidad. Al comprar se le ponen al caballo elegido arriba.</p>
      <div className="grilla-tienda">
        {HERRADURAS.map((h) => {
          const puestas = p.caballos.filter((c) => c.herraduras?.id === h.id).length;
          const alcanza = h.gemas !== undefined ? p.gemas >= h.gemas : p.oro >= (h.oro ?? 0);
          return (
            <div className="montura-item" key={h.id}>
              <div><b>{h.nombre}</b><small>{h.descripcion} Duran {h.carreras} carreras · riesgo ×{h.factor.toLocaleString("es-AR")}</small>
                <small>{inv[h.id as TipoHerradura] ? `Tenés ${inv[h.id as TipoHerradura]} sin poner` : "No tenés juegos sin poner"}{puestas ? ` · puestas en ${puestas} caballo${puestas > 1 ? "s" : ""}` : ""}</small></div>
              <button className="secundario" disabled={!alcanza} onClick={() => hacer("comprarYHerrar", { tipo: h.id, id: destino?.id ?? null })}>
                {h.gemas !== undefined ? <><i className="gema" />{h.gemas}</> : <><i className="oro" />{miles(h.oro ?? 0)}</>}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function TiendaMonturas({ partida: p, hacer }: { partida: Partida; hacer: Hacer }) {
  return (
    <>
      <p className="nota">Una por caballo. Se ponen y se cambian desde la ficha de cada caballo, fuera de carrera. Los atributos no pasan de 100.</p>
      <div className="grilla-tienda">
        {TIPOS_MONTURA.map((t: TipoMontura) => {
          const tengo = (p.monturas ?? []).filter((m) => m.tipo === t);
          return (
            <div className="montura-item" key={t}>
              <div><b>{MONTURAS[t].nombre}</b><small>{BONO_TXT(MONTURAS[t].bono)}{tengo.length ? ` · tenés ${tengo.length}` : ""}</small>
                {tengo.map((m) => { const q = portador(p, m.id); return q ? <small key={m.id}>Puesta en {q.nombre}</small> : null; })}</div>
              <div className="dos">
                <button className="secundario" disabled={p.oro < PRECIO_MONTURA.oro} onClick={() => hacer("comprarMontura", { tipo: t, moneda: "oro" })}><i className="oro" />{miles(PRECIO_MONTURA.oro)}</button>
                <button className="secundario" disabled={p.gemas < PRECIO_MONTURA.gemas} onClick={() => hacer("comprarMontura", { tipo: t, moneda: "gemas" })}><i className="gema" />{PRECIO_MONTURA.gemas}</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function TiendaDecoracion({ partida: p, alPoner, hacer }: { partida: Partida; alPoner: (id: string) => void; hacer: Hacer }) {
  const dep = p.decoracion?.deposito ?? {};
  const [nombre, setNombre] = useState(nombreCampo(p));
  const costo = costoNombre(p);
  return (
    <>
      <form className="hoja-interna editar-nombre" onSubmit={(e) => { e.preventDefault(); hacer("renombrarCampo", { nombre }); }}>
        <div className="eyebrow">Nombre del establecimiento</div>
        <div className="dos">
          <input maxLength={NOMBRE_CAMPO.largoMaximo} value={nombre} onChange={(e) => setNombre(e.target.value)} aria-label="Nombre del establecimiento" />
          <button type="submit" className="primary" disabled={nombre.trim().length < 2 || nombre.trim() === nombreCampo(p) || p.gemas < costo}>
            {costo ? <>Cambiar · {costo} <i className="gema" /></> : "Cambiar (gratis)"}
          </button>
        </div>
        <small className="nota">{costo ? `Cada cambio cuesta ${NOMBRE_CAMPO.gemasCambio} Gemas.` : `El primer cambio es gratis; los siguientes cuestan ${NOMBRE_CAMPO.gemasCambio} Gemas.`}</small>
      </form>
      <p className="nota">Adornos para tu campo: no dan ventajas. Al elegir uno vas al campo: tocás la casilla donde lo querés, lo ves ahí y recién ahí lo comprás.</p>
      <button className="primary acomodar" onClick={() => alPoner("")}>
        <b>Acomodar el campo</b>
        <small>Mover, girar o guardar lo que ya tenés: adornos, edificios, potrero y molino</small>
      </button>
      <ul className="catalogo grilla-tienda">
        {CATALOGO.map((o) => {
          const enDep = dep[o.id] ?? 0;
          const alcanza = enDep > 0 || (o.gemas !== undefined ? p.gemas >= o.gemas : p.oro >= (o.oro ?? 0));
          return (
            <li key={o.id}>
              <button className="item-deco" disabled={!alcanza} onClick={() => alPoner(o.id)}>
                <b>{o.nombre}</b>
                <small>{o.w}×{o.h} {o.w * o.h === 1 ? "casilla" : "casillas"}{o.sobreCamino ? " · va sobre caminos" : ""}{enDep ? ` · ${enDep} en el depósito` : ""}</small>
                <em>{enDep ? "Gratis" : o.gemas !== undefined ? <><i className="gema" />{o.gemas}</> : <><i className="oro" />{miles(o.oro ?? 0)}</>}</em>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function TiendaAspecto({ partida: p, hacer }: { partida: Partida; hacer: Hacer }) {
  const tipos: TipoAspecto[] = ["crin", "cascos", "manta", "montura"];
  return (
    <>
      <p className="nota">Solo cambian cómo se ven tus caballos y monturas: no dan ventaja y no se heredan. Cada compra queda para todo tu establo; se pone desde la ficha de cada caballo.</p>
      {tipos.map((t) => (
        <div key={t}>
          <h3>{NOMBRE_TIPO[t]}</h3>
          <div className="grilla-tienda">
            {ASPECTOS.filter((a) => a.tipo === t).map((a) => (
              <div className="item-aspecto" key={a.id}>
                <i className="muestra-aspecto" style={{ background: a.color }} />
                <b>{a.nombre}</b>
                {tiene(p, a.id) ? <span className="cobrado">Comprado</span>
                  : <button className="secundario" disabled={p.gemas < a.gemas} onClick={() => hacer("comprarAspecto", { id: a.id })}><i className="gema" />{a.gemas}</button>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function TiendaOro({ partida: p, ahora, hacer }: { partida: Partida; ahora: number; hacer: Hacer }) {
  const copia = clonar(p);
  const conv = Math.min(p.gemas, gemasConvertiblesHoy(copia, ahora));
  const [n, setN] = useState(1);
  const cant = Math.max(1, Math.min(n, Math.max(1, conv)));
  return (
    <>
      <h3>Comprar Oro con Gemas</h3>
      <p className="nota">1 Gema = {ORO_POR_GEMA} Oro, hasta 10 Gemas por día (para que pagar acelere, pero no compre carreras). Hoy podés cambiar {gemasConvertiblesHoy(copia, ahora)} más.</p>
      <div className="convertir">
        <button className="secundario" disabled={cant <= 1} onClick={() => setN(cant - 1)}>−</button>
        <b>{conv > 0 ? cant : 0}</b>
        <button className="secundario" disabled={cant >= conv} onClick={() => setN(cant + 1)}>+</button>
        <button className="primary" disabled={conv < 1} onClick={() => { hacer("convertirGemas", { cantidad: cant }); setN(1); }}>
          Comprar {miles(cant * ORO_POR_GEMA)} Oro · <i className="gema" />{cant}</button>
      </div>
    </>
  );
}

function TiendaGemas() {
  return (
    <>
      <h3>Comprar Gemas</h3>
      <p className="nota">Las Gemas se compran con dinero real. El cobro se habilita cuando el juego tenga servidor y pagos validados (Fases 11 y 12); por ahora los paquetes se muestran sin poder comprarlos.</p>
      <div className="paquetes">
        {PAQUETES_GEMAS.map(([g, precio]) => (
          <div className="paquete" key={g}>
            <i className="gema grande" /><b>{g} Gemas</b><span>{precio}</span>
            <button className="secundario" disabled>Próximamente</button>
          </div>
        ))}
      </div>
    </>
  );
}

function Barra({ nombre, natural, entreno, techo, montura = 0 }: { nombre: string; natural: number; entreno: number; techo: number; montura?: number }) {
  const total = Math.min(100, natural + entreno + montura);
  return (
    <div className="attr2">
      <span>{nombre}</span>
      <div className="bar">
        <i style={{ width: `${natural}%` }} />
        {entreno > 0 && <i className="entreno" style={{ width: `${entreno}%` }} />}
        {montura > 0 && <i className="montura" style={{ width: `${montura}%` }} />}
        <em style={{ left: `${techo}%` }} title={`Techo genético: ${techo}`} />
      </div>
      <b>{total}</b>
      <small>{rango(total)}</small>
    </div>
  );
}
