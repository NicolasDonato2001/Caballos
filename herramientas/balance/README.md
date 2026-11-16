# Herramientas de balance (referencia de diseño)

Prototipo en Python + numpy del simulador de carreras v0.2. **No es el código del juego**: es la referencia contra la que se valida el simulador TypeScript de la Fase 1.

| Archivo | Para qué sirve |
|---|---|
| `sim_v02.py` | Simulador de referencia (carriles, tráfico, rebufo, remate). Todos los coeficientes están en `P` |
| `bench_final.py` | Batería completa de criterios (GDD §21). Escribe `bench_final.json` |
| `breeds.py` | Perfiles y techos de raza; busca el mejor ejemplar posible por raza (escribe `best_allocs.json`) |
| `econ.py` | Progreso económico por perfil de jugador, v0.1 frente a v0.2 |
| `opt.py` | Optimizador automático de coeficientes |
| `strat_grid.py` | Búsqueda de modificadores de estrategia por distancia |
| `bench.py` | Funciones de prueba compartidas |
| `sim_v01_referencia.py` | Fórmulas de la v0.1, usadas para el diagnóstico inicial |

Requisitos: Python 3.10+ y `pip install numpy`. Ejemplos:

    python breeds.py
    python bench_final.py
    python econ.py
