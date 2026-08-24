import type { IncomingMessage, ServerResponse } from 'node:http';
import { LOOPBACK_HOSTNAMES, type ServerConfig } from './config.js';

/** Request bodies are small JSON documents; anything larger is rejected outright. */
export const MAX_BODY_BYTES = 64 * 1024;

/** An error carrying the HTTP status that should be returned to the caller. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()'
} as const;

/**
 * `bigint` is not JSON-serializable and an arbitrary `cause` may hold an Error
 * instance, so both are normalized before serialization.
 */
const jsonReplacer = (_key: string, value: unknown): unknown => {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return { name: value.name, message: value.message };
  return value;
};

export function sendJson(res: ServerResponse, status: number, payload: unknown, headOnly = false): void {
  sendJsonWithHeaders(res, status, payload, {}, headOnly);
}

export function sendJsonWithHeaders(
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers: Readonly<Record<string, string | readonly string[]>>,
  headOnly = false
): void {
  const body = JSON.stringify(payload, jsonReplacer, 2) ?? 'null';
  res.writeHead(status, {
    ...BASE_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  });
  if (headOnly) {
    res.end();
    return;
  }
  res.end(body);
}

export function sendHtml(res: ServerResponse, status: number, html: string, nonce: string): void {
  res.writeHead(status, {
    ...BASE_HEADERS,
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'content-security-policy': [
      "default-src 'none'",
      `style-src 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
      "connect-src 'self'",
      "form-action 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'"
    ].join('; ')
  });
  res.end(html);
}

export function sendNoContent(res: ServerResponse, status: number): void {
  res.writeHead(status, { ...BASE_HEADERS, 'content-length': 0 });
  res.end();
}

/** Reads and parses a JSON object body, enforcing the size cap. */
export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const contentEncoding = req.headers['content-encoding']?.trim().toLowerCase();
  if (contentEncoding && contentEncoding !== 'identity') {
    throw new HttpError(415, 'compressed request bodies are not accepted');
  }
  const declaredLength = req.headers['content-length'];
  if (declaredLength !== undefined) {
    if (!/^\d+$/u.test(declaredLength)) throw new HttpError(400, 'invalid Content-Length header');
    if (Number(declaredLength) > MAX_BODY_BYTES) {
      throw new HttpError(413, `request body exceeds ${MAX_BODY_BYTES} bytes`);
    }
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, `request body exceeds ${MAX_BODY_BYTES} bytes`);
    chunks.push(buffer);
  }
  if (size === 0) return {};
  const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new HttpError(415, 'request body content type must be application/json');
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'request body must be valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/** Strips the port from a `host`-style header value, handling IPv6 literals. */
function hostnameOf(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('[')) return trimmed.slice(0, trimmed.indexOf(']') + 1);
  const colon = trimmed.lastIndexOf(':');
  return colon > 0 ? trimmed.slice(0, colon) : trimmed;
}

const hostnameAllowed = (hostname: string, config: ServerConfig): boolean => {
  const publicHostname = config.publicOrigin ? new URL(config.publicOrigin).hostname.toLowerCase() : undefined;
  const platformHostname = config.platformHostname?.toLowerCase();
  return LOOPBACK_HOSTNAMES.has(hostname) || hostname === config.host.trim().toLowerCase() ||
    (publicHostname !== undefined && (hostname === publicHostname || hostname === `[${publicHostname}]`)) ||
    (platformHostname !== undefined && hostname === platformHostname);
};

/**
 * Guards against DNS rebinding: an attacker-controlled domain resolving to
 * 127.0.0.1 would otherwise let a remote page reach this server.
 */
export function assertHostAllowed(req: IncomingMessage, config: ServerConfig): void {
  const host = req.headers.host;
  if (!host) throw new HttpError(400, 'missing Host header');
  if (!hostnameAllowed(hostnameOf(host), config)) {
    throw new HttpError(403, `Host "${host}" is not allowed by the local runtime server`);
  }
}

/**
 * Guards against cross-site requests from a page in the user's browser. Absent
 * `Origin` (curl, fetch from a non-browser client) is allowed.
 */
export function assertOriginAllowed(req: IncomingMessage, config: ServerConfig): void {
  const origin = req.headers.origin;
  if (!origin) return;
  if (config.publicOrigin && origin !== config.publicOrigin) {
    throw new HttpError(403, `Origin "${origin}" does not match the configured public origin`);
  }
  if (origin === 'null') throw new HttpError(403, 'opaque Origin is not allowed by the local runtime server');
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new HttpError(403, `invalid Origin header "${origin}"`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!hostnameAllowed(hostname, config) && !hostnameAllowed(`[${hostname}]`, config)) {
    throw new HttpError(403, `Origin "${origin}" is not allowed by the local runtime server`);
  }
  const requestHost = req.headers.host?.trim().toLowerCase();
  if (!requestHost || parsed.host.toLowerCase() !== requestHost) {
    throw new HttpError(403, `Origin "${origin}" does not match this runtime server`);
  }
}
