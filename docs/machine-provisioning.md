# Secure machine provisioning

Machine credentials authenticate native machine runtimes, not people. A wallet-authenticated operator creates the machine record and issues a credential; the machine then uses that credential only for its own telemetry ingestion endpoint. The server checks credential validity, expiry, revocation, machine scope, and machine ownership before accepting data.

## Provision

1. Authenticate the operator wallet through the Console. Register the machine with `POST /api/machines`; the server derives the owner and wallet from the authenticated session and accepts no client-supplied ownership identity.
2. From an operator-controlled terminal, call `POST /api/machines/:machineId/credentials` with the authenticated session cookie, CSRF header, same-origin `Origin`, a descriptive label, and an expiry of 1–365 days. The response contains a `telemetry:write` credential exactly once. The Console frontend does not persist or embed it.
3. Pipe the returned credential directly into the device secret manager or deployment system. Do not place it in a shell profile, command argument, image, repository, browser storage, telemetry payload, or log. Restrict the secret so only the machine runtime process can read it.
4. Configure the native runtime to send `Authorization: Bearer <credential>` to `POST /api/machines/:machineId/telemetry` over HTTPS. Machine clients must omit browser `Origin` headers. The JSON body contains telemetry only; never include the credential in the body.
5. Send one nominal event and confirm its server-generated event ID appears in the owner-scoped telemetry view. Keep the previous credential active until this check succeeds.

The issuance response should be handled in memory and sent directly to the secret manager. A safe automation pattern is to parse the JSON response on standard input and write only the `credential` field to a secret-manager command that accepts standard input. Avoid command-line flags carrying the secret because process lists and shell history may retain them.

## Rotate and revoke

Create a replacement credential, deploy it, verify a successful event using the replacement, then revoke the previous credential with `POST /api/machine-credentials/:credentialId/revoke`. Revocation is immediate for new ingestion requests. Credential listings return metadata, expiry, revocation state, and scope but never the secret hash or plaintext.

If a credential may have leaked, revoke it first and accept the short telemetry interruption while provisioning a replacement. Review request logs by request ID and machine telemetry timestamps; authorization headers are never logged by the application.

## Boundary

The credential currently grants only `telemetry:write` for one machine. Human wallet sessions remain required for ownership changes, runtime session administration, jobs, marketplace actions, and settlements. Adding a future machine runtime operation requires a separate explicit scope and server-side ownership check; do not broaden `telemetry:write` implicitly.
