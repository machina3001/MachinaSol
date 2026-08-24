# Changelog

## v0.9.4 — Stable npm release

- Added fleet registry helpers for machine availability, status, capability gating, telemetry summaries, and public-safe fleet summaries.
- Added deeper work-order lifecycle helpers with queued, assigned, preparing, working, proof-submitted, settled, failed, and cancelled stages.
- Added telemetry evidence references and work evidence bundles that link machine, work order, session, telemetry, result/media references, settlement intent, and receipt expectations.
- Added source-aware receipt evidence for Robinhood and Solana so native chain evidence is separated from fixture or MachineFi envelope metadata.
- Added precision-safe decimal/base-unit amount comparison for ETH wei and SOL lamports evidence.
- Added tests for fleet assignment, work-order proof gates, telemetry evidence, receipt evidence sources, Solana transfer semantics, memo logs, and bigint amount precision.

## v0.9.3 — Public package and README alignment

- Kept GitHub README focused on the public runtime interface for the broader MachineFi Robotics platform.
- Kept package install examples on `@machinefi/runtime@0.9.3` while the next runtime candidate remains unpublished.
- Clarified closed-core production orchestration boundaries without reducing the repository to only a CLI.

## v0.8.x — Robinhood mainnet examples after public launch

- Added Robinhood Chain mainnet documentation and examples after the July 1, 2026 mainnet launch.
- Preserved caller-supplied provider endpoint guidance for production-style live-read checks.

## v0.6.x — Robinhood testnet rail

- Added Robinhood testnet rail metadata and fixture examples after the public testnet window.
- Kept EVM-compatible abstractions separate from mainnet examples until mainnet availability.

## v0.3.x — Solana and generic runtime foundations

- Added Solana session, signature/status verification, fixture transport, and CLI scaffolding.
- Added generic machine session schemas, provider config, receipt schemas, and settlement-intent primitives.

## v0.1.x — Package scaffold and deterministic fixtures

- Established the TypeScript package, CLI entrypoint, deterministic fixtures, validation workflow, and public documentation structure.
