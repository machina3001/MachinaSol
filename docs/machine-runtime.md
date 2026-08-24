# Machine runtime lifecycle

MachineFi Runtime models autonomous machines as wallet-linked runtime actors. A machine can be a robot arm, drone, rover, sensor, warehouse bot, or edge node. The public package captures the interface layer: identity, declared capabilities, fleet registry state, work orders, telemetry snapshots, policy decisions, unsigned settlement intents, work evidence bundles, and source-aware receipt evidence.

## Fleet/device registry

`src/fleet/registry.ts` keeps public-safe registry entries without claiming backend persistence. A registry entry can track fleet/site id, role, wallet/session linkage, status, last telemetry reference, battery/health summary, active job, and a public summary for CLI or docs. Assignment helpers gate jobs by idle status, health, battery, and declared capabilities.

## Work-order loop

`src/jobs/work-order.ts` models queued, assigned, preparing, working, proof-submitted, settled, failed, and cancelled stages. Work orders declare capabilities, telemetry/proof requirements, expected outputs, and settlement terms. The helper exposes allowed next actions and blocks proof/settlement transitions until required telemetry, proof, and settlement intent references exist.

## Telemetry and evidence

Telemetry snapshots normalize public-safe battery, health, signal, progress, location, and pose fields. `deriveTelemetryRef` creates a stable metadata reference so examples can link work to a deterministic snapshot without storing raw robot data or media streams. Work evidence bundles link machine identity, work order, session, telemetry reference, optional media/result references, settlement intent, and receipt expectations.

## Rails underneath the runtime

Solana is the implemented settlement/proof rail below the machine runtime. It provides receipt evidence and audit trail anchors; it does not replace machine identity, job state, telemetry, policy, or closed-core production orchestration.

## Availability and diagnostics

Fleet availability scoring is deterministic and local: it ranks public registry entries by assignable status, battery summary, health summary, and required capability match. Diagnostics helpers normalize public-safe health, battery, and signal readings into readiness summaries without claiming production fleet orchestration or direct robot control.
