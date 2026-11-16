// Escenario del hipódromo: pista (césped o tierra), barandas tipo "cuello de cisne", postes de distancia con carteles,
// poste de llegada con disco, casilla del juez con la cámara de foto final, partidor con gateras numeradas,
// tribuna con público frente a la recta final, marcador, torres de luz y canteros.
// Referencias: hipódromos de Palermo y San Isidro; glosarios de pista (riel interno, postes de distancia, partidor
// detrás de la línea, poste de llegada, cámara de foto final en la línea).
import {
  Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3, DynamicTexture,
} from "@babylonjs/core";
import { Course } from "./course.ts";
import { CLOTH_COLORS } from "./horse.ts";

export interface Hipodromo {
  meshes: Mesh[];
  /** Muestra los cuatro primeros en el marcador. */
  marcador(orden: number[]): void;
  /** Abre las puertas de las gateras (animación de la largada). */
  abrirGateras(): void;
}

export function buildTrack(scene: Scene, course: Course, surface: "cesped" | "tierra"): Hipodromo {
  const made: Mesh[] = [];
  const m = (name: string, hex: string, spec = 0.05) => {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor = Color3.FromHexString(hex);
    mat.specularColor = new Color3(spec, spec, spec);
    return mat;
  };

  // Terreno general
  const ground = MeshBuilder.CreateGround("terreno", { width: 1400, height: 1400, subdivisions: 2 }, scene);
  ground.position.set(course.distance === 500 ? 120 : -20, -0.05, 120);
  const gm = m("terrenoMat", "#5d7f45");
  ground.material = gm; ground.receiveShadows = true; made.push(ground);

  // Superficie de carrera
  const w = course.width;
  const inner = course.path(-0.2, 2, 0.02), outer = course.path(w, 2, 0.02);
  const surf = MeshBuilder.CreateRibbon("pista", { pathArray: [inner, outer], sideOrientation: Mesh.DOUBLESIDE }, scene);
  const sm = m("pistaMat", surface === "cesped" ? "#4f8a3a" : "#9a7650");
  surf.material = sm; surf.receiveShadows = true; made.push(surf);

  // Franjas de césped cortado (lectura de velocidad) o huellas en la tierra
  const stripeMat = m("franjaMat", surface === "cesped" ? "#5b9844" : "#8c6a47");
  for (let k = 0; k < Math.floor(w / 2.4); k += 2) {
    const a = course.path(k * 2.4 + 0.2, 2, 0.03), b = course.path(k * 2.4 + 2.6, 2, 0.03);
    const st = MeshBuilder.CreateRibbon(`franja${k}`, { pathArray: [a, b], sideOrientation: Mesh.DOUBLESIDE }, scene);
    st.material = stripeMat; st.receiveShadows = true; made.push(st);
  }

  // Barandas blancas de seguridad: el tubo queda volado hacia la pista sobre un brazo ("cuello de cisne"),
  // así el poste está lejos de las patas de los caballos.
  const railMat = m("barandaMat", "#f4f2ec", 0.25);
  for (const [nm, off, dir] of [["barandaInt", -0.3, -1], ["barandaExt", w + 0.3, 1]] as const) {
    const path = course.path(off, 4, 1.05);
    const tube = MeshBuilder.CreateTube(nm, { path, radius: 0.07, tessellation: 8 }, scene);
    tube.material = railMat; made.push(tube);
    const post = MeshBuilder.CreateCylinder(`${nm}_poste`, { height: 1.0, diameter: 0.09, tessellation: 6 }, scene);
    post.material = railMat; made.push(post);
    const brazo = MeshBuilder.CreateBox(`${nm}_brazo`, { width: 0.06, height: 0.06, depth: 0.5 }, scene);
    brazo.material = railMat; made.push(brazo);
    const pm: Matrix[] = [], bm2: Matrix[] = [];
    for (let s0 = -course.preRun; s0 <= course.distance + course.postRun; s0 += 3) {
      const r = course.rail(s0), o = Course.outward(r.heading);
      const q = Quaternion.FromEulerAngles(0, Math.atan2(o.x, o.z), 0);
      const px = r.x + o.x * (off + dir * 0.45), pz = r.z + o.z * (off + dir * 0.45);
      pm.push(Matrix.Compose(new Vector3(1, 1, 1), Quaternion.Identity(), new Vector3(px, 0.5, pz)));
      bm2.push(Matrix.Compose(new Vector3(1, 1, 1), q, new Vector3(r.x + o.x * (off + dir * 0.22), 1.0, r.z + o.z * (off + dir * 0.22))));
    }
    post.thinInstanceAdd(pm); brazo.thinInstanceAdd(bm2);
  }

  // Meta: poste, franja y cartel
  const fin = course.rail(course.distance);
  const o = Course.outward(fin.heading);
  /** Del lado de afuera y cerca de la llegada (de 170 m antes a 110 m después): ahí no va nada alto. En 1.500 m la
   *  salida está en el mismo lugar que la llegada, así que se mide en el mundo y no por metros recorridos. */
  const cercaDeLaMeta = (x: number, z: number) => {
    const dx = x - fin.x, dz = z - fin.z;
    const along = dx * Math.cos(fin.heading) + dz * Math.sin(fin.heading), lateral = dx * o.x + dz * o.z;
    return lateral > 0 && along > -170 && along < 110;
  };
  const finishLine = MeshBuilder.CreateGround("lineaMeta", { width: 0.4, height: w + 0.6 }, scene);
  finishLine.position.set(fin.x + o.x * (w / 2), 0.05, fin.z + o.z * (w / 2));
  finishLine.rotation.y = Math.atan2(Math.sin(fin.heading), -Math.cos(fin.heading)); // eje largo hacia afuera
  finishLine.material = m("metaMat", "#f7f7f7", 0.1); made.push(finishLine);
  // Solo del lado de adentro: del lado de afuera la línea queda libre para la cámara de meta (como en los hipódromos).
  {
    const pole = MeshBuilder.CreateCylinder("posteMeta", { height: 3.0, diameter: 0.2, tessellation: 10 }, scene);
    pole.position.set(fin.x - o.x * 0.9, 1.5, fin.z - o.z * 0.9);
    pole.material = m("posteMetaMat", "#f4f2ec", 0.3); made.push(pole);
  }
  // Poste de llegada (lado interno): disco rojo y blanco que marca la línea exacta
  const disco = MeshBuilder.CreateCylinder("discoLlegada", { height: 0.08, diameter: 1.1, tessellation: 24 }, scene);
  disco.position.set(fin.x - o.x * 0.9, 2.3, fin.z - o.z * 0.9);
  disco.rotation.z = Math.PI / 2; disco.rotation.y = -fin.heading;
  disco.material = m("discoMat", "#c0392b", 0.2); made.push(disco);
  const discoC = MeshBuilder.CreateCylinder("discoCentro", { height: 0.1, diameter: 0.55, tessellation: 20 }, scene);
  discoC.position.copyFrom(disco.position); discoC.rotation.copyFrom(disco.rotation);
  discoC.material = m("discoCMat", "#f7f7f7", 0.2); made.push(discoC);
  // Casilla del juez sobre pilotes, del lado de afuera y alineada con la línea; arriba, la cámara de foto final
  {
    // un poco pasada la línea, para no tapar la toma de meta (la cámara de foto final mira por la línea)
    const jx = fin.x + o.x * (w + 6) + Math.cos(fin.heading) * 4, jz = fin.z + o.z * (w + 6) + Math.sin(fin.heading) * 4, yaw = Math.atan2(Math.cos(fin.heading), Math.sin(fin.heading));
    const pil = m("pilotesMat", "#d9d3c4");
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const pp = MeshBuilder.CreateBox("juezPilote", { width: 0.25, height: 4, depth: 0.25 }, scene);
      pp.position.set(jx + Math.cos(fin.heading) * a * 1.2 + o.x * b * 1.0, 2, jz + Math.sin(fin.heading) * a * 1.2 + o.z * b * 1.0);
      pp.material = pil; made.push(pp);
    }
    const caja = MeshBuilder.CreateBox("juezCasilla", { width: 3.0, height: 2.4, depth: 2.6 }, scene);
    caja.position.set(jx, 5.2, jz); caja.rotation.y = yaw; caja.material = m("casillaMat", "#f1ead8"); made.push(caja);
    const vidrio = MeshBuilder.CreateBox("juezVidrio", { width: 2.6, height: 1.0, depth: 2.7 }, scene);
    vidrio.position.set(jx, 5.6, jz); vidrio.rotation.y = yaw; vidrio.material = m("vidrioMat", "#33454f", 0.6); made.push(vidrio);
    const techo = MeshBuilder.CreateBox("juezTecho", { width: 3.6, height: 0.2, depth: 3.2 }, scene);
    techo.position.set(jx, 6.5, jz); techo.rotation.y = yaw; techo.material = m("techoJuezMat", "#1f4d36"); made.push(techo);
    // Cartel META en el frente de la casilla, mirando a la pista
    const metaTex = new DynamicTexture("metaTex", { width: 256, height: 96 }, scene, false);
    metaTex.drawText("META", null, 74, "bold 70px Georgia", "#f4efe2", "#1f4d36", true, true);
    const metaMat = new StandardMaterial("cartelMetaMat", scene); metaMat.diffuseTexture = metaTex; metaMat.specularColor = Color3.Black();
    metaMat.emissiveColor = new Color3(0.25, 0.25, 0.25);
    const cartel = MeshBuilder.CreatePlane("cartelMeta", { width: 2.6, height: 1.0 }, scene);
    cartel.material = metaMat;
    cartel.position.set(jx - o.x * 1.32, 5.2, jz - o.z * 1.32);
    cartel.rotation.y = Math.atan2(o.x, o.z);   // la cara visible mira hacia la pista
    made.push(cartel);
    const camara = MeshBuilder.CreateBox("camaraFoto", { width: 0.45, height: 0.4, depth: 0.7 }, scene);
    camara.position.set(jx - o.x * 1.0 - Math.cos(fin.heading) * 1.2, 6.85, jz - o.z * 1.0 - Math.sin(fin.heading) * 1.2); camara.rotation.y = yaw; camara.material = m("camaraFotoMat", "#2b2b2b", 0.4); made.push(camara);
  }

  // Partidor: una gatera por caballo, detrás de la línea de salida, con puertas numeradas que se abren al largar.
  const st = course.rail(0);
  const so = Course.outward(st.heading);
  const fx = Math.cos(st.heading), fz = Math.sin(st.heading);
  const yawG = Math.atan2(fx, fz);
  const verde = m("partidorMat", "#2a5b45", 0.15), blanco = m("puertaMat", "#ece7da", 0.15);
  const n = course.lanes;
  const atras = 0;     // el caballo espera adentro de la gatera; las puertas quedan justo delante de su pecho
  const centro = (k: number) => course.railOffset + k * course.laneWidth;
  const puertas: Mesh[] = [];
  for (let k = 0; k <= n; k++) {
    const off = centro(k) - course.laneWidth / 2;
    const tab = MeshBuilder.CreateBox("partidor", { width: 0.08, height: 2.2, depth: 3.0 }, scene);
    tab.position.set(st.x + so.x * off - fx * atras, 1.25, st.z + so.z * off - fz * atras);
    tab.rotation.y = yawG; tab.material = verde; made.push(tab);
  }
  for (const y of [2.45, 0.25]) {
    const vig = MeshBuilder.CreateBox("partidor", { width: w + 0.6, height: 0.22, depth: 0.25 }, scene);
    vig.position.set(st.x + so.x * (w / 2) - fx * (atras + 1.5), y, st.z + so.z * (w / 2) - fz * (atras + 1.5));
    vig.rotation.y = yawG; vig.material = verde; made.push(vig);
    const vig2 = vig.clone("partidor"); vig2.position.addInPlace(new Vector3(fx * 3.0, 0, fz * 3.0)); made.push(vig2);
  }
  for (let k = 0; k < n; k++) {
    const off = centro(k);
    const tex = new DynamicTexture(`gateraNum${k}`, { width: 64, height: 64 }, scene, false);
    const fondo = CLOTH_COLORS[k % CLOTH_COLORS.length];
    tex.drawText(String(k + 1), null, 48, "bold 44px Arial", ["#f5f5f5", "#f2c84b", "#7fd4e0"].includes(fondo) ? "#111" : "#fff", fondo, true, true);
    const pm2 = new StandardMaterial(`gateraNumMat${k}`, scene); pm2.diffuseTexture = tex; pm2.specularColor = Color3.Black();
    for (const lado of [-1, 1]) {
      // dos hojas por gatera, con bisagra en cada costado
      const piv = new Mesh(`puertaPiv${k}${lado}`, scene);
      piv.position.set(st.x + so.x * (off + lado * course.laneWidth * 0.45) + fx * 1.5, 0, st.z + so.z * (off + lado * course.laneWidth * 0.45) + fz * 1.5);
      piv.rotation.y = yawG;
      const hoja = MeshBuilder.CreateBox("partidor", { width: course.laneWidth * 0.45, height: 1.5, depth: 0.06 }, scene);
      hoja.parent = piv; hoja.position.set(-lado * course.laneWidth * 0.225, 1.2, 0);
      hoja.material = lado < 0 ? pm2 : blanco; made.push(hoja); made.push(piv);
      piv.metadata = { lado };
      puertas.push(piv);
    }
  }

  // Postes de distancia sobre el riel interno, cada 100 m, a rayas (rojo y blanco los de 200 en 200, negro y blanco
  // los intermedios), y carteles con los metros que faltan del lado de afuera.
  const rayaA = MeshBuilder.CreateCylinder("rayaA", { height: 0.3, diameter: 0.16, tessellation: 8 }, scene);
  const rayaR = MeshBuilder.CreateCylinder("rayaR", { height: 0.3, diameter: 0.16, tessellation: 8 }, scene);
  const rayaN = MeshBuilder.CreateCylinder("rayaN", { height: 0.3, diameter: 0.16, tessellation: 8 }, scene);
  rayaA.material = m("rayaAMat", "#f4f2ec"); rayaR.material = m("rayaRMat", "#c0392b"); rayaN.material = m("rayaNMat", "#1d1d1d");
  made.push(rayaA, rayaR, rayaN);
  const ma: Matrix[] = [], mr: Matrix[] = [], mn: Matrix[] = [];
  for (let d = 100; d < course.distance; d += 100) {
    const p = course.rail(course.distance - d);
    const oo = Course.outward(p.heading);
    const x = p.x - oo.x * 0.75, z = p.z - oo.z * 0.75;
    for (let k = 0; k < 8; k++) (k % 2 ? ma : d % 200 === 0 ? mr : mn).push(Matrix.Translation(x, 0.15 + k * 0.3, z));
    const tex = new DynamicTexture(`cartel${d}`, { width: 128, height: 64 }, scene, false);
    tex.drawText(String(d), null, 50, "bold 46px Arial", "#1d1d1d", "#f4f2ec", true, true);
    const cm2 = new StandardMaterial(`cartelMat${d}`, scene); cm2.diffuseTexture = tex; cm2.specularColor = Color3.Black();
    cm2.emissiveColor = new Color3(0.2, 0.2, 0.2);
    const cartel = MeshBuilder.CreatePlane(`cartelDist${d}`, { width: 1.6, height: 0.8, sideOrientation: Mesh.DOUBLESIDE }, scene);
    cartel.material = cm2;
    cartel.position.set(p.x + oo.x * (w + 1.6), 1.9, p.z + oo.z * (w + 1.6));
    cartel.rotation.y = Math.atan2(oo.x, oo.z) + Math.PI;   // de frente a quien mira desde afuera
    made.push(cartel);
    const pata = MeshBuilder.CreateCylinder(`cartelPata${d}`, { height: 1.5, diameter: 0.08, tessellation: 5 }, scene);
    pata.position.set(cartel.position.x, 0.75, cartel.position.z); pata.material = railMat; made.push(pata);
  }
  if (ma.length) { rayaA.thinInstanceAdd(ma); rayaR.thinInstanceAdd(mr.length ? mr : [Matrix.Translation(0, -50, 0)]); rayaN.thinInstanceAdd(mn.length ? mn : [Matrix.Translation(0, -50, 0)]); }
  else { rayaA.setEnabled(false); rayaR.setEnabled(false); rayaN.setEnabled(false); }

  // Tribuna frente a la recta final (del lado de afuera), con escalones, techo, columnas y público.
  const finS = course.distance;
  const tribLen = 110, tribDesde = finS - 85;
  {
    const crema = m("tribunaMat", "#efe6d2"), gris = m("escalonMat", "#b9b4a8"), techoM = m("tribTechoMat", "#2a5b45", 0.2);
    const apron = m("apronMat", "#a9a49a");
    // explanada de cemento entre la baranda y la tribuna
    const ap1 = course.path(w + 0.9, 4, 0.03).filter((_, i) => { const s0 = -course.preRun + i * 4; return s0 >= tribDesde - 10 && s0 <= tribDesde + tribLen + 10; });
    const ap2 = course.path(w + 22, 4, 0.03).filter((_, i) => { const s0 = -course.preRun + i * 4; return s0 >= tribDesde - 10 && s0 <= tribDesde + tribLen + 10; });
    if (ap1.length > 1) { const ap = MeshBuilder.CreateRibbon("explanada", { pathArray: [ap1, ap2], sideOrientation: Mesh.DOUBLESIDE }, scene); ap.material = apron; ap.receiveShadows = true; made.push(ap); }
    const base = course.rail(tribDesde + tribLen / 2);
    const recta = course.rail(tribDesde).heading === course.rail(tribDesde + tribLen).heading;   // la recta final es recta
    const bo = Course.outward(base.heading);
    const yawT = Math.atan2(Math.cos(base.heading), Math.sin(base.heading));
    const cx = (k: number) => base.x + bo.x * (w + 24 + k), cz = (k: number) => base.z + bo.z * (w + 24 + k);
    const publico: Matrix[][] = [[], [], [], [], []];
    let sem = 99;
    const az = () => ((sem = (Math.imul(sem, 1103515245) + 12345) >>> 0) / 4294967296);
    for (let k = 0; k < 9; k++) {
      const esc = MeshBuilder.CreateBox("escalon", { width: 1.1, height: 0.6 + k * 0.55, depth: tribLen }, scene);
      esc.position.set(cx(k * 1.1), (0.6 + k * 0.55) / 2, cz(k * 1.1)); esc.rotation.y = yawT;
      esc.material = k % 2 ? gris : crema; esc.receiveShadows = true; made.push(esc);
      if (recta) for (let j = 0; j < 150; j++) {
        if (az() < 0.25) continue;
        const along = (j / 150 - 0.5) * (tribLen - 2) + (az() - 0.5) * 0.4;
        const x = cx(k * 1.1) + Math.cos(base.heading) * along, z = cz(k * 1.1) + Math.sin(base.heading) * along;
        publico[Math.floor(az() * 5)].push(Matrix.Compose(new Vector3(1, 0.9 + az() * 0.25, 1), Quaternion.Identity(), new Vector3(x, 0.6 + k * 0.55 + 0.45, z)));
      }
    }
    const fondo = MeshBuilder.CreateBox("tribFondo", { width: 0.5, height: 8.5, depth: tribLen }, scene);
    fondo.position.set(cx(10.2), 4.25, cz(10.2)); fondo.rotation.y = yawT; fondo.material = crema; made.push(fondo);
    const techo = MeshBuilder.CreateBox("tribTecho", { width: 12, height: 0.3, depth: tribLen + 4 }, scene);
    techo.position.set(cx(4.6), 8.8, cz(4.6)); techo.rotation.y = yawT; techo.rotation.x = 0; techo.material = techoM; made.push(techo);
    for (let j = 0; j <= 10; j++) {
      const along = (j / 10 - 0.5) * tribLen;
      const col = MeshBuilder.CreateCylinder("tribColumna", { height: 8.6, diameter: 0.35, tessellation: 8 }, scene);
      col.position.set(cx(-0.8) + Math.cos(base.heading) * along, 4.3, cz(-0.8) + Math.sin(base.heading) * along);
      col.material = crema; made.push(col);
    }
    const colores = ["#2e6fd1", "#c0392b", "#f2c84b", "#f4f2ec", "#2f8f4e"];
    publico.forEach((ms, i) => {
      if (!ms.length) return;
      const per = MeshBuilder.CreateCapsule(`publico${i}`, { radius: 0.2, height: 0.9, tessellation: 6, subdivisions: 1 }, scene);
      per.material = m(`publicoMat${i}`, colores[i]); per.thinInstanceAdd(ms); made.push(per);
    });
  }

  // Marcador (tablero) en el centro de la pista, frente a la tribuna: los cuatro primeros en vivo.
  const tabTex = new DynamicTexture("marcadorTex", { width: 512, height: 256 }, scene, false);
  const tabMat = new StandardMaterial("marcadorMat", scene);
  tabMat.diffuseTexture = tabTex; tabMat.emissiveColor = new Color3(0.85, 0.85, 0.85); tabMat.specularColor = Color3.Black();
  {
    const p = course.rail(finS - 45), oo = Course.outward(p.heading);
    const tab = MeshBuilder.CreatePlane("marcador", { width: 9, height: 4.5 }, scene);
    tab.material = tabMat;
    tab.position.set(p.x - oo.x * 14, 6.2, p.z - oo.z * 14);
    tab.rotation.y = Math.atan2(oo.x, oo.z) + Math.PI;
    made.push(tab);
    const tabTras = MeshBuilder.CreateBox("marcadorCaja", { width: 9.6, height: 5.1, depth: 0.5 }, scene);
    tabTras.position.set(p.x - oo.x * 14.3, 6.2, p.z - oo.z * 14.3); tabTras.rotation.y = tab.rotation.y;
    tabTras.material = m("marcadorCajaMat", "#1f4d36"); made.push(tabTras);
    for (const lado of [-3.5, 3.5]) {
      const pt = MeshBuilder.CreateBox("marcadorPata", { width: 0.4, height: 4, depth: 0.4 }, scene);
      pt.position.set(tabTras.position.x + Math.cos(p.heading) * lado, 2, tabTras.position.z + Math.sin(p.heading) * lado);
      pt.material = tabTras.material; made.push(pt);
    }
    // canteros con flores al pie del marcador y junto a la meta
    const flor = m("canteroMat", "#d9534f"), verde = m("ligustroMat", "#3f6b3a");
    for (const [ds, off, mat] of [[-55, 4, verde], [-35, 4, verde], [-45, 4, flor], [5, 3.5, flor], [12, 3.5, verde]] as const) {
      const q = course.rail(finS + ds), qo = Course.outward(q.heading);
      const c2 = MeshBuilder.CreateBox("cantero", { width: 1.4, height: 0.6, depth: 6 }, scene);
      c2.position.set(q.x - qo.x * off, 0.3, q.z - qo.z * off); c2.rotation.y = Math.atan2(Math.cos(q.heading), Math.sin(q.heading));
      c2.material = mat; made.push(c2);
    }
  }
  let ultimoTablero = "";
  const marcador = (orden: number[]) => {
    const txt = orden.slice(0, 4).join("-");
    if (txt === ultimoTablero) return;
    ultimoTablero = txt;
    const ctx = tabTex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = "#14281e"; ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = "#f2c84b"; ctx.font = "bold 34px Georgia"; ctx.textAlign = "center";
    ctx.fillText(`${course.distance === 500 ? "500" : "1.500"} m · ${surface === "cesped" ? "CÉSPED" : "ARENA"}`, 256, 52);
    orden.slice(0, 4).forEach((num, k) => {
      const x = 74 + k * 122;
      ctx.fillStyle = CLOTH_COLORS[(num - 1) % CLOTH_COLORS.length]; ctx.fillRect(x - 46, 92, 92, 112);
      ctx.fillStyle = ["#f5f5f5", "#f2c84b", "#7fd4e0"].includes(CLOTH_COLORS[(num - 1) % CLOTH_COLORS.length]) ? "#111" : "#fff";
      ctx.font = "bold 72px Arial"; ctx.fillText(String(num), x, 176);
      ctx.fillStyle = "#cfd8d2"; ctx.font = "bold 22px Arial"; ctx.fillText(`${k + 1}.º`, x, 236);
    });
    tabTex.update();
  };

  // Torres de luz (Palermo corre de noche desde 1971) a lo largo del lado de afuera
  {
    const torreM = m("torreMat", "#9aa2a5", 0.3), lampM = m("lamparaMat", "#f6f2dc", 0.4);
    for (let s0 = 60; s0 < course.distance + 60; s0 += 160) {
      const p = course.rail(s0), oo = Course.outward(p.heading);
      if (cercaDeLaMeta(p.x + oo.x * (w + 9), p.z + oo.z * (w + 9))) continue;   // zona de la llegada despejada para las cámaras
      const x = p.x + oo.x * (w + 9), z = p.z + oo.z * (w + 9);
      const t = MeshBuilder.CreateCylinder("torreLuz", { height: 18, diameterTop: 0.25, diameterBottom: 0.5, tessellation: 6 }, scene);
      t.position.set(x, 9, z); t.material = torreM; made.push(t);
      const l = MeshBuilder.CreateBox("lamparas", { width: 0.4, height: 1.0, depth: 2.4 }, scene);
      l.position.set(x - oo.x * 0.3, 18.2, z - oo.z * 0.3); l.rotation.y = Math.atan2(Math.cos(p.heading), Math.sin(p.heading)); l.material = lampM; made.push(l);
    }
  }

  // Árboles low-poly alrededor (entorno)
  const trunkMat = m("troncoMat", "#5a4030"), leafMat = m("copaMat", "#3f6b3a");
  const trunk = MeshBuilder.CreateCylinder("tronco", { height: 2.2, diameter: 0.5, tessellation: 6 }, scene);
  const crown = MeshBuilder.CreateCylinder("copa", { height: 6, diameterTop: 0, diameterBottom: 4.2, tessellation: 7 }, scene);
  trunk.material = trunkMat; crown.material = leafMat; made.push(trunk, crown);
  const tm: Matrix[] = [], cm: Matrix[] = [];
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let s = -course.preRun; s < course.distance + course.postRun; s += 18) {
    const p = course.rail(s), oo = Course.outward(p.heading);
    // Cerca de la llegada no hay árboles del lado de afuera (ahí están las cámaras de llegada y de meta):
    // se pasan al lado de adentro, lejos de la baranda.
    const off0 = w + 12 + rnd() * 40;
    const llegada = cercaDeLaMeta(p.x + oo.x * off0, p.z + oo.z * off0);
    const lado = llegada ? -1 : 1;
    const off = llegada ? 26 + rnd() * 30 : off0;
    const x = p.x + oo.x * off * lado, z = p.z + oo.z * off * lado, sc = 0.7 + rnd() * 0.7;
    tm.push(Matrix.Compose(new Vector3(sc, sc, sc), Quaternion.Identity(), new Vector3(x, 1.1 * sc, z)));
    cm.push(Matrix.Compose(new Vector3(sc, sc, sc), Quaternion.Identity(), new Vector3(x, 5 * sc, z)));
  }
  trunk.thinInstanceAdd(tm); crown.thinInstanceAdd(cm);

  for (const mm of made) if (!mm.name.startsWith("puertaPiv") && mm.name !== "partidor") mm.freezeWorldMatrix();
  // Largada: las puertas se abren hacia adelante en un cuarto de segundo.
  const abrirGateras = () => {
    const t0 = performance.now();
    const obs = scene.onBeforeRenderObservable.add(() => {
      const k = Math.min(1, (performance.now() - t0) / 250);
      for (const pv of puertas) pv.rotation.y = yawG + (pv.metadata.lado as number) * k * 1.6;
      if (k >= 1) scene.onBeforeRenderObservable.remove(obs);
    });
  };
  return { meshes: made, marcador, abrirGateras };
}
