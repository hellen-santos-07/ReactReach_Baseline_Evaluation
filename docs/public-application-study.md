# Public React application feasibility study

## Purpose and interpretation boundary

This supplementary study examines ReactReach on three public React
applications outside the controlled corpus. It records execution completion,
duration, checkpoint peak resident set size (RSS), parsing limitations, and the
distribution of analyser findings. The applications do not provide labelled
vulnerable data-flow ground truth. Consequently, the study does not calculate
precision, recall, F1, true positives, false positives, true negatives, or false
negatives. A finding is a structural result to inspect, not a confirmed
exploitable vulnerability.

## Selection strategy

The sample is purposive and supports feasibility analysis rather than
population-level generalisation. Candidate repositories were screened against
the following requirements:

1. the repository and React source are publicly accessible under an explicit
   license;
2. the project is a user-facing React application rather than only a package,
   template, generated bundle, or documentation example;
3. application source is available below `src/`, matching the declared
   ReactReach execution profile;
4. the dependency state can be frozen from a version-controlled lockfile;
5. an exact clean commit, branch, commit date, package manager input, and source
   fingerprint can be recorded;
6. `npm audit` reports at least one vulnerable package and ReactReach produces
   non-trivial output; and
7. the final set varies in application domain and size while remaining small
   enough for manual inspection.

Because completion and non-trivial output form part of this screening, the
sample must not be interpreted as random or representative of React projects in
general.

## Frozen sample

| Application | Repository | Branch | Frozen commit | Application root | Lockfile | license |
|---|---|---|---|---|---|---|
| Donetick Frontend | [`donetick/frontend`](https://github.com/donetick/frontend) | `develop` | `22e2f4abb5173eff2bb3c6b589368f6d095c6cbc` | repository root | `package-lock.json` | AGPL-3.0 |
| SocialEcho | [`nz-m/SocialEcho`](https://github.com/nz-m/SocialEcho) | `main` | `4dc6c7822bfff5c0b13e1b8098e8d7ae0084939a` | `client/` | `client/package-lock.json` | MIT |
| varHarrie.github.io | [`varHarrie/varharrie.github.io`](https://github.com/varHarrie/varharrie.github.io) | `v2` | `5e592ebac9c6eb6642121b49487889ebbc01fb87` | repository root | `yarn.lock` plus derived npm lock | MIT |

## Input preparation

The source clones are treated as read-only. For each application, the harness:

1. verifies the remote URL, branch, full commit, commit date, license metadata,
   and clean working tree;
2. exports the configured commit into `.work/public-applications/<id>/`;
3. resolves the declared application subdirectory without permitting it to
   escape the isolated workspace;
4. preserves `package.json` and the repository's original lockfile;
5. uses the repository npm lockfile for Donetick and SocialEcho;
6. for varHarrie, preserves `yarn.lock` and generates a derived
   `package-lock.json` with `npm install --package-lock-only --ignore-scripts
   --audit=false --fund=false --legacy-peer-deps`;
7. captures `npm audit --json` without installing application dependencies or
   executing lifecycle scripts; and
8. records SHA-256 hashes, Node/npm versions, and a fingerprint of every
   `src/**/*.{js,jsx,ts,tsx}` file.

The derived varHarrie npm lockfile is an evaluation input and is not claimed to
reproduce Yarn resolution exactly. Both lockfiles are retained to make this
limitation visible.

## Execution protocol

ReactReach v1.1.0 runs once per application in a separate Node process. The
frozen audit snapshot is normalised and injected through the public
`scanProject` API, so registry latency is excluded from static-analysis time.
The harness records:

- repository and commit provenance;
- ReactReach, evaluation, Node, and npm versions;
- total and per-stage analysis duration;
- process RSS at the scan boundary and after each analysis stage, retaining the
  highest checkpoint value;
- vulnerable-package, source-file, component, graph, sink, and finding counts;
- `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, and `NONE` counts;
- diagnostics, parsing failures, timeouts, and crashes; and
- raw JSON and SARIF reports.

Running each scan in a separate process prevents retained memory from an earlier
application from inflating a later application's RSS. Checkpoint RSS remains an
approximation because a short-lived peak between stages may not be observed.

## Result reporting

The retained run reports duration, checkpoint peak RSS, vulnerable-package and
source-structure counts, findings at every reachability level, diagnostics,
parsing failures, timeouts and crashes for each application. `CRITICAL` and
`HIGH` findings are preserved in a manual-review queue. The review records
whether a structural route is credible while keeping advisory-specific
exploitability, attacker control and sanitisation outside the claims supported
by this unlabelled study.

## Commands

```powershell
npm.cmd run public-apps:prepare
npm.cmd run public-apps:preflight
npm.cmd run public-apps:run
```

The strict preflight refuses dirty evaluation or ReactReach repositories. A
retained run is therefore created only after the implementation,
configuration and frozen inputs have been reviewed and committed.

## Limitations

- The three applications form a small, outcome-informed purposive sample.
- There is no labelled ground truth and no application-level accuracy estimate.
- `npm audit` establishes affected-package presence, not runtime exploitability.
- The varHarrie npm lockfile is derived from `package.json` and can differ from
  the native Yarn graph.
- ReactReach scans source files below `src/`; code outside that convention is
  outside this execution profile.
- Structural reachability does not model complete advisory semantics, attacker
  control, sanitisation efficacy, or runtime preconditions.
- Checkpoint RSS can miss a transient between-stage maximum.
