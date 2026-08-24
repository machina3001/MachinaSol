import { resolveSolanaNetworkExpectation, type SolanaCluster } from './production/network.js';

/**
 * Configuration for the local MachineFi runtime server.
 *
 * Defaults are deliberately conservative: loopback bind, fixture-only mode.
 * Live-read mode must be opted into explicitly and uses only an
 * operator-configured JSON-RPC endpoint. HTTP callers cannot choose an
 * outbound destination, regardless of authentication mode.
 */
export interface ServerConfig {
  /** Interface to bind. Defaults to loopback. */
  host: string;
  /** TCP port. `0` selects an ephemeral port, which is useful for tests. */
  port: number;
  /** When false, every runtime call is forced into deterministic fixture mode. */
  allowLive: boolean;
  /** Operator-controlled Solana endpoint used by live HTTP reads. Never render this value. */
  liveRpcUrl?: string;
  /** Selects the deterministic demo or the authenticated persistent application. */
  dataMode?: 'fixture' | 'production';
  /** PostgreSQL/Neon connection string. Used only by the production application. */
  databaseUrl?: string;
  /** Browser-visible origin used to bind wallet challenges and validate requests. */
  publicOrigin?: string;
  /** Explicit genesis hash. Required for custom clusters; known labels are canonically pinned. */
  solanaGenesisHash?: string;
  /** Human-readable cluster label; never used as proof of network identity. */
  solanaCluster?: SolanaCluster;
  /** Whether authenticated cookies carry Secure. Required for non-loopback production origins. */
  secureCookies?: boolean;
  /** Explicit production-only opt-in for a managed platform's public 0.0.0.0 bind. */
  allowPublicBind?: boolean;
  /** Managed platform hostname accepted for health checks before custom-domain cutover. */
  platformHostname?: string;
  /** Durable telemetry age limit. Defaults to 30 days. */
  telemetryRetentionDays?: number;
  /** Per-machine durable telemetry row cap. Defaults to 10,000 events. */
  telemetryMaxEventsPerMachine?: number;
}

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8787;
export const DEFAULT_TELEMETRY_RETENTION_DAYS = 30;
export const DEFAULT_TELEMETRY_MAX_EVENTS_PER_MACHINE = 10_000;

/** Hostnames that are always accepted in the `Host`/`Origin` headers. */
export const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const truthy = (value: string | undefined): boolean => {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

function parsePort(value: string | undefined, label: string): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${label} must be an integer between 0 and 65535, received "${value}"`);
  }
  return port;
}

function parseBoundedInteger(
  value: string | undefined,
  label: string,
  fallback: number,
  maximum: number
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}, received "${value}"`);
  }
  return parsed;
}

const readFlag = (argv: string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const WILDCARD_HOSTS: ReadonlySet<string> = new Set([
  '0.0.0.0',
  '::',
  '[::]',
  '0:0:0:0:0:0:0:0',
  '[0:0:0:0:0:0:0:0]',
]);

/** True for bind addresses that expose the server on every interface. */
export const isWildcardHost = (host: string): boolean =>
  WILDCARD_HOSTS.has(host.trim().toLowerCase());

function normalizeRpcUrl(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use http or https`);
  }
  return parsed.toString();
}

function normalizeOrigin(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute origin`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use http or https`);
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${label} must contain only scheme, hostname, and optional port`);
  }
  return parsed.origin;
}

export function assertSecureProductionDatabaseUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('MACHINEFI_DATABASE_URL must be an absolute PostgreSQL URL');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('MACHINEFI_DATABASE_URL must use postgres or postgresql');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (LOOPBACK_HOSTNAMES.has(hostname) || LOOPBACK_HOSTNAMES.has(`[${hostname}]`)) return;
  const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase();
  const ssl = parsed.searchParams.get('ssl')?.toLowerCase();
  if (!['require', 'verify-ca', 'verify-full'].includes(sslMode ?? '') && ssl !== 'true' && ssl !== '1') {
    throw new Error('non-loopback production PostgreSQL connections must require TLS');
  }
}

const clusterName = (value: string | undefined): ServerConfig['solanaCluster'] | undefined => {
  if (value === undefined || value.trim() === '') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'mainnet-beta' || normalized === 'devnet' || normalized === 'testnet' || normalized === 'custom') {
    return normalized;
  }
  throw new Error('MACHINEFI_SOLANA_CLUSTER must be mainnet-beta, devnet, testnet, or custom');
};

/** Rejects unsafe programmatic configuration as well as CLI/env configuration. */
export function assertSafeServerConfig(config: ServerConfig): void {
  if (config.host.trim() === '') throw new Error('server host must not be empty');
  const mode = config.dataMode ?? 'fixture';
  if (isWildcardHost(config.host) && !(mode === 'production' && config.allowPublicBind === true)) {
    throw new Error(
      `server host "${config.host}" is a wildcard bind. Choose loopback, an explicit interface, or explicitly allow a managed production platform bind.`
    );
  }
  const normalizedRpcUrl = normalizeRpcUrl(config.liveRpcUrl, 'liveRpcUrl');
  if (config.allowLive && normalizedRpcUrl === undefined) {
    throw new Error('live-read mode requires an operator-configured Solana endpoint');
  }
  const retentionDays = config.telemetryRetentionDays ?? DEFAULT_TELEMETRY_RETENTION_DAYS;
  const maxTelemetryEvents = config.telemetryMaxEventsPerMachine ?? DEFAULT_TELEMETRY_MAX_EVENTS_PER_MACHINE;
  if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0 || retentionDays > 3_650) {
    throw new Error('telemetryRetentionDays must be an integer between 1 and 3650');
  }
  if (!Number.isSafeInteger(maxTelemetryEvents) || maxTelemetryEvents <= 0 || maxTelemetryEvents > 1_000_000) {
    throw new Error('telemetryMaxEventsPerMachine must be an integer between 1 and 1000000');
  }
  if (mode === 'production') {
    if (!config.databaseUrl?.trim()) throw new Error('production mode requires MACHINEFI_DATABASE_URL');
    assertSecureProductionDatabaseUrl(config.databaseUrl);
    if (!config.allowLive || normalizedRpcUrl === undefined) {
      throw new Error('production mode requires live Solana RPC access');
    }
    const rpc = new URL(normalizedRpcUrl);
    const rpcIsLoopback = LOOPBACK_HOSTNAMES.has(rpc.hostname.toLowerCase());
    if (!rpcIsLoopback && rpc.protocol !== 'https:') {
      throw new Error('non-loopback production Solana RPC endpoints must use https');
    }
    // Known public labels use pinned canonical hashes; custom networks require
    // an explicit hash. A contradictory label/hash pair is rejected at startup.
    resolveSolanaNetworkExpectation(config.solanaCluster, config.solanaGenesisHash);
    const origin = normalizeOrigin(config.publicOrigin, 'publicOrigin');
    if (origin === undefined) throw new Error('production mode requires MACHINEFI_PUBLIC_ORIGIN');
    const parsedOrigin = new URL(origin);
    const originIsLoopback = LOOPBACK_HOSTNAMES.has(parsedOrigin.hostname.toLowerCase());
    if (!originIsLoopback && parsedOrigin.protocol !== 'https:') {
      throw new Error('non-loopback production origins must use https');
    }
    if (!originIsLoopback && config.secureCookies !== true) {
      throw new Error('non-loopback production origins require Secure cookies');
    }
  }
}

/** True when the bind address only accepts connections from this machine. */
export const isLoopbackHost = (host: string): boolean =>
  LOOPBACK_HOSTNAMES.has(host.trim().toLowerCase());

export function resolveServerConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = []
): ServerConfig {
  const port =
    parsePort(readFlag(argv, '--port'), '--port') ??
    parsePort(env.MACHINEFI_PORT, 'MACHINEFI_PORT') ??
    parsePort(env.PORT, 'PORT') ??
    DEFAULT_PORT;
  const host = readFlag(argv, '--host') ?? env.MACHINEFI_HOST ?? DEFAULT_HOST;
  const allowLive = argv.includes('--allow-live') || truthy(env.MACHINEFI_ALLOW_LIVE);
  const liveRpcUrl = normalizeRpcUrl(
    readFlag(argv, '--rpc-url') ?? env.MACHINEFI_SOLANA_RPC_URL,
    '--rpc-url / MACHINEFI_SOLANA_RPC_URL'
  );
  const dataMode = (readFlag(argv, '--mode') ?? env.MACHINEFI_DATA_MODE ?? 'fixture').trim().toLowerCase();
  if (dataMode !== 'fixture' && dataMode !== 'production') {
    throw new Error('--mode / MACHINEFI_DATA_MODE must be fixture or production');
  }
  const publicOrigin = normalizeOrigin(
    readFlag(argv, '--public-origin') ?? env.MACHINEFI_PUBLIC_ORIGIN,
    '--public-origin / MACHINEFI_PUBLIC_ORIGIN'
  );
  const solanaGenesisHash = (env.MACHINEFI_SOLANA_GENESIS_HASH ?? '').trim() || undefined;
  const solanaCluster = clusterName(env.MACHINEFI_SOLANA_CLUSTER);
  const secureCookies = truthy(env.MACHINEFI_SECURE_COOKIES) ||
    (publicOrigin !== undefined && new URL(publicOrigin).protocol === 'https:');
  const allowPublicBind = truthy(env.MACHINEFI_ALLOW_PUBLIC_BIND);
  const platformHostname = (env.RENDER_EXTERNAL_HOSTNAME ?? '').trim().toLowerCase() || undefined;
  if (platformHostname && (!/^[a-z0-9.-]+$/u.test(platformHostname) || platformHostname.startsWith('.') || platformHostname.endsWith('.'))) {
    throw new Error('RENDER_EXTERNAL_HOSTNAME must be a valid hostname');
  }
  const databaseUrl = (env.MACHINEFI_DATABASE_URL ?? env.DATABASE_URL ?? '').trim() || undefined;
  const telemetryRetentionDays = parseBoundedInteger(
    env.MACHINEFI_TELEMETRY_RETENTION_DAYS,
    'MACHINEFI_TELEMETRY_RETENTION_DAYS',
    DEFAULT_TELEMETRY_RETENTION_DAYS,
    3_650
  );
  const telemetryMaxEventsPerMachine = parseBoundedInteger(
    env.MACHINEFI_TELEMETRY_MAX_EVENTS_PER_MACHINE,
    'MACHINEFI_TELEMETRY_MAX_EVENTS_PER_MACHINE',
    DEFAULT_TELEMETRY_MAX_EVENTS_PER_MACHINE,
    1_000_000
  );
  const config: ServerConfig = {
    host,
    port,
    allowLive,
    dataMode,
    secureCookies,
    allowPublicBind,
    telemetryRetentionDays,
    telemetryMaxEventsPerMachine,
    ...(liveRpcUrl === undefined ? {} : { liveRpcUrl }),
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
    ...(publicOrigin === undefined ? {} : { publicOrigin }),
    ...(solanaGenesisHash === undefined ? {} : { solanaGenesisHash }),
    ...(solanaCluster === undefined ? {} : { solanaCluster }),
    ...(platformHostname === undefined ? {} : { platformHostname }),
  };
  try {
    assertSafeServerConfig(config);
  } catch (error) {
    if (
      config.allowLive &&
      config.liveRpcUrl === undefined &&
      error instanceof Error &&
      error.message === 'live-read mode requires an operator-configured Solana endpoint'
    ) {
      throw new Error(
        'live-read mode requires an operator-configured Solana endpoint via --rpc-url or MACHINEFI_SOLANA_RPC_URL'
      );
    }
    throw error;
  }
  return config;
}
