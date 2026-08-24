import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostgresProductionStore } from '../src/server/production/postgres-store.js';

afterEach(() => vi.restoreAllMocks());

describe('PostgreSQL pool process safety', () => {
  it('handles and safely logs idle client failures instead of leaving an unhandled error event', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = new PostgresProductionStore('postgres://localhost/unused');
    const providerError = Object.assign(new Error('provider connection details must not be logged'), {
      code: 'EADDRNOTAVAIL',
    });

    store.pool.emit('error', providerError);

    expect(logged).toHaveBeenCalledOnce();
    const payload = String(logged.mock.calls[0]?.[0]);
    expect(JSON.parse(payload)).toEqual({
      level: 'error',
      event: 'postgres_idle_client_error',
      errorName: 'Error',
      errorCode: 'EADDRNOTAVAIL',
    });
    expect(payload).not.toContain(providerError.message);
    await store.close();
  });
});
