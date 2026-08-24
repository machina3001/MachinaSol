import { LiveRpcTransport, type RpcTransport } from '../../transports/live-rpc.js';
export const SOLANA_PUBLIC_RPC = '';
export interface SolanaProviderOptions { rpcUrl?: string | undefined; timeoutMs?: number | undefined; transport?: RpcTransport | undefined; commitment?: 'processed' | 'confirmed' | 'finalized' | undefined; }
export function solanaRpcUrl(env: NodeJS.ProcessEnv = process.env): string { return env.MACHINEFI_SOLANA_RPC_URL || SOLANA_PUBLIC_RPC; }
export function createSolanaTransport(options: SolanaProviderOptions = {}): RpcTransport { return options.transport ?? new LiveRpcTransport(options.rpcUrl ?? solanaRpcUrl(), options.timeoutMs); }
export const solanaTxUrl = (signature: string, cluster?: string) => `https://explorer.solana.com/tx/${signature}${cluster ? `?cluster=${cluster}` : ''}`;
