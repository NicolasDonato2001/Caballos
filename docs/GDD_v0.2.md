# PROYECTO CABALLOS — Documento de diseño (GDD) v0.2

**Estado:** diseño consolidado y calibrado con simulación. Fases 1 a 5 completas (el Mercado del juego se adelantó a la Fase 5). Fases 1 a 6 completas, con Campo 2.0, y Fases 6.5 y 5.5 completas (15/11/2026). Fase 7 (online) completa: 7.1 a 7.5 hechas. Fases 8 (mercado entre jugadores y subastas) y 9 (clanes y guerras) hechas (servidor, cuentas, carreras contra otros jugadores). Las ideas nuevas del usuario están repartidas en fases en §24. Última modificación: 15/11/2026.
**Fecha:** 14/11/2026.
**Reemplaza a:** GDD v0.1 (se conserva sin cambios en el Proyecto de Claude).
**Fuente única de verdad.** El Prompt Maestro v0.2 no repite números; si algo difiere, manda este documento.
**Plataforma:** navegador de PC primero; port a iOS y Android después, sin rediseñar el juego (§20).
**Principio rector:** gestión sencilla; profundidad en los caballos, la genética y las carreras.

Cada cambio respecto de la v0.1 está explicado en `Registro_de_cambios.md`. Los resultados de las pruebas están en `Informe_balance_v0.2.md`. Todos los números de este documento son **parámetros configurables** (`config/balance/*.json` desde la Fase 1), no constantes del código.

---

## 1. Visión y principios innegociables

Juego de gestión, entrenamiento, crianza y competición de caballos. El jugador recibe un caballo inicial, mejora su establecimiento, consigue ejemplares, los entrena, cruza razas y compite contra IA y otros jugadores. El centro son los caballos y las carreras.

- Sin modo historia, campaña ni capítulos.
- Sin envejecimiento, muerte ni retiro.
- Sin empleados, contratos, enfermedades, comida, suplementos ni veterinaria. (Desde la Fase 6.5 hay lesiones en carrera, pero solo alargan la recuperación: sin veterinaria ni gastos; §24.2.)
- Sin edificios redundantes ni recursos innecesarios: tres edificios, dos monedas.
- Monetización **Pay to Fast, nunca Pay to Win**. Todo lo competitivo se alcanza jugando gratis.
- Sin apuestas con dinero real.
- La inspiración en otros juegos se limita a ideas generales; no se copia código, arte, nombres, sonidos, interfaz ni textos.

## 2. Plataforma y tecnología

| Capa | Elección |
|---|---|
| Cliente | React + TypeScript + Vite |
| 3D | Babylon.js (WebGL 2 base; WebGPU como mejora opcional) |
| Servidor | Node.js LTS vigente + Fastify (monolito modular) |
| Tiempo real | WebSockets |
| Base de datos | PostgreSQL 18.x estable |
| Caché | Ninguna al inicio (Redis solo si las métricas lo justifican) |
| Arte 3D | Blender → GLB/glTF |
| Offline | PWA + Service Worker + IndexedDB |
| Móvil (después) | El mismo cliente empaquetado con Capacitor (§20) |

**Simulador:** módulo TypeScript puro, sin dependencias de Babylon. Babylon solo reproduce lo que calculó el simulador. El servidor es la autoridad en carreras online, economía, inventario, mercado, compras y rankings.

**Determinismo (nuevo):** el simulador usa solo `+ − × ÷` y `sqrt`, que son exactos en IEEE-754, más tablas precalculadas para potencias. No usa `Math.pow`, `exp` ni funciones trigonométricas en la lógica, porque no garantizan el mismo resultado en todos los navegadores. Usa un generador pseudoaleatorio propio con enteros (PCG32 o xoshiro128**), paso fijo de 0,05 s y versión de simulación registrada. Así el servidor puede reproducir exactamente cualquier carrera, incluidas las offline.

## 3. Dirección visual e interfaz

- Low-poly moderno, elegante y deportivo; ni anime, ni hiperrealista, ni infantil.
- Caballos con anatomía reconocible, proporciones coherentes y animaciones naturales.
- Interfaz premium y minimalista. Paleta: verde bosque, marfil, blanco cálido, gris oscuro y dorado suave.
- Establecimiento en vista isométrica fija, sin avatar. Se hace clic o toque sobre un edificio, y todas las funciones también están en los menús.
- **Estilo del establecimiento (decidido 15/11/2026):** un campo argentino, con tranqueras, alambrado, árboles, picadero y caminos. Los tres edificios tienen lugares fijos y diseñados; solo la decoración se ubica libremente sobre una cuadrícula. Se construye en la Fase 3.
- **Pantalla de caballos (Fase 2):** lista de caballos a la izquierda, el caballo en 3D en el centro y la ficha (atributos, sangre, historial) a la derecha. En pantallas angostas se apilan.
- Secciones: Establecimiento, Caballos, Carreras, Mercado, Clanes, Tienda, Perfil/Historial.
- Pantalla de carrera inmersiva: HUD compacto (posición, metros restantes, estado) y cámara seleccionable.
- **Desde el día uno:** ninguna función depende del hover del mouse ni del teclado (§20).

## 4. Ciclo principal

1. Recibir el primer caballo en el tutorial.
2. Ver su ficha, atributos y genética.
3. Entrenarlo.
4. Correr 500 m o 1.500 m.
5. Recuperación automática.
6. Ganar Oro.
7. Comprar caballos, espacios o monturas; mejorar edificios.
8. Cruzar caballos.
9. Competir online, en el mercado y en clanes.
10. Repetir, desarrollando un establo variado.

El ciclo debe ser divertido aunque se ignoren el mercado, las subastas y los clanes.

## 5. Caballos y razas

### 5.1 Reglas generales

- Ocho razas reales, cada una con **modelo 3D anatómicamente diferenciado**, construido como presets de morfología sobre una topología y un rig compartidos (§10.4).
- Sexo: macho o hembra. Solo afecta la reproducción; nunca es una ventaja deportiva.
- No hay edad después del crecimiento; no hay muerte ni retiro.
- Cada caballo guarda su **composición racial**: el porcentaje de cada raza en su sangre. Una raza pura es 100 % de una raza.

### 5.2 Perfil medio por raza (nuevo: todas suman 330)

Es el valor medio de un ejemplar común, por ejemplo en el mercado o en la IA. Cada ejemplar varía **±6 por atributo** (uniforme, entero), limitado a [30, techo de su raza], con suma máxima de 360.

| Raza | Vel | Res | Pot | Tem | Int | Identidad |
|---|---:|---:|---:|---:|---:|---|
| Pura Sangre Inglés | 74 | 60 | 68 | 60 | 68 | Velocista de punta |
| Árabe | 62 | 72 | 60 | 67 | 69 | Fondista |
| Cuarto de Milla | 68 | 56 | 78 | 62 | 66 | Explosivo de distancia corta |
| Akhal-Teke | 68 | 72 | 62 | 62 | 66 | Versátil de fondo |
| Appaloosa | 67 | 66 | 66 | 63 | 68 | Todoterreno |
| Criollo | 58 | 74 | 62 | 74 | 62 | Duro y constante |
| Andaluz | 64 | 64 | 70 | 62 | 70 | Táctico de potencia |
| Frisón | 65 | 64 | 72 | 65 | 64 | Fuerte en tráfico y remate corto |

Son arquetipos de juego, no afirmaciones sobre razas reales.

### 5.3 Techo genético por raza (nuevo)

Es el valor natural máximo que la sangre de una raza permite en cada atributo. Todos los techos suman 410, el máximo por atributo es 90 y el presupuesto natural es 360. Así cada raza tiene un ejemplar ideal distinto y la crianza no converge a un único caballo.

| Raza | Vel | Res | Pot | Tem | Int |
|---|---:|---:|---:|---:|---:|
| Pura Sangre Inglés | 90 | 82 | 86 | 74 | 78 |
| Árabe | 80 | 90 | 72 | 88 | 80 |
| Cuarto de Milla | 86 | 72 | 90 | 80 | 82 |
| Akhal-Teke | 86 | 88 | 78 | 78 | 80 |
| Appaloosa | 82 | 82 | 82 | 82 | 82 |
| Criollo | 80 | 90 | 76 | 90 | 74 |
| Andaluz | 82 | 78 | 86 | 80 | 84 |
| Frisón | 80 | 80 | 90 | 86 | 74 |

El techo de un cruce es el promedio de los techos de su composición racial, ponderado y redondeado. Los puros tienen picos; los cruces son más parejos.

### 5.4 Primer caballo

Criollo predefinido: **Velocidad 60, Resistencia 70, Potencia 60, Temple 70, Inteligencia 65** (suma 325). El jugador elige nombre, sexo y una opción estética básica, ninguna con ventaja estadística. El tutorial explica que para criar necesitará un caballo del sexo opuesto, y el mercado diario siempre ofrece al menos un macho y una hembra.

## 6. Atributos

Escala 0–100, con un máximo final de 100. Valor natural al nacer entre 30 y 90, limitado por el techo racial, con una suma natural máxima de 360. Cada atributo tiene una distancia fuerte y ninguno es inútil en la otra (medido en `Informe_balance_v0.2.md`).

| Atributo | Qué hace en carrera | Distancia fuerte |
|---|---|---|
| **Velocidad** | Velocidad máxima; un poco de velocidad sostenible | 500 m (también decisiva en 1.500 m) |
| **Resistencia** | Velocidad sostenible y menor consumo de reserva | 1.500 m |
| **Potencia** | Aceleración (salida y tras encierros), remate por encima de la velocidad máxima y menor coste de acelerar | 500 m |
| **Temple** | Menos pérdida por cansancio, menos pérdida al quedar encerrado y ritmo más regular | 1.500 m |
| **Inteligencia** | Calcular cuándo lanzar el remate, mejores líneas (menos metros), buscar y aprovechar el rebufo, encontrar huecos y anticiparse al tráfico. No aumenta la velocidad máxima | Ambas |

Rangos visibles: 0–29 Muy bajo · 30–44 Bajo · 45–59 Normal · 60–74 Bueno · 75–84 Excelente · 85–94 Superior · 95–100 Extraordinario.

Cada caballo tiene tres capas por atributo: **valor natural** (heredable), **puntos de entrenamiento** (no heredables) y **predisposición**, un peso interno que hace más probable que ese atributo salga sorteado al entrenar. La predisposición no es una sexta estadística.

## 7. Entrenamiento

El jugador elige un caballo, pulsa **Entrenar** y la sesión general dura **60 minutos**. No elige ejercicios.

- Se sortean 2 atributos distintos, y con 35 % de probabilidad un tercero, ponderados por predisposición.
- Cada atributo sorteado recibe +1 punto, o +2 con 20 % de probabilidad.
- **Cambio v0.2: el límite es en puntos, no en selecciones.** Ningún atributo supera el tope de puntos del nivel ni el valor final 100. Los atributos que llegaron al tope se excluyen del sorteo.
- No causa lesiones, no consume nada y no genera fatiga.

| Nivel del Centro de entrenamiento | Caballos simultáneos | Tope de puntos por atributo |
|---:|---:|---:|
| 1 | 1 | 3 |
| 2 | 2 | 6 |
| 3 | 3 | 9 |
| 4 | 4 | 12 |
| 5 | 5 | 15 |

Con el límite en puntos, dos caballos entrenados al máximo terminan exactamente igual. La suerte solo cambia la **velocidad** del progreso: unas 28 sesiones por caballo para completar el nivel 5 (medido). Un caballo completamente entrenado (+15 en todo) gana alrededor de 2 s en 500 m y 5,5 s en 1.500 m. Por eso el emparejamiento usa la fuerza del caballo (§13).

## 8. Edificios (solo tres)

### 8.1 Establo

Caballos, fichas, capacidad, crianza y linaje. Techo de capacidad por nivel: **5 / 8 / 11 / 15 / 20**. Los primeros 5 espacios son gratis. Los demás se compran uno por uno con Oro o con **10 Gemas** cada uno.

| Espacio | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Oro | 400 | 480 | 575 | 690 | 830 | 1.000 | 1.200 | 1.440 | 1.730 | 2.075 | 2.490 | 2.990 | 3.590 | 4.300 | 5.160 |

### 8.2 Centro de entrenamiento

Ver §7.

### 8.3 Centro de recuperación

Después de cada carrera el caballo entra automáticamente; si está lleno, espera en cola. Capacidad por nivel: 1 a 5 caballos. Duración: **15 min** después de 500 m y **30 min** después de 1.500 m.

**Cambio v0.2:** se eliminan los indicadores Energía, Fatiga y Preparación, que eran redundantes porque solo describían dos estados. Cada caballo muestra un único **estado**: Disponible · En recuperación (con barra) · En cola de recuperación · Entrenando · En cruza · Creciendo · Publicado en mercado.

### 8.4 Mejoras (iguales para los tres edificios)

| Mejora | Oro | Tiempo |
|---|---:|---:|
| 1 → 2 | 1.000 | 15 min |
| 2 → 3 | 2.400 | 1 h |
| 3 → 4 | 4.800 | 3 h |
| 4 → 5 | 9.600 | 6 h |

## 9. Carreras

### 9.1 Formato

- **Distancias:** 500 m y 1.500 m, sorteadas 50/50 y reveladas **antes** de elegir caballo.
- **Superficies:** césped y tierra. En esta versión son solo visuales y dependen del hipódromo o evento.
- **Participantes:** Casual, Online casual y Ranked 8 · Campeonato semanal 12. (Práctica se quitó el 15/11/2026 por pedido del usuario: había demasiados modos.)
- **Modos (15/11/2026):** Casual (contra la IA), Online casual (2 a 8 jugadores, no toca el rating), Ranked (al menos 4 jugadores, TrueSkill) y Campeonato semanal.
- **Partidores:** se sortean. El carril 1 es la cuerda.
- El caballo corre solo. La decisión del jugador en la carrera es la estrategia, elegida antes de largar. **No hay pruebas de sincronización** (retiradas por decisión del usuario, 14/11/2026).

### 9.2 Estrategias (recalibradas)

| Estrategia | Efecto |
|---|---|
| Agresiva | Busca la cuerda y la posición con más decisión (×1,5 en las maniobras hacia adentro). No sube el ritmo |
| Equilibrada | Sin modificador |
| Conservadora | −0,15 m/s hasta el 70 % del recorrido; +0,40 m/s después si conserva más de 25 de reserva |

Calibradas para que ninguna sea siempre la mejor. La conveniente depende del caballo: en las pruebas, al velocista le conviene la Conservadora, al fondista la Agresiva en 1.500 m y la Equilibrada en 500 m, y en el táctico las tres quedan parejas.

### 9.3 Modelo de simulación v0.2

Paso fijo de 0,05 s (20 Hz). El resultado se decide por el cruce real de la meta, interpolado dentro del tick. Hay semilla y versión registradas, y la cámara no influye en nada.

**Velocidades base** (atributos en 0–100):
- `Vmax = 15,5 + 0,0228·Vel` (m/s)
- `Vs = min(Vmax − 0,5; 13 + 0,01265·Res + 0,00844·(Vel − 50))` (velocidad sostenible)
- `Aceleración máx = 0,5 + 0,104·Pot`; `Desaceleración máx = 1,8 + 0,025·Pot` (m/s²)

**Ritmo objetivo antes del remate:**
- 500 m (fracción de Vmax): 0–10 %: 0,90 · 10–70 %: 0,85 · 70–88 %: 0,87 · 88–100 %: 1,00.
- 1.500 m: `Vs + k·(Vmax − Vs)` con k = 0,10 · 0,18 · 0,35 · 0,90 en los tramos 0–8 %, 8–70 %, 70–88 % y 88–100 %.

**Remate (nuevo):** desde el 55 % del recorrido en 500 m y desde el 60 % en 1.500 m, el caballo lanza el remate cuando los metros restantes son menores o iguales al alcance que estima poder sostener con su reserva, multiplicado por (1 + error). El alcance se calcula con la reserva menos un margen de 4. Si no lo lanzó antes, lo hace obligatoriamente al 97 %.
- Velocidad de remate: `Vmax·(1 + 0,192·Pot/100)`.
- Error de cálculo: `−0,53·q + 0,50·q·N(0,1)`, con `q = 1 − Int/100`. Un caballo poco inteligente suele arrancar tarde y llegar con reserva sin usar, o arranca temprano y se apaga.

**Reserva y consumo** (reserva inicial 100):
- `E = clamp((v/(1 − P) − Vs)/(Vmax − Vs); 0; 1)`. El cansancio no ahorra reserva, y el plus de remate de Potencia no consume más.
- `D = (0,436 + 5,40·E^1,7)·(1,30 − 0,00659·Res) + 0,314·a·(1,2 − Pot/100)`, donde `a` es la aceleración del tick en m/s².
- **Rebufo:** con un rival 0,8–4 m adelante en el mismo carril, `D × (1 − 0,674·(0,2 + 0,8·Int/100))`.

**Cansancio (Temple):** `P = max(0; 50 − Reserva)/50 · 0,527 · (1 − 0,824·Tem/100)`. La velocidad objetivo se multiplica por (1 − P).

**Tráfico** (decisiones laterales con probabilidad por tick equivalente a una cada 0,5 s):
- **Encierro:** con un rival más lento a menos de 1,6 m adelante en el mismo carril, la velocidad objetivo pasa a `v_rival · (1 − 0,097·(1 − 0,9·Tem/100))`.
- Buscar hueco cuando está encerrado o anticipando un rival lento a menos de `1 + 5·Int/100` m: probabilidad `0,20 + 0,70·Int/100`.
- Ir hacia la cuerda: `0,10 + 0,55·Int/100` (×1,5 con estrategia Agresiva).
- Buscar rebufo en un carril vecino: `1,0·Int/100`.
- Abrirse en curva: `0,50·(1 − Int/100)`.
- Un carril es libre si nadie lo ocupa ni lo eligió como destino de 3 m atrás a 3,2 m adelante. El cambio lateral avanza a 1 carril/s.
- **Cuerpos sólidos (sim-0.4.0, 15/11/2026):** un caballo mide 2,5 m. Nadie atraviesa a nadie: el de atrás queda a un cuerpo del de adelante (y no lo supera en velocidad) si van a menos de 0,7 carriles; un cambio de carril que dejaría a dos caballos encimados no se hace. El encierro empieza a 2,9 m (antes 1,6 m, que con cuerpos de 2,5 m implicaba superponerse).
- **Lesión (sim-0.5.0, Fase 6.5):** cada participante trae una probabilidad de lesión. Se sortea con un generador aparte derivado de la semilla, así una carrera sin lesiones es idéntica a sim-0.4.0 y el balance no cambia. Si le toca, entre el 15 % y el 90 % del recorrido frena a 3 m/s² hasta el paso (2,2 m/s), se abre hacia afuera, deja de contar para el tráfico y no termina: queda último, sin tiempo.
- **Recta final (sim-0.4.0):** el que viene atrás con remate y un rival a menos de 12 m busca afuera (+35 % de probabilidad); la cuerda queda para el que se apaga. Medido: en la recta final de 500 m la cuerda pasó de llevar el 63 % de los caballos al 31 %, y las superposiciones bajaron del 29–54 % de los cuadros a 0.

**Recorrido:** en curva, cada carril de distancia a la cuerda suma un 2 % de recorrido. Las malas líneas suman `4,55 %·(1 − Int/100)` en toda la carrera. Curvas: 500 m del 40 al 72 %; 1.500 m del 12 al 36 % y del 62 al 86 %.

**Irregularidad:** ruido de ritmo AR(1) con τ = 1,5 s y σ = `1 %·(1 − 0,6·Tem/100)`.

Los coeficientes se obtuvieron con un optimizador automático contra los objetivos de §21 y se validaron con semillas nuevas. Están en `herramientas/balance/sim_v02.py`, que es la **referencia** del simulador TypeScript.

### 9.4 Pruebas de sincronización — retiradas

Se quitaron del diseño el 14/11/2026 por decisión del usuario. El simulador ya no las incluye (versión `sim-0.3.0`).

### 9.5 Presentación

Cámaras lateral, de seguimiento, aérea y de llegada. Repetición automática de los últimos 5 s. Foto final si la diferencia es menor a 0,05 s.

**Nota:** con los coeficientes actuales los tiempos medios son 33,4 s en 500 m y 108 s en 1.500 m, un 8–10 % más lentos que carreras reales. En la Fase 1 se ajusta la constante base de velocidad (15,5) y se repite la validación.

## 10. Genética y crianza

### 10.1 Reglas

- Dentro del Establo. Requiere un macho y una hembra disponibles, de cualquier raza.
- Coste: 500 Oro. Reserva un espacio libre del establo. Una cruza activa por cuenta.
- La cruza dura **8 h**, con los padres ocupados. Después nace el potrillo y crece durante **24 h**, sin poder entrenar ni correr. Ambos tiempos se pueden acelerar (§11.6).

### 10.2 Herencia deportiva

Para cada atributo, de forma independiente:
1. 55 % de heredar el valor natural mayor de los padres y 45 % el menor.
2. Variación uniforme de −2 a +2.
3. Se limita a [30; techo del potrillo]. El techo es el promedio de los techos según su composición racial, que a su vez es el promedio de la de los padres.
4. Si la suma supera 360, se normaliza proporcionalmente con redondeo determinista (mayor resto; empate al atributo de índice menor).

No se heredan entrenamiento, monturas ni equipamiento. No hay mutaciones acumulativas.

**Efecto medido:** con cría selectiva se llega a la suma de 360 en unas 10 generaciones. Pero el "mejor caballo" depende de la raza y de la distancia: los techos producen al menos 8 ideales distintos, y en las pruebas de mejor combinación posible todas las razas ganaron entre 9 % y 19 %.

### 10.3 Predisposición

Se hereda como el promedio de la de los padres ± 10 % y se normaliza.

### 10.4 Apariencia

- Una topología y un rig compartidos. Ocho **presets de morfología** (shape keys), uno por raza, con cabeza, cuello, cuerpo, patas, musculatura y proporciones propias.
- La morfología del potrillo es la mezcla de presets según su composición racial, más una variación individual pequeña.
- Pelaje con reglas simplificadas inspiradas en MC1R (extensión), ASIP (agutí) y patrones conocidos (tobiano, overo, leopardo/Appaloosa, tordillo, roano), más marcas en cara y patas.
- Registro completo de padres y linaje.

## 11. Economía

### 11.1 Monedas

Solo dos. **Oro**, gratuito, se gana jugando. **Gemas**, premium, se compran o se ganan en cantidad limitada. Saldo inicial: 1.000 Oro, más 1.500 al terminar el tutorial.

### 11.2 Recompensas de carrera

| Posición | Práctica (6) 500 m | Práctica (6) 1.500 m | Casual/Ranked (8) 500 m | Casual/Ranked (8) 1.500 m |
|---|---:|---:|---:|---:|
| 1.º | 95 | 125 | 160 | 210 |
| 2.º | 70 | 90 | 115 | 150 |
| 3.º | 50 | 65 | 80 | 105 |
| Resto | 25 | 30 | 40 | 50 |

- **Límite diario:** las primeras 15 carreras de cada día pagan el 100 %; las siguientes, el 25 %. El día se reinicia a las 00:00 de la región del servidor (configurable). Las carreras IA offline y online pagan lo mismo.
- Los bots no cobran ni alteran el rating de nadie.

### 11.3 Campeonato semanal (12 caballos)

Se juega el fin de semana con una inscripción por cuenta, que cuesta 500 Oro. La distancia se sortea y se agrupa por rating; los bots completan grupos si hace falta. Premios: 1.º 3.000 · 2.º 2.000 · 3.º 1.400 · 4.º–6.º 800 · 7.º–12.º 400. Neto medio: unos +430 Oro por participante. No cuenta para el límite diario.

### 11.4 Objetivos semanales

Se reinician el lunes a las 00:00 y son opcionales:

| Objetivo | Recompensa |
|---|---|
| Correr 25 carreras | 500 Oro + 2 Gemas |
| Terminar 8 veces en el podio | 500 Oro + 2 Gemas |
| Completar 10 entrenamientos | 500 Oro + 1 Gema |

### 11.5 Precios de referencia

- Caballos del mercado del juego: básico unos 2.500, especializado unos 6.000, genética destacada unos 12.000. Salen de la fórmula de §12.2 y el precio no implica que el caballo sea mejor en todo.
- Montura: 3.000 Oro o 30 Gemas.
- Cruza: 500 Oro.
- Espacios y mejoras: §8.
- **Decoración del establecimiento (nuevo como sumidero):** objetos cosméticos de 200 a 20.000 Oro; algunos exclusivos de Gemas. Es el gasto sin fin para el Oro que sobra al final del juego.

### 11.6 Aceleración y conversión

- **Aceleración: 1 Gema por cada 30 minutos restantes, redondeando hacia arriba, mínimo 1.** Aplica a edificios, entrenamiento, cruza, crecimiento y, desde el 15/11/2026 (pedido del usuario), recuperación: no baja la carga, así que correr seguido sigue subiendo el riesgo de lesión. Ejemplos: una sesión de entrenamiento cuesta 2 Gemas, la mejora 4→5 cuesta 12 y el crecimiento completo 48.
- **Conversión: 1 Gema = 100 Oro, máximo 10 Gemas cada 24 h.** No existe conversión de Oro a Gemas. Las Gemas no se transfieren entre jugadores.

### 11.7 Monturas

Una ranura por caballo. Son objetos del inventario y **se pueden cambiar entre caballos** fuera de carrera.

| Montura | Bonificación |
|---|---|
| Sprint | +2 Velocidad, +1 Potencia |
| Resistencia | +2 Resistencia, +1 Temple |
| Táctica | +2 Inteligencia, +1 Temple |

Los atributos siguen limitados a 100.

### 11.8 Paquetes de Gemas (orientativos)

30 por USD 0,99 · 80 por USD 2,49 · 170 por USD 4,99 · 360 por USD 9,99 · 750 por USD 19,99. Se localizan por región y tienda. No se implementan cobros sin validación de recibos en servidor, protección contra doble acreditación y soporte de las tiendas móviles (§20).

### 11.9 Ritmo de progreso medido

Hito: los tres edificios en nivel 5.

| Perfil | v0.1 | v0.2 |
|---|---|---|
| Casual (5 carreras/día) | nunca en un año | día 239 |
| Regular (15/día) | día 133 | día 78 |
| Dedicado (25/día) | día 104 | día 62 |
| Regular que convierte Gemas al máximo | día 41 (3,2× más rápido) | día 44 (1,8× más rápido) |

Todas las fuentes y sumideros de Oro y Gemas se registran en un **ledger** de economía.

## 12. Mercados

### 12.1 Mercado del juego

Cuatro ofertas que rotan cada 24 h: dos básicas, una especializada y una de genética destacada. Siempre hay al menos un macho y una hembra.

### 12.2 Precio sugerido (nuevo; reemplaza "potencial/aptitudes", que no estaban definidos)

`Precio = 2.500 · 1,035^(G − 300) + 60·PE + 150·min(V; 30)`

donde G es la suma natural, PE los puntos de entrenamiento y V las victorias. Ejemplos: G 300 → 2.500; G 325 → 5.900; G 345 → 11.700; G 360 sin entrenamiento → 19.700.

### 12.3 Mercado entre jugadores

- Hasta 3 publicaciones activas por jugador, de 24 h cada una.
- **El precio debe estar entre el 50 % y el 300 % del sugerido**, para frenar el traspaso de Oro entre cuentas y la venta de Oro por dinero real.
- Comisión del 5 % solo si se vende.
- El caballo queda bloqueado mientras está publicado. No se puede publicar el último caballo.
- **Máximo 3 compras por cuenta cada 7 días** (nuevo, para frenar comprar poder competitivo con Gemas convertidas).

**Hecho (Fase 8, v0.21):** pestaña Mercado → Jugadores con «En venta», «Mis publicaciones» y «Publicar». La montura vuelve al inventario del vendedor al publicar; el comprador recibe el caballo con su genética, historial y herraduras, sin la montura ni el aspecto del vendedor. Las compras de la semana cuentan también las subastas que se van ganando. Valores en `config/balance/mercadoJugadores.json`, reglas en `src/domain/mercadoJugadores.ts` y servidor en `server/mercado.ts`.

### 12.4 Subastas

Duración de 30 min, 1 h, 3 h, 8 h o 24 h. La puja reserva Oro y se libera si alguien la supera. Gana la puja válida más alta. Las transacciones son atómicas en PostgreSQL, con protección contra doble venta, duplicación y doble gasto. Rigen el mismo rango de precio y el mismo límite de compras.

**Hecho (Fase 8, v0.21):**
- Cada puja supera a la anterior en al menos 5 % o 50 Oro y no pasa del 300 % del sugerido. Reserva el Oro y un lugar en el establo; si alguien la supera, se devuelven los dos.
- **Extensión (nuevo):** una puja en los últimos 2 minutos estira la subasta hasta 2 minutos después, para que no se gane en el último segundo sin respuesta.
- Una subasta con ofertas no se puede cancelar; sin ofertas vuelve al vendedor al terminar.
- **Atomicidad:** cada operación cambia la publicación y las partidas de los jugadores que toca (vendedor, comprador, el que pujó antes) dentro de una sola transacción de SQLite, con control de versión de cada partida; si algo no cuadra, no cambia nada. Se pasa a PostgreSQL en la Fase 11 cambiando solo `server/db.ts`.

## 13. Online, ranking y emparejamiento

**Flujo de una carrera online (nuevo):** cola → emparejamiento → **se revela la distancia** → 20 s para elegir caballo y estrategia → carrera. El servidor simula; los clientes reproducen.

**Emparejamiento:**
- Rating visible ±100, que se amplía hasta ±300 con la espera.
- Filtro secundario: **fuerza del establo**, es decir, el mejor tiempo esperado del jugador en cada distancia con sus caballos disponibles. Se calcula con la tabla de regresión versionada del simulador. Diferencia máxima inicial del 3 %, ampliable al 5 %. Nunca decide resultados.

**Ranked:** 8 participantes con al menos 4 humanos; los bots completan. **TrueSkill se actualiza solo con el orden relativo entre humanos.** Los bots solo afectan las recompensas por posición.

**Rating visible (recalibrado):** `ratingVisible = max(0; round(50·(μ − 3σ)))`, con μ = 25 y σ = 8,333 al inicio. Hay 10 carreras de colocación.

| División | Rating | % objetivo de jugadores |
|---|---|---|
| Bronce | 0–799 | 30 % |
| Plata | 800–1.099 | 25 % |
| Oro | 1.100–1.349 | 20 % |
| Platino | 1.350–1.549 | 13 % |
| Diamante | 1.550–1.749 | 7 % |
| Maestro | 1.750–1.999 | 4 % |
| Leyenda | 2.000+ | 1 % |

Los cortes son una estimación analítica, que supone habilidad de población N(25; 8,3) y σ convergida de unos 1,3. Se recalibran con datos reales en la beta para acercarse a los porcentajes objetivo.

Historial del caballo, rating del jugador y ranking de clan se mantienen separados.

## 14. Clanes y guerras

- Hasta 30 miembros: 1 líder, hasta 3 oficiales y el resto miembros. Un clan por jugador.
- **Guerra:** 4 representantes por clan, 3 carreras de 8 caballos (4 por clan) y 48 h de duración. Puntos por posición: 8-6-5-4-3-2-1-0. Una sola guerra activa por clan.
- **Rating de clan (cambio v0.2): Elo** con inicio en 1.000 y K = 32, en lugar de ±20 fijo, que premiaba enfrentar solo a clanes débiles. Empate: ambos con resultado 0,5.
- **Emparejamiento de clanes (nuevo):** rating ±150, que se amplía a ±400 tras 30 min.
- Premios: 250 Oro por participante, más 250 para cada participante del clan ganador. No cuentan para el límite diario.
- Usa el mismo simulador.

**Hecho (Fase 9, v0.22):** pantalla **Clan** (botón en el campo). Valores en `config/balance/clanes.json`, reglas en `src/domain/clanes.ts` y servidor en `server/clanes.ts`.
- **Clan:** crear (nombre único), unirse, salir (el liderazgo pasa al oficial más antiguo, o al miembro más antiguo; sin miembros se disuelve). El líder nombra oficiales (hasta 3), pasa el liderazgo y expulsa; un oficial expulsa miembros. Un representante no se va ni se expulsa en plena guerra.
- **Guerra:** la busca el líder o un oficial. Las 3 carreras cierran a las 16, 32 y 48 h y corren antes si ya se anotaron todos los representantes. Cada representante anota caballo y estrategia por carrera (un caballo, una carrera pendiente a la vez); el que no anotó corre con su mejor caballo listo. Los lugares vacíos los completan bots que no suman puntos. Las carreras de guerra no pagan por puesto ni cuentan para el límite diario: el premio es por participar y por ganar.
- **Verificable:** cada carrera guarda su entrada completa (semilla y versión del simulador); la pantalla muestra la semilla y permite ver la repetición. Repetirla da exactamente el mismo resultado.
- **Mínimo de miembros para ir a la guerra:** 1 (configurable), para poder probar con pocos jugadores; el GDD pide 4 representantes.

## 15. Modo offline

- Carreras contra IA iguales a las del modo conectado.
- **Tokens de carrera (nuevo):** con conexión, el cliente descarga paquetes firmados por el servidor con semilla, id, día asignado y vencimiento de 72 h. Cubren hasta 3 días: 15 tokens de pago completo y 10 reducidos por día. Cada carrera offline consume un token.
- Las recompensas offline quedan **pendientes** hasta sincronizar. El servidor reproduce cada carrera, la valida y la acredita. Cambiar el reloj del dispositivo no da carreras extra, porque el día lo asigna el token.
- Requieren conexión: mercado, subastas, clanes, compras reales, ranked y carreras online.
- Ningún cliente offline es inviolable: hay validación de coherencia, operaciones idempotentes y protección contra duplicados, y los límites quedan documentados.

**Cómo funciona (v0.20, `config/balance/offline.json`, `src/domain/offline.ts`, `server/offline.ts`):**
- **Tokens:** con conexión, el cliente pide tokens y el servidor completa 25 por día (15 + 10) para hoy y los dos días siguientes. Cada uno tiene id, día, semilla y vencimiento (72 h), firmado con HMAC-SHA256 y una clave que solo tiene el servidor (`server/datos/secreto.key`). El servidor también los anota en su base.
- **Sin conexión (con cuenta):** el juego sigue con la última copia de la partida guardada en el navegador. Solo se corren carreras Casual; mercado, entrenamiento, online, Ranked y campeonato esperan a la conexión (el reloj sí corre: recuperaciones y entrenamientos que terminan). Cada carrera gasta un token: **la semilla del token sortea la distancia, la superficie, el lugar, los rivales y la carrera**, así el resultado ya está fijado.
- **Al reconectar** (se prueba cada 10 s, y al abrir el juego): el cliente manda las carreras pendientes. El servidor toma cada token una sola vez, verifica firma, dueño, día y hora, repite cada carrera en orden a su hora y recién ahí acredita el Oro. Una carrera que no cuadra no cobra y su token se pierde.
- **Límite diario:** el pago lo decide el contador de §11.2 del día en que se corrió (se guardan los últimos 5 días), así correr online y offline el mismo día no da más de 15 carreras completas. Cambiar el reloj no da carreras extra: cada token es de un día.
- **Coherencia:** cada caballo guarda desde cuándo está disponible; una carrera offline de antes de esa hora (por ejemplo, en plena recuperación) se rechaza.
- **Límites conocidos:** con las herramientas del navegador alguien podría probar la carrera de un token antes de correrla y elegir el caballo que gana. No da carreras ni premios extra (cada token se usa una vez), pero sí puede mejorar el resultado. Se acepta, como dice este apartado: el offline no es inviolable.

## 16. Tutorial

Breve y con acciones reales:
1. Recibir el Criollo y elegir nombre, sexo y estética.
2. Ver la ficha.
3. Entrenar.
4. Correr contra IA, una carrera Casual (Práctica se quitó el 15/11/2026).
5. Ver la recuperación automática.
6. Cobrar y recibir +1.500 Oro.
7. Ver el establo, los espacios y las mejoras.
8. Saber que para criar se necesita un caballo del sexo opuesto, que está en el mercado.

## 17. Reglas para todas las fases

Diseño → implementación → pruebas → corrección → aprobación. Nada está terminado solo porque compila. Se conservan nombres y rutas. Los números van en configuración. Hay pruebas unitarias de fórmulas y de integración de flujos. El simulador va separado del render. Los placeholders se marcan como tales. Las decisiones se documentan. No se agregan sistemas fuera de este GDD.

## 18. Contratos entre módulos

```
[Cliente React/Babylon] --(WebSocket/HTTP)--> [Servidor Fastify] --> [PostgreSQL]
        |                                         |
        +--> [Simulador TS puro] <----------------+   (mismo paquete, misma versión)
```

- **Simulador:** `simulate(entrada) → resultado`.
  - Entrada: `{simVersion, seed, distance, surface, participants[{id, attrs[5], strategy}]}`.
  - Resultado: `{finishTimes[], order[], frames (submuestreados a 10 Hz para el render), eventos (encierros, remates, foto final)}`.
  - Determinista: misma entrada, mismo resultado, en cliente y servidor.
- **Render:** consume `frames` y no puede alterar resultados.
- **Servidor:** autoridad sobre Oro, Gemas, inventario, temporizadores, mercado, ranking y recibos. Todas las operaciones son idempotentes con `requestId`.
- **Configuración:** `config/balance/*.json` versionado. El servidor envía al cliente la versión vigente.

## 19. Modelo de datos (resumen)

| Entidad | Campos clave |
|---|---|
| Usuario | id, nombre, oro, gemas, rating (μ, σ), división, clanId, diaRecompensa, carrerasPagadasHoy |
| Caballo | id, dueñoId, nombre, sexo, composiciónRacial[8], natural[5], entreno[5], predisposición[5], techo[5], apariencia{morph[8], individual[], pelaje}, padreId, madreId, estado, finEstado, monturaId, victorias, historial |
| Edificio | usuarioId, tipo (establo/entreno/recuperación), nivel, mejoraFin |
| Temporizador | id, tipo, objetoId, inicio, fin (fuente de verdad en servidor) |
| Inventario | usuarioId, objeto (montura/decoración), cantidad, equipadoEn |
| Carrera | id, simVersion, seed, distancia, superficie, modo, participantes, resultado, tokenId? |
| TokenOffline | id, usuarioId, seed, díaAsignado, tipo (completo/reducido), vence, usado |
| Ledger | id, usuarioId, moneda, cantidad, motivo, refId, fecha |
| Publicación/Subasta | id, caballoId, vendedorId, precio/puja, reservas, fin, estado |
| Clan / Guerra | id, nombre, eloClan, miembros(rol); guerra: clanes, representantes, carreras, puntos, fin |

## 20. Requisitos para el port móvil (nuevo)

- **Empaquetado:** el mismo cliente web dentro de Capacitor (iOS/Android). No se reescribe el juego.
- **Rendimiento:**
  - Caballo LOD0 de hasta unos 8.000 triángulos en móvil, con 3 LOD.
  - Hasta 12 caballos con huesos en pantalla.
  - Los morphs de raza se **aplican una sola vez** al crear el caballo (son fijos por ejemplar) y no se calculan por cuadro.
  - Pelo con alpha-test o dithering, sin transparencias mezcladas.
  - Texturas de 1.024 px en móvil.
  - Objetivo de 60 FPS en PC y 30 FPS estables en gama media.
- **Entrada:**
  - Nada depende del hover ni del teclado.
  - Objetivos táctiles de 44 px o más.
- **Orientación:** horizontal en todo el juego, igual que en PC.
- **Pagos:** compras integradas de cada tienda, validadas en servidor. Las Gemas se guardan en la cuenta, no en el dispositivo. Las reglas de cada tienda se verifican al hacer el port.
- **Almacenamiento:** Safari en iPhone puede borrar los datos web que no se usan. En la versión web móvil, el progreso offline se considera provisional hasta sincronizar. Dentro de la app nativa ese límite no aplica.
- **Notificaciones:** opcionales, por ejemplo "entrenamiento terminado" o "potrillo crecido". Desactivadas por defecto, para no ser invasivas.

## 21. Criterios automáticos de balance

Cualquier cambio de números debe pasar `herramientas/balance/bench_final.py`:

| Prueba | Criterio | Resultado v0.2 |
|---|---|---|
| Atributo +10, promedio de ambas distancias | Probabilidad de ganar entre 0,20 y 0,40 para los 5 | Cumple: 0,27–0,34 |
| Atributo +10 en cada distancia | Mayor que la base en las 10 combinaciones | Cumple, pero Potencia en 1.500 m queda casi en la base (pendiente §23) |
| Razas promedio, ambas distancias | Entre 8 % y 17 % de victorias cada una | Cumple: 9,5 %–15 % |
| Mejor ejemplar posible por raza | Entre 7 % y 20 % | Cumple: 9 %–19 % |
| Estrategias por arquetipo | Índice entre 0,09 y 0,16 (neutral 0,125) | Cumple: 0,10–0,15 |
| Economía | Regular con edificios al máximo en 60–90 días; quien paga, como mucho 2× más rápido | Cumple: 78 días y 1,8× |

**Revalidación con sim-0.4.0 (runner TypeScript, 400 carreras por prueba):** +10 en un atributo, promedio de distancias: Vel 0,29 · Res 0,29 · Pot 0,25 · Tem 0,25 · Int 0,23, y mayor que la base en las 10 combinaciones. Razas promedio 9,5 %–15,9 %. Estrategias 0,094–0,142. Todo dentro de los criterios.

## 22. Fases de producción

| Fase | Contenido | Criterio de aprobación |
|---|---|---|
| **0. Diseño** | Este GDD, calibración, modelo de datos y contratos | El usuario aprueba el GDD v0.2 |
| **1. Prototipo de carrera** | Proyecto Vite + TS + Babylon. Simulador TS (port de `sim_v02.py`) con pruebas de determinismo y paridad estadística. Runner headless. Pista de prueba. 8 caballos animados (asset de prueba marcado como placeholder) con idle, paso, trote, galope, aceleración, frenado y llegada. Cámaras. HUD | Carrera reproducible; mismos criterios de §21 en TS; animación natural sin patinar; 60 FPS en PC |
| **2. Caballos y establo** | Pipeline de modelos (8 presets de raza), pelajes, ficha 3D, persistencia local, colección, capacidad, tutorial | Ejemplares distintos que no son recolores; guardar y cargar |
| **3. Edificios** | Mapa isométrico, tres edificios, niveles, entrenamiento, recuperación, temporizadores | Sin mejoras duplicadas; topes correctos |
| **4. Carreras contra IA** | Modos Práctica y Casual, sorteo de distancia, estrategias, recompensas, historial, repetición y foto final | Carreras divertidas, reproducibles y balanceadas |
| **5. Crianza** | Herencia, techos, composición racial, apariencia, temporizadores | Resultados variados y explicables; sin escalada |
| **6. Economía** | Ledger, límite diario, objetivos, campeonato, monturas, decoración, aceleraciones (el mercado del juego se hizo en la Fase 5) | Simulación económica dentro de §21 |
| **7. Online** | Cuentas, servidor autoritativo, WebSockets, TrueSkill, emparejamiento | Todos ven el mismo resultado |
| **8. Mercado y subastas** | Publicaciones, pujas, límites, transacciones atómicas | Sin doble venta ni doble gasto |
| **9. Clanes** | Clanes, roles, Elo, guerras | Resultados verificables |
| **10. Contenido y optimización** | Hipódromos, pulido de UI, PWA, rendimiento móvil (§20) | Rendimiento objetivo en PC y móvil |
| **11. Beta y lanzamiento** | QA, carga, seguridad, recalibración de divisiones y economía con datos reales | Estabilidad y economía sostenible |
| **12. Port móvil** | Capacitor, compras integradas, notificaciones, publicación en tiendas | Aprobación de tiendas; paridad con la web |

## 22.1 Fase 7 por partes (decidido 15/11/2026)

El servidor arranca en **Node puro + SQLite** (incluido en Node), sin dependencias, para poder programarlo y probarlo entero sin instalar nada. Antes de publicar (Fase 11) se pasa a Fastify + PostgreSQL (§2), cambiando solo `server/db.ts` y el arranque.

| Parte | Contenido | Estado |
|---|---|---|
| 7.1 | Servidor, cuentas (usuario y contraseña con scrypt, sesión de 30 días), partida guardada en el servidor, **todas las acciones con nombre** (`src/domain/acciones.ts`), y carreras contra la IA simuladas y cobradas por el servidor que el cliente reproduce con la misma semilla | **Hecho** |
| 7.2 | Carreras online entre jugadores: cola, emparejamiento por fuerza del caballo (el rating llega en 7.3), avisos en vivo del servidor con Server-Sent Events, todos ven la misma carrera a la misma hora | **Hecho** |
| 7.3 | TrueSkill, rating visible, divisiones y ranking (§13): modo Ranked (8 con al menos 4 humanos), TrueSkill solo con el orden entre humanos, 10 carreras de colocación, emparejamiento por rating ±100→±300 y fuerza del establo 3 %→5 %. El rating vive solo en el servidor | **Hecho** |
| 7.4 | Apuestas de pozo común con Oro (§24.5) en Online casual y Ranked: durante la elección se apuesta a qué jugador llega primero entre los jugadores; el juego se queda el 10 % y el resto se reparte entre los que acertaron. De 10 a 500 Oro por carrera y hasta 2.000 por día | **Hecho** |
| 7.5 | Tokens de carrera offline firmados (§15): con cuenta y sin conexión se corren carreras Casual que se cobran al reconectar, después de que el servidor las repite y las valida | **Hecho** |

**Cómo funciona 7.2** (`server/online.ts`, valores en `config/balance/online.json`):
- **Emparejamiento:** de 2 a 8 jugadores con caballos de fuerza parecida (índice ±1,5, que se agranda 0,15 por segundo de espera). Se arma con 8 o cuando el primero lleva 10 s esperando.
- **Sala:** se revela la distancia y hay 20 s para elegir caballo y estrategia. Quien no elige corre con su mejor caballo listo, con estrategia equilibrada.
- **Carrera:** los bots completan hasta 8, con el tier de los jugadores. El servidor simula una vez, cobra a cada uno en su partida (premios de Casual, cuentan para el límite diario) y manda la misma entrada a todos, con la hora de largada.
- **Avisos en vivo:** van con Server-Sent Events y no con WebSocket, porque funcionan sobre HTTP común sin dependencias y alcanzan para avisar. Las acciones del jugador siguen yendo por POST.
- **Para jugar con amigos en la misma red:** `npm run red`, que abre Vite a la red local; ellos entran a `http://IP-de-tu-compu:5173`.

**Cómo funciona 7.1:**
- **Sin cuenta:** se juega igual que antes, con la partida guardada en el navegador. Las acciones pasan por la misma tabla.
- **Con cuenta:**
  - El cliente pide cada acción por nombre. El servidor aplica el reloj, pone la hora y el azar, valida y guarda.
  - La carrera la sortea, simula y cobra el servidor. El simulador es determinista, así la reproducción del cliente da el mismo resultado.
- **Pendientes de seguridad antes de publicar:**
  - La ocupación del campo para la decoración la manda el cliente: es solo cosmética, pero hay que pasarla al dominio.
  - Al crear la cuenta se puede subir la partida local: se apaga o se valida en la Fase 11.

## 23. Riesgos y pendientes conocidos

1. **Potencia en 1.500 m y Temple en 500 m pesan poco:** +10 da 0,13 contra 0,128 de base, y 0,17 contra 0,14. Cumplen el promedio, pero conviene reforzarlos en la Fase 1 con el runner TypeScript.
2. **Los ejemplares ideales dejan un atributo en el mínimo** según la distancia: Temple en 500 m y Potencia en 1.500 m. Es especialización esperable, porque la distancia se sortea; se vigila en la Fase 5.
3. **Los tiempos de carrera son un 8–10 % más lentos que los reales.** Se ajustan en la Fase 1 (§9.5).
4. **Assets de caballos (resuelto en la Fase 2):** modelo base "Low Poly Horse Standing" de LowPolyFigures (CC BY 4.0, exige crédito) y un generador propio en Python (`arte/caballo/`) que agrega esqueleto, pesos, las 8 razas como morph targets y los aires por cinemática inversa. No requiere Blender. Pendiente de pulido: en el galope las manos se cruzan de más en algunos cuadros y la cola es algo rígida.
5. **Cortes de división y economía:** son estimaciones; se recalibran con datos de la beta.
6. **Seguridad offline:** se mitiga con tokens y reproducción en servidor, pero no es perfecta.

### 23.1 Pedidos del usuario pendientes (15/11/2026)

| Pedido | Cuándo | Notas |
|---|---|---|
| **Detener el entrenamiento:** el caballo vuelve disponible y no gana los puntos de esa sesión | **Hecho** (15/11/2026) | No devuelve nada porque el entrenamiento no cuesta |
| **Sacar de la recuperación** | **Hecho** (15/11/2026) | Opción (b), elegida por el usuario: el caballo sale cuando quiera y puede entrenar, pero no puede correr hasta cumplir el descanso que le faltaba (si estaba en cola, el descanso completo) |
| **Liberar (eliminar) un caballo** | **Hecho** (15/11/2026) | Con confirmación; no se puede liberar el último caballo (§12.3 aplica la misma regla al mercado) |
| **Comprar caballos** (pregunta del usuario) | **Hecho** en la Fase 5 (15/11/2026) | Se adelantó el Mercado del juego (§12.1) porque la crianza necesita un caballo del sexo opuesto. Cuatro ofertas por día que cambian a las 00:00 locales (en la Fase 7 lo decide el servidor); precio de §12.2. Precios medios medidos en 2.000 días: básico 2.514, especializado 5.935, genética destacada 11.818 |
| **Vender un caballo al juego** por un precio mínimo, para deshacerse de él al instante | **Hecho** (Fase 6, 15/11/2026) | El juego paga el **10 % del precio sugerido** (§12.2), mínimo 100 Oro. Un potrillo de genética media (suma 330) se vende por unos 700 Oro contra 500 de la cruza y 32 h de espera: no rinde más que correr. Valor configurable, a revisar con datos reales |
| **Vender un caballo a otros jugadores** | Fase 8 (Mercado) | Mercado entre jugadores, §12.3 |
| **Subastar un caballo** | Fase 8 (Mercado) | Subastas, §12.4 |


## 24. Ideas del usuario (15/11/2026) y en qué fase van

Análisis de cada pedido, con la decisión propuesta. Lo que cambia una decisión anterior del GDD está marcado.

### 24.1 Fase 6 (economía) — se completa con esto

| Pedido | Propuesta |
|---|---|
| **Todo lo que se compra va en el Mercado, con pestañas:** Caballos · Monturas · Herraduras · Decoración · Aspecto (skins) · Oro · Gemas | **Hecho (15/11/2026)** para Caballos, Monturas, Decoración, Aspecto, Oro y Gemas; Herraduras llega con la Fase 6.5. Objetivos queda solo para misiones. La pestaña Oro vende Oro por Gemas (la conversión de §11.6, con su tope diario). La pestaña Gemas muestra los paquetes de §11.8; el cobro con dinero real recién se habilita en la Fase 11/12, con validación en servidor (§11.8, §20) |
| **«Comprar caballo» en el establo** | **Hecho.** Botón en Mis caballos que abre Mercado → Caballos, con la ficha y los atributos de cada oferta |
| **Recompensa por entrar** | **Hecho:** premio diario por entrar, con racha de 7 días que se reinicia si se corta (por ejemplo 100 · 150 · 200 · 250 · 300 · 400 Oro y 2 Gemas el día 7). Se cobra una vez por día y entra en el ledger. Números a calibrar con la simulación económica (§21) |
| **Decoración: que el objeto quede puesto hasta tocar Comprar** | **Hecho.** El objeto elegido aparece en el campo y queda ahí mientras se lo mueve; solo se cobra al tocar «Comprar». Si se cancela, desaparece |
| **El portal de estancia va en la entrada** | **Hecho:** el portal, la tranquera y los faroles pueden ir sobre los caminos; el resto no. El objeto también se puede arrastrar |
| **Caminos de tierra como decoración** | **Hecho** (tramo de una casilla, 100 Oro; se arman caminos poniendo tramos juntos). Se venden por tramo y se dibujan igual que los caminos del campo. Los caminos fijos que unen los edificios no se pueden borrar |
| **Skins con Gemas para caballos y monturas** | **Hecho (15/11/2026):** crin y cola teñidas, cascos, mantas y color del cuero de la montura (las monturas ahora se ven sobre el caballo). Solo aspecto: no cambian atributos ni se heredan (el pelaje genético de §10.4 sigue igual debajo). Ejemplos: mantas, crines trenzadas, monturas de colores. Respeta «Pay to Fast, nunca Pay to Win» (§1) |

### 24.2 Fase 6.5 (nueva) — Bienestar del caballo: carga, lesiones y herraduras

| Pedido | Propuesta |
|---|---|
| **Lesiones con probabilidad** | Cada caballo acumula **carga** al correr (más en 1.500 m) y la pierde descansando. La probabilidad de lesión por carrera crece con la carga: casi nula descansado (≈0,2 %) y alta solo con abuso (≈5 % con carga máxima). Un caballo lesionado no termina la carrera (no cobra premio de puesto) y pasa más tiempo en el Centro de recuperación. Se calibra para que un jugador normal casi nunca la vea. **Cambia §1 («sin enfermedades ni veterinaria») y §8.3:** no se agrega veterinaria ni gastos; la lesión solo alarga la recuperación |
| **Herraduras** | En las carreras reales casi todos los caballos corren con herraduras de aluminio livianas (las plateas de carrera), que se cambian cada 3 a 6 semanas. En el juego: un juego de herraduras dura un número de carreras, baja el riesgo de lesión y se gasta. Sin herraduras el riesgo sube un poco. No se ve en el modelo (como pidió el usuario). Precio propuesto: 300 Oro por 20 carreras; las «de competición» con Gemas duran más pero **no dan velocidad**, solo reducen el riesgo |
| La simulación de carrera tiene que reproducir la lesión con la misma semilla (determinismo, §2) | El caballo afectado frena y se retira en la carrera; versión nueva del simulador |

**Hecho (v0.13, 15/11/2026).** Valores en `config/balance/bienestar.json` y reglas en `src/domain/bienestar.ts`.
- **Carga (0–100):** +12 por carrera de 500 m y +22 por 1.500 m; baja 10 por hora, también con el juego cerrado.
- **Riesgo por carrera:** `(0,2 % + 4,8 %·(carga/100)²) × herraduras`, es decir, de 0,2 % descansado a 5 % con carga máxima.
  - Sin herraduras el riesgo es ×1,5.
  - Herraduras de aluminio: 300 Oro, 20 carreras, ×1.
  - Plateas de competición: 15 Gemas, 40 carreras, ×0,8.
  - Los rivales de la IA corren con el mínimo (0,2 %).
- **Medido en las pruebas:**
  - Corriendo un caballo cada 20 min toda la tarde, el riesgo pasa del 2,5 %.
  - Turnando cinco caballos queda por debajo del 0,4 %.
- **El lesionado:** no cobra premio de puesto, no cuenta como podio ni victoria y suma 120 min de recuperación. La ficha muestra sus lesiones.
- **Dónde se ve:**
  - Las herraduras se compran en Mercado → Herraduras y se ponen desde la ficha (sección Bienestar: carga, riesgo y herraduras).
  - La pantalla Carreras muestra el riesgo de cada caballo listo.

### 24.3 Fase 5.5 (nueva) — Crianza 2.0: cruzas, rarezas y tiers

| Pedido | Propuesta |
|---|---|
| **Cada cruza da un caballo de forma y colores nuevos; modelar todas las cruzas** | Ya funciona por mezcla: el potrillo toma la forma de las razas de su sangre en proporción (morph targets, §10.4), con variación individual y pelaje heredado. En lugar de modelar a mano las 28 cruzas de a dos (y las infinitas mezclas), se agregan **rasgos por cruza**: cada par de razas aporta rasgos visibles (perfil, crin, cola, manchas) para que cada mestizo se vea propio. Se revisan en láminas, una por cruza de a dos |
| **Cruzas raras muy difíciles con stats altas (estilo Dragon City)** | **Linajes raros:** con probabilidad baja (≈1 %) y solo entre ciertas combinaciones, nace un potrillo de linaje raro: pelaje y rasgos únicos, y techo genético algo más alto (+2 a +4 en uno o dos atributos). Para no romper el balance (§10.2: «sin escalada») el tope de 360 sigue y el emparejamiento por tier lo compensa |
| **Tiers de caballos y emparejamiento por tier** | Cada caballo tiene un **tier** calculado con su tiempo esperado en cada distancia (la tabla del simulador de §13): Bronce, Plata, Oro, Platino, Diamante. Las carreras contra la IA ponen rivales del mismo tier; online se combina con el rating (§13) |

**Hecho (v0.14, 15/11/2026).**

- **Rasgos por cruza** (`config/balance/rasgos.json`, `src/domain/rasgos.ts`):
  - Hay 11 rasgos visibles: cuello de cisne, perfil cóncavo, cabeza acarnerada, patas largas, cuerpo compacto, grupa potente, cernejas, crin lavada, brillo metálico, calzado alto y malacara.
  - Cada una de las 28 cruzas de dos razas tiene el suyo.
  - **Probabilidades:** un potrillo con al menos 20 % de cada raza lo muestra el 70 % de las veces. Hereda cada rasgo de sus padres con 40 %. Tiene como máximo 3.
  - **Cómo se ven:**
    - *Proporciones del esqueleto:* cuello, remos (con el cuerpo levantado lo mismo) y largo del lomo.
    - *Forma de raza:* la mezcla se corre hacia la forma de una raza. Nunca pasa del puro, porque al sumar formas de más el caballo se deformaba.
    - *Color:* crin, marcas blancas y brillo del pelo.
  - La variación individual (`forma`, cuatro ejes) ahora se ve: alzada ±2,5 %, cuello ±7 %, remos ±3,5 % y lomo ±3,5 %.
  - Se revisan en la lámina `/lamina.html`, una herramienta de desarrollo con comparación A/B por rasgo, los linajes y la variación individual.
- **Linajes raros:**
  - Los cuatro linajes: Dorado del Desierto (Árabe × Akhal-Teke), Barroco Azabache (Andaluz × Frisón), Relámpago (Pura Sangre × Cuarto de Milla) y Overo de la Pampa (Criollo × Appaloosa).
  - **Probabilidad:** 1 % con al menos 25 % de cada raza. Sube a 25 % si un padre es del linaje y a 50 % si lo son los dos. Medido: 0,6–1,5 % y 18–32 % en las pruebas.
  - **Efecto:** pelaje y rasgos propios, y +3 de techo en dos atributos (tope 94). La suma natural sigue ≤ 360.
  - Se sortea con un generador aparte, así el resto del potrillo no cambia.
- **Tiers:**
  - Cada caballo tiene un *índice*: cuánto más rápido es que un caballo de 60 en todo, promediando 500 m y 1.500 m. Sale de una tabla de regresión del simulador (`tools/regresion.ts` → `config/balance/regresion.json`, R² 0,83 y 0,93).
  - Niveles: Bronce < 2,5 ≤ Plata < 4 ≤ Oro < 5,5 ≤ Platino < 7 ≤ Diamante. Ejemplos: Criollo inicial 1,8; genética 345 sin entrenar 3,9; suma 360 sin entrenar 5,3–5,6.
  - **Rivales:** las carreras contra la IA arman rivales del tier del caballo, con un índice a ±1,5 del suyo; en el campeonato, algo más fuertes.
  - **Medido** en 300 carreras por caso: el caballo gana entre 7 % y 20 % en todos los niveles (lo justo con 8 es 12,5 %), salvo los Diamante por encima del índice 10,5, que ganan más porque no hay rivales más fuertes.
- **Interfaz:**
  - *Ficha:* chip de tier y de linaje, y lista de rasgos.
  - *Cruza:* rasgo esperado, rasgos heredables y linaje posible con su probabilidad.
  - *Carreras:* tier de cada caballo y de los rivales.

### 24.4 Campo 2.0 (dentro de la Fase 6, después del Mercado)

| Pedido | Propuesta |
|---|---|
| **Todo movible: establo, centros, todo** | **Cambia la decisión del 15/11/2026 (§3: edificios fijos).** Los edificios pasan a moverse sobre la misma cuadrícula que la decoración; los caminos que los unen se rehacen solos |
| **Parcela más grande y sin el azul alrededor** | Parcela más amplia (menos apretada), terreno que sigue más allá del alambrado, sierras bajas en el horizonte (como las de Tandil o Ventania) y cielo con degradé, para que nunca se vea el fondo azul |

**Hecho (v0.12, 15/11/2026).**
- La parcela pasa de 66 × 48 m a **90 × 66 m**.
- Hay un solo terreno de 440 m: llanura con lomas suaves y **sierras bajas** al norte y al oeste, que es el fondo que ve la cámara. Bruma lineal y cielo de horizonte para que lo lejano se funda. Ya no se ve el borde del mundo.
- **Edificios movibles:** establo, centros de entrenamiento y de recuperación, potrero y molino. Se eligen desde «Acomodar el campo» o tocándolos. Se ubican al metro y giran de a 90°.
- Al moverlos se ve una copia translúcida, la huella verde o roja y una flecha hacia la entrada. No pueden pisarse entre sí ni salir del alambrado. Tampoco pueden tapar el patio, el camino de entrada, la laguna ni el ombú. Mover es gratis.
- La decoración que queda debajo de una pieza movida va al depósito.
- Los **caminos se rehacen solos** desde el patio hasta la puerta de cada pieza. Los árboles, las cortaderas y las piedras que quedan debajo no se plantan.
- Reglas en `src/domain/campo.ts` y valores en `config/balance/campo.json`.
- **Cómo se mueve todo (v0.15, como en Clash of Clans):** no hay un modo aparte.
  - *Mover:* tocar algo lo selecciona; se aprieta y se arrastra en tiempo real; al soltar queda puesto si entra y vuelve a su lugar si no.
  - *Acciones:* girar y guardar aparecen en una botonera flotante sobre el objeto.
  - *Comprar:* el objeto nuevo aparece en un lugar libre, con ✕, ⟳ y ✓ con el precio.
- **Nombre del establecimiento:** se cambia en Mercado → Decoración. El primer cambio es gratis y los siguientes cuestan 20 Gemas, configurable (pedido del usuario).

### 24.5 Fase 7 (online) y Fase 8 (mercado)

| Pedido | Propuesta |
|---|---|
| **Apuestas en carreras online, balanceadas** | Sistema de **pozo común (pari-mutuel)**, el de los hipódromos: todo lo apostado va a un pozo, la casa se queda un porcentaje y el resto se reparte entre los que acertaron. Así el favorito paga poco solo, porque casi todos le apuestan. Apuestas **solo con Oro**, con tope por carrera y por día. Va en la Fase 7, porque necesita servidor |
| **Apostar con Gemas y vender Gemas por dinero real (por ejemplo, por Binance)** | **No se recomienda (ver §24.6).** Queda fuera del plan salvo decisión explícita, con asesoramiento legal |

**Cómo funcionan las apuestas (v0.19, `config/balance/apuestas.json`, `src/domain/apuestas.ts`):**
- **Cuándo:** en la sala de una carrera online, mientras se elige caballo. Cierran al largar; la carrera se simula después, así nadie conoce el resultado al apostar.
- **A qué:** a qué jugador de la sala llega primero entre los jugadores (los bots no cuentan). No se apuesta a caballos porque, durante la sala, los caballos todavía no están elegidos ni los bots armados.
- **Pozo:** todo lo apostado; el juego se queda el 10 % (sumidero de Oro) y el resto se reparte entre los que acertaron, en proporción a lo apostado. Quien acierta nunca cobra menos de lo que apostó.
- **Casos especiales:** si nadie acierta, o ningún jugador termina, se devuelve todo sin comisión. Si un jugador no larga, se devuelven las apuestas hechas a él.
- **Topes:** una apuesta por carrera, de 10 a 500 Oro, y hasta 2.000 Oro por día.
- **Pizarra:** la sala muestra el pozo de cada jugador y su cuota (cuánto paga cada 1 de Oro) en vivo.
- **Arreglos entre amigos:** el Oro no se crea, solo pasa de unos jugadores a otros menos la comisión, así que arreglar una carrera solo puede sacarle Oro a un tercero que apostó. Los topes lo limitan; en la Fase 11 conviene revisar patrones.

### 24.6 Opinión sobre apuestas con dinero real

Si las Gemas se compran con dinero y además se pueden vender por dinero, apostar con Gemas es apostar dinero real. Eso exige licencia de juego en cada lugar donde se ofrezca (en Argentina las da cada provincia), controles de identidad y de lavado de dinero, y restricción por país. Las tiendas de apps exigen esa licencia y la restricción geográfica, y no permiten usar compras dentro de la app para cargar saldo de juego con dinero real. Además contradice el principio del GDD «Sin apuestas con dinero real» y «Pay to Win» (§1). Propuesta: apuestas solo con Oro, Gemas que no se pueden vender, y si alguna vez se quiere ir más allá, tratarlo como un negocio aparte con abogados. No es asesoramiento legal.

### 24.7 Fase 10 (contenido y pulido)

| Pedido | Propuesta |
|---|---|
| **Sonidos: largada y galope** | Campana y apertura de gateras, galope que sube y baja con la velocidad y la cantidad de caballos cerca de la cámara, y público en la recta final. Se pueden adelantar si el usuario quiere |
| **Jockeys** (propuesta propia) | Jinete low poly con chaquetilla del color del número, animado con el galope. **Pedido del usuario (15/11/2026):** antes de modelar, buscar imágenes de referencia en internet del jockey (postura en el galope, casco, chaquetilla, botas, fusta) y de las monturas de carrera (montura liviana, estribos cortos, cincha, número de manta), para hacer el mejor modelo 3D posible; las monturas actuales del juego se rehacen con esas referencias |
| **Modelo de caballo propuesto por el usuario (15/11/2026)** | [3D Game Horse Low Poly Model with Animation](https://sketchfab.com/3d-models/3d-game-horse-low-poly-model-with-animation-d82a7b62022f444f81e65a9cf1321586) (Sketchfab). Antes de usarlo: confirmar licencia (gratis y que permita uso en un juego), crédito, cantidad de triángulos, rig y animaciones; compararlo con el modelo actual en la lámina y ver si se adapta a las 8 razas (morph targets) y al galope sin patinar |
