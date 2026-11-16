// Cuentas (Fase 7): nombre y contraseña. La contraseña se guarda con scrypt y sal; la sesión es un token al azar
// del que solo se guarda el hash. Sin datos personales: no pedimos correo ni nombre real.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Base } from "./db.ts";

const DIAS_SESION = 30;
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function validarNombre(nombre: string): string | null {
  const n = nombre.trim();
  if (n.length < 3 || n.length > 20) return "El nombre de usuario debe tener entre 3 y 20 letras.";
  if (!/^[\p{L}\p{N}_ .-]+$/u.test(n)) return "Usá solo letras, números, espacios, punto, guion o guion bajo.";
  return null;
}
export function validarClave(clave: string): string | null {
  return clave.length < 8 ? "La contraseña debe tener al menos 8 caracteres." : clave.length > 200 ? "La contraseña es demasiado larga." : null;
}

function hashClave(clave: string, sal: string): string { return scryptSync(clave, sal, 64).toString("hex"); }

export function registrar(db: Base, nombre: string, clave: string, ahora: number): { ok: true; usuario: number } | { ok: false; motivo: string } {
  const e = validarNombre(nombre) ?? validarClave(clave);
  if (e) return { ok: false, motivo: e };
  if (db.usuarioPorNombre(nombre.trim())) return { ok: false, motivo: "Ese nombre de usuario ya existe." };
  const sal = randomBytes(16).toString("hex");
  return { ok: true, usuario: db.crearUsuario(nombre.trim(), hashClave(clave, sal), sal, ahora) };
}

export function entrar(db: Base, nombre: string, clave: string): { ok: true; usuario: number } | { ok: false; motivo: string } {
  const u = db.usuarioPorNombre(nombre.trim());
  const malo = { ok: false as const, motivo: "Usuario o contraseña incorrectos." };
  if (!u) { hashClave(clave, "sal-falsa"); return malo; }   // mismo tiempo exista o no el usuario
  const a = Buffer.from(hashClave(clave, u.sal), "hex"), b = Buffer.from(u.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? { ok: true, usuario: u.id } : malo;
}

export function nuevaSesion(db: Base, usuario: number, ahora: number): string {
  const token = randomBytes(32).toString("hex");
  db.guardarSesion(hashToken(token), usuario, ahora + DIAS_SESION * 86_400_000);
  return token;
}
