# Informe de balance v0.2

Resultados **reales** del simulador de referencia (`herramientas/balance/`). Se calibró con unas semillas y se validó con otras distintas. Reproducible con `python bench_final.py`.

## 1. ¿Cuánto vale cada atributo?

Prueba: un caballo recibe +10 puntos en un atributo, en un pelotón de 8 con todo en 60 ±4 y estrategias aleatorias. Son 1.200 carreras por medición, y la misma carrera se repite con y sin los puntos extra.

**Probabilidad de ganar** (sin el extra: 0,142 en 500 m y 0,128 en 1.500 m):

| Atributo | 500 m | 1.500 m | Promedio |
|---|---:|---:|---:|
| Velocidad | 0,379 | 0,288 | 0,334 |
| Resistencia | 0,254 | 0,430 | 0,342 |
| Potencia | 0,431 | 0,133 | 0,282 |
| Temple | 0,174 | 0,376 | 0,275 |
| Inteligencia | 0,262 | 0,273 | 0,268 |

**Segundos ganados:** 500 m — Vel 0,46 · Res 0,27 · Pot 0,56 · Tem 0,08 · Int 0,31. 1.500 m — Vel 0,63 · Res 1,07 · Pot 0,29 · Tem 0,89 · Int 0,56.

En la v0.1 (500 m / 1.500 m): Temple daba 0,00 s / 0,80 s, Inteligencia no tenía efecto, Resistencia daba 0,05 s en 500 m y Velocidad dominaba las dos distancias.

## 2. Razas

**Ejemplares promedio** (perfil ±6), las 8 razas en la misma carrera, 3.000 carreras por distancia:

| Raza | 500 m | 1.500 m | Promedio |
|---|---:|---:|---:|
| Pura Sangre | 23,2 % | 4,9 % | 14,0 % |
| Árabe | 2,5 % | 27,0 % | 14,8 % |
| Cuarto de Milla | 28,2 % | 1,7 % | 15,0 % |
| Akhal-Teke | 7,5 % | 19,1 % | 13,3 % |
| Appaloosa | 10,2 % | 10,1 % | 10,2 % |
| Criollo | 0,9 % | 25,6 % | 13,3 % |
| Andaluz | 14,1 % | 5,9 % | 10,0 % |
| Frisón | 13,3 % | 5,7 % | 9,5 % |

Cada raza tiene su distancia y ninguna domina las dos. El Appaloosa es parejo en ambas, como corresponde a un todoterreno.

**Mejor ejemplar posible de cada raza** (360 puntos repartidos óptimamente dentro de sus techos, sin entrenamiento), 2.000 carreras:

| Raza | 500 m | 1.500 m | Promedio |
|---|---:|---:|---:|
| Pura Sangre | 26,8 % | 10,6 % | 18,7 % |
| Árabe | 0,2 % | 19,7 % | 10,0 % |
| Cuarto de Milla | 22,7 % | 5,7 % | 14,2 % |
| Akhal-Teke | 9,1 % | 21,1 % | 15,1 % |
| Appaloosa | 9,2 % | 9,0 % | 9,1 % |
| Criollo | 0,9 % | 18,6 % | 9,8 % |
| Andaluz | 15,4 % | 9,0 % | 12,2 % |
| Frisón | 15,7 % | 6,2 % | 11,0 % |

Repartos óptimos encontrados, en orden Vel/Res/Pot/Tem/Int. En 500 m: Pura Sangre 90/66/86/40/78, Cuarto de Milla 86/62/90/40/82, Frisón 80/76/90/40/74. En 1.500 m: Árabe 80/90/40/82/68, Akhal-Teke 86/88/40/78/68, Criollo 80/90/40/82/68. El "mejor caballo" depende de la raza y de la distancia: no hay uno solo.

## 3. Estrategias

Índice por arquetipo (0,125 = neutral; 8 caballos parecidos con estrategias aleatorias, 1.500 carreras):

| Arquetipo | 500 m Agr / Equ / Con | 1.500 m Agr / Equ / Con |
|---|---|---|
| Velocista | 0,12 / 0,12 / **0,14** | 0,13 / 0,10 / **0,15** |
| Fondista | **0,14** / **0,14** / 0,10 | **0,15** / 0,12 / 0,11 |
| Táctico | 0,13 / 0,13 / 0,11 | 0,13 / 0,12 / 0,13 |
| Equilibrado | 0,13 / 0,13 / 0,11 | 0,13 / 0,12 / 0,13 |

Todas entre 0,10 y 0,15, y la mejor depende del caballo. En la v0.1, la Conservadora era siempre la peor.

## 4. Montura, entrenamiento y habilidad

| Efecto | 500 m | 1.500 m |
|---|---:|---:|
| Montura Sprint | 0,10 s | 0,13 s |
| Montura Resistencia | 0,05 s | 0,25 s |
| Montura Táctica | 0,07 s | 0,15 s |
| Entrenamiento completo (+15 en todo) | 1,96 s | 5,45 s |

Nota: las pruebas de sincronización se retiraron del diseño después de este informe. El entrenamiento completo es decisivo: un caballo entrenado gana casi siempre contra uno igual sin entrenar. Por eso el emparejamiento filtra por fuerza del establo.

## 5. Economía

Simulación de 180 a 365 días con compras en orden razonable: segundo caballo, edificios y espacios, cruzas, monturas y espacios restantes. Día en que alcanza cada hito:

| Perfil | Edificios nivel 3 | Edificios nivel 5 | 3 monturas |
|---|---:|---:|---:|
| Casual (5 carreras/día, 5 días/semana) | 45 | 239 | 66 |
| Regular (15/día, 6 días/semana) | 15 | 78 | 22 |
| Dedicado (25/día) | 11 | 62 | 26 |
| Regular que convierte 10 Gemas/día | 7 | 44 | 18 |

v0.1, edificios nivel 5: casual nunca (año completo); regular 133; dedicado 104; regular que convierte Gemas, 41 días con 500.000 de Oro sobrante.

## 6. Cómo se calibró

1. Se construyó un simulador con carriles, tráfico, curvas, rebufo y remate calculado (`sim_v02.py`).
2. Se fijaron objetivos de probabilidad de ganar por atributo y distancia, de modo que cada atributo tenga una distancia fuerte y ninguno sea inútil.
3. Un optimizador automático ajustó 17 coeficientes a la vez durante unas 75 iteraciones.
4. Se buscaron modificadores de estrategia por distancia en una grilla.
5. Se retocaron los perfiles y techos de raza en dos rondas.
6. Se validó todo con semillas no usadas en la calibración.

## 7. Pendientes

- Potencia en 1.500 m (0,133 contra 0,128 de base) y Temple en 500 m (0,174 contra 0,142): positivos pero débiles. Se refuerzan en la Fase 1.
- Los tiempos medios (33,4 s / 108 s) son un 8–10 % más lentos que los reales; se ajusta la constante base.
- El modelo de economía es simplificado: posiciones uniformes, sin mercado entre jugadores ni clanes. Se recalibra con la beta.
