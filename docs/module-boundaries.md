# Runtime module boundaries

MachineFi Runtime exposes public TypeScript boundaries for machine identity, jobs, telemetry snapshots, policy checks, unsigned settlement intents, and receipt-backed work proofs. Production robot control, private provider routing, treasury policy, hardware adapters, and backend orchestration remain outside this public package.

## Public modules

- `machines`: wallet-linked machine identities, roles, capabilities, registry entries, and status transitions.
- `jobs`: machine job lifecycle records and transition validation.
- `telemetry`: normalized health, battery, signal, location, and progress snapshots.
- `policy`: public-safe accept/reject decisions for machine jobs and rail settlement limits.
- `proofs`: work receipt objects linking machine output, telemetry references, unsigned settlement intents, and onchain receipt expectations.
- `adapters`: read-only Solana rail verification helpers.

The package models the public runtime/audit interface. It does not contain robot-control drivers, autonomous signing, private keys, treasury movement, or production fleet orchestration.

## Production application boundary

The opt-in authenticated production Console is not part of the exported SDK/CLI contract. It may construct a canonical version-0 Solana transaction from a trusted accepted quote and submit the caller-wallet-signed bytes through a verified RPC endpoint. Signing remains an explicit action in the caller's Wallet Standard account; the server does not receive private keys, sign autonomously, or custody assets. See [Production Console and API](./production-console.md) for authentication, persistence, settlement reconciliation, and deployment limits.
