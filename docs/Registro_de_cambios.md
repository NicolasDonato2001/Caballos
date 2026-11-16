# Registro de cambios

## v0.22 — 15/11/2026 (Fase 9: clanes y guerras; Online casual para amigos)

| Cambio | Motivo |
|---|---|
| **Clanes:** crear, unirse, roles (líder, hasta 3 oficiales, miembros), expulsar, salir; pantalla Clan con botón en el campo | §14 |
| **Guerras:** emparejamiento por Elo ±150 que se abre a ±400 a los 30 min; 3 carreras de 8 con hasta 4 representantes por clan; puntos 8-6-5-4-3-2-1-0; Elo K = 32; 250 Oro por participar y 250 más al ganador | §14 |
| Las carreras cierran a las 16, 32 y 48 h o antes si se anotaron todos; los bots completan sin sumar puntos | No estaba definido cómo se reparten en 48 h |
| Resultados verificables: cada carrera guarda semilla y versión; se ve la semilla y la repetición | Criterio de la Fase 9 |
| Modo de carrera «Guerra de clanes»: no paga por puesto ni cuenta para el límite diario | §14 |
| La transacción sobre varias partidas pasa a `server/transaccion.ts` (la usan el mercado y los clanes) | Una sola implementación |
| **Online casual junta a todos los de la cola** sin mirar la fuerza, y espera 15 s; en la cola se ven los nombres y la cuenta regresiva | Un amigo del usuario quedó afuera por tener caballos más fuertes |
| `3 - JUGAR ONLINE CON AMIGOS.bat` ofrece cerrar solo el servidor viejo | Pedido del usuario |
| Botones del campo más compactos en pantallas angostas | El quinto botón (Clan) no entraba |
| 4 pruebas nuevas: Elo y ventana, roles y permisos, guerra completa verificada carrera por carrera, Online casual con caballos muy distintos (102 en total) | §17 |

## v0.21 — 15/11/2026 (Fase 8: mercado entre jugadores y subastas)

| Cambio | Motivo |
|---|---|
| **Mercado → Jugadores:** publicar a precio fijo (24 h) o en subasta (30 min a 24 h), comprar y pujar. Precio del 50 % al 300 % del sugerido, hasta 3 publicaciones, comisión del 5 % solo si se vende, no se publica el último caballo, el publicado queda bloqueado | §12.3 y §12.4 |
| Máximo 3 compras cada 7 días; las subastas que vas ganando cuentan y reservan un lugar en el establo | §12.3; que nadie gane una subasta sin lugar |
| Cada puja reserva el Oro; al superarla se devuelve. Una puja en los últimos 2 minutos estira la subasta | §12.4; la extensión evita ganar en el último segundo sin respuesta (no estaba definido) |
| Cada operación es una sola transacción de la base sobre la publicación y las partidas que toca, con control de versión | «Sin doble venta ni doble gasto» (criterio de la Fase 8) |
| El comprador recibe el caballo sin la montura ni el aspecto del vendedor (eran suyos) | Las monturas y los aspectos son del inventario de cada cuenta |
| **La recuperación se acelera con Gemas** (1 por cada 30 min), también en la cola y en el descanso después de sacarlo antes | Pedido del usuario; cambia §11.6. No baja la carga |
| Herramienta de pruebas `4 - DAR ORO Y GEMAS.bat` | Pedido del usuario |
| 4 pruebas nuevas: venta con dos compradores a la vez (uno solo compra), subasta completa con extensión y Oro que cierra exacto, vencimientos y cancelación, límites de compras y de lugar (98 en total) | §17 |

## v0.20.1 — 15/11/2026 (online más firme por el túnel)

| Cambio | Motivo |
|---|---|
| Buscar carrera dos veces (o estando ya en la sala) ya no da «Ya estás en una carrera»: el servidor le recuerda la sala | Le pasó a un amigo del usuario por el túnel: la pantalla volvió a «Buscar» con la sala ya armada |
| El panel online dice «Conectando…» hasta saber el estado, y cada 3 s lo consulta como respaldo de los avisos en vivo | Los avisos por el túnel pueden demorarse o perderse |
| La carrera se reenvía a quien se reconecta o consulta el estado (hasta 90 s); el cliente nunca la reproduce dos veces | El amigo corrió sin ver la carrera |
| Un corte cortito ya no pasa el juego a modo offline: primero se confirma que el servidor no responde | El modo offline cerraba el panel online |
| `3 - JUGAR ONLINE CON AMIGOS.bat` muestra en grande la dirección para los amigos y la copia al portapapeles; el servidor aclara que 127.0.0.1 es solo para esta compu | El amigo probó con 127.0.0.1 |
| 1 prueba nueva (94 en total) | §17 |

## v0.20 — 15/11/2026 (Fase 7.5: carreras offline; archivos para abrir el juego)

| Cambio | Motivo |
|---|---|
| **Modo offline con cuenta:** si no hay servidor, el juego sigue con la última copia de la partida; se corren carreras Casual con tokens y el Oro queda pendiente. Aviso en el cuadro del establecimiento con las carreras que quedan hoy | §15 |
| **Tokens firmados** (HMAC-SHA256, clave solo en el servidor): 25 por día para hoy y los dos días siguientes, vencen a las 72 h. La semilla del token fija distancia, superficie, rivales y carrera | §15 |
| **Sincronización:** al reconectar, el servidor toma cada token una sola vez, verifica firma, dueño, día y hora, repite las carreras en orden y acredita. Lo que no cuadra no cobra | «El servidor reproduce cada carrera, la valida y la acredita» |
| El límite diario (§11.2) se cuenta en el día en que se corrió cada carrera; se guardan los contadores de los últimos 5 días | Que online + offline no den más de 15 carreras completas por día |
| Cada caballo guarda desde cuándo está disponible: una carrera offline de cuando estaba en recuperación se rechaza | Validación de coherencia (§15). Lo encontraron las pruebas |
| `newRaceSetup` acepta una semilla: todo el armado sale de ella, con mezcla Fisher–Yates (igual en todos los navegadores) | Que cliente y servidor armen la misma carrera |
| **Archivos para abrir el juego**, numerados: `1 - ABRIR EL JUEGO.bat` (servidor + juego), `2 - ABRIR SOLO EL SERVIDOR.bat`, `3 - JUGAR ONLINE CON AMIGOS.bat` (túnel) y `LEEME - COMO ABRIR EL JUEGO.txt`. Avisan si falta Node.js, instalan lo necesario, no abren dos servidores y entienden Windows en inglés y en español | Pedido del usuario |
| 4 pruebas nuevas: la misma semilla da la misma carrera; contadores de días pasados; sincronización con trampas (token repetido, firma falsa, token ajeno, token de otro día, caballo en recuperación); límite diario online + offline (93 en total) | §17 |

## v0.19 — 15/11/2026 (Fase 7.4: apuestas; menos modos)

| Cambio | Motivo |
|---|---|
| Se quitó el modo **Práctica**. Quedan Casual (IA), Online casual, Ranked y Campeonato semanal. Las carreras de Práctica viejas siguen en el historial | Pedido del usuario: había demasiados modos |
| Se mantienen **Online casual** (desde 2 jugadores) y **Ranked** (al menos 4, como pide el GDD) | Decisión del usuario: por ahora juega con un solo amigo |
| En la cola Ranked, después de 30 s sin rivales suficientes, aparece «Pasar a Online casual» | Que la Ranked no quede buscando sin avisar |
| **Apuestas de pozo común con Oro** en las carreras online: durante la elección se apuesta a qué jugador llega primero; 10 % de comisión; el resto se reparte entre los que acertaron. Pizarra con pozo y cuota en vivo; resultado de la apuesta en la pantalla final | §24.5 |
| Topes: de 10 a 500 Oro por carrera, una apuesta por carrera, hasta 2.000 por día. Si nadie acierta se devuelve todo; si un jugador no larga, se devuelven las apuestas a él | Que sean balanceadas (§24.5) |
| 5 pruebas nuevas: reparto del pozo (el Oro cierra exacto), devoluciones, topes, y una carrera online con dos jugadores apostando (89 en total) | §17 |

## v0.18 — 15/11/2026 (Fase 7.3: rating, divisiones y ranking)

| Cambio | Motivo |
|---|---|
| Modo **Ranked** en Carreras (con cuenta): 8 participantes con al menos 4 jugadores; los bots completan. Mismos premios que Casual. El online de 7.2 sigue como **Online casual** (2 a 8, no toca el rating) | §13 |
| **TrueSkill** completo para todos contra todos (grafo de factores con propagación de expectativas, sin dependencias): μ 25, σ 8,333, β σ/2, τ σ/100. Se actualiza solo con el orden de llegada entre humanos; los bots no cuentan | §13 |
| Rating visible `max(0; round(50·(μ − 3σ)))`, 10 carreras de colocación y siete divisiones de Bronce a Leyenda con los cortes de §13 | §13 |
| Emparejamiento Ranked: rating visible ±100 que se abre hasta ±300 (5 por segundo) y fuerza del establo (mejor tiempo esperado en cada distancia) 3 % que se abre hasta 5 % | §13 |
| El que no tiene caballo listo al largar una Ranked cuenta como último puesto | Que no convenga abandonar para no perder rating (no estaba definido) |
| El rating se guarda solo en el servidor (tabla `ratings`), fuera de la partida | Que no se pueda subir un rating falso con la partida local |
| Ranking de los 50 mejores (solo los que terminaron la colocación), con mi puesto; en el resultado de la carrera se ve el cambio de rating | §13 |
| `JUGAR_POR_INTERNET.bat` corregido: el servidor entrega el juego armado (`npm run armar` + `npm run publico`) por 127.0.0.1:8787; latido en los avisos; el freno de intentos usa la dirección real de cada amigo | A un amigo no le abría el juego por el túnel |
| 9 pruebas nuevas: TrueSkill contra la solución analítica 1 contra 1, simetría y orden, divisiones; Ranked de punta a punta con 4 jugadores; emparejamiento por rating y fuerza; el servidor entregando el juego armado (84 en total) | §17 |

## v0.17 — 15/11/2026 (Fase 7.2: carreras contra otros jugadores)

| Cambio | Motivo |
|---|---|
| Modo **Online** en Carreras (con cuenta): buscar carrera → cola → sala con la distancia revelada y 20 s para elegir caballo y estrategia → carrera | §13 |
| Emparejamiento por fuerza del caballo (índice de tiers), de 2 a 8 jugadores; los bots completan hasta 8 con el tier de los jugadores | Carreras parejas; el rating TrueSkill llega en 7.3 |
| El servidor simula una sola vez, cobra a cada jugador y manda la misma carrera a todos con la hora de largada; en el resultado se ve el dueño de cada caballo | «Todos ven el mismo resultado» |
| Avisos en vivo con Server-Sent Events (sin dependencias) | En lugar de WebSocket: alcanza para avisar y pasa por el mismo proxy de Vite |
| `npm run red`: abre el juego a la red local para jugar con amigos en el mismo Wi-Fi | Pedido del usuario: jugar con amigos |
| La carrera online no borra la distancia sorteada para Práctica o Casual | Corrección |
| 1 prueba nueva: dos jugadores se emparejan, uno elige y el otro no, los dos reciben la misma carrera y el cobro coincide con la reproducción (75 en total) | §17 |

## v0.16 — 15/11/2026 (Fase 7.1: servidor y cuentas)

| Cambio | Motivo |
|---|---|
| **Servidor del juego** (`server/`): Node puro con `node:http` y `node:sqlite`, sin dependencias. Se arranca con `npm run servidor` (puerto 8787) y Vite le reenvía `/api` | §2 y §18. Decisión del usuario: Node + SQLite primero, PostgreSQL antes de publicar |
| **Cuentas:** nombre de usuario y contraseña (scrypt con sal), sesión con token (se guarda solo su hash), freno de 10 intentos por minuto. No se piden datos personales | Fase 7 |
| **Tabla de acciones** (`src/domain/acciones.ts`): todas las acciones del jugador con nombre y argumentos JSON. La interfaz ya no modifica la partida directamente | Que el servidor sea la autoridad (§2) |
| Con cuenta, cada acción la ejecuta el servidor (pone la hora y el azar) y la partida se guarda ahí; una acción por vez por jugador y guardado con versión | Sin trampas con el reloj ni con el azar |
| Carreras contra la IA con cuenta: el servidor sortea, simula y cobra; el cliente reproduce la misma carrera con la misma semilla | «Todos ven el mismo resultado» |
| Sin cuenta se juega igual, guardado en el navegador. Al crear la cuenta se puede llevar la partida del navegador | No perder el progreso |
| 4 pruebas nuevas del servidor (74 en total) | §17 |

## v0.15 — 15/11/2026 (mover y poner como en Clash of Clans)

| Cambio | Motivo |
|---|---|
| **Sin modo aparte para acomodar:** en el campo, tocar un adorno, un edificio, el potrero o el molino lo selecciona (borde dorado). Apretar sobre lo seleccionado y arrastrar lo mueve en tiempo real, con la copia translúcida y la huella verde o roja; al soltar queda puesto si entra y vuelve a su lugar si no. Arrastrar sobre otra cosa mueve la cámara | Pedido del usuario: copiar cómo se mueven las estructuras en Clash of Clans |
| **Botonera flotante** sobre lo seleccionado: girar y guardar en el depósito (adornos), girar (edificios) | Igual que Clash of Clans: las acciones al lado del objeto |
| **Comprar un adorno:** aparece en el lugar libre más cercano al centro de la vista, con ✕ (cancelar), ⟳ (girar) y ✓ con el precio encima; se arrastra o se toca dónde va; si no entra, dice por qué y el ✓ queda apagado | Igual que Clash of Clans |
| Objetos finos (un farol) se eligen tocando su casilla | Eran difíciles de tocar |
| Se quitó el panel «Acomodar el campo»; el botón del Mercado ahora explica cómo mover | Ya no hace falta un modo |

## v0.14 — 15/11/2026 (Fase 5.5: crianza 2.0)

| Cambio | Motivo |
|---|---|
| **Rasgos visibles por cruza:** 11 rasgos y uno por cada una de las 28 cruzas de dos razas. Cambian las proporciones del esqueleto, corren la mezcla hacia la forma de una raza y cambian crin, marcas o brillo | §24.3, pedido del usuario: que cada cruza se vea distinta |
| La variación individual de forma (que existía en los datos pero no se veía) ahora cambia alzada, cuello, remos y lomo | Más variedad entre caballos de la misma sangre |
| **Linajes raros** (≈1 %): Dorado del Desierto, Barroco Azabache, Relámpago y Overo de la Pampa, con pelaje propio y +3 de techo en dos atributos | §24.3, «estilo Dragon City» |
| **Tiers** Bronce a Diamante con un índice sacado de una regresión del simulador (`tools/regresion.ts`), y rivales de la IA del mismo tier | §24.3 y §13 |
| Lámina de revisión `/lamina.html` (A/B por rasgo, linajes, variación individual) | Revisar cada cruza antes de darla por buena |
| Corrección: el Barroco Azabache se veía deforme (cuello quebrado). Los rasgos sumaban formas de raza más allá del puro; ahora solo corren la mezcla | El usuario lo vio en la lámina |
| `Rng.fork()` para sorteos aparte sin mover la secuencia | Que el resto del potrillo no cambie |
| 5 pruebas nuevas (70 en total) | §17 |

## v0.13 — 15/11/2026 (Fase 6.5: carga, lesiones y herraduras)

| Cambio | Motivo |
|---|---|
| **Carga de trabajo:** cada carrera suma (12 en 500 m, 22 en 1.500 m) y baja 10 por hora | §24.2, pedido del usuario |
| **Riesgo de lesión** por carrera de 0,2 % (descansado) a 5 % (carga máxima), ×1,5 sin herraduras. Medido: rotando cinco caballos queda bajo el 0,4 %; corriendo uno cada 20 min pasa del 2,5 % | Que no sea abusivo ni excesivo |
| **Simulador sim-0.5.0:** el lesionado frena hasta el paso, se aparta, no termina y queda último. Generador aparte: sin lesión la carrera es idéntica a sim-0.4.0 (probado con 30 carreras) y el balance de §21 no cambia | Determinismo (§2) |
| El lesionado no cobra premio de puesto, no suma podio ni victoria y queda 120 min más en recuperación; resultado con «Se lesionó» | §24.2 |
| **Herraduras** en Mercado → Herraduras: de aluminio (300 Oro, 20 carreras) y plateas de competición (15 Gemas, 40 carreras, riesgo ×0,8). No dan velocidad ni se ven. Al comprar se elige el caballo y quedan puestas (o se guardan para ponerlas después desde la ficha) | §24.2, investigado: las de carrera son de aluminio y se cambian cada pocas semanas. Elegir el caballo al comprar: pedido del usuario |
| Ficha: sección **Bienestar** (carga, riesgo, herraduras) y lesiones en el historial. Carreras: riesgo de cada caballo listo | Que el jugador lo vea antes de correr |
| La repetición compara tiempos con `Object.is` (un lesionado no tiene tiempo) | Corrección |
| 6 pruebas nuevas (65 en total) | §17 |

## v0.12 — 15/11/2026 (Campo 2.0)

| Cambio | Motivo |
|---|---|
| **Parcela de 90 × 66 m** (antes 66 × 48), con más árboles, flores, pasto y cortaderas | Pedido del usuario: el campo se sentía apretado |
| **Terreno continuo con sierras bajas** al fondo, lomas en la llanura, montes de árboles afuera y bruma de horizonte: ya no se ve el fondo azul | Pedido del usuario |
| **Edificios, potrero y molino movibles y girables** desde «Acomodar el campo» (Mercado → Decoración) o tocándolos en ese modo. Copia translúcida, huella verde o roja y flecha hacia la entrada. Gratis | Pedido del usuario; cambia la decisión de §3 (edificios fijos) |
| **Caminos que se rehacen solos** hasta la puerta de cada pieza; la decoración que queda debajo va al depósito | Coherencia del campo |
| La decoración se elige solo desde el Mercado; al tocar una casilla, el objeto queda ahí hasta «Comprar» (no sigue al mouse) | Pedido del usuario |
| Límites de la decoración ampliados a la parcela nueva; zoom inicial más lejos y más alejamiento posible | Parcela más grande |
| **Arrastre de objetos y edificios en tiempo real:** apretás sobre el objeto (o cerca, con margen para el dedo) y sigue al puntero mientras lo mantenés; tocar una casilla también lo lleva ahí. Si apretás lejos, se mueve la cámara | Pedido del usuario: había que ir tocando casilla por casilla |
| Botón **«Acomodar el campo»** destacado arriba de Mercado → Decoración | El usuario no encontraba cómo mover lo que ya tenía |
| **Nombre del establecimiento** en Mercado → Decoración: el primer cambio es gratis, los siguientes cuestan 20 Gemas (en el ledger). El título del campo muestra el nombre | Pedido del usuario |
| 5 pruebas nuevas (59 en total) | §17 |

## v0.11 — 15/11/2026 (cierre de la Fase 6: aspecto con Gemas)

| Cambio | Motivo |
|---|---|
| **Aspecto (skins) con Gemas:** crin y cola teñidas (4), cascos (2), mantas (5) y color del cuero de la montura (4), de 10 a 40 Gemas. Una compra sirve para todo el establo; se elige en la ficha de cada caballo | §24.1, pedido del usuario |
| Las **monturas se ven** sobre el caballo (cuero suela por defecto, o el color comprado), en la ficha, en el campo y en la carrera; el color viaja con la montura al cambiarla de caballo | Darles sentido visual a las monturas y a sus skins |
| Pestaña **Aspecto** en el Mercado | Todo lo que se compra, en el Mercado |
| Solo visual: no cambia atributos ni se hereda; el pelaje genético sigue igual debajo | «Pay to Fast, nunca Pay to Win» (§1) |
| 2 pruebas nuevas (54 en total) | §17 |

## v0.10 — 15/11/2026 (Fase 6: decoración, Mercado con pestañas y recompensa diaria)

| Cambio | Motivo |
|---|---|
| **Decoración libre** (§11.5): 19 objetos de campo argentino (de 100 a 20.000 Oro y dos de Gemas) sobre una cuadrícula de 2 m; se rotan, se mueven y se guardan en el depósito (se vuelven a poner gratis). Las baldosas rojizas marcan lo fijo | GDD §3 y §11.5 |
| El objeto queda puesto en el campo mientras se lo ubica (se toca o se arrastra) y recién se cobra al tocar «Comprar»; si se cancela, se va | Pedido del usuario |
| El portal, la tranquera y los faroles pueden ir sobre los caminos (el portal va en la entrada); tramos de camino de tierra a la venta | Pedido del usuario |
| **Mercado con pestañas:** Caballos, Monturas, Decoración, Oro (con Gemas, 10 por día) y Gemas (paquetes de §11.8, sin cobro hasta las Fases 11 y 12) | Pedido del usuario: todo lo que se compra, en el Mercado |
| **Objetivos** queda para misiones: objetivos semanales, recompensa por entrar, carreras del día y movimientos | Pedido del usuario |
| **Recompensa por entrar:** racha de 7 días (100 a 500 Oro y 2 Gemas el día 7); se corta si se saltea un día. Aviso en el campo | Pedido del usuario |
| Botón **«Comprar caballo»** en Mis caballos | Pedido del usuario |
| Ideas del usuario repartidas en fases (GDD §24) | Plan |
| 7 pruebas nuevas (52 en total) | §17 |

## v0.9 — 15/11/2026 (carreras: cuerpos sólidos, recta final, hipódromo y toma de meta)

| Cambio | Motivo |
|---|---|
| **Simulador sim-0.4.0:** los caballos tienen cuerpo (2,5 m); ninguno atraviesa a otro, los cambios de carril que dejarían a dos encimados no se hacen y nadie elige un carril que otro ya eligió | El usuario vio caballos que se atravesaban. Medido con `tools/trafico.ts`: había superposiciones en el 29–54 % de los cuadros; ahora 0 |
| En la recta final, quien viene atrás con remate busca afuera; la cuerda queda para el que se apaga | El usuario vio a casi todos por la misma banda. En la recta de 500 m la cuerda llevaba el 63 % de los caballos; ahora el 31 %, y el resto se reparte en 4–6 carriles, como en las carreras reales |
| Balance revalidado con el runner (§21): todo dentro de los criterios | Cambiar el tráfico cambia el balance |
| **Hipódromo:** barandas blancas «cuello de cisne», postes de distancia a rayas cada 100 m con carteles de metros, poste de llegada con disco, casilla del juez con la cámara de foto final, partidor con gateras numeradas cuyas puertas se abren al largar, tribuna con público y techo frente a la recta final, explanada, marcador con los cuatro primeros en vivo, torres de luz y canteros | Pedido del usuario: pista más realista, a partir de cómo son Palermo y San Isidro y de las partes de una pista real |
| **Toma «Meta» (tecla 5) y cámara lenta:** cámara fija sobre la prolongación de la línea de llegada, como la de foto final; en automático entra en los últimos 28 m y el tiempo corre al 30 % mientras los caballos cruzan | Pedido del usuario |
| **Zona de llegada despejada:** del lado de afuera, de 170 m antes a 110 m después de la meta, no hay árboles ni torres de luz (los árboles de esa zona pasan al lado de adentro). Se mide en el mundo, porque en 1.500 m la salida y la llegada están en el mismo lugar. Se sacó el poste de afuera de la meta y el cartel que cruzaba la pista; el cartel META pasó al frente de la casilla del juez | Pedido del usuario: los árboles tapaban las cámaras de la llegada |
| Prueba nueva: ningún caballo atraviesa a otro con 8 y 12 caballos en ambas distancias (46 en total) | §17 |

## v0.8 — 15/11/2026 (Fase 6, segunda parte: campeonato y campo más detallado)

| Cambio | Motivo |
|---|---|
| **Campeonato semanal** en la pantalla Carreras: sábado y domingo (hora local), una inscripción por semana de 500 Oro que sortea la distancia, 12 caballos, premios 3.000 · 2.000 · 1.400 · 800 (4.º–6.º) · 400 (7.º–12.º); no cuenta para el límite diario | §11.3 |
| Mientras no hay servidor, los rivales del campeonato son IA con entre 0 y 8 puntos de entrenamiento por atributo, para que sea más exigente que una Casual. En la Fase 7 se agrupa por rating | §11.3: «agrupa por rating; los bots completan grupos» |
| Carreras de 12 caballos: colores de número 9 a 12 en el HUD | Faltaban |
| **Campo más detallado** (pedido del usuario): matas de pasto y flores silvestres, piedras, una laguna con juncos, cortaderas con penachos, nido de hornero en un poste, palenque, farol, veleta, alero con fardos y carretilla en el establo; banco, macetas, farol y baldes en el Centro de recuperación; huella en la arena, tachos, rastrillo y monturas en el picadero; comedero, bebedero y piedra de sal en el potrero; trigo y un girasolar fuera del alambrado; árboles con copas de varios bultos y eucaliptos de tronco claro | Más vida sin cambiar el estilo low poly |
| Rendimiento del campo: las piezas repetidas se dibujan como *thin instances* y lo estático se une por material y edificio (de unas 3.200 mallas a 121). Medido en el navegador: 2 FPS antes de optimizar, 240 FPS después | Mantener 60 FPS en PC y apuntar a móviles (§20) |
| 1 prueba nueva (45 en total) | §17 |

## v0.7 — 15/11/2026 (Fase 6, primera parte: economía)

| Cambio | Motivo |
|---|---|
| **Ledger:** cada entrada y salida de Oro y Gemas queda anotada con su motivo (últimos 300 movimientos; se ven los recientes en Objetivos y Gemas) | §11.9 |
| **Límite diario:** las primeras 15 carreras del día pagan el 100 %, las siguientes el 25 %; el día cambia a las 00:00 locales. Contador en Carreras y aviso en el resultado | §11.2 |
| **Objetivos semanales** (25 carreras, 8 podios, 10 entrenamientos), con barra de progreso y botón Cobrar; se reinician el lunes a las 00:00 | §11.4 |
| **Aceleraciones con Gemas** («Terminar ya»): mejoras, entrenamiento, cruza y crecimiento, 1 Gema cada 30 min, mínimo 1. La recuperación no se acelera | §11.6 |
| **Conversión** de Gemas a Oro: 1 = 100, máximo 10 por día | §11.6 |
| **Monturas** Sprint, Resistencia y Táctica (3.000 Oro o 30 Gemas): una por caballo, se cambian desde la ficha y suman al correr (tope 100). Su aporte se ve en azul en las barras | §11.7 |
| **Venta al juego** desde la ficha, con confirmación: 10 % del precio sugerido, mínimo 100 | Pedido del usuario (§23.1) |
| Pantalla nueva **Objetivos y Gemas** (botón en el campo; muestra un punto cuando hay algo para cobrar) | Reunir lo de la economía en un lugar |
| Números en `config/balance/economia.json`; el precio sugerido pasó ahí desde `mercado.json` | Todo configurable |
| 7 pruebas nuevas (44 en total) | §17 |

## v0.6 — 15/11/2026 (Fase 5: crianza y mercado del juego)

| Cambio | Motivo |
|---|---|
| **Mercado del juego adelantado** a esta fase: cuatro ofertas por día (dos básicas, una especializada, una de genética destacada), siempre con un macho y una hembra; precio de §12.2 | Pregunta del usuario: no había dónde comprar caballos, y criar necesita uno del sexo opuesto |
| Cada tipo de oferta tiene una suma natural buscada (300, 325, 345 ±4) en `config/balance/mercado.json`. La especializada sube los dos atributos fuertes de su raza | Precios de §11.5. Medido: básico 2.514, especializado 5.935, destacada 11.818 |
| **Cruza** desde la ficha: elegir la pareja, nombrar al potrillo, 500 Oro, espacio reservado, 8 h de cruza y 24 h de crecimiento, una cruza por establo | §10.1 |
| Herencia de §10.2 (55 % el mayor, ±2, techo de la nueva sangre, suma ≤ 360), predisposición promedio ±10 %, composición racial promedio | §10.2, §10.3 |
| Pelaje heredado: un alelo de cada padre por locus; marcas blancas parecidas a las de los padres; forma del cuerpo mezclada | §10.4 |
| El potrillo se ve más chico mientras crece, en el campo y en la ficha; la ficha muestra padre y madre (se tocan para verlos) | Mostrar el crecimiento y el linaje |
| Números en `config/balance/crianza.json` | Todo configurable |
| `?partida=nombre` en la dirección abre otra partida guardada | Probar sin tocar la partida del jugador |
| 8 pruebas nuevas (37 en total), entre ellas 30 generaciones de cría selectiva sin pasar techos ni presupuesto | §17 y criterio de la fase: sin escalada |

## v0.5 — 15/11/2026 (Fase 4: carreras contra IA)

| Cambio | Motivo |
|---|---|
| Pantalla **Carreras** (botón en el campo): modo, distancia sorteada, caballo, estrategia e historial | §9.1: la distancia se revela antes de elegir caballo |
| Modos **Práctica** (6 caballos) y **Casual** (8) | §9.1 |
| La distancia y la superficie sorteadas quedan guardadas hasta correr; no se pueden volver a sortear | Evita sortear hasta que salga la distancia que conviene |
| Premios en Oro por puesto y distancia en `config/balance/recompensas.json`; bono de bienvenida de 1.500 Oro en la primera carrera | §11 y tutorial |
| Historial de las últimas 100 carreras (puesto, modo, distancia, foto final, Oro, semilla para la repetición) | §9 |
| Resultado con el Oro ganado; la repetición no vuelve a pagar | Determinismo y seguridad del premio |
| **Liberar un caballo** desde la ficha, con confirmación en dos pasos; no se puede liberar el último | Pedido del usuario |
| 6 pruebas nuevas (29 en total) | §17 |

## v0.4 — 15/11/2026 (Fase 3: edificios)

| Cambio | Motivo |
|---|---|
| Reglas de los tres edificios en `src/domain/edificios.ts` y números en `config/balance/edificios.json`: mejoras 1→5, compra de espacios, entrenamiento (sorteo por predisposición, tope en puntos), recuperación con cola y reloj que resuelve en orden lo ocurrido con el juego cerrado | §7 y §8. Los costos de mejoras y espacios se revisarán más adelante (pedido del usuario); están en configuración |
| La partida pasa a la versión 2 (edificios) y convierte sola las partidas de la Fase 2 | No perder el progreso del jugador |
| Pantallas: pestaña Edificios, Entrenar en la ficha, barras de progreso con cuenta regresiva y avisos al terminar | Contenido de la Fase 3 (§22) |
| Después de cada carrera el caballo entra al Centro de recuperación; se quitó «Nueva carrera» del resultado | §8.3 |
| **Campo argentino isométrico** (`src/render/campoView.ts`): establo encalado de techo rojo, picadero redondo con tinglado, centro de recuperación con galería, potrero, alambrado con tranquera, molino con tanque australiano, ombú, eucaliptos y paraísos. Edificios en lugares fijos; se toca un edificio para abrir su panel | Decisión del usuario (15/11/2026) y §3 |
| Los caballos aparecen en el campo: pastan en el potrero, caminan en el picadero mientras entrenan y descansan junto al Centro de recuperación | Dar vida al establecimiento con lo que ya existe |
| 9 pruebas nuevas (23 en total) | §17 |

## v0.3 — 15/11/2026 (Fase 2: caballos y establo)

| Cambio | Motivo |
|---|---|
| **Modelo de caballo nuevo:** base low poly de LowPolyFigures (CC BY 4.0) con esqueleto, pesos y 8 razas como morph targets, generado por `arte/caballo/` (Python, sin Blender) | Los modelos generados con tubos en Blender no alcanzaban la calidad pedida; el usuario los rechazó |
| Las razas cambian proporciones del esqueleto y rasgos propios (perfil cóncavo del Árabe, grupa del Cuarto de Milla, cuello largo del Akhal-Teke, cernejas y crin larga del Frisón, etc.) | §5.1 y §10.4: modelos anatómicamente diferenciados, no recolores |
| Aires Quieto, Paso, Trote, Medio galope y Galope por cinemática inversa: los cascos apoyan sin patinar | Criterio de la Fase 1: animación natural sin patinar |
| Pelaje pintado por faceta desde la genética (región, hueso y altura) | Coherencia con la estética low poly |
| **Interfaz en React** (antes HTML armado a mano) | §2: cliente React + TypeScript |
| Bienvenida (paso 1 del tutorial), establo con capacidad, ficha 3D, guardado local en IndexedDB, carrera de práctica con el caballo propio e historial | Contenido de la Fase 2 (§22) |
| **Estilo del establecimiento:** campo argentino; edificios en lugares fijos y decoración libre sobre una cuadrícula | Decisión del usuario (15/11/2026). Se construye en la Fase 3 |
| Pantalla de caballos: lista a la izquierda, 3D al centro, ficha a la derecha | Aprobado por el usuario |
| Crédito del modelo visible en el juego (enlace "Créditos" del establo) | Lo exige la licencia CC BY 4.0 |

## v0.2.1 — 14/11/2026 (Fase 1)

| Cambio | Motivo |
|---|---|
| **Se retiran las pruebas de sincronización** (salida, cambio de ritmo, remate) del juego, del simulador y del GDD. Simulador `sim-0.3.0` | Decisión del usuario: no forman parte del juego. La estrategia elegida antes de largar queda como la decisión del jugador en carrera |

## v0.2 — 14/11/2026 (Fase 0)

Cada cambio indica el problema que resolvía. Los resultados medidos están en `Informe_balance_v0.2.md`.

### Carreras

| Cambio | Motivo |
|---|---|
| Modelo con carriles, encierros, curvas, rebufo y decisiones laterales | El GDD hablaba de posicionamiento, adelantamientos y rebufo, pero las fórmulas eran unidimensionales. Inteligencia y la estrategia Agresiva no se podían programar |
| Remate calculado: el caballo estima cuándo puede sprintar hasta la meta | Los caballos llegaban con 25–48 de reserva sin usar. Da a Inteligencia un papel claro (dosificar) |
| Inteligencia: menos metros perdidos (hasta 4,55 %), más rebufo, más huecos, anticipación y mejor cálculo del remate | Con los efectos de la v0.1 (0,6 % y 4 %) era el atributo que nadie quería: el reparto óptimo la dejaba al mínimo |
| Temple: también reduce la pérdida al quedar encerrado y la irregularidad del ritmo | En 500 m no servía para nada (0,00 s por +10 puntos) |
| Potencia: remate por encima de Vmax sin consumo extra; acelerar cuesta reserva y Potencia lo abarata | Valía poco en las dos distancias |
| El cansancio empieza bajo 50 de reserva (antes 80) y el esfuerzo se mide sobre la velocidad buscada | Antes todos se vaciaban en 1.500 m y en 500 m la reserva no importaba |
| Ritmo de 1.500 m como fracción entre Vs y Vmax | Resistencia dominaba 1.500 m a través de la velocidad sostenible |
| Estrategias recalibradas por distancia (Agresiva = prioridad de posición) | Conservadora nunca convenía; luego, Agresiva siempre ganaba en 500 m y Equilibrada en 1.500 m |
| Coeficientes obtenidos con un optimizador automático y validados con semillas nuevas | Cambiar números a ojo no garantizaba el balance |
| Pruebas de sincronización: máximo 0,6 % (500 m) y 0,5 % (1.500 m), antes 0,3 % y 0,45 % | Una montura pesaba más que la habilidad del jugador |
| Simulador determinista solo con `+ − × ÷ sqrt` y PRNG entero | `Math.pow` y similares pueden diferir entre navegadores, y el servidor no podría reproducir las carreras offline |

### Caballos, genética y entrenamiento

| Cambio | Motivo |
|---|---|
| Perfiles de raza con suma igual (330) y retocados con simulación | Las sumas iban de 310 a 332 y el Frisón y el Andaluz salían últimos |
| Techos genéticos por raza (suman 410) y composición racial heredable | Con 90/360 iguales para todos, la cría convergía al mismo caballo en unas 10 generaciones |
| Variación individual ±6 y mínimo natural 30 | Solo estaba en el Prompt Maestro, no en el GDD |
| Límite de entrenamiento en **puntos** (3/6/9/12/15) en lugar de selecciones | El +1/+2 aleatorio dejaba hasta 10 puntos de diferencia entre dos caballos "al máximo" |
| Se elimina Energía/Fatiga/Preparación; queda un estado único | Eran redundantes: solo describían "listo" o "recuperándose" |
| El jugador elige el sexo del caballo inicial; el mercado garantiza ambos sexos | No estaba definido y criar requería un segundo caballo |

### Economía

| Cambio | Motivo |
|---|---|
| Recompensas de 8 caballos subidas un 15 %; nuevas tablas para Práctica (6) y Campeonato (12) | Faltaban las tablas de 6 y 12, y el progreso era muy lento |
| Mejoras de edificios: 1.000 / 2.400 / 4.800 / 9.600 (antes 1.500 / 3.500 / 8.000 / 18.000) | Un jugador regular tardaba 133 días; uno casual nunca llegaba |
| Espacios del establo un 20 % más baratos | Lo mismo |
| Aceleración: 1 Gema por cada 30 min (antes por hora) | Era tan barata que no sostenía el juego |
| Conversión: 10 Gemas por día (antes 25) | Quien pagaba avanzaba 3,2× más rápido y acumulaba Oro para comprar caballos ganadores |
| Mercado entre jugadores: precio entre 50 % y 300 % del sugerido; máximo 3 compras por semana | Era una vía de pay-to-win y de venta de Oro por dinero real |
| Precio sugerido con fórmula explícita | Usaba "potencial" y "aptitudes", que no existían |
| Monturas intercambiables entre caballos | No estaba definido |
| Decoración con Oro como sumidero sin fin | Los jugadores regulares acumulaban más de 100.000 de Oro sin uso |
| Objetivos semanales definidos; reinicio diario y semanal definidos | Estaban sin especificar |

### Online, clanes y offline

| Cambio | Motivo |
|---|---|
| Orden: emparejamiento → distancia → elección de caballo; filtro por "fuerza del establo" (3–5 %) | El orden era ambiguo y el filtro del 12–20 % era enorme frente a diferencias reales del 1–2 % |
| TrueSkill solo entre humanos en ranked con bots | No estaba definido cómo afectaban los bots |
| Rating visible `50·(μ−3σ)` y cortes nuevos con porcentajes objetivo | Con la fórmula anterior, cerca del 70 % de los jugadores quedaba en Bronce y Leyenda era casi inalcanzable |
| Clanes con Elo (K = 32) y emparejamiento por rating | ±20 fijo premiaba enfrentar a clanes débiles |
| Tokens offline firmados por el servidor | Se podía hacer trampa cambiando el reloj |

### Documentación

- El GDD es la única fuente de verdad. El Prompt Maestro v0.2 ya no repite números; en la v0.1 la duplicación había creado contradicciones.
- Nuevas secciones: contratos entre módulos (§18), modelo de datos (§19), requisitos móviles (§20), criterios automáticos de balance (§21) y riesgos (§23).
