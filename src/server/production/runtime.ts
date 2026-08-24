import type { ServerConfig } from '../config.js';
import { LiveRpcTransport, type RpcTransport } from '../../transports/live-rpc.js';
import { WalletAuthService } from './auth.js';
import {
  resolveSolanaNetworkExpectation,
  verifySolanaNetwork,
  type VerifiedSolanaNetwork,
} from './network.js';
import { PostgresProductionStore } from './postgres-store.js';
import { TelemetryHub } from './telemetry-hub.js';
import type { ProductionStore } from './types.js';

export interface ProductionRuntime {
  store: ProductionStore;
  auth: WalletAuthService;
  rpc: RpcTransport;
  network: VerifiedSolanaNetwork;
  telemetryHub: TelemetryHub;
  close(): Promise<void>;
}

export interface ProductionRuntimeOverrides {
  store?: ProductionStore;
  rpc?: RpcTransport;
  now?: Date;
}

export async function createProductionRuntime(
  config: ServerConfig,
  overrides: ProductionRuntimeOverrides = {}
): Promise<ProductionRuntime> {
  if ((config.dataMode ?? 'fixture') !== 'production') throw new Error('production runtime requires production data mode');
  if (!config.databaseUrl && !overrides.store) throw new Error('production runtime requires a PostgreSQL store');
  if (!config.liveRpcUrl && !overrides.rpc) throw new Error('production runtime requires a Solana RPC transport');
  const networkExpectation = resolveSolanaNetworkExpectation(config.solanaCluster, config.solanaGenesisHash);

  const ownsStore = overrides.store === undefined;
  const store = overrides.store ?? new PostgresProductionStore(config.databaseUrl!);
  const rpc = overrides.rpc ?? new LiveRpcTransport(config.liveRpcUrl!);
  try {
    await store.migrate();
    const network = await verifySolanaNetwork(rpc, networkExpectation, overrides.now);
    const telemetryHub = new TelemetryHub();
    return {
      store,
      // Bind wallet challenges to the identity proven by the startup RPC
      // check. Known cluster labels may omit an explicit configured hash, so
      // passing the original config could otherwise emit an "unverified"
      // challenge even though startup successfully verified the network.
      auth: new WalletAuthService(store, {
        ...config,
        solanaGenesisHash: network.actualGenesisHash,
      }),
      rpc,
      network,
      telemetryHub,
      async close() {
        telemetryHub.close();
        if (ownsStore) await store.close();
      },
    };
  } catch (error) {
    if (ownsStore) await store.close();
    throw error;
  }
}
