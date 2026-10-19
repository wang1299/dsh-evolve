import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { EvolveService } from './service.js';
import { idSchema, redact, textSchema, feedbackSchema, RevisionConflict } from './domain.js';
import { factCitationsSchema } from './domain.js';

const revisionBody = z.object({ revision: z.number().int().positive(), reason: textSchema }).strict();
async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value)); size += chunk.length;
    if (size > 32768) throw new Error('Request body exceeds 32 KiB'); chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
function html(nonce: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH-Evolve · 经验</title>
<style nonce="${nonce}">
:root{font-family:system-ui,"Microsoft YaHei",sans-serif;color:#183132;background:#f3f6f5}*{box-sizing:border-box}body{margin:0}header{padding:26px 5%;background:#fff;border-bottom:1px solid #dce6e1}header h1{margin:0 0 8px;font-size:25px}header p{margin:0;color:#617574}main{max-width:1300px;margin:24px auto;padding:0 24px}.stats{display:flex;gap:12px;margin-bottom:20px}.stat{background:#fff;border:1px solid #dce6e1;border-radius:10px;padding:15px 22px;flex:1}.stat strong{display:block;font-size:26px;margin-top:6px}.layout{display:grid;grid-template-columns:300px 1fr;gap:20px}.box{background:#fff;border:1px solid #dce6e1;border-radius:12px;padding:20px}button,input,textarea,select{font:inherit;border-radius:6px;border:1px solid #bacdc8;padding:9px}button{cursor:pointer;background:#edf6f1;color:#194e40;margin:4px 5px 4px 0}button:hover{background:#d9eee3}.item{display:block;width:100%;text-align:left;margin:9px 0;padding:13px}.muted{color:#617574;font-size:13px}h2{margin-top:0}h3{margin-top:24px;font-size:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f8f6;padding:14px;border-radius:7px;font-size:12px}textarea{width:100%;min-height:85px;margin:6px 0 10px}label{display:block;margin:8px 0}#message{min-height:28px;color:#8a3a20}#token-entry{display:none}#token-entry.visible{display:block}.badge{font-size:12px;color:#246a54}.actions{display:flex;flex-wrap:wrap;gap:5px}.empty{padding:36px 12px;color:#617574}@media(max-width:760px){.layout{grid-template-columns:1fr}.stats{flex-wrap:wrap}.stat{flex-basis:40%}}
.layout{grid-template-columns:300px minmax(0,1fr)}.box{min-width:0;overflow-wrap:anywhere}select{max-width:100%}textarea{box-sizing:border-box}@media(max-width:760px){.layout{grid-template-columns:1fr}}
.evidence-jobs{margin-bottom:20px}
</style></head><body><header><h1>DSH-Evolve</h1><p>让修正有据可查，让经验在合适的时候发挥作用。</p></header><main><div id="message" role="status"></div><section id="token-entry" class="box"><label>访问令牌 <input id="token" type="password" autocomplete="off"></label><button id="connect">连接本地数据</button></section><div class="stats" id="stats"></div><div class="layout"><aside class="box"><h2>经验库</h2><select id="filter"><option value="all">全部状态</option><option value="candidate">待验证</option><option value="source_verified">来源已验证</option><option value="disabled">已停用</option></select><div id="list"></div><button id="refresh">刷新</button><button id="cleanup">清理过期事件摘要</button><p class="muted">清理删除过期事件和未引用来源；所有历史版本引用的最小来源、验证依据与历史保留。</p></aside><section id="detail" class="box"><div class="empty">选择一条经验，查看它的来源、验证和使用记录。</div></section></div></main>
<script nonce="${nonce}">
let token=new URLSearchParams(location.hash.slice(1)).get('token')||'';history.replaceState(null,'',location.pathname);let state=null;let selected=null;
const $=id=>document.getElementById(id);const labels={candidate:'待验证',source_verified:'来源已验证',disabled:'已停用'};
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el}
function message(text){$('message').textContent=text}
async function api(path,method='GET',data){const res=await fetch(path,{method,headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});const result=await res.json();if(!res.ok)throw new Error(result.error||'请求失败');return result}
async function action(path,data){try{await api(path,'POST',data);message('已保存');await refresh()}catch(error){message(error.message)}}
function section(root,title,value){
root.append(node('h3',title));let detail=false;
if(title==='适用条件'){root.append(node('p','仅适用同一仓库、相同依赖条件，以及以下代码未变化时：'+Object.keys(value.requiredFiles).join('、')));detail=true}
else if(title==='来源任务'&&typeof value==='object'){root.append(node('p',value.summary),node('p','任务 '+value.id.slice(0,8)+' · 起始版本 '+value.baseCommit.slice(0,8),'muted'));detail=true}
else if(title==='验证依据'&&typeof value==='object'){for(const [key,label]of [['base','原始问题'],['fixed','修复后'],['regression','回归检查']]){const run=value[key];root.append(node('p',label+'：'+run.tests+' 项测试，'+run.failures+' 失败，'+run.skipped+' 跳过'))}root.append(node('p',value.verified?'来源修复验证通过':'仍需重新验证','badge'));detail=true}
else if(title==='版本历史'){for(const old of value){root.append(node('p','v'+old.revision+' · '+labels[old.status]+' · '+old.reason));const sources=node('details');sources.append(node('summary','v'+old.revision+' 的事实来源'));showFactSources(sources,old,false);root.append(sources);if(old.verificationId&&state.verifications[old.verificationId]){const proof=node('details');proof.append(node('summary','v'+old.revision+' 的验证记录'),node('pre',JSON.stringify(state.verifications[old.verificationId],null,2)));root.append(proof)}}detail=true}
else if(title==='使用与反馈'){if(!value.length)root.append(node('p','尚未在后续任务提供此经验。','muted'));for(const use of value){root.append(node('p','任务 '+use.taskId.slice(0,8)+' 使用经验 v'+use.revision));for(const f of use.feedback)root.append(node('p',({unknown:'尚未确认',accepted:'通过验收',rejected:'已拒绝，停用版本',counterexample:'发现反例，停用版本',irrelevant:'此任务不相关，保留经验'}[f.outcome])+'：'+f.note,'muted'))}detail=true}
else if(Array.isArray(value)){const list=node('ul');for(const text of value)list.append(node('li',text));root.append(list)}
else if(title==='推断与建议'){for(const text of value.inferences)root.append(node('p','推断：'+text));for(const text of value.recommendations)root.append(node('p','建议：'+text))}
else root.append(node('p',String(value)));
if(detail){const details=node('details');details.append(node('summary','查看完整记录'),node('pre',JSON.stringify(value,null,2)));root.append(details)}
}
function showFactSources(root,e,editable){
const p=state.provenance[e.id][e.revision];const locked=editable&&e.status==='source_verified'&&p.complete;editable=editable&&!locked;if(locked)root.append(node('p','已验证且出处完整的经验来源已锁定。请先核对历史反馈，再在下方人工修订为待验证版本；重验只证明来源修复，不能反证后续任务反例。','muted'));root.append(node('h3','事实来源 · v'+e.revision),node('p',p.complete?'每条事实均已关联来源；不代表文字主张已证实。':'事实来源不完整或无效，默认不会自动复用此经验。','muted'));
root.append(node('p','来源引用只校验出处、任务和摘要。显式纠正由工具提交，未自动核对用户原话。','muted'));
const options=state.evidence.filter(s=>s.taskId===e.sourceTaskId&&s.repoId===e.scope.repoId);const choices=[];
for(let i=0;i<e.observedFacts.length;i++){root.append(node('p',(i+1)+'. '+e.observedFacts[i]));const refs=p.citations.filter(c=>c.factIndex===i);
if(!refs.length)root.append(node('p','尚未关联来源','muted'));
for(const ref of refs){const source=state.evidence.find(s=>s.id===ref.evidenceId);const detail=node('details');detail.append(node('summary',source?(source.kind==='correction'?'查看显式纠正':'查看测试与代码版本'):'来源缺失'));
if(source){if(source.kind==='correction')detail.append(node('p',source.note));else{const proof=state.verifications[source.verificationId];if(proof){detail.append(node('p','原始版本 '+proof.baseCommit.slice(0,8)+' → 修复版本 '+proof.fixCommit.slice(0,8)),node('p','原始失败 '+proof.base.failures+'；修复失败 '+proof.fixed.failures+'；回归失败 '+proof.regression.failures));const full=node('details');full.append(node('summary','查看完整验证报告'),node('pre',JSON.stringify(proof,null,2)));detail.append(full)}else detail.append(node('p','验证报告缺失'))}const raw=node('details');raw.append(node('summary','查看来源标识与摘要'),node('pre',JSON.stringify({reference:ref,source},null,2)));detail.append(raw)}root.append(detail)}
if(editable){const select=node('select');select.setAttribute('aria-label','事实'+(i+1)+'的来源');const empty=node('option','未选择来源');empty.value='';select.append(empty);for(const source of options){const option=node('option',source.kind==='correction'?'纠正：'+source.note.slice(0,70):'测试记录 '+source.verificationId.slice(0,8));option.value=source.id;select.append(option)}select.value=refs[0]?.evidenceId||'';choices.push(select);root.append(select)}}
if(editable){root.append(node('p','来源变化时建立新版本，未变化时保留原版本与反馈。每条事实设为所选一个来源；未选择则保持来源缺失。','muted'));const save=node('button','保存事实来源');save.onclick=()=>{const citations=[];for(let i=0;i<choices.length;i++){const source=options.find(s=>s.id===choices[i].value);if(source)citations.push({...p.facts[i],evidenceId:source.id,evidenceDigest:source.digest})}action('/api/experience/'+e.id+'/evidence',{revision:e.revision,citations})};root.append(save)}}
function render(){const items=state.experiences.filter(e=>$('filter').value==='all'||e.status===$('filter').value);$('stats').replaceChildren();for(const [label,value]of [['全部经验',state.experiences.length],['来源已验证',state.experiences.filter(e=>e.status==='source_verified').length],['已提供上下文',state.applications.length],['反馈事件',state.feedback.length]]){const el=node('div',label,'stat');el.append(node('strong',String(value)));$('stats').append(el)}$('list').replaceChildren();for(const e of items){const b=node('button',e.title,'item');b.append(node('div',labels[e.status]+' · v'+e.revision,'badge'));b.onclick=()=>{selected=e.id;renderDetail()};$('list').append(b)}if(!items.length)$('list').append(node('p','目前没有经验。先在受信任仓库中完成一次失败与修正记录。','empty'));renderDetail()}
function renderDetail(){const e=state.experiences.find(e=>e.id===selected);const root=$('detail');root.replaceChildren();if(!e){root.append(node('div','选择一条经验，查看来源、验证状态和使用记录。','empty'));return}root.append(node('h2',e.title),node('p',labels[e.status]+' · 版本 '+e.revision,'badge'),node('p','来源验证只说明当时的修复通过了检查；未来任务收益需要独立对照评价。','muted'));section(root,'处理策略',e.strategy);showFactSources(root,e,true);section(root,'推断与建议',{inferences:e.inferences,recommendations:e.recommendations});section(root,'适用条件',e.scope);section(root,'来源任务',state.tasks.find(t=>t.id===e.sourceTaskId)||'来源缺失');section(root,'验证依据',e.verificationId?state.verifications[e.verificationId]:'尚未通过来源验证');const uses=state.applications.filter(a=>a.experienceId===e.id);section(root,'使用与反馈',uses.map(a=>({...a,feedback:state.feedback.filter(f=>f.applicationId===a.id)})));section(root,'版本历史',state.histories[e.id]);root.append(node('h3','修订经验'));const title=node('input');title.value=e.title;title.setAttribute('aria-label','经验标题');const strategy=node('textarea');strategy.value=e.strategy;strategy.setAttribute('aria-label','处理策略');const reason=node('input');reason.placeholder='修改或停用原因（必填）';reason.setAttribute('aria-label','修改原因');root.append(title,strategy,reason);const actions=node('div',undefined,'actions');const revise=node('button','保存为待验证版本');revise.onclick=()=>action('/api/experience/'+e.id+'/revise',{revision:e.revision,reason:reason.value,citations:state.provenance[e.id][e.revision].citations,candidate:{title:title.value,strategy:strategy.value,observedFacts:e.observedFacts,inferences:e.inferences,recommendations:e.recommendations,requiredFiles:Object.keys(e.scope.requiredFiles)}});const disable=node('button','停用经验');disable.onclick=()=>action('/api/experience/'+e.id+'/disable',{revision:e.revision,reason:reason.value});actions.append(revise,disable);const versions=node('select');for(const old of state.histories[e.id]){const op=node('option','v'+old.revision);op.value=old.revision;versions.append(op)}const restore=node('button','恢复为待验证版本');restore.onclick=()=>action('/api/experience/'+e.id+'/restore',{revision:e.revision,targetRevision:Number(versions.value),reason:reason.value});actions.append(versions,restore);root.append(actions);
if(uses.length){root.append(node('h3','记录应用反馈'),node('p','不相关只避免在相同任务表述中再次推荐；策略无效或反例会停用当前经验版本。','muted'));const app=node('select');for(const use of uses){const option=node('option',use.taskId.slice(0,8)+' · 经验v'+use.revision);option.value=use.id;app.append(option)}const outcome=node('select');for(const [value,label]of [['unknown','尚未确认'],['accepted','通过验收'],['irrelevant','此任务不相关：保留经验'],['rejected','策略无效：停用版本'],['counterexample','发现反例：停用版本']]){const option=node('option',label);option.value=value;outcome.append(option)}const note=node('textarea');note.placeholder='验收依据或反例说明';note.setAttribute('aria-label','反馈依据');const cost=node('input');cost.type='number';cost.min='0';cost.step='any';cost.placeholder='额外成本（USD，可留空）';cost.setAttribute('aria-label','额外成本');const rework=node('input');rework.type='number';rework.min='0';rework.step='1';rework.placeholder='人工返工次数（可留空）';rework.setAttribute('aria-label','人工返工次数');const submit=node('button','追加反馈');submit.onclick=()=>action('/api/feedback',{id:crypto.randomUUID(),applicationId:app.value,outcome:outcome.value,note:note.value,extraCost:cost.value===''?null:Number(cost.value),humanRework:rework.value===''?null:Number(rework.value)});root.append(app,outcome,note,cost,rework,submit)}}
function renderEvidenceJobs(){let root=$('evidence-jobs');if(!root){root=node('section',undefined,'box evidence-jobs');root.id='evidence-jobs';document.querySelector('main').insertBefore(root,document.querySelector('.layout'))}root.replaceChildren(node('h2','任务证据与后台处理'));root.append(node('p','结束任务后自动整理；证据齐备不代表已经学会或提高了效果。工具报错不等于测试失败。','muted'));
const states={queued:'等待整理',running:'正在整理',succeeded:'已整理',failed:'整理失败',unknown:'验证可能已执行，结果待核对（不会自动重跑）'};
const reasons={no_source_verification:'缺少匹配的测试验证',source_not_verified:'测试尚未证明修复有效',no_commit_change:'尚无修复提交',dirty_tree:'任务结束时存在未提交修改',capture_unavailable:'代码材料采集不完整',sources_omitted:'来源数量超出本版限制',events_omitted:'事件数量超出本版限制',diff_truncated:'代码差异超过保留上限',execution_disabled:'未开启后台验证',policy_changed:'验证授权或配置已变化',repository_changed:'等待期间代码版本已变化'};
const failures={invalid_input:'任务材料不一致',invalid_source:'来源缺失或摘要不符',interrupted_verification:'验证中断，结果未知',recovery_limit:'已达到本地恢复次数上限',verification_error:'验证执行异常'};
for(const job of state.learningJobs||[]){const task=state.tasks.find(t=>t.id===job.input.taskId);const detail=node('details');detail.append(node('summary',(task?task.summary:'来源任务缺失')+' · '+states[job.state]));const bundle=(state.evidenceBundles||[]).find(b=>b.id===job.id);detail.append(node('p','原始版本 '+job.input.baseCommit.slice(0,8)+' → 修复版本 '+job.input.fixCommit.slice(0,8)),node('p','关联来源 '+job.input.sources.length+' 条；事件摘要 '+job.input.observations.length+' 条','muted'));
const extraction=(state.extractionJobs||[]).find(e=>e.evidenceJobId===job.id);
if(bundle){detail.append(node('p',bundle.status==='ready'?(extraction?'证据齐备':'证据齐备，尚未开启自动提炼'):'材料不完整','badge'));for(const reason of bundle.reasons)detail.append(node('p',reasons[reason]||reason));if(bundle.verificationId){const proof=state.verifications[bundle.verificationId];if(proof)section(detail,'验证依据',proof);else detail.append(node('p','验证报告缺失'))}}else if(failures[job.reason])detail.append(node('p',failures[job.reason]));
if(extraction){const labels={waiting:'等待提炼',running:'正在提炼',candidate:'已生成候选，尚未验证',abstained:'未提炼出适合的经验',blocked:'提炼条件不满足',failed:'响应无效，未生成经验',unknown:'模型调用结果未知，不会自动重试'};const why={evidence_pending:'等待证据整理',model_unavailable:'等待DSH模型服务',evidence_incomplete:'证据尚不完整',evidence_failed:'证据整理未成功',policy_revoked:'提炼授权或配置已变化',quota_exhausted:'已用完授权调用次数',invalid_material:'来源或代码条件不一致',repository_changed:'修复版本已变化',invalid_response:'模型输出不符合候选要求',interrupted_model:'调用中断或结果无法确认'};detail.append(node('h3','候选经验提炼'),node('p',labels[extraction.state],'badge'));if(why[extraction.reason])detail.append(node('p',why[extraction.reason]));detail.append(node('p','模型：'+extraction.policy.provider+' / '+extraction.policy.model,'muted'));const grant=(state.extractionGrants||[]).find(g=>g.id===extraction.policy.grantId);if(grant)detail.append(node('p','已占用 '+grant.used+' / '+grant.maxCalls+' 次逻辑调用；未知调用不退额，不代表实际账单。','muted'));if(extraction.candidateId){const open=node('button','查看候选经验');open.onclick=()=>{selected=extraction.candidateId;renderDetail();$('detail').scrollIntoView({block:'start'})};detail.append(open)}}
for(const ref of job.input.sources.filter(s=>s.kind==='correction')){const source=state.evidence.find(s=>s.id===ref.id);if(source)detail.append(node('p','用户明确纠正：'+source.note))}
const technical=node('details');technical.append(node('summary','查看最小材料、来源标识与处理历史'),node('pre',JSON.stringify({job,bundle:bundle||null,extraction:extraction||null,attempts:(state.learningAttempts||{})[job.id]||[]},null,2)));detail.append(technical);root.append(detail)}if(!(state.learningJobs||[]).length)root.append(node('p','结束一次明确的修复任务后，会自动整理证据。','muted'));root.append(node('p','清理会保留经验历史或后台任务引用的最小来源，以及证据包中的有限元数据。自动提炼需在本地配置中单独授权，只产生候选。','muted'))}
async function refresh(){try{state=await api('/api/state');$('token-entry').className='box';render();renderEvidenceJobs()}catch(error){message(error.message);$('token-entry').className='box visible'}}
$('connect').onclick=()=>{token=$('token').value;$('token').value='';refresh()};$('filter').onchange=render;$('refresh').onclick=refresh;$('cleanup').onclick=()=>action('/api/cleanup',{});if(token)refresh();else $('token-entry').className='box visible';
</script></body></html>`;
}

export async function startPanel(service: EvolveService): Promise<{ url: string; origin: string; token: string; close: () => Promise<void> }> {
  const token = randomBytes(32).toString('hex'); let origin = '';
  const server = createServer((request, response) => { void handle(request, response); });
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const send = (status: number, value: unknown): void => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (request.headers.host !== new URL(origin).host) { send(403, { error: 'Invalid local host' }); return; }
      const path = request.url ?? '/';
      if (path === '/' && request.method === 'GET') {
        const nonce = randomBytes(16).toString('hex');
        response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html(nonce)); return;
      }
      const supplied = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      if (Buffer.byteLength(supplied) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { send(401, { error: 'Local access token required' }); return; }
      if (request.method === 'GET' && path === '/api/state') {
        const experiences = service.store.experiences();
        const histories = Object.fromEntries(experiences.map((e) => [e.id, service.store.history(e.id)]));
        const proofIds = new Set(Object.values(histories).flatMap((items) => items.flatMap((e) => e.verificationId ? [e.verificationId] : [])));
        const evidence = service.store.evidenceRecords();
        for (const e of evidence) if (e.kind === 'verification') proofIds.add(e.verificationId);
        const provenance = Object.fromEntries(Object.entries(histories).map(([id, versions]) => [id,
          Object.fromEntries(versions.map((e) => [e.revision, { ...service.provenance(e), facts: service.facts(e) }]))]));
        const learningJobs = service.store.learning.jobs();
        send(200, { experiences, tasks: service.store.tasks(), applications: service.store.applications(), feedback: service.store.feedback(),
          learningJobs, evidenceBundles: service.store.learning.bundles(), learningAttempts: Object.fromEntries(learningJobs.map(j => [j.id, service.store.learning.attempts(j.id)])),
          extractionJobs: service.store.extraction.jobs(), extractionGrants: service.store.extraction.grants(),
          histories, evidence, provenance, verifications: Object.fromEntries([...proofIds].map((id) => [id, service.store.verification(id)])) }); return;
      }
      if (request.method !== 'POST') { send(404, { error: 'Not found' }); return; }
      if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') { send(403, { error: 'Same-origin JSON required' }); return; }
      const value = await body(request);
      if (path === '/api/feedback') {
        const parsed = feedbackSchema.omit({ createdAt: true }).parse(value);
        send(200, service.feedback(parsed)); return;
      }
      if (path === '/api/cleanup') {
        z.object({}).strict().parse(value);
        send(200, service.store.cleanEvidenceWithRetention(new Date(Date.now() - 30 * 86400000).toISOString())); return;
      }
      const match = path.match(/^\/api\/experience\/([^/]+)\/(revise|disable|restore|evidence)$/);
      if (!match) { send(404, { error: 'Not found' }); return; }
      const id = idSchema.parse(match[1]); const current = service.requireExperience(id);
      const revision = z.object({ revision: z.number().int().positive() }).passthrough().parse(value).revision;
      if (revision !== current.revision) { send(409, { error: 'Experience changed; refresh before editing' }); return; }
      if (match[2] === 'revise') {
        const input = revisionBody.extend({ candidate: z.unknown(), citations: factCitationsSchema.optional() }).parse(value);
        send(200, service.revise(id, input.revision, input.candidate, input.reason, input.citations ?? []));
      } else if (match[2] === 'evidence') {
        const input = z.object({ revision: z.number().int().positive(), citations: factCitationsSchema }).strict().parse(value);
        send(200, service.linkEvidence(id, input.revision, input.citations));
      } else if (match[2] === 'restore') {
        const input = revisionBody.extend({ targetRevision: z.number().int().positive() }).parse(value);
        send(200, service.restore(id, input.targetRevision, input.reason, input.revision));
      } else {
        const input = revisionBody.parse(value); send(200, service.disable(id, input.reason, input.revision));
      }
    } catch (error) { send(error instanceof RevisionConflict ? 409 : 400, { error: redact(error instanceof Error ? error.message : 'Invalid request', 1000) }); }
  }
  await new Promise<void>((resolveStart, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveStart); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local address');
  origin = `http://127.0.0.1:${address.port}`;
  return { origin, token, url: origin + '/#token=' + token,
    close: () => new Promise<void>((resolveClose, reject) => { server.close((error) => error ? reject(error) : resolveClose()); server.closeAllConnections(); }) };
}
