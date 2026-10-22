import { createElement as h, useEffect, useRef, useState } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type { ILayout, MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import { renderPanel } from './panel-view.js';
import { bridgeRequest } from './native-bridge.js';

export const name = 'dsh-evolve-client';
export const inject = ['slots', 'connection', 'layout'];
const channel = '/api'; const mainId = 'dsh-evolve' as MainPanelId;
interface Info { repositoryId: string; repositoryName: string; version: number }
type Face = { connection: ConnectionHandle; layout: ILayout };

function NativeView({ connection, layout, inSettings = false }: Face & { inSettings?: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null); const [info, setInfo] = useState<Info | null>(null); const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController(); let live = true;
    void connection.rpc.call(channel, 'dsh-evolve-info', {}, abort.signal).then(result => {
      if (!live) return;
      if (result.ok) setInfo(result.value as Info); else setError(result.error.message);
    }).catch(() => { if (live) setError('暂时无法连接 DSH 插件，请关闭后重新打开。'); });
    return () => { live = false; abort.abort(); };
  }, [connection]);
  useEffect(() => {
    if (!info || !frame.current) return;
    const target = frame.current; const session = crypto.randomUUID(); const nonce = crypto.randomUUID().replaceAll('-', '');
    const abort = new AbortController(); const seen = new Set<string>(); let live = true;
    const listener = (event: MessageEvent) => {
      if (!live || event.source !== target.contentWindow || event.origin !== 'null') return;
      const request = bridgeRequest(event.data, session); if (!request || seen.has(request.id)) return;
      // Bound lifetime correlation memory. No write is ever retried under another ID.
      if (seen.size >= 4096) return; seen.add(request.id);
      void connection.rpc.call(channel, 'dsh-evolve-request', { repositoryId: info.repositoryId, path: request.path, method: request.method, ...(request.data === undefined ? {} : { data: request.data }) }, abort.signal)
        .then(result => {
          if (!live || event.source !== target.contentWindow) return;
          target.contentWindow?.postMessage({ channel: session, id: request.id, ok: result.ok, ...(result.ok ? { value: result.value } : { message: result.error.message }) }, '*');
        }).catch(() => {
          if (live) target.contentWindow?.postMessage({ channel: session, id: request.id, ok: false, message: request.method === 'POST' ? '保存回执中断，请刷新核对结果；不会自动重试。' : 'DSH 连接中断，请稍后刷新。' }, '*');
        });
    };
    window.addEventListener('message', listener);
    target.srcdoc = renderPanel(nonce, { channel: session, parentOrigin: window.location.origin });
    return () => { live = false; abort.abort(); window.removeEventListener('message', listener); };
  }, [connection, info]);
  return h('section', { style: { width: '100%', height: '100%', minHeight: 400, display: 'flex', flexDirection: 'column' } },
    h('header', { style: { padding: '10px 16px', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' } },
      !inSettings && h('button', { type: 'button', onClick: () => layout.selectPanel(null) }, '← 返回对话'),
      h('span', null, info ? 'DSH-Evolve · 配置绑定仓库：' + info.repositoryName : 'DSH-Evolve · 正在连接')),
    error ? h('p', { role: 'alert' }, error) : h('iframe', { ref: frame, title: 'DSH-Evolve 经验与学习动态', sandbox: 'allow-scripts', style: { border: 0, width: '100%', flex: 1, minHeight: '70vh', background: '#f5f6f2' } }));
}

// Browser and host connection augment the same Cordis symbol in this monorepo.
// Narrow the browser face to the published client contract at this entry point.
export function apply(ctx: Omit<Context, 'connection'> & { connection: ConnectionHandle }): void {
  const face: Face = { connection: ctx.connection, layout: ctx.layout };
  const View = () => h(NativeView, face);
  const SettingsView = () => h(NativeView, { ...face, inSettings: true });
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'dsh-evolve' }, View));
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({ name: 'settings.plugins.tab', id: 'dsh-evolve', label: 'DSH-Evolve', order: 25 }, SettingsView));
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: 'dsh-evolve', order: 25 }, function Entry(props) {
    const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
    const open = async () => {
      setBusy(true); setError('');
      try {
        const result = await face.connection.rpc.call(channel, 'dsh-evolve-info', { sessionId: props.sessionId });
        if (result.ok) face.layout.selectPanel(mainId); else setError(result.error.message);
      } catch { setError('暂时无法连接 DSH 插件。'); } finally { setBusy(false); }
    };
    return h('span', null, h('button', { type: 'button', disabled: busy, onClick: () => { void open(); }, title: '查看当前配置仓库的经验与学习动态' }, '经验'), error && h('span', { role: 'status' }, error));
  }));
  ctx.effect(() => () => { if (ctx.layout.panelInfo.getSnapshot().activePanelId === mainId) ctx.layout.selectPanel(null); }, 'dsh-evolve:native-navigation');
}
