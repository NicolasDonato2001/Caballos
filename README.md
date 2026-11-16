# Proyecto Caballos

Videojuego de gestión, entrenamiento, crianza y carreras de caballos. Navegador de PC primero, port a iOS/Android después.

## Estado

- Fase 0 (diseño maestro): GDD v0.2 aprobado.
- Fase 1 (prototipo de carrera): completa.
- **Fase 2 (caballos y establo): completa.** Modelo 3D con 8 razas y aires, pelajes genéticos, bienvenida, establo, ficha 3D y guardado local.
- **Fase 3 (edificios): completa.** Campo argentino isométrico, mejoras, entrenamiento, recuperación y espacios.
- Fase 4 (carreras contra IA: Práctica y Casual, recompensas, historial): siguiente.

## Estructura

```
Caballos/
├── README.md                      ← este archivo
├── docs/
│   ├── GDD_v0.2.md                ← FUENTE ÚNICA DE VERDAD del diseño
│   ├── Registro_de_cambios.md     ← qué cambió y por qué
│   ├── Informe_balance_v0.2.md    ← resultados reales de las simulaciones
│   └── Prompt_Maestro_v0.2.md     ← reglas de trabajo para el desarrollo
├── juego/                         ← el juego (Vite + TypeScript + React + Babylon.js)
├── arte/
│   ├── caballo/                   ← generador del caballo 3D (Python): razas, esqueleto, aires → caballo.glb
│   └── previews/                  ← imágenes de control de los modelos
└── herramientas/
    └── balance/                   ← simulador de referencia y pruebas de balance (Python)
```

## Cómo jugar (desarrollo)

Requiere Node.js 22.18 o superior.

```
cd juego
npm install        # la primera vez, o cuando cambian las dependencias
npm run dev        # abre http://localhost:5173
npm test           # pruebas del simulador y de los caballos
```

## Cómo regenerar el caballo 3D

Requiere Python 3 con numpy y scipy (ver `arte/caballo/LEEME.md`).

```
cd arte/caballo
python exportar.py
```

## Pruebas de balance

Requiere Python 3.10+ y numpy.

```
cd herramientas/balance
python bench_final.py      # batería completa: atributos, razas, estrategias
python econ.py             # progreso económico por perfil de jugador
```

## Créditos

- Modelo base del caballo: "Low Poly Horse Standing", de LowPolyFigures (Printables), licencia CC BY 4.0. Modificado: esqueleto, razas y animaciones.
