# Security and Operations Readiness

## Runtime modes

- **Fixture mode:** deterministic local transport for CI, CLI smoke tests, and package review. It uses bundled Solana receipt fixtures.
- **Live-read mode:** CLI/SDK callers may supply a Solana RPC endpoint through `MACHINEFI_SOLANA_RPC_URL` or `--rpc-url`. The HTTP server requires `--allow-live` and accepts its endpoint only from operator startup configuration. It performs read-only receipt and status lookups.

## Trust boundaries

### Solana adapter

The Solana adapter owns base58 address/signature validation, explorer URL generation, `getSignatureStatuses`, and `getTransaction` read-only verification semantics. It handles missing transactions and status errors explicitly and returns typed verification results. Solana `getVersion` proves endpoint reachability, not cluster identity; live status results therefore avoid claiming a mainnet/devnet/testnet match from version data alone.

There is no Robinhood/EVM adapter in this checkout. It must not be advertised or inferred from historical examples.

### RPC transport

The live transport sends JSON-RPC requests to configured endpoints without following redirects. It caps decompressed response size and process-wide concurrent outbound requests. The HTTP API rejects every caller-provided `rpcUrl`, so browser/API clients cannot redirect the server to another host. Operators should use provider endpoints with appropriate rate limits, monitoring, and key rotation. Public endpoints are suitable for demos and local checks only.

## Wallet and provider handling

- Keep RPC provider tokens in the application environment, not in source files or fixtures.
- Do not render provider URLs: query strings and path segments can carry provider tokens. The bundled UIs report only whether live-read is enabled.
- Keep wallet signing inside caller-owned wallet/provider surfaces.
- Treat fixture receipts as offline validation inputs for local development and CI.

## Failure modes and recovery

| Failure mode | Expected behavior | Operator action |
| --- | --- | --- |
| RPC timeout or provider error | returns an RPC error result | retry with provider endpoint or inspect provider status |
| Receipt not found | returns `not_found` | confirm transaction id, commitment/finality, and network |
| Solana status error | returns failed verification | inspect transaction meta and caller wallet state |
| Invalid address/hash/signature | returns invalid input | reject before wallet signing or receipt lookup |
| Redirect or oversized provider response | rejects the RPC response | verify the configured endpoint and provider behavior |
| Outbound concurrency cap reached | returns an RPC error | retry with backoff or add an operator-owned queue/rate limiter |

## Release/readiness checklist

- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm run test:smoke`
- `npm pack --dry-run --json`
- Review package file list for the intended `dist`, docs, fixtures, examples, and license entries.
- Confirm public GitHub and npm links point to the current version.
