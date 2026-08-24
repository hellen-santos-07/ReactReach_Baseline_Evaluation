# Adversarial holdout error analysis

**Author:** Hellen Santos

**Final run:** `20260824T202157298Z-2aa39a3a`

**ReactReach:** `v1.0.0` at `0202e2c451802ea449ca576beeda7695340687d0`

The 12-scenario adversarial holdout contains six positive and six negative
scenarios. ReactReach classifies one true positive, six false positives, zero
true negatives and five false negatives. The holdout precision is 0.143, recall
is 0.167, F1 is 0.154 and accuracy is 0.083. This cohort deliberately
concentrates boundary cases and is reported separately from characterization.

## Scenario outcomes

| Scenario | Label | Outcome | Primary cause |
|---|---|---|---|
| `holdout-custom-hook-flow` | Positive | FN | No general function-return propagation |
| `holdout-cross-file-helper-flow` | Positive | FN | No cross-file function-return summary |
| `holdout-react-context-flow` | Positive | FN | React Context is not modelled |
| `holdout-member-mutation-flow` | Positive | FN | Member mutation does not introduce access-path taint |
| `holdout-array-mutation-flow` | Positive | FN | Array mutation is not modelled |
| `holdout-async-state-setter-flow` | Positive | TP | Supported state-setter propagation reaches the sink |
| `holdout-overwritten-binding` | Negative | FP | Trusted overwrite does not kill existing taint |
| `holdout-generic-props-unrelated` | Negative | FP | Generic props collapse to one tainted binding |
| `holdout-rest-props-unrelated` | Negative | FP | Rest props collapse to one tainted binding |
| `holdout-object-property-separation` | Negative | FP | Object properties are not distinguished |
| `holdout-destructured-property-separation` | Negative | FP | Destructuring propagates whole-object taint |
| `holdout-array-index-separation` | Negative | FP | Array indices are not distinguished |

## Consolidated model boundaries

1. ReactReach has no general interprocedural function summaries for local or
   cross-file helper return values.
2. React Context is not represented as an inter-component data-flow boundary.
3. Member assignments and mutating collection operations are not modelled.
4. Taint is monotonic at binding level: trusted overwrites do not remove taint,
   and access paths for properties or indices are not retained.
5. Generic, rest and compound props may seed an entire binding, causing
   unrelated properties to overlap with a sink.

These outcomes describe implementation boundaries, not defects in the frozen
labels. They explain why ReactReach improves precision over package presence on
the complete dataset while losing recall on unsupported propagation patterns.
