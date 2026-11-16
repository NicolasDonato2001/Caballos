// Modelos low poly de la decoración del campo (GDD v0.2 §11.5). Cada objeto se arma con primitivas y colores planos,
// centrado en su huella (ancho × alto en celdas de 2 m, antes de rotar) y apoyado en el suelo (y = 0).
// Devuelve una sola malla (las piezas se unen con varios materiales) para que cada objeto cueste pocas llamadas de dibujo.
import { Color3, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";

type Mat = (color: string) => StandardMaterial;

export function construirDeco(scene: Scene, id: string, mat: Mat, nombre: string): Mesh | null {
  const piezas: Mesh[] = [];
  const caja = (w: number, h: number, d: number, x: number, y: number, z: number, color: string, ry = 0) => {
    const b = MeshBuilder.CreateBox("p", { width: w, height: h, depth: d }, scene);
    b.position.set(x, y + h / 2, z); b.rotation.y = ry; b.material = mat(color); piezas.push(b); return b;
  };
  const cil = (h: number, dTop: number, dBot: number, x: number, y: number, z: number, color: string, tes = 8) => {
    const c = MeshBuilder.CreateCylinder("p", { height: h, diameterTop: dTop, diameterBottom: dBot, tessellation: tes }, scene);
    c.position.set(x, y + h / 2, z); c.material = mat(color); piezas.push(c); return c;
  };
  const bola = (r: number, x: number, y: number, z: number, color: string, sy = 1) => {
    const b = MeshBuilder.CreateIcoSphere("p", { radius: r, subdivisions: 1, flat: true }, scene);
    b.position.set(x, y, z); b.scaling.y = sy; b.material = mat(color); piezas.push(b); return b;
  };
  const MADERA = "#8b6239", MADERA_OSC = "#6b4a2e", HIERRO = "#2f2f2f", LADRILLO = "#a8583a", PIEDRA = "#a9a49a",
    CAL = "#f1ead8", VERDE = "#4f7a38", PASTO = "#d9c070";

  switch (id) {
    case "camino": {
      const t = MeshBuilder.CreateGround("p", { width: 2.02, height: 2.02 }, scene);
      t.position.y = 0.066; t.material = mat("#c9a774"); piezas.push(t);
      break;
    }
    case "banco": {
      caja(1.6, 0.08, 0.45, 0, 0.45, 0, MADERA);
      caja(1.6, 0.4, 0.06, 0, 0.6, 0.2, MADERA);
      for (const x of [-0.7, 0.7]) caja(0.08, 0.45, 0.45, x, 0, 0, HIERRO);
      break;
    }
    case "maceta": {
      cil(0.55, 0.75, 0.5, 0, 0, 0, "#b5643a", 8);
      bola(0.42, 0, 0.82, 0, VERDE, 0.75);
      for (let k = 0; k < 6; k++) bola(0.1, Math.cos(k) * 0.28, 1.0 + (k % 2) * 0.06, Math.sin(k) * 0.28, "#d9534f");
      break;
    }
    case "farol": {
      cil(2.4, 0.08, 0.12, 0, 0, 0, HIERRO, 6);
      caja(0.36, 0.45, 0.36, 0, 2.4, 0, "#f3e3a0").material!.emissiveColor = new Color3(0.55, 0.45, 0.2);
      cil(0.25, 0, 0.55, 0, 2.85, 0, HIERRO, 4);
      break;
    }
    case "fardos": {
      for (const [x, y, z] of [[-0.35, 0, 0], [0.35, 0, 0], [0, 0.75, 0]] as const) {
        const f = cil(1.2, 0.7, 0.7, x, 0, z, PASTO, 8);
        f.rotation.x = Math.PI / 2; f.position.y = y + 0.35;
      }
      break;
    }
    case "cantero": {
      caja(3.6, 0.35, 1.5, 0, 0, 0, LADRILLO);
      caja(3.4, 0.05, 1.3, 0, 0.35, 0, "#5a3f2a");
      const colores = ["#d9534f", "#f2cf44", "#b88fd8", "#f4efe2"];
      for (let k = 0; k < 14; k++) {
        const x = -1.5 + (k % 7) * 0.5, z = k < 7 ? -0.3 : 0.3;
        bola(0.16, x, 0.55, z, VERDE, 0.8);
        bola(0.09, x, 0.68, z, colores[k % colores.length]);
      }
      break;
    }
    case "paraiso": {
      cil(1.8, 0.2, 0.32, 0, 0, 0, "#6d4c33", 6);
      bola(1.0, 0, 2.3, 0, "#5f8a46", 0.75);
      bola(0.6, 0.55, 2.1, 0.2, "#6b9450", 0.8);
      bola(0.55, -0.45, 2.2, -0.3, "#5f8a46", 0.8);
      break;
    }
    case "bebedero": {
      caja(3.2, 0.6, 1.0, 0, 0, 0, PIEDRA);
      caja(2.9, 0.02, 0.7, 0, 0.58, 0, "#5f9cc0");
      break;
    }
    case "tranquera": {
      for (const x of [-2.75, 2.75]) cil(1.9, 0.26, 0.32, x, 0, 0, MADERA_OSC, 6);
      for (let i = 0; i < 5; i++) caja(5.3, 0.1, 0.07, 0, 0.25 + i * 0.27, 0, "#a57c50");
      const d = caja(5.5, 0.1, 0.07, 0, 0.6, 0.05, "#a57c50");
      d.rotation.z = 0.2;
      break;
    }
    case "carreta": {
      caja(2.4, 0.5, 1.4, 0, 0.9, 0, MADERA);
      caja(2.4, 0.08, 1.4, 0, 0.85, 0, MADERA_OSC);
      for (const z of [-0.85, 0.85]) {
        const r = cil(0.12, 1.5, 1.5, 0.2, 0, z, MADERA_OSC, 12);
        r.rotation.x = Math.PI / 2; r.position.y = 0.75;
        const e = cil(0.18, 0.25, 0.25, 0.2, 0, z, HIERRO, 6);
        e.rotation.x = Math.PI / 2; e.position.y = 0.75;
      }
      for (const z of [-0.4, 0.4]) caja(1.8, 0.08, 0.08, -2.0, 0.55, z, MADERA_OSC).rotation.z = -0.25;
      caja(2.0, 0.25, 1.1, 0, 1.4, 0, PASTO);
      break;
    }
    case "aljibe": {
      cil(0.9, 1.6, 1.7, 0, 0, 0, CAL, 12);
      cil(0.1, 1.75, 1.75, 0, 0.9, 0, LADRILLO, 12);
      for (const x of [-0.75, 0.75]) caja(0.15, 1.6, 0.15, x, 1.0, 0, HIERRO);
      caja(1.7, 0.1, 0.1, 0, 2.55, 0, HIERRO);
      cil(0.3, 0.3, 0.3, 0, 2.2, 0, HIERRO, 8).rotation.z = Math.PI / 2;
      caja(1.9, 0.08, 1.0, 0, 2.7, 0, "#3f6b4f").rotation.x = 0.15;
      cil(0.3, 0.32, 0.26, 0.4, 0.95, 0.4, "#8a8f93", 7);
      break;
    }
    case "asador": {
      caja(2.6, 0.9, 1.0, 0, 0, -0.5, LADRILLO);
      caja(2.4, 0.06, 0.8, 0, 0.9, -0.5, HIERRO);
      caja(0.7, 1.6, 0.6, 1.0, 0.9, -0.7, LADRILLO);
      caja(0.5, 0.15, 0.5, 1.0, 2.5, -0.7, "#7c2e22");
      for (let k = 0; k < 4; k++) caja(0.3, 0.06, 0.15, -0.8 + k * 0.4, 0.97, -0.45, "#7a3a19");   // chorizos y tiras
      caja(2.2, 0.08, 0.4, 0, 0.45, 1.1, MADERA);
      for (const x of [-0.9, 0.9]) caja(0.08, 0.45, 0.4, x, 0, 1.1, MADERA_OSC);
      break;
    }
    case "glorieta": {
      cil(0.2, 5.4, 5.4, 0, 0, 0, PIEDRA, 6);
      for (let k = 0; k < 6; k++) cil(2.6, 0.18, 0.18, Math.cos(k * Math.PI / 3) * 2.4, 0.2, Math.sin(k * Math.PI / 3) * 2.4, CAL, 6);
      cil(1.5, 0, 6.0, 0, 2.8, 0, "#7c2e22", 6);
      cil(0.3, 0.1, 0.1, 0, 4.3, 0, HIERRO, 4);
      caja(1.6, 0.08, 0.4, 0, 0.6, 1.4, MADERA);
      break;
    }
    case "mangrullo": {
      for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]] as const) {
        const p = cil(6, 0.16, 0.24, x, 0, z, MADERA_OSC, 5);
        p.rotation.z = -x * 0.04; p.rotation.x = z * 0.04;
      }
      caja(2.4, 0.12, 2.4, 0, 5.2, 0, MADERA);
      for (const s of [-1, 1]) { caja(2.4, 0.08, 0.08, 0, 6.0, s * 1.15, MADERA); caja(0.08, 0.08, 2.4, s * 1.15, 6.0, 0, MADERA); }
      cil(1.2, 0, 3.2, 0, 6.6, 0, "#8a7a5a", 4).rotation.y = Math.PI / 4;
      for (let k = 0; k < 9; k++) caja(0.7, 0.06, 0.08, 0, 0.5 + k * 0.55, -1.05, MADERA);   // escalera
      break;
    }
    case "fuente": {
      const borde = MeshBuilder.CreateTorus("p", { diameter: 4.6, thickness: 0.5, tessellation: 16 }, scene);
      borde.position.y = 0.4; borde.scaling.y = 1.6; borde.material = mat(CAL); piezas.push(borde);
      cil(0.5, 4.4, 4.4, 0, 0, 0, PIEDRA, 16);
      cil(0.05, 4.2, 4.2, 0, 0.5, 0, "#5f9cc0", 16);
      cil(1.4, 0.4, 0.6, 0, 0.5, 0, CAL, 8);
      cil(0.25, 1.5, 1.2, 0, 1.9, 0, CAL, 10);
      cil(0.6, 0.2, 0.3, 0, 2.15, 0, "#8fc4e0", 6).material!.alpha = 0.8;
      break;
    }
    case "estatua": case "estatuaOro": {
      caja(2.0, 1.2, 1.2, 0, 0, 0, id === "estatuaOro" ? "#f1ead8" : PIEDRA);
      caja(2.2, 0.12, 1.4, 0, 1.2, 0, CAL);
      break;   // el caballo de bronce u oro lo pone el campo (usa el modelo de los caballos)
    }
    case "portal": {
      for (const x of [-3.4, 3.4]) { caja(1.0, 3.6, 1.0, x, 0, 0, LADRILLO); caja(1.2, 0.2, 1.2, x, 3.6, 0, CAL); }
      caja(7.8, 0.8, 0.5, 0, 3.4, 0, MADERA_OSC);
      const tex = new DynamicTexture(`portalTex${nombre}`, { width: 512, height: 64 }, scene, false);
      tex.drawText("ESTANCIA", null, 50, "bold 48px Georgia", "#f2cf44", "#4a2f1d", true, true);
      const tm = new StandardMaterial(`portalMat${nombre}`, scene); tm.diffuseTexture = tex; tm.specularColor = Color3.Black();
      for (const s of [-1, 1]) {
        const cartel = MeshBuilder.CreatePlane("p", { width: 6.4, height: 0.7 }, scene);
        cartel.position.set(0, 3.8, s * 0.27); cartel.rotation.y = s > 0 ? Math.PI : 0; cartel.material = tm; piezas.push(cartel);
      }
      for (const s of [-1, 1]) for (let k = 0; k < 6; k++) caja(0.06, 1.6, 0.06, s * (0.3 + k * 0.45), 0, 0, HIERRO);
      for (const s of [-1, 1]) caja(2.8, 0.08, 0.08, s * 1.45, 1.4, 0, HIERRO);
      break;
    }
    case "faroles": {
      for (const x of [-0.35, 0.35]) {
        cil(2.8, 0.06, 0.1, x, 0, 0, HIERRO, 6);
        const l = caja(0.3, 0.38, 0.3, x, 2.75, 0, "#f6e7a8");
        l.material!.emissiveColor = new Color3(0.6, 0.5, 0.25);
        cil(0.2, 0, 0.45, x, 3.13, 0, HIERRO, 4);
      }
      caja(1.0, 0.06, 0.06, 0, 2.4, 0, HIERRO);
      break;
    }
    default: return null;
  }
  const u = Mesh.MergeMeshes(piezas, true, true, undefined, false, true);
  if (!u) return null;
  u.name = nombre;
  return u;
}

/** Posición del centro de un objeto en el mundo a partir de su celda de esquina y su tamaño ya rotado. */
export function centroDe(cx: number, cz: number, w: number, h: number, celda: number): Vector3 {
  return new Vector3((cx + w / 2) * celda, 0, (cz + h / 2) * celda);
}
