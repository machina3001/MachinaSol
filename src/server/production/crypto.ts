import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { decodeBase58, isSolanaAddress, isSolanaSignature } from '../../adapters/solana/validation.js';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export const opaqueToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('base64url');

export function constantTimeHashEqual(expectedHash: string, value: string): boolean {
  const actual = Buffer.from(sha256(value));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function verifySolanaMessageSignature(
  walletAddress: string,
  signature: string,
  message: string
): boolean {
  if (!isSolanaAddress(walletAddress) || !isSolanaSignature(signature)) return false;
  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(decodeBase58(walletAddress))]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, Buffer.from(message, 'utf8'), publicKey, Buffer.from(decodeBase58(signature)));
  } catch {
    return false;
  }
}

export interface WalletChallengeMessageInput {
  audience: string;
  walletAddress: string;
  challengeId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  genesisHash: string;
}

/** Human-readable, domain-bound message signed by the wallet. */
export function walletChallengeMessage(input: WalletChallengeMessageInput): string {
  return [
    'MachineFi Console authentication',
    '',
    `Origin: ${input.audience}`,
    `Wallet: ${input.walletAddress}`,
    `Chain: solana:${input.genesisHash}`,
    `Challenge: ${input.challengeId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`,
    '',
    'Sign this message to authenticate. This does not authorize a transaction.',
  ].join('\n');
}
