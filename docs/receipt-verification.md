# Receipt verification

Receipt verification returns what the runtime can prove from each rail and where each field came from. Results include source-aware evidence fields such as `native_receipt`, `transaction`, `balance_delta`, `memo_log`, `machinefi_envelope`, `fixture`, and `unavailable`.

## Solana rail

Solana verification separates signature status/finality from transaction detail evidence. Account keys prove account involvement; they do not by themselves prove transfer settlement. SOL amount checks use lamport balance-delta evidence when the transaction shape supports it. SPL-token or program-specific asset expectations remain unavailable in the native SOL verifier rather than being inferred from account involvement. Memo expectations can be matched from memo/log evidence. Missing transfer, memo, machine id, or session evidence produces explicit mismatch reasons rather than a false positive.

Fixture mode keeps examples deterministic, but fixture fields are labeled as fixture/envelope metadata rather than native chain evidence.

## Amount and finality handling

Solana amount checks compare lamport/base-unit deltas with bigint-safe arithmetic. If balance data is absent or outside safe parsing boundaries, amount evidence remains unavailable instead of being treated as verified.

## Expectation summaries

SDK consumers can summarize receipt evidence per expected field. The summary separates native chain fields, MachineFi envelope metadata, fixture metadata, and unavailable fields so downstream runtime code can reject incomplete settlement evidence without parsing raw adapter responses.

## Confirmation and SOL transfer evidence

Solana SOL amount evidence uses recipient credit with sender-debit checks, so ordinary fee-paying transfers can be verified without treating account-key presence alone as settlement evidence.

This checkout does not contain a Robinhood/EVM receipt adapter.
