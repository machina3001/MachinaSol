#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { assertSecureProductionDatabaseUrl } from '../config.js';
import { PostgresProductionStore } from './postgres-store.js';

export async function migrateProductionDatabase(databaseUrl: string): Promise<void> {
  assertSecureProductionDatabaseUrl(databaseUrl);
  const store = new PostgresProductionStore(databaseUrl);
  try {
    await store.migrate();
  } finally {
    await store.close();
  }
}

const isMainModule = (): boolean => {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
};

if (isMainModule()) {
  const databaseUrl = (process.env.MACHINEFI_DATABASE_URL ?? process.env.DATABASE_URL ?? '').trim();
  if (!databaseUrl) throw new Error('MACHINEFI_DATABASE_URL or DATABASE_URL is required');
  await migrateProductionDatabase(databaseUrl);
  console.log('Machine Console production schema is current.');
}
