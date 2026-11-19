# Indice di fortuna — calibrazione

Generato da `server/scripts/luck-calibrate.js` il 2026-11-19: 30000 distribuzioni per gioco (120000 mani), bot "Difficile", verifica Monte Carlo su 200 mani × 150 ridistribuzioni.

| Gioco | R² (mani nuove) | Spearman con Monte Carlo | Punti medi per fascia d'indice 0-20 / 20-40 / 40-60 / 60-80 / 80-100 |
|---|---|---|---|
| No Re e Fanti | 0.34 | 0.93 | -7.61 / -4.98 / -3.63 / -2.5 / -1.29 |
| No Donne | 0.26 | 0.91 | -5.55 / -3.74 / -2.76 / -1.96 / -1 |
| No 8 di Quadri | 0.14 | 0.91 | -3.98 / -2.68 / -1.84 / -1.12 / -0.39 |
| No K di Cuori | 0.09 | 0.81 | -3.71 / -2.51 / -1.87 / -1.27 / -0.64 |
| No Cuori | 0.32 | 0.91 | -6.68 / -4.14 / -2.78 / -1.76 / -0.89 |
| Ultime Due Prese | 0.22 | 0.88 | -4.67 / -2.66 / -1.55 / -0.85 / -0.26 |
| No Prese | 0.49 | 0.95 | -5.95 / -4.04 / -3 / -2.14 / -1.12 |
| Domino | 0.27 | 0.89 | -2.63 / -1.56 / -0.59 / 0.79 / 3.98 |
| Seme scelto | 0.72 | 0.98 | 1.43 / 2.39 / 3.13 / 3.94 / 5.36 |
| Senza Briscola | 0.50 | 0.94 | 3.31 / 5.11 / 6.35 / 7.71 / 10.02 |

## Pesi (caratteristiche standardizzate: punti attesi per 1 deviazione standard)

### No Re e Fanti

| Caratteristica | Peso | Quota |
|---|---|---|
| meanRank | -0.855 | 20% |
| singletons | +0.535 | 12% |
| voids | +0.457 | 10% |
| highs | -0.430 | 10% |
| kings | -0.425 | 10% |
| exposed | -0.383 | 9% |
| penGuarded | +0.364 | 8% |
| penCards | -0.346 | 8% |
| aces | -0.344 | 8% |
| shape | +0.093 | 2% |
| lows | +0.048 | 1% |
| penShort | -0.043 | 1% |
| longest | -0.038 | 1% |
| exits | +0.022 | 0% |

### No Donne

| Caratteristica | Peso | Quota |
|---|---|---|
| meanRank | -0.651 | 18% |
| penCards | -0.471 | 13% |
| singletons | +0.399 | 11% |
| aces | -0.356 | 10% |
| kings | -0.293 | 8% |
| voids | +0.287 | 8% |
| exposed | -0.281 | 8% |
| penShort | -0.272 | 8% |
| penGuarded | +0.204 | 6% |
| shape | +0.199 | 6% |
| lows | +0.064 | 2% |
| longest | -0.055 | 2% |
| highs | -0.018 | 1% |
| exits | +0.001 | 0% |

### No 8 di Quadri

| Caratteristica | Peso | Quota |
|---|---|---|
| meanRank | -0.660 | 27% |
| holds | +0.613 | 25% |
| exposed | -0.257 | 11% |
| suitLen | +0.251 | 10% |
| shape | +0.239 | 10% |
| singletons | +0.119 | 5% |
| below | +0.116 | 5% |
| voids | +0.077 | 3% |
| above | -0.038 | 2% |
| lows | +0.017 | 1% |
| kings | -0.016 | 1% |
| longest | -0.014 | 1% |
| aces | -0.011 | 0% |
| exits | +0.010 | 0% |
| highs | -0.004 | 0% |

### No K di Cuori

| Caratteristica | Peso | Quota |
|---|---|---|
| meanRank | -0.546 | 22% |
| shape | +0.297 | 12% |
| suitLen | +0.278 | 11% |
| holds | +0.217 | 9% |
| singletons | +0.208 | 9% |
| exposed | -0.203 | 8% |
| below | +0.195 | 8% |
| aces | -0.103 | 4% |
| voids | +0.096 | 4% |
| above | +0.081 | 3% |
| aceHearts | +0.081 | 3% |
| kings | -0.055 | 2% |
| lows | +0.044 | 2% |
| highs | -0.022 | 1% |
| longest | -0.014 | 1% |
| exits | +0.009 | 0% |

### No Cuori

| Caratteristica | Peso | Quota |
|---|---|---|
| meanRank | -1.105 | 25% |
| heartsLow | +0.941 | 21% |
| shape | +0.434 | 10% |
| lows | -0.387 | 9% |
| exits | +0.321 | 7% |
| hearts | +0.278 | 6% |
| exposed | -0.248 | 6% |
| heartsHigh | +0.231 | 5% |
| highs | -0.146 | 3% |
| aces | -0.111 | 2% |
| kings | -0.089 | 2% |
| voids | +0.086 | 2% |
| singletons | +0.070 | 2% |
| longest | +0.017 | 0% |

### Ultime Due Prese

| Caratteristica | Peso | Quota |
|---|---|---|
| meanRank | -0.901 | 34% |
| singletons | +0.320 | 12% |
| highs | -0.310 | 12% |
| voids | +0.226 | 8% |
| aces | -0.224 | 8% |
| exposed | -0.203 | 8% |
| kings | -0.183 | 7% |
| shape | +0.147 | 5% |
| exits | +0.083 | 3% |
| lows | -0.080 | 3% |
| longest | -0.011 | 0% |

### No Prese

| Caratteristica | Peso | Quota |
|---|---|---|
| meanRank | -1.020 | 31% |
| exits | +0.472 | 14% |
| voids | +0.411 | 13% |
| singletons | +0.402 | 12% |
| exposed | -0.379 | 12% |
| lows | -0.152 | 5% |
| longest | -0.119 | 4% |
| highs | -0.118 | 4% |
| shape | +0.104 | 3% |
| kings | -0.054 | 2% |
| aces | -0.034 | 1% |

### Domino

| Caratteristica | Peso | Quota |
|---|---|---|
| meanDist | -2.382 | 70% |
| sevens | -0.627 | 19% |
| suitsHeld | +0.139 | 4% |
| gaps | -0.113 | 3% |
| far | -0.090 | 3% |
| chained | -0.020 | 1% |
| near | +0.009 | 0% |

### Seme scelto

| Caratteristica | Peso | Quota |
|---|---|---|
| trumpLen | +0.825 | 26% |
| sideAces | +0.428 | 13% |
| trumpRankSum | +0.371 | 12% |
| kings | +0.230 | 7% |
| aces | +0.207 | 6% |
| singletons | +0.174 | 5% |
| voids | +0.171 | 5% |
| highs | +0.167 | 5% |
| meanRank | +0.125 | 4% |
| sideSingletons | -0.110 | 3% |
| shape | +0.079 | 2% |
| sideKings | +0.071 | 2% |
| sideVoids | -0.061 | 2% |
| lows | +0.056 | 2% |
| exposed | +0.056 | 2% |
| trumpHigh | +0.044 | 1% |
| longest | -0.025 | 1% |
| ruffs | +0.021 | 1% |
| trumpTop | -0.006 | 0% |
| exits | -0.002 | 0% |

### Senza Briscola

| Caratteristica | Peso | Quota |
|---|---|---|
| aces | +0.862 | 23% |
| meanRank | +0.828 | 22% |
| kings | +0.813 | 22% |
| highs | +0.708 | 19% |
| exposed | +0.178 | 5% |
| exits | +0.162 | 4% |
| lows | +0.085 | 2% |
| voids | +0.067 | 2% |
| singletons | -0.042 | 1% |
| longest | +0.024 | 1% |
| shape | +0.004 | 0% |
