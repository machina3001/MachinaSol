# Operations

Use fixture mode for deterministic local development and CI. CLI/SDK live reads accept a provider endpoint through:

- `MACHINEFI_SOLANA_RPC_URL` or `--rpc-url` for Solana reads.

For the local HTTP server, combine that operator configuration with `--allow-live` (or `MACHINEFI_ALLOW_LIVE=1`). HTTP callers can select fixture versus live-read mode but cannot supply or override `rpcUrl`; the configured value is not rendered in either UI. Wildcard bind hosts are rejected because the server has no authentication. Explicit non-loopback binds remain unsafe for untrusted networks.

This checkout has no Robinhood/EVM adapter. The verification and hardening suites cover the implemented Solana rail only; a future rail must ship a real adapter and its own tests before it is advertised.

Operational checks should run `npm run typecheck`, `npm run build`, `npm test`, `npm run test:smoke`, and `npm pack --dry-run --json` before proposing a package release. No npm publication is performed by these commands.
