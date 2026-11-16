# Caballo del juego

Genera `juego/public/modelos/caballo.glb` y `caballo_meta.json` (8 razas, esqueleto y aires). No necesita Blender.

```
python exportar.py            # requiere Python 3 con numpy y scipy
```

- `caballo_original.stl`: modelo base (ver CREDITOS.md).
- `base.py`: orienta, escala a 1,60 m a la cruz y simplifica la malla (→ `base_8000.npz`).
- `esqueleto.py`, `rig.py`: huesos y pesos de piel.
- `regiones.py`: crin, cola y cascos (para pintar los pelajes).
- `razas.py`: las 8 razas como deformaciones del caballo base (proporciones y rasgos).
- `animacion.py`: Quieto, Paso, Trote, Medio galope y Galope por cinemática inversa (cascos sin patinar).
- `exportar.py`: escribe el GLB; `verificar_glb.py` lo vuelve a leer y dibuja caballos animados para revisar.
