import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { SessionStore } from '@deepseek-ai/dsh-session';
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection';
import * as plugin from '../src/dsh.js';
import { fixture } from './fixture.js';
import { join } from 'node:path';

test('native host mounts when connection becomes active even without Agent tools', async () => {
  const f = await fixture(); const root = new Context(); let connection: HostConnectionService | undefined;
  await root.plugin(SessionStore).await();
  const fiber = root.plugin(plugin, { repoRoot: f.repo, dataDir: join(f.home, 'native-host'), executionTrusted: false }); await fiber.await();
  await root.plugin(function provide(ctx) {
    connection = new HostConnectionService(ctx, [], { isAuthenticated: () => true } as unknown as ConstructorParameters<typeof HostConnectionService>[2]);
  }).await();
  await new Promise<void>(resolve => setTimeout(resolve, 50));
  const carrier = connection!.createSharedFetchHandler('/api');
  const request = () => new Request('http://fixture/api/dsh-evolve-info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'fixture-info', method: 'dsh-evolve-info', payload: {} }) });
  try {
    assert.equal(carrier.requestBodyMode({ method: 'POST', url: new URL('http://fixture/api/dsh-evolve-info') }), 'streaming');
    const reply = await carrier.fetch(request()); assert.equal(reply.status, 200);
    const value = await reply.json() as { rpcId: string; result: { ok: boolean } }; assert.equal(value.rpcId, 'fixture-info'); assert.equal(value.result.ok, true);
    const huge = new Request('http://fixture/api/dsh-evolve-info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(32769) });
    assert.equal((await carrier.fetch(huge)).status, 413);
    const malformed = new Request('http://fixture/api/dsh-evolve-info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'fixture-info', method: 'dsh-evolve-request', payload: {} }) });
    assert.equal((await carrier.fetch(malformed)).status, 400);
  } finally { await root.fiber.dispose(); }
  assert.equal((await carrier.fetch(request())).status, 404);
});
