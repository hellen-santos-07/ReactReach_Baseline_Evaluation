# Final ReactReach v1.1.0 evaluation results

**Author:** Hellen Santos

**Evaluation date:** 18 September 2026

**ReactReach tag:** `v1.1.0`

**ReactReach commit:** `d63e114dfaf78a793806984336522e73f40fab63`

**Evaluation commit:** `aee4f4a6fc901bdb3764af4549703f66bac513f3`

## Frozen identity

| Input | SHA-256 or value |
|---|---|
| Ground-truth dataset | `68951480a3987ef7314631d41304076807fbd220e11e1b67910cb0e8ea70aae1` |
| Ground-truth file | `fa04fd3c2c2c9e4299f2cc229629bdc6dd001fdff41792386fc0836732031066` |
| Evaluation configuration | `1eee302e373fb3ffc9d112cc45a5705c3793232e3a161ca6ba335a4582a2f9e4` |
| Sink catalogue | `5330d6c10a2e320723e24cad6e4b780be7e4abeb31546bbdd3442d4b5262390a` |
| Performance benchmark configuration | `fdb6a6b343c4ab6ad7a4e85c8ea17c3e8342f9b52ace05f30464128f0348f8cb` |
| Semgrep | Community Edition `1.177.0`; OSS engine |
| Semgrep ruleset | `p/javascript`; 74 rules; retrieved 13 September 2026 |
| Semgrep rule catalogue | `01bda027b61d4ecd64f2d3da6ca23b393e3759849589da3c701614941d689afd` |
| Runtime | Node.js 24.11.1; npm 11.6.2 |

## Effectiveness

Final run: `20260918T145311595Z-977fc6ee`.

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

### Semgrep general SAST baseline

Definitive run: `20260913T162943241Z-c1b5665a`.

Semgrep Community Edition `1.177.0` used its OSS engine and the public
`p/javascript` ruleset retrieved on 13 September 2026. A scenario was predicted
positive when a Semgrep finding overlapped one of its frozen ground-truth
evidence ranges. All 23 findings mapped to exactly one scenario; none required
manual review.

| Cohort | TP | FP | TN | FN | Precision | Recall | F1 | Accuracy | Specificity |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Characterization | 9 | 3 | 12 | 6 | 0.750 | 0.600 | 0.667 | 0.700 | 0.800 |
| Holdout | 3 | 5 | 1 | 3 | 0.375 | 0.500 | 0.429 | 0.333 | 0.167 |
| Primary | 12 | 8 | 13 | 9 | 0.600 | 0.571 | 0.585 | 0.595 | 0.619 |
| Robustness | 2 | 1 | 5 | 4 | 0.667 | 0.333 | 0.444 | 0.583 | 0.833 |
| Extended | 14 | 9 | 18 | 13 | 0.609 | 0.519 | 0.560 | 0.593 | 0.667 |

On the primary dataset, ReactReach exceeds Semgrep in precision (0.727 versus
0.600), recall (0.762 versus 0.571), F1 (0.744 versus 0.585), and accuracy
(0.738 versus 0.595). On the extended dataset, ReactReach also has fewer false
positives (7 versus 9) and false negatives (9 versus 13). This aggregate
advantage is not uniform across cohorts. Semgrep performs better on the
deliberately adversarial holdout, with F1 0.429 versus 0.154 and accuracy 0.333
versus 0.083, while both tools have the same aggregate robustness confusion
matrix and metrics.

The holdout was intentionally constructed around custom-hook returns,
cross-file helpers, React Context, mutation, trusted overwrites, generic or rest
props, and property or index separation outside ReactReach's implemented
propagation boundaries. Semgrep's stronger holdout result does not mean that it
reconstructed these dependency-origin paths. All 23 findings in the definitive
run came from the generic `dangerouslySetInnerHTML` rule, which can predict a
positive scenario by recognising the sink pattern without establishing that
the value originated in the vulnerable dependency. Its holdout result therefore
shows complementary pattern coverage under the frozen mapping. Conversely,
ReactReach's overall advantage is influenced by the development-aligned
characterization cohort and must not be interpreted as universal superiority
over Semgrep. The comparison is not feature-equivalent.

### Secondary fidelity

| Field | Matches | Total | Accuracy |
|---|---:|---:|---:|
| Reachability tier | 37 | 54 | 0.685 |
| Sink rule | 18 | 27 | 0.667 |
| Reason code | 37 | 54 | 0.685 |
| Exact classification | 37 | 54 | 0.685 |

The perfect characterization result is implementation-aligned and must not be
treated as generalisation evidence. The adversarial holdout exposes the model
boundaries documented in `holdout-error-analysis.md`; its purpose is precisely
to concentrate cases that the implemented ReactReach model does not cover.

## Performance

The reference machine used Windows 10.0.22631 x64, an AMD Ryzen 5 5600X
6-Core Processor with 12 logical processors, and 32 GiB of installed memory.
Each campaign contains 3 projects x 30 measurements = 90 retained samples, in
addition to three discarded warm-ups per project. All detected Tukey outliers
remain included.

### Campaign 1 — `20260918T145318252Z-40189d1a`

| Files | Mean ms | SD ms | Median ms | p95 ms | Min–max ms | Peak RSS MiB | Outliers |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 77.969 | 3.485 | 76.932 | 87.233 | 74.111–89.402 | 98.941 | 2 |
| 250 | 211.952 | 2.087 | 212.313 | 215.423 | 207.383–216.171 | 112.273 | 0 |
| 500 | 363.300 | 3.128 | 363.350 | 368.377 | 356.904–369.123 | 134.148 | 2 |

### Campaign 2 — `20260918T145418654Z-389ceb1c`

| Files | Mean ms | SD ms | Median ms | p95 ms | Min–max ms | Peak RSS MiB | Outliers |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 77.359 | 1.649 | 77.134 | 81.045 | 74.413–81.507 | 98.707 | 0 |
| 250 | 212.499 | 3.241 | 211.693 | 218.893 | 207.844–222.091 | 112.387 | 1 |
| 500 | 364.952 | 3.863 | 364.720 | 372.782 | 356.670–374.263 | 134.223 | 4 |

### Campaign 3 — `20260918T145518404Z-892aa8d3`

| Files | Mean ms | SD ms | Median ms | p95 ms | Min–max ms | Peak RSS MiB | Outliers |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 77.211 | 2.247 | 76.795 | 82.556 | 74.295–84.336 | 98.547 | 3 |
| 250 | 213.527 | 4.073 | 212.304 | 221.583 | 208.268–228.643 | 112.402 | 2 |
| 500 | 365.342 | 4.215 | 364.667 | 373.300 | 358.890–376.353 | 134.301 | 1 |

All campaigns pass the 500-file thresholds of p95 below 30,000 ms and peak RSS
below 512 MiB. The largest observed 500-file p95 is 373.300 ms, and the largest
observed peak RSS is 134.301 MiB.

## Public-application feasibility

Final run: `20260918T145620134Z-a1044ac8`.

All three applications completed without crashes, parsing errors or diagnostics.
Donetick produced 78 findings (2 HIGH, 68 MEDIUM, 1 LOW and 7 NONE), SocialEcho
produced 55 (37 MEDIUM and 18 NONE), and varHarrie.github.io produced 10
(1 MEDIUM and 9 NONE). The complete per-application timing, memory and frozen
input records are reported in `public-application-study.md`.

Manual inspection confirmed that both HIGH findings represent credible
structural routes from `react-router-dom` use through chore state and
`useDescriptionHtml` to `dangerouslySetInnerHTML`. It did not establish attacker
control or the open-redirect mechanism of the associated advisory. The sample
has no labelled ground truth, so these counts are not accuracy estimates and no
precision, recall or F1 is computed.

## Interpretation

The final results support the feasibility of contextual prioritisation as a
complement to package-presence reporting. They do not establish runtime
exploitability and do not support replacing SCA. The Semgrep comparison adds a
general SAST reference point, but it is not a dependency-reachability analyser.
The controlled corpus, fixed vulnerable core and single reference machine limit
external validity.
