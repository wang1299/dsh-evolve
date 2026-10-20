import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, Script } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { renderPanel } from '../src/panel-view.js';

// A small DOM port exercises the shipped client, including real event callbacks.
// Layout, native controls and accessibility are separately checked in a browser.
function browser() {
  class Element {
    id = ''; value = ''; hidden = false; open = false; className = ''; textContent = ''; type = '';
    children: Element[] = []; attributes = new Map<string, string>(); listeners = new Map<string, () => void>();
    onclick?: () => Promise<void> | void; onchange?: () => void; oninput?: () => void;
    classList = { toggle: (_name: string, _value: boolean) => undefined };
    constructor(readonly tag: string) { elements.push(this); }
    set innerHTML(_value: string) { throw new Error('Untrusted HTML insertion is forbidden'); }
    append(...children: Element[]) { if (this.tag === 'select' && this.children.length === 0 && children[0]?.tag === 'option') this.value = children[0].value; this.children.push(...children); }
    replaceChildren(...children: Element[]) { this.children = children; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
    closest() { return null; }
    focus() { document.activeElement = this; }
    scrollIntoView() { /* no layout in this port */ }
  }
  const elements: Element[] = [];
  const html = renderPanel('unit-test-nonce'); const markup = html.slice(0, html.indexOf('<script'));
  for (const match of markup.matchAll(/id="([^"]+)"/g)) { const element = new Element('static'); element.id = match[1]!; }
  const get = (id: string) => elements.findLast(e => e.id === id)!;
  get('filter').value = 'all'; get('records').open = false;
  const document: { activeElement: Element | null; hidden: boolean; getElementById: typeof get; createElement: (tag: string) => Element; addEventListener: () => void } = {
    activeElement: null, hidden: false, getElementById: get, createElement: tag => new Element(tag), addEventListener: () => undefined,
  };
  const exp = { id: 'experience-one', revision: 1, status: 'candidate', title: '<img src=x onerror=alert(1)>', strategy: 'Restore the prior state', observedFacts: ['A correction was recorded'], inferences: [], recommendations: [], scope: { repoId: 'repo', requiredFiles: { 'ledger.py': 'a'.repeat(64) } }, sourceTaskId: 'source', verificationId: null, createdAt: '2026-10-20T00:00:00Z' };
  const current = { experiences: [exp], tasks: [{ id: 'source', summary: '转账失败时恢复余额' }, { id: 'target', summary: '库存异常后数量不正确' }], applications: [{ id: 'application-one', taskId: 'target', experienceId: exp.id, revision: 1, createdAt: exp.createdAt }], feedback: [], evidence: [{ id: 'source-evidence', taskId: 'source', repoId: 'repo', kind: 'correction', note: 'restore balance', digest: 'd' }], verifications: {}, histories: { [exp.id]: [exp] }, provenance: { [exp.id]: { 1: { complete: false, facts: [{ factIndex: 0, factDigest: 'f' }], citations: [] } } }, learningJobs: [], evidenceBundles: [], extractionJobs: [], extractionGrants: [] };
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  let offline = false; let postStatus = 409;
  const context = createContext({ document, URLSearchParams, Intl, Date, JSON, crypto: { randomUUID }, location: { hash: '#token=fixture', pathname: '/' }, history: { replaceState: () => undefined }, setInterval: () => undefined,
    fetch: async (path: string, init: { method: string; body?: string }) => {
      if (offline) throw new Error('Synthetic offline');
      if (init.method === 'POST') { posts.push({ path, body: JSON.parse(init.body!) as Record<string, unknown> }); if (postStatus === 0) throw new Error('Synthetic interrupted response'); return { ok: postStatus === 200, json: async () => ({ error: 'Experience changed; refresh before editing' }) }; }
      return { ok: true, json: async () => structuredClone(current) };
    },
  });
  new Script(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1]!).runInContext(context);
  const run = async (code: string) => { await new Promise<void>(resolve => setImmediate(resolve)); await new Script(code).runInContext(context) as Promise<void>; };
  const descendants = (root: Element): Element[] => root.children.flatMap(e => [e, ...descendants(e)]);
  const control = (label: string) => descendants(get('detail')).find(e => e.attributes.get('aria-label') === label)!;
  const click = async (text: string) => { const control = descendants(get('detail')).find(e => e.tag === 'button' && e.textContent === text); assert.ok(control); await control.onclick!(); };
  return { get, current, posts, run, control, click, descendants, offline: () => { offline = true; }, unknownWrites: () => { postStatus = 0; } };
}

test('learning home renders untrusted titles as text and keeps technical editors off the default screen', async () => {
  const b = browser(); await b.run('refresh()');
  assert.equal(b.get('home').hidden, false); assert.equal(b.get('library').hidden, true); assert.equal(b.get('detail').hidden, true); assert.equal(b.get('records').open, false);
  assert.ok(b.descendants(b.get('recent')).some(e => e.tag === 'h3' && e.textContent === b.current.experiences[0]!.title));
  assert.equal(b.descendants(b.get('recent')).some(e => ['input', 'select', 'textarea', 'pre'].includes(e.tag)), false);
  assert.ok(b.descendants(b.get('activity')).some(e => e.tag === 'h3' && e.textContent === '库存异常后数量不正确'));
  assert.ok(b.descendants(b.get('activity')).some(e => e.textContent.includes('任务结果尚未确认')));
});

test('polling preserves a draft and its captured revision; a conflict never overwrites it', async () => {
  const b = browser(); await b.run('refresh()'); await b.run("openExperience('experience-one')");
  const strategy = b.control('处理策略'); strategy.value = 'My unsaved strategy'; b.get('detail').listeners.get('input')!(); strategy.focus();
  b.current.experiences[0]!.revision = 2; await b.run('refresh()');
  assert.equal(b.control('处理策略'), strategy); assert.equal(strategy.value, 'My unsaved strategy'); assert.equal(b.get('detail-update').hidden, false); assert.equal(b.get('discard-edit').hidden, false);
  await b.click('保存为待验证版本'); assert.equal(b.posts.length, 1); assert.equal(b.posts[0]!.body.revision, 1); assert.equal(b.control('处理策略'), strategy); assert.equal(strategy.value, 'My unsaved strategy'); assert.match(b.get('message').textContent, /当前编辑已保留/);
});

test('unknown feedback submission retains its request ID and offline refresh marks existing data stale', async () => {
  const b = browser(); await b.run('refresh()'); await b.run("openExperience('experience-one')"); b.control('反馈依据').value = 'Synthetic acceptance basis'; b.unknownWrites();
  await b.click('保存反馈'); await b.click('保存反馈'); assert.equal(b.posts.length, 2); assert.equal(b.posts[0]!.body.id, b.posts[1]!.body.id); assert.equal(b.posts[0]!.body.applicationId, 'application-one');
  const card = b.get('recent').children[0]; b.offline(); await b.run('refresh()'); assert.equal(b.get('recent').children[0], card); assert.equal(b.get('stale').hidden, false); assert.match(b.get('stale-text').textContent, /上次读取/);
});
