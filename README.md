# ReactReach Baseline Evaluation

Public replication package for the final evaluation of
[ReactReach](https://github.com/hellen-santos-07/ReactReach) `v1.0.0`.

This project evaluates whether ReactReach can distinguish vulnerable-dependency
usages with a demonstrated contextual path to a security-sensitive sink from
usages without such a demonstrated path. ReactReach is compared with a
package-presence baseline derived from frozen `npm audit` data. Contextual
reachability is an operational proxy and does not prove runtime exploitation of
a specific advisory.

## Author

Designed and implemented by **Hellen Santos** as part of the Master's Degree in
Software Engineering at the Instituto Superior de Engenharia do Porto (ISEP).
Citation metadata is available in [`CITATION.cff`](CITATION.cff), and authorship
details are recorded in [`AUTHORS.md`](AUTHORS.md).

## Evaluated artefact

| Field | Value |
|---|---|
| Project | ReactReach |
| Version | `1.0.0` |
| Git tag | `v1.0.0` |
| Git commit | `0202e2c451802ea449ca576beeda7695340687d0` |
| Runtime | Node.js 24 |

The preflight rejects a different ReactReach version, tag, commit, dirty working
tree, sink catalogue, configuration, dataset, dependency set, or audit snapshot.

## Evaluation design

The final labelled dataset contains 54 balanced scenarios:

| Cohort | Scenarios | Positive | Negative | Purpose |
|---|---:|---:|---:|---|
| Characterization | 30 | 15 | 15 | Core supported and unsupported constructs |
| Adversarial holdout | 12 | 6 | 6 | Boundary cases and generalisation |
| Supplemental robustness | 12 | 6 | 6 | Additional packages and module structures |
| Extended total | 54 | 27 | 27 | Final combined evaluation |

`CRITICAL` and `HIGH` are positive predictions. `MEDIUM`, `LOW`, and `NONE`
are negative predictions. The package-presence baseline predicts positive when
the scenario's package appears in the frozen audit input. Precision, recall and
F1 are the primary effectiveness metrics; accuracy, specificity and exact
classification fidelity are secondary.

Performance is measured on deterministic projects containing 50, 250 and 500
source files. Each campaign uses three warm-ups and 30 retained measurements per
project in fresh Node.js processes. The 500-file acceptance thresholds are:

- static-analysis p95 below 30 seconds;
- peak resident set size below 512 MiB.

The complete method is specified in
[`docs/evaluation-protocol.md`](docs/evaluation-protocol.md).

## Published final results

The final effectiveness run is `20260824T192135965Z-eb90ec9e`.

| Cohort | TP | FP | TN | FN | Precision | Recall | F1 | Accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Characterization | 15 | 0 | 15 | 0 | 1.000 | 1.000 | 1.000 | 1.000 |
| Holdout | 1 | 6 | 0 | 5 | 0.143 | 0.167 | 0.154 | 0.083 |
| Primary | 16 | 6 | 15 | 5 | 0.727 | 0.762 | 0.744 | 0.738 |
| Robustness | 2 | 1 | 5 | 4 | 0.667 | 0.333 | 0.444 | 0.583 |
| Extended | 18 | 7 | 20 | 9 | 0.720 | 0.667 | 0.692 | 0.704 |

On the extended dataset, the package-presence baseline has TP=27, FP=27,
TN=0 and FN=0, with precision 0.500, recall 1.000 and F1 0.667. ReactReach
reduces false positives from 27 to 7 but introduces nine false negatives.

Three performance campaigns are published. All contain 90 retained samples and
pass both frozen thresholds. Their 500-file results are:

| Campaign | p95 static analysis | Peak RSS | Status |
|---|---:|---:|---|
| `20260824T192146961Z-eeb6de5a` | 414.373 ms | 137.535 MiB | PASS |
| `20260824T192257612Z-07ac2678` | 394.735 ms | 137.152 MiB | PASS |
| `20260824T192407201Z-62469cce` | 397.367 ms | 136.297 MiB | PASS |

All four executions used evaluation commit
`656d489a1462ac7431386db040acde821a4d1cb1`. Later commits only add the
published result artefacts, documentation and verification metadata.

See [`docs/results.md`](docs/results.md) for the complete tables and
[`docs/holdout-error-analysis.md`](docs/holdout-error-analysis.md) for the
scenario-level error analysis.

## Repository structure

```text
audit-data/       Frozen npm audit snapshots and input metadata
config/           ReactReach, performance and final-run configuration
corpus/           Three controlled React projects
docs/             Protocol, results and error analysis
ground-truth/     Final labelled 54-scenario manifest
schemas/          JSON Schema for the final ground truth
scripts/          Public command-line entry points
src/              Evaluation and verification implementation
test/             Harness and corpus tests
results/          Raw and processed outputs from the final v1.0.0 evaluation
```

Performance projects are generated deterministically and are intentionally not
stored in Git. This avoids committing hundreds of reproducible files while preserving
their generator, configuration, manifests and hashes.

## Setup

Place both repositories beside each other:

```text
parent-directory/
|-- ReactReach/
`-- ReactReach_Baseline_Evaluation/
```

Clone and select the evaluated ReactReach release:

```powershell
git clone https://github.com/hellen-santos-07/ReactReach.git
git -C ReactReach checkout v1.0.0
git clone https://github.com/hellen-santos-07/ReactReach_Baseline_Evaluation.git
cd ReactReach_Baseline_Evaluation
npm.cmd ci
```

On Linux or macOS, replace `npm.cmd` with `npm`.

## Verify the published artefact

```powershell
npm.cmd test
npm.cmd run ground-truth:validate
npm.cmd run ground-truth:hash
npm.cmd run performance:generate
npm.cmd run performance:check
npm.cmd run evaluation:preflight
npm.cmd run performance:preflight
npm.cmd run results:verify
```

`results:verify` recalculates hashes, scenario metrics, performance statistics
and thresholds from the committed raw data, and confirms that the recorded
execution commit is present in the repository history. It does not trust the
published summary files without independently checking them.

## Reproduce the effectiveness experiment

```powershell
npm.cmd run evaluation:run
```

The command scans each corpus project once with frozen audit inputs and writes a
new immutable identifier under `results/raw/` and `results/processed/`. Verify
the identifier printed by the command with:

```powershell
npm.cmd run evaluation:verify -- <run-id>
```

## Reproduce the performance experiment

Generate and validate the controlled inputs, inspect the plan, and run a
campaign:

```powershell
npm.cmd run performance:generate
npm.cmd run performance:check
npm.cmd run performance:preflight
npm.cmd run performance:plan
npm.cmd run performance:run
```

Verify the printed run identifier with:

```powershell
npm.cmd run performance:verify -- <run-id>
```

The published protocol retains three complete campaigns rather than choosing
the fastest result. To reproduce repeatability, execute `performance:run` three
times and report every completed identifier, including all retained outliers.

## Frozen inputs and reproducibility

- `ground-truth/ground-truth.json` is the only labelled manifest used by the
  final experiment.
- `audit-data/` contains project-specific audit snapshots and their SHA-256
  metadata.
- generated performance projects must match the deterministic source-tree
  hashes before a campaign starts.
- every final run records the ReactReach and evaluation commits, Node/npm
  versions, operating system, processor, memory, configuration and input hashes.
- raw outputs are written before metrics are derived and are independently
  verifiable.

## Interpretation boundary

A positive result means that ReactReach recognised a static contextual path
under its model. A negative result means that no such path was demonstrated,
but neither outcome establishes whether a specific advisory is exploitable at
runtime. The corpus is controlled and supports repeatable comparison, and it does
not replace validation on diverse industrial applications.
