"""Regiones de la malla base (por cara): cuerpo, crin, cola, cascos, ojos, orejas... para pintar pelajes."""
import numpy as np

CUERPO, CRIN, COLA, CASCO, OJO, HOCICO = 0, 1, 2, 3, 4, 5


def regiones(V, F):
    c = V[F].mean(1)
    x, y, z = np.abs(c[:, 0]), c[:, 1], c[:, 2]
    reg = np.zeros(len(F), int)
    # crin: banda sobre la cresta, por encima del pliegue que recorre el cuello
    s = (y - 0.38) * (-0.757) + (z - 1.49) * 0.653
    vmin = np.minimum.reduce([(V[F[:, i], 1] - 0.38) * (-0.757) + (V[F[:, i], 2] - 1.49) * 0.653 for i in range(3)])
    crin = (vmin > -0.012) & (y > 0.20) & (y < 0.99) & (z > 1.50) & ~((z > 2.02) & (y > 0.97))
    reg[crin] = CRIN
    # copete: mechón sobre la frente, entre las orejas
    cop = (y > 0.99) & (y < 1.20) & (x < 0.075) & (z > 1.955) & (z - 2.05 > -(y - 1.02) * 0.95 - 0.045)
    reg[cop & ~((x > 0.045) & (z > 2.04))] = CRIN
    # cola
    reg[(y < -0.955) & (x < 0.2)] = COLA
    reg[(y < -0.93) & (z < 1.25) & (x < 0.11)] = COLA
    # cascos
    zmax = V[F][:, :, 2].max(1)
    reg[(zmax < 0.118)] = CASCO
    return reg
