# RQ04 evaluation protocol — version 1.0

**Author:** Hellen Santos
**Evaluated artefact:** ReactReach `v1.0.0`
**ReactReach commit:** `0202e2c451802ea449ca576beeda7695340687d0`

## Research question and experimental dimensions

**RQ04:** *What is the effectiveness, in terms of precision, recall, and
performance, of the proposed contextual model in distinguishing between
exploitable and non-exploitable vulnerabilities when compared with traditional
approaches?*

The experiment measures:

1. **Classification effectiveness:** whether a controlled scenario has a
   demonstrated contextual path from a vulnerable dependency to a security
   sink. This contextual reachability is the experiment's operational proxy, although
   it is not evidence of runtime exploitation of a specific advisory.
2. **Performance:** static-analysis duration and peak memory, excluding the
   external and variable latency of `npm audit`.

## Decisions

- ReactReach is compared with one baseline: `npm audit` package presence.
- Snyk, dynamic analysis, and public projects without ground truth are outside
  this experiment. A supplemental multi-package cohort adds two vulnerability
  families without changing the original primary dataset.
- `CRITICAL` and `HIGH` are positive predictions.
- `MEDIUM`, `LOW`, and `NONE` are negative predictions.
- A positive label means that the model demonstrated contextual reachability:
  it does not prove runtime exploitation.
- A negative label means that the model demonstrated no contextual path: it
  does not assert that the dependency is safe or that the advisory cannot be
  exploited through another mechanism.
- Precision, recall, and F1 are primary. Accuracy and specificity are secondary.
- Five-tier accuracy is secondary and does not replace binary classification.

## Effectiveness corpus

The primary corpus contains 42 independent scenarios: 30 characterization and
12 originally unobserved adversarial-holdout scenarios, balanced at 21 positive
and 21 negative. It covers static imports, `require`, dynamic
imports, direct flow, local and hook propagation, scope shadowing, props and
multi-component propagation, unrelated sinks, unused imports, and usages without
a captured binding. Every scenario uses a dependency recognised as vulnerable
by the frozen `npm audit` input.

A separately reported supplemental robustness cohort contains 12 balanced
scenarios using `dompurify@2.4.0` and `serialize-javascript@2.1.1`. It introduces
different package APIs, default and CommonJS bindings, direct and propagated
HTML sinks, cross-file helper flow, overwrite kills and property separation.
Its isolated module graphs are stratified into four simple single-file, four
intermediate two- or three-file, and four realistic four-file scenarios. The
ground-truth evidence covers all 29 source modules, and structural tests enforce
the isolation and complexity tiers.
The selected audit snapshot includes XSS/sanitization-bypass advisories for
DOMPurify and insecure-serialization/RCE advisories for serialize-javascript,
improving advisory-to-sink coherence. The extended dataset contains 54 scenarios
(27 positive and 27 negative), but the original 42-scenario primary metrics
remain independently reported and directly comparable with earlier runs.

The experimental unit is one scenario. Each scenario has a stable identifier,
project and source file, vulnerable package, optional component and sink rule,
expected tier and reason code, and manually reviewed evidence lines.

## Ground-truth freeze

The manifest must validate against `schemas/ground-truth.schema.json`. Labels are
reviewed before the final candidate is run over the corpus. The dataset SHA-256
is calculated from canonical JSON containing exactly `classificationPolicy`,
`projects`, and `scenarios`. The hash is retained with the experiment results:
once recorded, the labelled content is frozen and any change requires a new
hash. The public replication package contains only this final manifest.

## Frozen execution inputs

Each project has a project-specific audit file and metadata record containing
the package-lock, audit-data, ground-truth, evaluation-config and sink-catalog
hashes. Projects with byte-equivalent dependency sets may reuse the same audit
snapshot, but the reuse and dependency-set hash must be explicit. The final run
uses a complete versioned ReactReach configuration rather than implicit
defaults, the recorded built-in sink catalog, and one clean ReactReach Git
commit. The evaluation harness must also be at one recorded clean Git commit.
A preflight command verifies these invariants before execution.

## Finding matching

Binary matching and explanatory fidelity are evaluated separately. Within a
project, a finding belongs to a scenario when `packageName`, `sourceFile`, and
the optional `component` match. `projectId` is enforced by evaluating each
project independently. This identity determines exactly one binary
classification per scenario:

- a contextually reachable scenario with at least one identity-matching
  `HIGH`/`CRITICAL` finding is a true positive:
- a contextually reachable scenario without such a finding is a false negative:
- a no-demonstrated-path scenario with at least one identity-matching
  `HIGH`/`CRITICAL` finding is a false positive:
- otherwise the scenario is a true negative.

Expected tier, `sinkRuleId`, and `reasonCode` are evaluated separately and do
not change the primary binary outcome. Multiple findings in one scenario still
produce one binary classification and are all retained for review. A positive
finding that matches no scenario identity is unexpected output and gives the
run `review-required` status until the finding has been investigated and
documented.

## Baseline and metrics

For every scenario whose package occurs in the frozen audit, the `npm audit`
presence baseline predicts positive. This explicit transformation does not claim
that `npm audit` itself produces exploitability labels.

| Term | Definition |
|---|---|
| TP | Positive ground truth and `HIGH`/`CRITICAL` prediction |
| FP | Negative ground truth and `HIGH`/`CRITICAL` prediction |
| TN | Negative ground truth and negative or absent positive prediction |
| FN | Positive ground truth and negative or absent matching prediction |

- `precision = TP / (TP + FP)`
- `recall = TP / (TP + FN)`
- `F1 = 2 * precision * recall / (precision + recall)`
- `accuracy = (TP + TN) / (TP + FP + TN + FN)`
- `specificity = TN / (TN + FP)`

A zero denominator produces `null`.

## Performance protocol

Controlled projects contain 50, 250, and 500 source files. They preserve a fixed
set of labelled scenarios and add benign components to increase scale. Audit
data is frozen and injected locally: runs are sequential on the same machine and
configuration. Each project has three unrecorded warm-ups followed by 30 measured
runs using a monotonic high-resolution clock.

Three complete campaigns are planned. Every campaign is retained and reported:
there is no selection of the fastest or most favourable run. Per-campaign
statistics are primary, while pooled values are descriptive only. Every
campaign must independently pass the 500-file thresholds. All final campaigns
must evaluate the same ReactReach `v1.0.0` tag and commit.

The fixed core consists of the 30 characterization scenarios distributed over
33 source files. It is copied byte-for-byte into every generated project. The
50-, 250-, and 500-file variants add respectively 17, 217, and 467 deterministic
components with no dependency imports or configured sinks. Generation records a
hash of the common core and a distinct full source-tree hash for each scale.
All variants use dependency-equivalent package locks and byte-identical frozen
audit data. A dedicated preflight verifies these invariants without executing a
scan or collecting a measurement.

Each sample runs in a fresh isolated Node.js process so retained heap cannot
carry from one measurement into the next. The scan itself runs in a worker
thread, allowing the coordinating thread to sample whole-process RSS every 5 ms
while also retaining RSS checkpoints emitted at ReactReach stage boundaries.
`staticAnalysisMs`, measured by ReactReach's monotonic clock, is the primary
duration and excludes the locally injected audit stage and report generation.
Process startup is excluded from that duration but included in the observed RSS
of the isolated sample process.

Warm-up values are discarded and only a completion marker is retained. Each of
the 30 measured samples is written to immutable raw JSON immediately after it
finishes. A 120-second per-sample timeout preserves the failed run. Outliers are
identified using Tukey's 1.5-IQR rule, reported, and never automatically removed
from statistics. The p95 uses nearest-rank and standard deviation is the sample
standard deviation. A run verifier independently checks raw hashes, sample
identities, CSV rows, recomputed statistics and thresholds.

Record total and per-stage static-analysis duration, peak process RSS, failures,
and outliers. Report minimum, maximum, mean, sample standard deviation, median,
and nearest-rank p95. Do not remove an outlier without a documented technical
cause. For 500 files, p95 must be below 30 seconds and peak RSS below 512 MiB.

## Execution order and evidence

1. Create scenarios and manual evidence.
2. Validate the manifest.
3. Review labels without running the final candidate over the corpus.
4. Freeze and hash the ground truth and audit data.
5. Run ReactReach and the baseline on the same corpus.
6. Preserve raw outputs.
7. Derive metrics automatically.
8. For effectiveness, repeat only after a documented technical failure or a predeclared artefact revision, preserving every earlier run.
9. For performance, complete the three planned campaigns and report all of them, preserving failures and outliers.

The replication package must retain ground-truth and audit hashes, JSON/SARIF
outputs, per-scenario classification CSV, confusion matrices, metric summaries,
raw time/memory samples, descriptive statistics, hardware/OS/Node versions, and
the evaluated ReactReach commit.

The effectiveness runner creates a unique timestamped run and refuses to
overwrite an existing identifier. It writes the ReactReach JSON and SARIF for
all projects before deriving any scenario matching or metrics. Derived results
are reported separately for characterization, holdout, the primary 42-scenario
dataset, supplemental robustness, and the extended 54-scenario dataset.
A technical failure retains `failure.json` and all raw artefacts written before
the failure.

## Validity threats to report

- Controlled scenarios strengthen ground truth but reduce external validity, and
  the multi-package cohort reduces package monoculture but remains synthetic.
- Some constructions were used during tool development.
- A static `HIGH`/`CRITICAL` path is not runtime exploitation evidence.
- A package advisory and a configured sink may describe different exploitation
  mechanisms: in particular, the primary `marked` advisories concern ReDoS
  while that corpus operationalises contextual reachability to generic sinks.
  The supplemental packages improve semantic alignment but still do not prove
  runtime exploitability.
- The package-level baseline is deliberately less granular.
- Measurements on one machine do not generalise directly to every CI system.
