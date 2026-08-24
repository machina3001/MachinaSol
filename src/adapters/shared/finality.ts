export type ChainFinality = 'finalized' | 'confirmed' | 'processed' | 'pending' | 'unknown';

export function normalizeSolanaFinality(status?: 'processed' | 'confirmed' | 'finalized' | null, hasTransaction = false): ChainFinality {
  if (status === 'finalized' || status === 'confirmed' || status === 'processed') return status;
  return hasTransaction ? 'confirmed' : 'pending';
}

export function finalityMeetsMinimum(finality: ChainFinality, minimum: ChainFinality): boolean {
  const rank: Record<ChainFinality, number> = { pending: 0, unknown: 0, processed: 1, confirmed: 2, finalized: 3 };
  return rank[finality] >= rank[minimum];
}
