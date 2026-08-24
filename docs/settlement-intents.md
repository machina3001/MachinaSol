# Settlement intents

Settlement intents are unsigned public interface objects. They carry source wallet, recipient, amount, asset, chain, machine id, session id, policy id, memo/reference, nonce, and `signingMode: caller-wallet`.

Amounts are normalized as decimal strings and can be compared to Solana lamports with bigint-safe helpers. The package validates addresses and positive amounts, but it does not sign, broadcast, custody funds, or move treasury assets. Applications can pass the intent to their own wallet/provider flow after policy approval.

## Decimal policy comparisons

Policy and job helpers compare settlement amounts as validated decimal strings converted to base units for the target rail. This keeps caller-wallet settlement limits stable for precision-sensitive values without using floating-point comparisons.

## Nonce and decimal precision

Unsigned settlement intents include a nonce in the intent id. By default the runtime creates a fresh nonce for each intent; callers may still provide an explicit nonce for reproducible tests or idempotent workflows. Amount validation uses rail and asset decimals before producing caller-wallet intent records.
