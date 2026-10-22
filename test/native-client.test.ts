import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, Script } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { renderPanel } from '../src/panel-view.js';
import { bridgeRequest } from '../src/native-bridge.js';

test('native child uses correlated messages without fetch, token exchange or unknown write replay', async () => {
  const html = renderPanel('test-nonce', { channel: 'fixture', parentOrigin: 'http://127.0.0.1:1234' });
  assert.match(html, /default-src 'none'/); assert.match(html, /connect-src|default-src/);
  assert.ok(!html.includes('allow-same-origin')); assert.ok(!html.includes('http://127.0.0.1:57942'));
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1]!;
  const prefix = script.slice(0, script.indexOf('let state='));
  let listener: (e: object) => void = () => undefined;
  const outbox: { data: { id: string }; origin: string }[] = []; const timers: (() => void)[] = [];
  const parent = { postMessage: (data: { id: string }, origin: string) => { outbox.push({ data, origin }); } };
  const context = createContext({ URLSearchParams, Map, Error, crypto: { randomUUID }, parent,
    window: { addEventListener: (_name: string, fn: typeof listener) => { listener = fn; } },
    setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; }, clearTimeout: () => undefined,
    fetch: () => { throw Error('Native view must not fetch'); } });
  new Script(prefix).runInContext(context);
  const response = new Script("nativeRequest('/api/state','GET')").runInContext(context) as Promise<unknown>;
  const id = outbox[0]!.data.id;
  listener({ source: {}, origin: 'http://127.0.0.1:1234', data: { channel: 'fixture', id, ok: true, value: 'spoofed' } });
  listener({ source: parent, origin: 'http://attacker.invalid', data: { channel: 'fixture', id, ok: true, value: 'spoofed' } });
  listener({ source: parent, origin: 'http://127.0.0.1:1234', data: { channel: 'fixture', id, ok: true, value: 'actual' } });
  assert.equal(await response, 'actual'); assert.equal(outbox[0]!.origin, 'http://127.0.0.1:1234');
  const write = new Script("nativeRequest('/api/cleanup','POST',{})").runInContext(context) as Promise<unknown>;
  const rejected = assert.rejects(write, /不会自动重试/); timers[1]!(); await rejected;
  assert.equal(outbox.length, 2);
  assert.equal(bridgeRequest({ ...outbox[0]!.data, channel: 'wrong', path: '/api/state', method: 'GET' }, 'fixture'), null);
  assert.equal(bridgeRequest({ channel: 'fixture', id, path: '/api/state', method: 'GET', extra: true }, 'fixture'), null);
  assert.equal(bridgeRequest({ channel: 'fixture', id, path: '/api/state', method: 'GET' }, 'fixture')?.id, id);
});

test('shipped client registers the official settings, main and conversation slots with scoped disposal', async () => {
  const text = await readFile('dist/src/client.js', 'utf8'); let module: { apply: (ctx: unknown) => void; inject: string[] } | undefined;
  const require = createRequire(import.meta.url);
  new Script(text).runInContext(createContext({ window: { __ModuleLoader__: { load: (entry: { id: string; factory: (require: (name: string) => unknown) => typeof module }) => {
    assert.equal(entry.id, 'dsh-evolve'); module = entry.factory(require);
  } } } }));
  assert.ok(module); assert.deepEqual([...module.inject], ['slots', 'connection', 'layout']);
  const entries: Record<string, unknown>[] = []; const disposers: (() => void)[] = []; const navigation: unknown[] = [];
  module.apply({ connection: {}, slots: { inject: (_slot: string, fn: () => unknown) => fn(), register: (options: Record<string, unknown>) => { entries.push(options); return () => undefined; } },
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId: 'dsh-evolve' }) }, selectPanel: (id: unknown) => navigation.push(id) },
    effect: (fn: () => () => void) => disposers.push(fn()) });
  assert.deepEqual(entries.map(e => e.name), ['main', 'settings.plugins.tab', 'conversation.session.header.actions']);
  disposers.forEach(fn => fn()); assert.deepEqual(navigation, [null]);
});
