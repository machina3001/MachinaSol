import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readJsonBody } from '../src/server/http.js';

const request = (body: string, contentType?: string, headers: Record<string, string> = {}): IncomingMessage => {
  const stream = Readable.from([body]);
  return Object.assign(stream, {
    headers: { ...headers, ...(contentType === undefined ? {} : { 'content-type': contentType }) },
  }) as unknown as IncomingMessage;
};

describe('JSON request content type', () => {
  it('accepts application/json with parameters', async () => {
    await expect(readJsonBody(request('{"ok":true}', 'application/json; charset=utf-8')))
      .resolves.toEqual({ ok: true });
  });

  it('rejects a non-empty body without an application/json content type', async () => {
    await expect(readJsonBody(request('{"ok":true}', 'text/plain')))
      .rejects.toMatchObject({ status: 415 });
  });

  it('rejects declared oversized and compressed bodies before parsing', async () => {
    await expect(readJsonBody(request('', 'application/json', { 'content-length': '65537' })))
      .rejects.toMatchObject({ status: 413 });
    await expect(readJsonBody(request('{"ok":true}', 'application/json', { 'content-encoding': 'gzip' })))
      .rejects.toMatchObject({ status: 415 });
  });
});
