import solanaFixtures from '../fixtures/solana-receipts.json' with { type: 'json' };
import type { RuntimeChain } from '../adapters/shared/types.js';

export const fixtureData = { solana: solanaFixtures } as const;

export function getFixtureReceipt(_chain: RuntimeChain, id: string): unknown | undefined {
  return solanaFixtures.receipts.find((row: { id: string }) => row.id === id);
}
