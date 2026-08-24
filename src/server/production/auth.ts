import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isSolanaAddress } from '../../adapters/solana/validation.js';
import { HttpError } from '../http.js';
import type { ServerConfig } from '../config.js';
import { constantTimeHashEqual, opaqueToken, sha256, verifySolanaMessageSignature, walletChallengeMessage } from './crypto.js';
import { RequestRateLimiter } from './rate-limit.js';
import type { AuthSessionRecord, ProductionStore } from './types.js';

export const SESSION_COOKIE = 'mfi_console_session';
export const CSRF_COOKIE = 'mfi_console_csrf';
export const AUTH_CHALLENGE_TTL_MS = 5 * 60_000;
export const AUTH_SESSION_TTL_MS = 12 * 60 * 60_000;

const challengeLimiter = new RequestRateLimiter(12, 60_000);
const verificationLimiter = new RequestRateLimiter(20, 5 * 60_000);
const challengeIpLimiter = new RequestRateLimiter(600, 60_000);
const challengeGlobalLimiter = new RequestRateLimiter(3_000, 60_000, 1);
const verificationIpLimiter = new RequestRateLimiter(300, 5 * 60_000);
const verificationGlobalLimiter = new RequestRateLimiter(2_000, 5 * 60_000, 1);

export const requestIp = (req: IncomingMessage): string => req.socket.remoteAddress ?? 'unknown';

function cookies(req: IncomingMessage): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

export const sessionCookie = (token: string, config: ServerConfig): string =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(AUTH_SESSION_TTL_MS / 1000)}${config.secureCookies ? '; Secure' : ''}`;

export const expiredSessionCookie = (config: ServerConfig): string =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.secureCookies ? '; Secure' : ''}`;

/**
 * CSRF is deliberately readable by the same-origin Console so it survives
 * tab/browser restores. It is not an authentication credential; the opaque
 * session cookie remains HttpOnly and the server verifies this value against
 * the per-session hash for every mutation.
 */
export const csrfCookie = (token: string, config: ServerConfig): string =>
  `${CSRF_COOKIE}=${token}; Path=/; SameSite=Strict; Max-Age=${Math.floor(AUTH_SESSION_TTL_MS / 1000)}${config.secureCookies ? '; Secure' : ''}`;

export const expiredCsrfCookie = (config: ServerConfig): string =>
  `${CSRF_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0${config.secureCookies ? '; Secure' : ''}`;

export interface AuthenticatedSession {
  record: AuthSessionRecord;
  csrfValid: boolean;
}

export class WalletAuthService {
  constructor(private readonly store: ProductionStore, private readonly config: ServerConfig) {}

  async challenge(walletAddress: string, req: IncomingMessage, now = new Date()): Promise<{
    challengeId: string;
    message: string;
    expiresAt: string;
  }> {
    const wallet = walletAddress.trim();
    if (!isSolanaAddress(wallet)) throw new HttpError(400, 'walletAddress must be a valid Solana address');
    const ip = requestIp(req);
    challengeGlobalLimiter.assert('global');
    challengeIpLimiter.assert(ip);
    challengeLimiter.assert(`${ip}:${wallet}`);
    const challengeId = randomUUID();
    const nonce = opaqueToken();
    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + AUTH_CHALLENGE_TTL_MS).toISOString();
    const audience = this.config.publicOrigin ?? `http://${this.config.host}:${this.config.port}`;
    const message = walletChallengeMessage({
      audience,
      walletAddress: wallet,
      challengeId,
      nonce,
      issuedAt,
      expiresAt,
      genesisHash: this.config.solanaGenesisHash ?? 'fixture-unverified',
    });
    await this.store.createChallenge({
      id: challengeId,
      walletAddress: wallet,
      message,
      nonceHash: sha256(nonce),
      expiresAt,
      consumedAt: null,
    }, issuedAt);
    return { challengeId, message, expiresAt };
  }

  async verify(input: {
    challengeId: string;
    walletAddress: string;
    signature: string;
  }, req: IncomingMessage, now = new Date()): Promise<{
    session: AuthSessionRecord;
    sessionToken: string;
    csrfToken: string;
  }> {
    const challengeId = input.challengeId.trim();
    const walletAddress = input.walletAddress.trim();
    const ip = requestIp(req);
    verificationGlobalLimiter.assert('global');
    verificationIpLimiter.assert(ip);
    verificationLimiter.assert(`${ip}:${walletAddress}`);
    if (!challengeId || challengeId.length > 128 || !isSolanaAddress(walletAddress)) {
      throw new HttpError(400, 'invalid wallet authentication input');
    }
    const verifiedAt = now.toISOString();
    const challenge = await this.store.activeChallenge(challengeId, walletAddress, verifiedAt);
    if (!challenge) throw new HttpError(401, 'wallet challenge is expired, consumed, or unknown');
    if (!verifySolanaMessageSignature(walletAddress, input.signature.trim(), challenge.message)) {
      throw new HttpError(401, 'wallet signature verification failed');
    }
    // Verification is intentionally performed before invalidation so an
    // invalid signature cannot burn another login attempt. The conditional
    // consume remains atomic; only its winner may establish a session.
    const consumed = await this.store.consumeChallenge(challengeId, walletAddress, verifiedAt);
    if (!consumed) throw new HttpError(401, 'wallet challenge is expired, consumed, or unknown');

    const sessionToken = opaqueToken();
    const csrfToken = opaqueToken();
    const session: AuthSessionRecord = {
      id: randomUUID(),
      userId: randomUUID(),
      walletAddress,
      tokenHash: sha256(sessionToken),
      csrfHash: sha256(csrfToken),
      expiresAt: new Date(now.getTime() + AUTH_SESSION_TTL_MS).toISOString(),
      revokedAt: null,
    };
    const saved = await this.store.createAuthenticatedSession({
      session,
      walletAddress,
      now: verifiedAt,
    });
    return { session: saved, sessionToken, csrfToken };
  }

  async authenticate(req: IncomingMessage, requireCsrf = false, now = new Date()): Promise<AuthenticatedSession> {
    const token = cookies(req)[SESSION_COOKIE];
    if (!token || token.length > 256) throw new HttpError(401, 'authentication required');
    const record = await this.store.sessionByTokenHash(sha256(token), now.toISOString());
    if (!record) throw new HttpError(401, 'authentication session is expired or revoked');
    const csrf = req.headers['x-csrf-token'];
    const csrfValue = Array.isArray(csrf) ? csrf[0] : csrf;
    const csrfValid = typeof csrfValue === 'string' && csrfValue.length <= 256 && constantTimeHashEqual(record.csrfHash, csrfValue);
    if (requireCsrf && !csrfValid) throw new HttpError(403, 'valid X-CSRF-Token header required');
    return { record, csrfValid };
  }

}
