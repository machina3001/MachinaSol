# Security model

MachineFi Runtime's exported SDK and CLI are a read-only verification and unsigned-intent interface. The package validates public inputs, normalizes telemetry, evaluates public-safe policy constraints, and verifies receipts. They do not control robots directly, sign transactions, broadcast autonomous payments, or custody assets.

The repository also contains an opt-in, authenticated production Console application (`MACHINEFI_DATA_MODE=production`). This application is a separate caller-wallet boundary: after an authenticated owner explicitly approves a persisted, accepted marketplace quote, the server constructs a canonical version-0 Solana transaction from trusted records, the caller's wallet signs it, and the server simulates, submits, and reconciles that signed transaction through its verified RPC configuration. The Console never receives a wallet private key, never signs autonomously, and does not custody funds. This narrowly scoped submission path does not make the exported Runtime SDK or CLI a transaction broadcaster.

Sensitive production concerns such as hardware drivers, private policy engines, provider routing, treasury controls, and incident response remain outside this repository.
