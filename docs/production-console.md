# Machine Console production mode

Production mode is a separate, opt-in application path. It never reads the repository's demo fleet snapshot or substitutes fixture marketplace, telemetry, job, receipt, or settlement records. An unavailable database or Solana RPC fails startup or the affected request; it does not produce a fake success.

This implementation removes several application blockers, but it is not a turnkey mainnet deployment. Operators still own TLS termination, PostgreSQL recovery, RPC trust and capacity, distributed rate limiting/pub-sub where needed, monitoring, incident response, and an independent security review.

## Start

Copy `.env.example` and configure every production value:

```sh
npm install
npm run db:migrate
npm run build
MACHINEFI_DATA_MODE=production npm start
```

Production requires PostgreSQL (Neon is compatible), an operator-controlled Solana JSON-RPC endpoint, a public origin, and a verified cluster expectation. Known `mainnet-beta`, `devnet`, and `testnet` labels are pinned to their canonical genesis hashes. A `custom` cluster requires an explicit genesis hash. Startup calls `getGenesisHash` and aborts when the RPC response conflicts with the configured expectation. A non-loopback RPC URL must use HTTPS; plain HTTP is accepted only for an explicitly loopback local RPC.

For a non-loopback origin, HTTPS and Secure cookies are mandatory. Bind one explicit interface behind the TLS proxy. A managed platform may explicitly opt into its required `0.0.0.0` production bind with `MACHINEFI_ALLOW_PUBLIC_BIND=true`; fixture/development wildcard binds remain rejected. Never put the PostgreSQL URL, RPC URL, wallet session, CSRF value, machine credential, seed phrase, or private key in frontend configuration or logs.

## Wallet authentication and authorization

1. `POST /api/auth/challenge` creates a random five-minute challenge bound to the public origin, wallet address, challenge ID, timestamps, and verified genesis hash.
2. The injected Solana wallet signs the exact message. Authentication never asks for a transaction signature, private key, or seed phrase.
3. `POST /api/auth/verify` loads the still-active challenge, verifies the Ed25519 signature, and then atomically consumes it. Invalid signatures do not burn a legitimate attempt; concurrent replays cannot both create sessions. Expired, replayed, mismatched, or unknown challenges fail, and overlapping challenges remain independently usable until consumed or expired.
4. The server stores only hashes of the opaque 12-hour session token and CSRF token. The authentication cookie is HttpOnly and SameSite=Strict. A separate SameSite=Strict CSRF cookie is intentionally readable by same-origin Console code, is not an authentication credential, and is checked in constant time against the per-session hash on every mutation.
5. Logout revokes the database session and expires both cookies.

Machine, runtime-session, work-order, request, grant, receipt, settlement, and telemetry queries are scoped by the authenticated user in PostgreSQL. Provider-side request access is derived from ownership of the selected provider machine. Record IDs from URLs or JSON never establish ownership; a foreign identifier returns no authorized record.

## Persistent model

The idempotent migration creates ownership-aware tables and indexes for:

- users, verified wallets, single-use authentication challenges, and revocable sessions;
- machines, declared machine capabilities, revocable machine credentials, runtime sessions, work orders, and retained telemetry events;
- provider capabilities, resource requests, separate resource quotes, access grants, and resource receipts;
- non-custodial Solana settlements linked uniquely to an accepted request and accepted quote.

Application IDs are UUIDs or runtime-generated opaque IDs. Foreign keys, uniqueness constraints, state checks, positive numeric checks, supported vocabulary checks, and requester/provider ownership relationships enforce the important linkages again at the database boundary. A non-null Solana transaction signature is unique across settlements, preventing one payment from satisfying two settlement records. Migration `002_validate_production_constraints.sql` validates the upgrade constraints against legacy rows; a migration failure must be investigated rather than bypassed.

## Runtime and jobs

Machine capability values, runtime sessions, and work-order creation use the repository's actual runtime-8 validators and record factories. The application persists safe projections of those records. Runtime session nonces are hashed and are not returned by the production API. The Console renders only persisted sessions, work orders, telemetry, and derived durations/timeline entries.

This phase supports creating/listing runtime sessions, ending a session, and creating/listing work orders. It does not implement robot control, autonomous job execution, or the full work-order transition/proof pipeline.

## Marketplace lifecycle

The installed application does not pretend that the audited resource-layer source supplies a remote marketplace protocol. Its real vocabulary and validation concepts are kept behind the Console resource service boundary; durable discovery, quote exchange, grants, and receipts are application-level PostgreSQL services.

The implemented lifecycle is:

1. An authenticated owner registers or updates a capability for an owned provider machine. IDs and owner fields are server-generated.
2. A requester discovers available, type/rail/price-compatible persisted capabilities and submits a request for an owned machine.
3. The provider owner offers a separate SOL quote. The requester explicitly accepts one unexpired quote; competing quotes are declined. Before acceptance, the requester can cancel the request; the selected provider can reject it or withdraw an offered quote.
4. The provider creates a pending access grant and explicitly activates or revokes it. An elapsed grant expiry is treated as `expired`; it cannot be activated or used to record fulfillment.
5. After an active grant, the provider records a resource receipt containing opaque evidence/result references and, where supplied, a valid settlement link.
6. The requester explicitly verifies or rejects the recorded receipt.

Access references are identifiers, not a secret-delivery mechanism. The application does not provision compute, bandwidth, charging, data access, or enforce an external provider's authorization. Receipt verification here records the requester's decision and relational evidence; it does not independently prove arbitrary off-chain work. Provider discovery is this deployment's database registry, not global or decentralized discovery.

## Non-custodial Solana settlement

Only an accepted persisted SOL quote can create a settlement. Source wallet, recipient wallet, amount in lamports, request ID, and quote ID are derived from authenticated and persisted records. Client-supplied recipients or amounts are ignored because they are not accepted inputs.

The Console settlement flow is:

1. Create or resume the one settlement record for the accepted request.
2. The server obtains a recent blockhash and constructs a version-0 system transfer with the trusted audit memo `machinefi:settlement:<settlement-id>`.
3. The user reviews the trusted source, recipient, and amount.
4. A Wallet Standard account must match the authenticated source address, its public-key bytes, the `solana:signTransaction` feature, version `0`, and the verified `solana:mainnet`, `solana:devnet`, or `solana:testnet` chain on both the wallet and account.
5. The wallet signs only after an explicit click. Cancellation or wallet rejection persists `cancelled`; it never reports submission.
6. The server confirms that signed bytes contain the canonical transfer, memo, source account, complete signature, and expected signature. It checks block height, simulates with signature verification, and submits with preflight through the operator RPC.
7. `submitting`, `submitted`, `confirmed`, `failed`, and `cancelled` remain distinct persisted states. An ambiguous RPC delivery result stays `submitting` with its local signature and is reconciled without blind resubmission. A timeout remains unresolved. A transaction is called dropped only when it is not found and its blockhash is expired.
8. A failed or cancelled record can be prepared again only after another explicit user click and receives a new blockhash and wallet signature.

The browser has no private key and cannot choose the RPC endpoint. The server does not call a wallet's `signAndSendTransaction`. The Console provides a copy control and a network-correct Solana Explorer link for known public clusters; custom clusters show the signature without fabricating a public explorer URL. A verified `custom` cluster has no standard Wallet Standard chain identifier in this application, so browser signing fails closed until an explicit supported mapping is implemented.

## Machine authentication and telemetry

Machines do not use a human wallet cookie. An authenticated operator provisions a `telemetry:write` bearer credential for one owned machine. The plaintext is returned once; only its hash is stored. Credentials expire, can be revoked, and should be deployed through the machine's secret manager, never browser code or telemetry payloads. Telemetry ingestion rejects browser-origin requests so this credential remains a machine-to-server authentication mechanism.

Follow the [secure machine provisioning runbook](./machine-provisioning.md) to register ownership, issue and deliver a credential without committing it to source control, verify ingestion, rotate it, and revoke the old credential.

`POST /api/machines/:machineId/telemetry` authenticates that credential, checks its machine scope, validates and normalizes the runtime-8 telemetry shape, bounds clock skew and request size, rate-limits ingestion, and records both device `observedAt` and server `receivedAt`. Events default to 30 days of retention and 10,000 rows per machine. Operators can lower or raise those bounded limits with `MACHINEFI_TELEMETRY_RETENTION_DAYS` (1–3,650) and `MACHINEFI_TELEMETRY_MAX_EVENTS_PER_MACHINE` (1–1,000,000).

The Console receives owner-filtered updates through SSE and reconciles against the durable owner-filtered telemetry API every 30 seconds. Freshness is derived from timestamps as `LIVE`, `DELAYED`, `OFFLINE`, or `UNKNOWN`; an SSE disconnect leaves stored snapshots visible and never fabricates a live state. SSE fanout is process-local, so the reconciliation poll provides eventual convergence across instances. Deployments needing low-latency multi-instance fanout should add a shared authenticated pub/sub layer.

## API and security controls

Production JSON mutations require the expected method and `application/json` content type (parameters such as `charset` are accepted), same-origin checks, an authenticated session where applicable, CSRF verification, bounded JSON bodies, field validation, and scoped fixed-window rate limits. Settlement mutations use a tighter bucket. Authentication and telemetry have separate limits. Errors exposed by the Solana transaction service use stable safe codes rather than upstream RPC text. Security headers and a nonce-bound Content Security Policy are applied by the existing HTTP server.

Console list views and lifecycle expansion are bounded to the most recent 100 requester and 100 provider records; an authorized direct detail URL is resolved separately. Lifecycle quotes, grants, receipts, and party-safe confirmed receipt-settlement projections are loaded with one owner-scoped batch operation rather than per-request database round trips. Pagination/search beyond those windows is not implemented in this phase. Latest telemetry uses one bounded latest-per-owned-machine database query so a noisy machine cannot starve quieter machine rows.

The bundled rate limiter is per-process and keys on the socket address. A horizontally scaled or adversarial public deployment needs a trusted-proxy design and a shared limiter. The operator RPC is still a trust and availability dependency: genesis verification establishes network identity, not correctness of every RPC response.

## Operational checks

```sh
npm audit
npm run typecheck
npm run build
npm test
# Required real-PostgreSQL migration/concurrency gate; point at a disposable database.
MACHINEFI_TEST_DATABASE_URL=postgres://... npm run test:postgres
npm run test:smoke
npm run pack:preview
```

`npm run test:postgres` creates isolated schemas, executes both the application migration and checked-in SQL migration twice, verifies critical indexes, and exercises concurrent single-use challenge consumption. CI and every production release must run this gate against real PostgreSQL; the memory-store test suite is not a substitute for database execution.

Back up PostgreSQL according to the provider's point-in-time recovery policy. Rotate a machine credential by creating a replacement, deploying it through the machine secret manager, verifying ingestion, and revoking the old credential. Monitor sessions, rate-limit responses, RPC simulation/submission/confirmation failures, unresolved `submitting` settlements, stale telemetry, migration status, and database capacity.

Before moving value on mainnet, complete an independent security review, load/failover testing, database recovery exercise, RPC-provider risk assessment, wallet compatibility testing, alerting/on-call setup, and provider-specific access/receipt verification integration.
