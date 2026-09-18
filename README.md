# ReactReach Baseline Evaluation

Public replication package for the final evaluation of
[ReactReach](https://github.com/hellen-santos-07/ReactReach) `v1.1.0`.

This project evaluates whether ReactReach can distinguish vulnerable-dependency
usages with a demonstrated contextual path to a security-sensitive sink from
usages without such a demonstrated path. ReactReach is compared with a
package-presence baseline derived from frozen `npm audit` data and with a
general static-analysis baseline produced by Semgrep Community Edition.
Contextual reachability is an operational proxy and does not prove runtime
exploitation of a specific advisory.

## Author

Designed and implemented by **Hellen Santos** as part of the Master's Degree in
Software Engineering at the Instituto Superior de Engenharia do Porto (ISEP).
Citation metadata is available in [`CITATION.cff`](CITATION.cff), and authorship
details are recorded in [`AUTHORS.md`](AUTHORS.md).

## Evaluated artefact

| Field | Value |
|---|---|
| Project | ReactReach |
| Version | `1.1.0` |
| Git tag | `v1.1.0` |
| Git commit | `d63e114dfaf78a793806984336522e73f40fab63` |
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
the scenario's package appears in the frozen audit input. For the Semgrep
baseline, a scenario is positive when at least one finding overlaps a frozen
ground-truth evidence range for that scenario. Precision, recall and F1 are the
primary effectiveness metrics; accuracy, specificity and exact classification
fidelity are secondary.

Performance is measured on deterministic projects containing 50, 250 and 500
source files. Each campaign uses three warm-ups and 30 retained measurements per
project in fresh Node.js processes. The 500-file acceptance thresholds are:

- static-analysis p95 below 30 seconds;
- peak resident set size below 512 MiB.

The complete method is specified in
[`docs/evaluation-protocol.md`](docs/evaluation-protocol.md).

## Published final results

The final effectiveness run is `20260824T202157298Z-2aa39a3a`.

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

The Semgrep Community Edition `1.177.0` baseline uses the public
`p/javascript` ruleset retrieved on 13 September 2026. The definitive run is
`20260913T162943241Z-c1b5665a`; all 23 findings mapped unambiguously to frozen
scenario evidence.

| Cohort | TP | FP | TN | FN | Precision | Recall | F1 | Accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Characterization | 9 | 3 | 12 | 6 | 0.750 | 0.600 | 0.667 | 0.700 |
| Holdout | 3 | 5 | 1 | 3 | 0.375 | 0.500 | 0.429 | 0.333 |
| Primary | 12 | 8 | 13 | 9 | 0.600 | 0.571 | 0.585 | 0.595 |
| Robustness | 2 | 1 | 5 | 4 | 0.667 | 0.333 | 0.444 | 0.583 |
| Extended | 14 | 9 | 18 | 13 | 0.609 | 0.519 | 0.560 | 0.593 |

The cohort-level comparison qualifies the aggregate result. Semgrep performs
better on the deliberately adversarial holdout (F1 0.429 versus 0.154;
accuracy 0.333 versus 0.083), while both tools produce the same aggregate
robustness outcome. The holdout intentionally concentrates custom hooks,
cross-file helpers, React Context, mutation, trusted overwrites, generic or
rest props, and property or index separation outside ReactReach's implemented
propagation boundaries. This does not mean that Semgrep reconstructed those
dependency-origin flows: all 23 emitted findings came from its generic
`dangerouslySetInnerHTML` rule, which can flag the sink without establishing
that its value originated in the vulnerable dependency. ReactReach's aggregate
advantage must therefore not be generalised as universal superiority over
Semgrep.

Three performance campaigns are published. All contain 90 retained samples and
pass both frozen thresholds. Their 500-file results are:

| Campaign | p95 static analysis | Peak RSS | Status |
|---|---:|---:|---|
| `20260824T202221487Z-8155975c` | 422.584 ms | 137.273 MiB | PASS |
| `20260824T202331517Z-26f2fb51` | 396.821 ms | 136.641 MiB | PASS |
| `20260824T202442081Z-13c94484` | 393.665 ms | 136.113 MiB | PASS |

All four executions used evaluation commit
`976f2b3c3c1c18bc05398a3c310f9a9118e870aa`. Later commits only add the
published result artefacts, documentation and verification metadata.

See [`docs/results.md`](docs/results.md) for the complete tables and
[`docs/holdout-error-analysis.md`](docs/holdout-error-analysis.md) for the
scenario-level error analysis.

## Repository structure

```text
audit-data/       Frozen npm audit snapshots and input metadata
config/           ReactReach, performance, real-application and final-run configuration
corpus/           Three controlled React projects
docs/             Protocol, results and error analysis
ground-truth/     Final labelled 54-scenario manifest
schemas/          JSON Schema for the final ground truth
scripts/          Public command-line entry points
src/              Evaluation and verification implementation
test/             Harness and corpus tests
results/          Raw and processed outputs from frozen evaluation runs
```

Performance projects are generated deterministically and are intentionally not
stored in Git. This avoids committing hundreds of reproducible files while preserving
their generator, configuration, manifests and hashes.

The real-application workspaces under `.work/public-applications/` are also
generated locally and excluded from Git. Their repository commits, package
manifests, original lockfiles, derived npm lockfiles, audit snapshots and hashes
are recorded under `audit-data/public-applications/`.

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
git -C ReactReach checkout v1.1.0
git clone https://github.com/hellen-santos-07/ReactReach_Baseline_Evaluation.git
cd ReactReach_Baseline_Evaluation
npm.cmd --prefix ..\ReactReach ci --no-bin-links
npm.cmd ci
```

On Linux or macOS, replace `npm.cmd` with `npm`.

## Verify the published artefact

```powershell
npm.cmd test
npm.cmd run ground-truth:validate
npm.cmd run ground-truth:hash
npm.cmd run performance:check
npm.cmd run evaluation:preflight
npm.cmd run performance:preflight
npm.cmd run results:verify
npm.cmd run semgrep:verify
```

`npm test` generates the deterministic performance projects before executing
the test suite. The generated directory is intentionally excluded from Git.

`semgrep:verify` checks the published raw Semgrep JSON, rule-catalogue
fingerprint, scenario mapping, artifact hashes and recomputed metrics without
performing a new network scan.

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

## Reproduce the Semgrep baseline

Install the frozen Semgrep Community Edition version in an isolated Python
environment, then run the baseline:

```powershell
python -m venv .venv-semgrep
.\.venv-semgrep\Scripts\python.exe -m pip install semgrep==1.177.0
$env:SEMGREP_BIN = (Resolve-Path .\.venv-semgrep\Scripts\semgrep.exe)
npm.cmd run semgrep:run
npm.cmd run semgrep:verify -- <run-id>
```

The runner uses the OSS engine, disables metrics and the version check, ignores
Git-ignore filtering, excludes `node_modules`, and runs one job. It records the
74 resolved rule identifiers and registry version identifiers, a catalogue
SHA-256, raw JSON and stderr for each project, the complete finding-to-scenario
mapping, and the derived tables. The public rule source is not redistributed;
the rules remain subject to the
[Semgrep Rules License](https://semgrep.dev/legal/rules-license/).

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

## Run the public-application feasibility study

The unlabelled feasibility study uses three frozen public React applications
with non-trivial analyser output: `donetick/frontend`, `nz-m/SocialEcho`, and
`varHarrie/varharrie.github.io`. SocialEcho is analysed from its `client/`
subdirectory. Place the three clones at the paths recorded in
`config/public-applications.json`, then prepare and validate the frozen inputs:

```powershell
npm.cmd run public-apps:prepare
npm.cmd run public-apps:preflight
npm.cmd run public-apps:run
```

Preparation exports each configured commit into an ignored isolated workspace.
It does not install dependencies or execute project lifecycle scripts.
Donetick and SocialEcho use their repository `package-lock.json`; varHarrie
retains its native `yarn.lock` and receives a derived npm lockfile generated with
`--package-lock-only`. The harness then freezes `npm audit --json`, while the
original clones remain unchanged.

Each application scan runs in a separate Node process. The run records
repository and commit provenance, Node/npm versions, frozen audit evidence,
duration, checkpoint peak RSS, findings by reachability level, diagnostics,
parsing errors and crashes. CRITICAL and HIGH findings are copied to a
manual-review queue. The applications have no labelled ground truth;
therefore the study does not compute or imply precision, recall, F1, true
positives or false positives. See
[`docs/public-application-study.md`](docs/public-application-study.md).

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
- the Semgrep baseline records the exact CLI version, engine, ruleset retrieval
  date and resolved rule-catalogue fingerprint; rerunning the registry ruleset
  at a later date can produce a different catalogue and must be reported as a
  new baseline run.
- the public-application study freezes repository commits, original and derived
  lockfiles, `npm audit` outputs, runtime versions and source-tree fingerprints;
  its results are feasibility observations without accuracy metrics.

## Interpretation boundary

A positive result means that ReactReach recognised a static contextual path
under its model. A negative result means that no such path was demonstrated,
but neither outcome establishes whether a specific advisory is exploitable at
runtime. The corpus is controlled and supports repeatable comparison, and it does
not replace validation on diverse industrial applications. Semgrep is evaluated
as a general SAST comparator: its alerts identify code patterns and are not
claims about reachability from the vulnerable dependency named by a scenario.

## License

Code in this repository (generators, evaluation scripts, and scenario sources)
is licensed under the MIT License; see [`LICENSE`](LICENSE). The datasets under
`audit-data/`, `ground-truth/`, and `results/`—ground truth, frozen audit
inputs, raw reports, and performance samples—are licensed under CC BY 4.0.
Vulnerability advisory data reproduced in the frozen audit inputs originates
from the GitHub Advisory Database, which is published under CC BY 4.0.

When reusing these datasets, please attribute as: Santos, H. (2026). ReactReach
Baseline Evaluation: Replication Package. Licensed under CC BY 4.0.
[https://github.com/hellen-santos-07/ReactReach_Baseline_Evaluation](https://github.com/hellen-santos-07/ReactReach_Baseline_Evaluation)
