# Provider boundaries

CLI/SDK live reads use a caller-supplied Solana provider endpoint. HTTP-server live reads use only the endpoint supplied by the operator at startup; HTTP request fields cannot override it. Fixture mode is deterministic and offline for CI. Public RPCs may be rate-limited; production callers should configure their own providers. This checkout has no Robinhood/EVM provider adapter.

The package never stores private keys, seed phrases, wallet secrets, or provider credentials. Write/broadcast behavior and hardware control remain outside this public package.
