# Final ReactReach v1.0.0 evaluation results

**Author:** Hellen Santos

**Evaluation date:** 24 August 2026

**ReactReach tag:** `v1.0.0`

**ReactReach commit:** `0202e2c451802ea449ca576beeda7695340687d0`

**Evaluation commit:** `656d489a1462ac7431386db040acde821a4d1cb1`

## Frozen identity

| Input | SHA-256 or value |
|---|---|
| Ground-truth dataset | `68951480a3987ef7314631d41304076807fbd220e11e1b67910cb0e8ea70aae1` |
| Ground-truth file | `fa04fd3c2c2c9e4299f2cc229629bdc6dd001fdff41792386fc0836732031066` |
| Evaluation configuration | `1eee302e373fb3ffc9d112cc45a5705c3793232e3a161ca6ba335a4582a2f9e4` |
| Sink catalogue | `5330d6c10a2e320723e24cad6e4b780be7e4abeb31546bbdd3442d4b5262390a` |
| Performance benchmark configuration | `fdb6a6b343c4ab6ad7a4e85c8ea17c3e8342f9b52ace05f30464128f0348f8cb` |
| Runtime | Node.js 24.11.1; npm 11.6.2 |

## Effectiveness

Final run: `20260824T192135965Z-eb90ec9e`.

The run contains 54 processed scenario records, the raw ReactReach JSON and
SARIF outputs for all three projects, a per-scenario CSV, derived metrics,
completion manifests and SHA-256 records. Independent verification reported no
unexpected positive findings and no inconsistent artefacts.

| Cohort | TP | FP | TN | FN | Precision | Recall | F1 | Accuracy | Specificity |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Characterization | 15 | 0 | 15 | 0 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| Holdout | 1 | 6 | 0 | 5 | 0.143 | 0.167 | 0.154 | 0.083 | 0.000 |
| Primary | 16 | 6 | 15 | 5 | 0.727 | 0.762 | 0.744 | 0.738 | 0.714 |
| Robustness | 2 | 1 | 5 | 4 | 0.667 | 0.333 | 0.444 | 0.583 | 0.833 |
| Extended | 18 | 7 | 20 | 9 | 0.720 | 0.667 | 0.692 | 0.704 | 0.741 |

### Package-presence baseline

On the extended dataset, the baseline produces TP=27, FP=27, TN=0 and FN=0.
Its precision is 0.500, recall is 1.000, F1 is 0.667, accuracy is 0.500 and
specificity is 0. ReactReach reduces false positives from 27 to 7 and increases
precision to 0.720, while its nine false negatives reduce recall to 0.667.

### Secondary fidelity

| Field | Matches | Total | Accuracy |
|---|---:|---:|---:|
| Reachability tier | 37 | 54 | 0.685 |
| Sink rule | 18 | 27 | 0.667 |
| Reason code | 37 | 54 | 0.685 |
| Exact classification | 37 | 54 | 0.685 |

The perfect characterization result is implementation-aligned and must not be
treated as generalisation evidence. The adversarial holdout exposes the model
boundaries documented in `holdout-error-analysis.md`.

## Performance

The reference machine used Windows 10.0.22631 x64, an AMD Ryzen 5 5600X
6-Core Processor with 12 logical processors, and 32 GiB of installed memory.
Each campaign contains 3 projects x 30 measurements = 90 retained samples, in
addition to three discarded warm-ups per project. All detected Tukey outliers
remain included.

### Campaign 1 — `20260824T192146961Z-eeb6de5a`

| Files | Mean ms | SD ms | Median ms | p95 ms | Min–max ms | Peak RSS MiB | Outliers |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 81.923 | 2.242 | 81.388 | 85.956 | 77.828–86.756 | 101.051 | 0 |
| 250 | 229.353 | 5.789 | 229.468 | 238.229 | 219.019–239.892 | 111.668 | 0 |
| 500 | 395.527 | 10.175 | 393.893 | 414.373 | 380.502–425.433 | 137.535 | 4 |

### Campaign 2 — `20260824T192257612Z-07ac2678`

| Files | Mean ms | SD ms | Median ms | p95 ms | Min–max ms | Peak RSS MiB | Outliers |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 84.163 | 3.462 | 83.567 | 91.046 | 80.453–97.835 | 91.406 | 2 |
| 250 | 230.073 | 7.519 | 228.841 | 245.097 | 218.343–252.723 | 111.961 | 3 |
| 500 | 383.176 | 6.411 | 382.011 | 394.735 | 371.826–396.015 | 137.152 | 0 |

### Campaign 3 — `20260824T192407201Z-62469cce`

| Files | Mean ms | SD ms | Median ms | p95 ms | Min–max ms | Peak RSS MiB | Outliers |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 80.973 | 2.180 | 80.534 | 84.572 | 77.743–86.187 | 92.246 | 0 |
| 250 | 222.459 | 5.102 | 220.285 | 233.512 | 216.573–236.500 | 111.465 | 1 |
| 500 | 382.347 | 7.104 | 380.195 | 397.367 | 372.614–401.348 | 136.297 | 0 |

All campaigns pass the 500-file thresholds of p95 below 30,000 ms and peak RSS
below 512 MiB. The largest observed 500-file p95 is 414.373 ms, and the largest
observed peak RSS is 137.535 MiB.

## Interpretation

The final results support the feasibility of contextual prioritisation as a
complement to package-presence reporting. They do not establish runtime
exploitability and do not support replacing SCA. The controlled corpus, fixed
vulnerable core and single reference machine limit external validity.
