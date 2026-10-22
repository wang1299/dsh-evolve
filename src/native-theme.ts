const colors = {
  background: ['--dsw-alias-bg-layer-1', '#ffffff', '#171717'],
  surface: ['--dsw-alias-bg-layer-2', '#f7f7f8', '#222222'],
  text: ['--dsw-alias-label-primary', '#202123', '#eeeeee'],
  muted: ['--dsw-alias-label-secondary', '#6b6c70', '#aaaaaa'],
  border: ['--dsw-alias-border-l3', '#e5e5e7', '#393939'],
  accent: ['--dsw-alias-brand-primary', '#4d6bfe', '#879bff'],
  success: ['--dsw-alias-state-success-primary', '#248147', '#65be83'],
  warning: ['--dsw-alias-state-warn-primary', '#9a6800', '#e8b65b'],
  danger: ['--dsw-alias-state-error-primary', '#be4242', '#f58b8b'],
} as const;

/** Read only the official theme presenter's bounded DOM projection. */
export function watchNativeTheme(frame: HTMLIFrameElement, channel: string): () => void {
  const send = () => {
    const style = getComputedStyle(document.body); const dark = document.body.hasAttribute('data-ds-dark-theme');
    const appearance: Record<string, unknown> = { dark, fontSize: Math.min(24, Math.max(10, parseInt(style.getPropertyValue('--dsh-content-font-size')) || 14)) };
    for (const [key, [token, light, night]] of Object.entries(colors)) appearance[key] = style.getPropertyValue(token).trim() || (dark ? night : light);
    frame.contentWindow?.postMessage({ channel, type: 'theme', appearance }, '*');
  };
  const observer = new MutationObserver(send);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-ds-dark-theme'] });
  frame.addEventListener('load', send); send();
  return () => { observer.disconnect(); frame.removeEventListener('load', send); };
}

/** Self-contained: serialized into the isolated child, no host DOM access. */
export function applyNativeTheme(input: unknown): boolean {
  const keys = ['background', 'surface', 'text', 'muted', 'border', 'accent', 'success', 'warning', 'danger'];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== 11 || Object.keys(value).some(k => ![...keys, 'dark', 'fontSize'].includes(k))) return false;
  if (typeof value.dark !== 'boolean' || !Number.isInteger(value.fontSize) || (value.fontSize as number) < 10 || (value.fontSize as number) > 24) return false;
  for (const key of keys) {
    const color = value[key];
    if (typeof color !== 'string' || color.length > 120 || /[;{}<>\\]|url|var\(/i.test(color) || !CSS.supports('color', color)) return false;
  }
  for (const key of keys) document.documentElement.style.setProperty('--evolve-' + key, value[key] as string);
  document.documentElement.style.setProperty('--evolve-font-size', value.fontSize + 'px');
  document.documentElement.style.colorScheme = value.dark ? 'dark' : 'light';
  return true;
}

export const nativePanelStyles = `
:root{--evolve-background:#fff;--evolve-surface:#f7f7f8;--evolve-text:#202123;--evolve-muted:#6b6c70;--evolve-border:#e5e5e7;--evolve-accent:#4d6bfe;--evolve-success:#248147;--evolve-warning:#9a6800;--evolve-danger:#be4242;--evolve-font-size:14px;color:var(--evolve-text);background:var(--evolve-background);font-family:system-ui,"Segoe UI","Microsoft YaHei",sans-serif;font-size:var(--evolve-font-size);line-height:1.6}
.topbar{min-height:0;padding:8px 0;justify-content:flex-end}.brand{display:none}main{max-width:none;padding:0 2px}.hero{padding:0 0 16px;display:block}.hero>div:first-child{display:none}.stats{margin:0;padding:12px 16px;gap:28px;justify-content:flex-start;border:1px solid var(--evolve-border);border-radius:10px;background:var(--evolve-surface)}.stat{min-width:0;gap:0}.stat strong{font-size:22px}.stat span{font-size:12px;color:var(--evolve-muted)}
button{border-color:var(--evolve-border);background:var(--evolve-surface);color:var(--evolve-text);padding:6px 12px;border-radius:8px}button:hover,.quiet:hover{background:var(--evolve-surface);color:var(--evolve-accent)}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline-color:var(--evolve-accent)}input,select,textarea,.search-label input{background:var(--evolve-background);color:var(--evolve-text);border-color:var(--evolve-border)}
.navigation{margin-bottom:16px;border-color:var(--evolve-border)}.navigation [role=tab]{padding:8px 0;color:var(--evolve-muted)}.navigation [role=tab].active{color:var(--evolve-accent);border-color:var(--evolve-accent)}.quiet{background:transparent;color:var(--evolve-muted)}h2{font-size:18px}h3{font-size:14px}.eyebrow{letter-spacing:0;color:var(--evolve-muted)}
.learning-area,.progress-card,.experience-card,.surface,.empty,.notice,.records #evidence-jobs,.fold .fold{background:var(--evolve-background);border-color:var(--evolve-border);border-radius:10px;box-shadow:none}.learning-area{margin:0 0 24px;padding:16px}.learning-mode h2{font-size:18px}.learning-mode>.pill{margin-top:8px}.learning-setup{margin:12px 0 16px;padding:10px 0;border-color:var(--evolve-border)}.learning-setup summary{color:var(--evolve-muted)}.learning-mode .eyebrow,.section-heading .eyebrow{display:none}.section-heading{margin-bottom:12px}.progress-card,.experience-card{padding:16px}.progress-heading h3,.experience-card h3{font-size:15px}.cards{gap:12px}.progress-steps{margin:12px 0}.step{border-color:var(--evolve-border)}.step.done{border-color:var(--evolve-success)}.step.active{border-color:var(--evolve-accent)}.step.blocked,.step.unknown{border-color:var(--evolve-warning)}
.pill,.activity-mark{background:var(--evolve-surface);color:var(--evolve-success)}.pill.candidate,.notice.warning{background:var(--evolve-surface);color:var(--evolve-warning)}.pill.disabled{background:var(--evolve-surface);color:var(--evolve-muted)}.muted,.eyebrow,.date,.origin,.preview,.stat span,.step small,.activity-item p,.activity-item .muted,.scope p,.source-note p,.fold>summary,.records,.connection,footer{color:var(--evolve-muted)}.connected{color:var(--evolve-success)}.connected:before{background:var(--evolve-success)}.danger,.message{color:var(--evolve-danger)}.message:not(:empty){background:var(--evolve-surface)}
.card-foot,.activity-item,.use-row,.fold,.records{border-color:var(--evolve-border)}.activity-section{margin:24px 0}.detail{max-width:none;padding:16px}.detail h1{font-size:23px}.detail .strategy{font-size:14px;color:var(--evolve-text)}.detail h2{font-size:16px;margin:20px 0 10px}.scope,.source-note,.proof,.records pre,.detail pre{padding:14px 16px;margin:16px 0;background:var(--evolve-surface);color:var(--evolve-text)}.records{margin-top:24px;padding:14px 0}footer{padding:18px 0;font-size:11px}.notice.warning,.progress-card.needs_attention,.progress-card.unknown{border-color:var(--evolve-warning)}
@media(max-width:600px){.stats{gap:20px;padding:10px 12px}.learning-area,.progress-card,.experience-card,.detail{padding:12px}.learning-mode h2{font-size:17px}.progress-steps{grid-template-columns:repeat(2,minmax(0,1fr))}.navigation [role=tablist]{gap:18px}.detail h1{font-size:20px}}
`;
