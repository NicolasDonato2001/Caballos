// Tipos del contrato del simulador (GDD v0.2 §18).

/** Atributos en orden fijo: [Velocidad, Resistencia, Potencia, Temple, Inteligencia], escala 0–100. */
export type Attrs = readonly [number, number, number, number, number];

export type Strategy = "agresiva" | "equilibrada" | "conservadora";

export interface Participant {
  id: string;
  attrs: Attrs;
  strategy: Strategy;
  /** Caballo controlado por la IA (sin efecto en la simulación; informativo). */
  ai?: boolean;
  /** sim-0.5.0: probabilidad de lesionarse en esta carrera (0–1). La sortea el simulador con la semilla. */
  riesgo?: number;
}

export interface RaceInput {
  simVersion: string;
  seed: number;
  distance: 500 | 1500;
  surface: "cesped" | "tierra";
  participants: Participant[];
}

/** Estado de un caballo en un frame (10 Hz para el render). */
export interface HorseFrame {
  s: number;      // metros recorridos sobre la cuerda
  lat: number;    // carril (0 = cuerda), continuo
  v: number;      // m/s
  res: number;    // reserva 0–100
  kick: boolean;  // en remate
  blocked: boolean;
  draft: boolean;
  done: boolean;
  /** sim-0.5.0: se lesionó y se retira (no termina la carrera). */
  lesion?: boolean;
}

export interface Frame { t: number; horses: HorseFrame[]; }

export type RaceEventType = "inicioRemate" | "llegada" | "encierro" | "fotoFinal" | "lesion";
export interface RaceEvent { t: number; type: RaceEventType; horse: number; data?: number; }

export interface RaceResult {
  simVersion: string;
  finishTimes: number[];   // segundos, por índice de participante (NaN si se lesionó y no terminó)
  order: number[];         // índices de participante del 1.º al último
  photoFinish: boolean;    // diferencia 1.º–2.º < 0,05 s
  /** sim-0.5.0: índices de los caballos que se lesionaron (quedan últimos en `order`). */
  injured: number[];
  frames: Frame[];
  events: RaceEvent[];
}
