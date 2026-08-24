# Policy runtime

The public policy layer contains deterministic policy profiles and machine-job decisions. It models the inputs a runtime can safely expose: allowed rails, max settlement amount, required capabilities, battery threshold, telemetry health, machine/job ids, and rejection reasons.

`evaluateMachineJobPolicy` accepts or rejects a job before an unsigned settlement intent is built. Rejections include missing capabilities, unsupported settlement rail, stale/unhealthy telemetry, low battery, machine mismatch, and amount limits.

This is not the private production policy engine. It is an inspectable SDK boundary for tests, examples, and developer integration.
