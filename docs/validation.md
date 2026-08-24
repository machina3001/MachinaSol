# Runtime validation

Validation is deliberately local, deterministic, and public-safe. The package validates machine identifiers, roles, capabilities, wallet/account formats, job lifecycle transitions, telemetry ranges, policy decisions, unsigned settlement intents, and receipt expectations.

## Failure paths covered

- invalid machine roles/capabilities and malformed machine IDs;
- invalid job transitions such as settling before proof submission;
- stale or out-of-range telemetry snapshots;
- policy rejection for offline/faulted machines, low battery, missing capabilities, unsupported rails, and amount limits;
- JSON-RPC errors, malformed responses, and status wrong-chain results;
- receipt expectations where a requested amount, memo, machine ID, or session ID is unavailable in the fetched receipt.

Fixture mode keeps examples deterministic. CLI/SDK live-read mode uses caller-supplied provider endpoints and remains read-only. The HTTP server uses only its startup-configured endpoint and rejects request-level overrides.
