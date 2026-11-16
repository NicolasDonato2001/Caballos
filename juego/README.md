# Caballos — juego (Fase 1: prototipo de carrera)

## Requisitos
- **Node.js 22.18 o superior** (recomendado: la versión LTS de nodejs.org). Comprobar con `node -v`.

## Primera vez
En PowerShell, dentro de esta carpeta (`Caballos\juego`):

```
npm install
```

## Jugar el prototipo
```
npm run dev
```
Abrí **http://localhost:5173** en el navegador.

## Pruebas automáticas
```
npm test          # determinismo, paso a paso = cálculo completo, tiempos plausibles, versión
npm run runner    # miles de carreras sin gráficos: criterios de balance del GDD §21
```

## Qué hay en esta fase
| Carpeta | Contenido |
|---|---|
| `src/sim/` | Simulador de carreras (TypeScript puro, determinista, sin Babylon) |
| `config/balance/` | Todos los números de balance (carrera y razas) |
| `src/render/` | Pista, caballos **provisorios**, cámaras (Babylon.js) |
| `src/game/` | Armado de la carrera y reproducción en tiempo real |
| `tests/` | Pruebas automáticas (`node --test`) |
| `tools/` | Runner headless y generador de la tabla de potencias |

Controles: **1–4** cámaras · **A** cámara automática · botones ×1/×2/×4 para la velocidad.
