import { GAMES, pad, choose, generatePlan, planTotals, ticketText, ticketKey, statistics, checkEntry, validateEntry, validateDraw, canonicalIssue, mergeDraws } from './domain.js';
import { setupCloudSync } from './sync-ui.js';
import { setupRules } from './rules.js';
const $ = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STORE = 'shishu.plans.v1', CACHE = 'shishu.draws.v1';
let game = 'ssq', mode = 'single', view = 'generate', data, currentPlan, saved = [], historyLimit = 20;
let activeEntry, manualCheck = false, toastTimer, cloud, rules;
const fetchedState = {}, loading = new Set();
const strategyNames = {random:'随机选号',hot:'热号参考',cold:'冷号参考',overdue:'遗漏参考'};
const rankNames = ['','一等奖','二等奖','三等奖','四等奖','五等奖','六等奖','七等奖','八等奖','九等奖'];
const amount = v => Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
const odds = p => p >= 1 ? '100%' : `约 ${amount(Math.round(1 / p))} 分之一`;
const dateLabel = value => { const d = new Date(value); return Number.isNaN(d.valueOf()) ? '未知时间' : d.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}); };
function toast(message) { clearTimeout(toastTimer); $('toast').textContent=message; $('toast').hidden=false; toastTimer=setTimeout(()=>$('toast').hidden=true,3500); }
function errorAt(id,message) { $(id).textContent=message || ''; $(id).hidden=!message; }
function balls(ticket) { return ticket.main.map(n=>`<span class="ball">${pad(n)}</span>`).join('') + '<span class="ball-divider" aria-hidden="true">＋</span>' + ticket.extra.map(n=>`<span class="ball extra">${pad(n)}</span>`).join(''); }
function ticketRows(tickets,copy=false) { return tickets.map((ticket,i)=>`<div class="ticket-row"><span class="ticket-index">${pad(i+1)}</span><div class="ball-row" aria-label="${ticket.main.join('、')}，${ticket.extra.join('、')}">${balls(ticket)}</div>${copy?`<button class="copy-one" data-copy="${i}" aria-label="复制第${i+1}组">复制</button>`:''}</div>`).join(''); }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('号码已复制，不含序号'); }
  catch { const input=document.createElement('textarea'); input.value=text; document.body.append(input); input.select(); const ok=document.execCommand('copy'); input.remove(); toast(ok?'号码已复制':'复制不可用，请长按选择号码'); }
}
function download(name,content,type='text/plain;charset=utf-8') { const url=URL.createObjectURL(new Blob([content],{type})); const a=document.createElement('a'); a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function readSaved() {
  try {
    const parsed=JSON.parse(localStorage.getItem(STORE)||'[]');
    if(!Array.isArray(parsed)) throw new Error();
    saved=parsed.filter(validateEntry).slice(0,200).map(r=>({...r,id:typeof r.id==='string'?r.id:crypto.randomUUID()}));
  } catch { saved=[]; toast('浏览器中的保存记录无法读取，请导入备份恢复'); }
}
function writeSaved(next) {
  if(next.length>200) throw new Error('最多保存200组方案，请先导出备份并整理旧记录');
  if(cloud?.update(next))return;
  localStorage.setItem(STORE,JSON.stringify(next)); saved=next; renderSaved();
}
function options() {
  return {game,mode,strategy:$('strategy').value,count:Number($('ticket-count').value),mainSize:Number($('main-size').value),extraSize:Number($('extra-size').value),multiplier:Number($('multiplier').value),additional:$('additional').checked,spread:$('spread').checked};
}
function previewTotals() {
  const o=options(),g=GAMES[game];
  const placeholder={game,mode,multiplier:o.multiplier,additional:game==='dlt'&&o.additional,tickets:mode==='compound'?[{main:Array.from({length:Math.min(35,Math.max(0,o.mainSize))},(_,i)=>i+1),extra:Array.from({length:Math.min(16,Math.max(0,o.extraSize))},(_,i)=>i+1)}]:Array.from({length:Math.min(50,Math.max(0,o.count))},()=>({main:Array.from({length:g.mainK},(_,i)=>i+1),extra:Array.from({length:g.extraK},(_,i)=>i+1)}))};
  if((mode==='single'&&(!Number.isInteger(o.count)||o.count<1||o.count>50))||(mode==='compound'&&(!Number.isInteger(o.mainSize)||!Number.isInteger(o.extraSize)))) throw new Error('请输入有效的整数');
  const totals=planTotals(placeholder);
  // Generated single tickets are unique; the dummy preview is not a real set.
  if(mode==='single')totals.jackpot=o.count/g.total;
  return totals;
}
function renderConfig() {
  const g=GAMES[game];
  $('single-inputs').hidden=mode!=='single';$('compound-inputs').hidden=mode!=='compound';
  $('ticket-count').disabled=mode!=='single';$('main-size').disabled=mode!=='compound';$('extra-size').disabled=mode!=='compound';
  $('additional-wrap').hidden=game!=='dlt';$('spread-wrap').hidden=mode!=='single';
  $('main-size-label').textContent=`${g.mainLabel}数量`;$('extra-size-label').textContent=`${g.extraLabel}数量`;
  $('main-size').min=g.mainK;$('main-size').max=g.mainN;$('extra-size').min=g.extraK;$('extra-size').max=g.extraN;
  $('spread-label').innerHTML=game==='ssq'?'尽量分散蓝球 <small>优先覆盖不同蓝球号码</small>':'分散后区组合 <small>优先选择不同的后区两数组合</small>';
  const descriptions={random:'每个号码均匀抽取，整组号码自动去重。',hot:'近50期出现越多，抽样权重越高；不代表下期更易开出。',cold:'近50期出现越少，抽样权重越高；不代表“该出了”。',overdue:'近50期遗漏越长，抽样权重越高；不代表即将补出。'};
  $('strategy-description').textContent=descriptions[$('strategy').value];
  all('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',b.dataset.mode===mode);});
  try {
    const t=previewTotals(),unit=game==='dlt'&&$('additional').checked?3:2;
    $('plan-cost').innerHTML=`¥${amount(t.cost)}<small>.00</small>`;
    $('plan-detail').textContent=`${amount(t.combinations)} 注 × ${unit} 元 × ${$('multiplier').value} 倍`;
    $('plan-probability').textContent=odds(t.jackpot);errorAt('form-error','');
  } catch { $('plan-cost').textContent='—';$('plan-detail').textContent='请检查输入范围';$('plan-probability').textContent='—'; }
}
function renderPlan() {
  const p=currentPlan,t=planTotals(p),g=GAMES[p.game];
  $('result-tag').textContent=p.mode==='compound'?`${p.tickets[0].main.length} + ${p.tickets[0].extra.length} 复式`:`${p.tickets.length} 注单式`;
  $('generation-meta').textContent=`${strategyNames[p.strategy]||'参考选号'} · ${g.name} · ${p.multiplier} 倍${p.game==='dlt'?p.additional?' · 已追加':' · 不追加':''} · 共 ${amount(t.cost)} 元`;
  $('results').innerHTML=ticketRows(p.tickets,true);$('save-plan').disabled=false;$('save-plan').innerHTML='保存本组号码 <span aria-hidden="true">＋</span>';
}
function generate() {
  try {
    errorAt('form-error','');
    currentPlan={...generatePlan(options(),data.games[game].draws),id:crypto.randomUUID(),createdAt:new Date().toISOString()};
    renderPlan();
  } catch(e) {errorAt('form-error',e.message);}
}
function setGame(next) {
  if(!GAMES[next])return;
  const changed=next!==game;game=next;
  if(changed){$('main-size').value=game==='ssq'?7:6;$('extra-size').value=game==='ssq'?2:3;$('additional').checked=false;$('target-issue').value='';historyLimit=20;}
  all('[data-game]').forEach(b=>{b.classList.toggle('active',b.dataset.game===game);b.setAttribute('aria-pressed',b.dataset.game===game);});
  renderConfig();renderLatest();renderHistory();rules?.render(game);
  if(changed && currentPlan)generate();
  if(!fetchedState[game])refreshData(game);
}
function setView(next) {
  if(!['generate','saved','history','rules'].includes(next))next='generate';view=next;
  all('.view-section').forEach(el=>el.hidden=el.id!==`view-${next}`);
  all('nav [data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===next);if(b.dataset.view===next)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  if(location.hash!==`#${next}`)history.replaceState(null,'',`#${next}`);
  if(next==='saved')renderSaved();if(next==='history')renderHistory();if(next==='rules')rules?.render(game);
  window.scrollTo(0,0);
}
function renderLatest() {
  if(!data)return;
  const draw=data.games[game].draws[0];
  $('latest-game').textContent=GAMES[game].name;$('latest-issue').textContent=`第 ${draw.issue} 期`;$('latest-date').textContent=draw.date;$('latest-balls').innerHTML=balls(draw);
  $('data-state').textContent=loading.has(game)?'正在查询官方数据…':fetchedState[game]||`内置快照 · ${data.snapshotDate} 采集`;
  $('refresh-button').disabled=loading.has(game);
}
async function refreshData(which=game) {
  if(loading.has(which))return;loading.add(which);renderLatest();
  try {
    const response=await fetch(`/api/draws?game=${which}`,{signal:AbortSignal.timeout(13000)}),result=await response.json();
    if(!response.ok||result.fallback)throw new Error();
    data.games[which].draws=mergeDraws(which,data.games[which].draws,result.draws);
    fetchedState[which]=`已查询官方数据 · ${new Date(result.checkedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`;
    try { const cached=JSON.parse(localStorage.getItem(CACHE)||'{}');cached[which]=result.draws;localStorage.setItem(CACHE,JSON.stringify(cached)); }catch{}
  }catch{fetchedState[which]='官方源暂不可用 · 显示已收录数据';}
  finally{loading.delete(which);if(which===game){renderLatest();if(view==='history')renderHistory();}}
}
function renderSaved() {
  $('saved-count').textContent=saved.length;
  if(!saved.length){$('saved-list').innerHTML='<div class="empty-state"><div class="empty-symbol" aria-hidden="true">✦</div><h3>把期待，留在这里</h3><p>生成一组参考号码并保存，开奖后就能回来核对。</p><button class="button button-dark" data-view="generate">去生成一组 →</button></div>';return;}
  $('saved-list').innerHTML=[...saved].reverse().map(entry=>{
    const g=GAMES[entry.game],t=planTotals(entry),label=entry.mode==='compound'?`${entry.tickets[0].main.length} + ${entry.tickets[0].extra.length} 复式`:`${entry.tickets.length} 注单式`;
    const check=entry.lastCheck;const status=check?`${check.manual?'手动核对 · ':''}${check.issue} 期 · ${check.winningBets?'中 '+check.winningBets+' 注':'未中常规奖'}`:'尚未核对';
    return `<article class="panel saved-card"><div class="saved-card-head"><div><h3>${g.name} <span class="muted">/</span> ${label}</h3><p class="saved-meta">${escape(dateLabel(entry.createdAt))} · ${entry.multiplier} 倍${entry.additional?' · 已追加':''} · ${amount(t.cost)} 元${entry.targetIssue?' · 目标 '+escape(entry.targetIssue)+' 期':''}</p></div><span class="saved-status ${check?.winningBets?'won':''}">${escape(status)}</span></div><div class="saved-preview"><div class="ball-row">${balls(entry.tickets[0])}</div>${entry.tickets.length>1?`<span>及另外 ${entry.tickets.length-1} 注</span>`:''}</div>${entry.tickets.length>1?`<details><summary>展开全部号码</summary>${ticketRows(entry.tickets)}</details>`:''}<div class="saved-actions"><div class="button-group"><button class="button button-dark" data-check="${escape(entry.id)}">核对开奖 →</button><button class="button button-outline" data-export="${escape(entry.id)}">导出号码 ↓</button></div><button class="danger-link" data-delete="${escape(entry.id)}">删除方案</button></div></article>`;
  }).join('');
}
function renderHistory() {
  if(!data)return;
  const g=GAMES[game],info=data.games[game],zone=$('frequency-zone').value;
  $('frequency-zone').options[0].textContent=g.mainLabel;$('frequency-zone').options[1].textContent=g.extraLabel;
  const sample=$('frequency-window').value==='all'?info.draws.length:Number($('frequency-window').value);
  const stats=statistics(info.draws,game,zone,sample),min=Math.min(...stats.map(s=>s.count)),max=Math.max(...stats.map(s=>s.count));
  const actual=Math.min(sample,info.draws.length),n=zone==='main'?g.mainN:g.extraN,k=zone==='main'?g.mainK:g.extraK;
  $('frequency-caption').textContent=`${actual} 期样本 · 每个号码理论平均 ${(actual*k/n).toFixed(1)} 次`;
  $('frequency-grid').innerHTML=stats.map(s=>`<button class="frequency-tile" data-number="${s.number}" aria-label="${pad(s.number)}号，出现${s.count}次，当前遗漏${s.omission}期" aria-pressed="false" style="--strength:${8+Math.round(35*(s.count-min)/(max-min||1))}%"><strong>${pad(s.number)}</strong><span>${s.count} 次</span></button>`).join('');
  $('frequency-detail').textContent='选择一个号码查看详情。';
  $('study-range').textContent=`研究区间 ${info.study.from}—${info.study.to} · ${info.study.count} 期`;
  $('study-table').innerHTML=info.study.backtests.map(row=>`<tr><td>${escape(row.name)}</td><td>${row.mean.toFixed(3)}</td><td>${row.baseline.toFixed(3)}</td></tr>`).join('');
  $('single-jackpot').textContent=`1 / ${amount(g.total)}`;$('single-any').textContent=game==='ssq'?'6.709%':'6.670%';
  $('history-source').textContent=game==='ssq'?'来源：中国福彩网':'来源：甘肃体彩网';
  $('history-table').innerHTML=info.draws.slice(0,historyLimit).map(row=>`<tr><td>${escape(row.issue)}<small>${escape(row.date)}</small></td><td><div class="ball-row">${balls(row)}</div></td></tr>`).join('');
  $('history-more').hidden=historyLimit>=info.draws.length;
}
function openCheck(id) {
  activeEntry=saved.find(r=>r.id===id);if(!activeEntry)return;
  const g=GAMES[activeEntry.game];manualCheck=false;
  $('check-plan-label').textContent=`${g.name} · ${planTotals(activeEntry).combinations} 注基本组合 · ${activeEntry.multiplier} 倍${activeEntry.additional?' · 已追加':''}`;
  $('check-issue').innerHTML='<option value="">开奖后，选择对应期号</option>'+data.games[activeEntry.game].draws.map(r=>`<option value="${r.issue}">${r.issue} 期 · ${r.date}</option>`).join('');
  if(activeEntry.targetIssue&&data.games[activeEntry.game].draws.some(r=>r.issue===activeEntry.targetIssue))$('check-issue').value=activeEntry.targetIssue;
  $('manual-issue').value=activeEntry.targetIssue||'';$('manual-main').value='';$('manual-extra').value='';
  $('manual-main-label').textContent=`${g.mainLabel}号码（${g.mainK}个）`;$('manual-extra-label').textContent=`${g.extraLabel}号码（${g.extraK}个）`;
  $('check-result').innerHTML='';errorAt('check-error','');renderCheckMode();renderCheckPreview();$('check-dialog').showModal();
}
function renderCheckMode() {
  $('official-check-fields').hidden=manualCheck;$('manual-check-fields').hidden=!manualCheck;
  $('check-official-mode').classList.toggle('active',!manualCheck);$('check-manual-mode').classList.toggle('active',manualCheck);
  $('check-official-mode').setAttribute('aria-pressed',!manualCheck);$('check-manual-mode').setAttribute('aria-pressed',manualCheck);
  $('check-result').innerHTML='';errorAt('check-error','');
}
function renderCheckPreview() { const row=data.games[activeEntry.game].draws.find(r=>r.issue===$('check-issue').value);$('check-draw-preview').innerHTML=row?balls(row):''; }
function parseNumbers(value) { return value.trim().split(/[\s,，、;；]+/).filter(Boolean).map(Number).sort((a,b)=>a-b); }
function performCheck() {
  try {
    errorAt('check-error','');let draw;
    if(manualCheck){draw={issue:canonicalIssue(activeEntry.game,$('manual-issue').value),main:parseNumbers($('manual-main').value),extra:parseNumbers($('manual-extra').value)};if(!validateDraw(activeEntry.game,draw))throw new Error('请检查开奖号码的数量、范围与重复号码');}
    else{draw=data.games[activeEntry.game].draws.find(r=>r.issue===$('check-issue').value);if(!draw)throw new Error('请先选择对应的开奖期号');}
    if(activeEntry.targetIssue&&activeEntry.targetIssue!==draw.issue)throw new Error(`该方案目标为 ${activeEntry.targetIssue} 期，请选择相同期号核对`);
    const result=checkEntry(activeEntry,draw);
    const ranks=Object.entries(result.ranks).map(([rank,count])=>`<div><span>${rankNames[rank]}</span><strong>${amount(count)} 注</strong></div>`).join('');
    const money=result.allAmountsKnown?`按该期公告奖金合计 ¥${amount(result.knownAmount)}（税前）`:result.winningBets?'已确认奖级与注数，奖金请查对应期开奖公告。':'';
    $('check-result').innerHTML=`<div class="check-summary ${result.winningBets?'won':''}"><h3>${result.winningBets?'中得 '+amount(result.winningBets)+' 注常规奖':'未中常规奖'}</h3><p>第 ${escape(draw.issue)} 期 · ${manualCheck?'手动输入奖号':'已收录官方开奖'}</p><div class="check-ranks">${ranks}</div>${result.additionalWinningBets?`<p>其中 ${result.additionalWinningBets} 注享有追加奖金权益。</p>`:''}<p>${money}</p><small>方案金额 ¥${amount(result.total.cost)} · 倍投已计入中奖注数${activeEntry.game==='dlt'?' · '+(Number(draw.issue)>=26014?'七奖级规则':'历史九奖级规则'):''}</small></div>`;
    const lastCheck={issue:draw.issue,manual:manualCheck,winningBets:result.winningBets,ranks:result.ranks,checkedAt:new Date().toISOString()};
    try{writeSaved(saved.map(r=>r.id===activeEntry.id?{...r,lastCheck}:r));}catch{toast('核对完成，浏览器空间不足，核对记录未保存');}
  }catch(e){errorAt('check-error',e.message);$('check-result').innerHTML='';}
}
function safeImported(raw) {
  if(!raw||raw.version!==1||!Array.isArray(raw.entries)||raw.entries.length>200)throw new Error('不是有效的拾数备份文件');
  return raw.entries.map(entry=>{
    if(!validateEntry(entry))throw new Error('备份包含不合法的号码或投注参数');
    let targetIssue='';if(entry.targetIssue)targetIssue=canonicalIssue(entry.game,entry.targetIssue);
    return {id:crypto.randomUUID(),game:entry.game,mode:entry.mode,multiplier:entry.multiplier,additional:entry.additional,strategy:Object.hasOwn(strategyNames,entry.strategy)?entry.strategy:'random',tickets:entry.tickets.map(t=>({main:[...t.main].sort((a,b)=>a-b),extra:[...t.extra].sort((a,b)=>a-b)})),targetIssue,createdAt:typeof entry.createdAt==='string'&&!Number.isNaN(Date.parse(entry.createdAt))?entry.createdAt:new Date().toISOString()};
  });
}
function wire() {
  document.addEventListener('click',event=>{
    const viewButton=event.target.closest('[data-view]');if(viewButton)setView(viewButton.dataset.view);
    const gameButton=event.target.closest('[data-game]');if(gameButton)setGame(gameButton.dataset.game);
    const modeButton=event.target.closest('[data-mode]');if(modeButton){mode=modeButton.dataset.mode;renderConfig();}
    const copyButton=event.target.closest('[data-copy]');if(copyButton&&currentPlan)copy(ticketText({...currentPlan,tickets:[currentPlan.tickets[Number(copyButton.dataset.copy)]]}));
    const checkButton=event.target.closest('[data-check]');if(checkButton)openCheck(checkButton.dataset.check);
    const exportButton=event.target.closest('[data-export]');if(exportButton){const entry=saved.find(r=>r.id===exportButton.dataset.export);if(entry)download(`${GAMES[entry.game].name}-${entry.targetIssue||'参考号码'}.txt`,ticketText(entry));}
    const deleteButton=event.target.closest('[data-delete]');if(deleteButton){try{writeSaved(saved.filter(r=>r.id!==deleteButton.dataset.delete));toast('方案已删除');}catch{toast('删除失败，请检查浏览器存储');}}
    const closeButton=event.target.closest('[data-close]');if(closeButton)$(closeButton.dataset.close).close();
    const numberButton=event.target.closest('[data-number]');if(numberButton){const limit=$('frequency-window').value==='all'?data.games[game].draws.length:Number($('frequency-window').value);const s=statistics(data.games[game].draws,game,$('frequency-zone').value,limit).find(r=>r.number===Number(numberButton.dataset.number));all('[data-number]').forEach(b=>b.setAttribute('aria-pressed',b===numberButton));$('frequency-detail').textContent=`${pad(s.number)} 号 · 样本内出现 ${s.count} 次 · 当前连续遗漏 ${s.omission}${s.omission===Math.min(limit,data.games[game].draws.length)?'期及以上':'期'}。遗漏不代表下一期更容易开出。`;}
  });
  $('generate-form').addEventListener('submit',e=>{e.preventDefault();generate();});
  ['strategy','ticket-count','main-size','extra-size','multiplier','additional','spread'].forEach(id=>$(id).addEventListener('input',renderConfig));
  $('copy-all').addEventListener('click',()=>currentPlan&&copy(ticketText(currentPlan)));
  $('save-plan').addEventListener('click',()=>{
    if(!currentPlan)return;
    try{const targetIssue=$('target-issue').value.trim()?canonicalIssue(currentPlan.game,$('target-issue').value):'';if(saved.some(r=>r.id===currentPlan.id)){toast('这组号码已经保存');return;}writeSaved([...saved,{...currentPlan,targetIssue}]);$('save-plan').textContent='已保存 ✓';toast('已保存到「我的号码」');}catch(e){toast(e.message.includes('期号')?e.message:'保存失败：请检查浏览器存储，或先导出备份');}
  });
  $('refresh-button').addEventListener('click',()=>refreshData());
  $('export-saved').addEventListener('click',()=>{if(!saved.length){toast('还没有保存的号码');return;}download('拾数-号码备份.json',JSON.stringify({version:1,exportedAt:new Date().toISOString(),entries:saved},null,2),'application/json');});
  $('import-saved').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>5_000_000)throw new Error('备份文件超过5MB');const entries=safeImported(JSON.parse(await file.text()));writeSaved([...saved,...entries]);toast(`已导入 ${entries.length} 组方案，核对记录请重新验证`);}catch(e){toast(e.message||'导入失败');}finally{e.target.value='';}});
  ['frequency-zone','frequency-window'].forEach(id=>$(id).addEventListener('change',renderHistory));
  $('history-more').addEventListener('click',()=>{historyLimit+=20;renderHistory();});
  $('check-official-mode').addEventListener('click',()=>{manualCheck=false;renderCheckMode();});$('check-manual-mode').addEventListener('click',()=>{manualCheck=true;renderCheckMode();});
  $('check-issue').addEventListener('change',()=>{renderCheckPreview();$('check-result').innerHTML='';});
  ['manual-issue','manual-main','manual-extra'].forEach(id=>$(id).addEventListener('input',()=>$('check-result').innerHTML=''));
  $('check-form').addEventListener('submit',e=>{e.preventDefault();performCheck();});
  $('check-rules').addEventListener('click',()=>{
    if(!activeEntry)return;
    const issue=manualCheck?$('manual-issue').value:$('check-issue').value;
    $('check-dialog').close();setGame(activeEntry.game);rules.selectIssue(activeEntry.game,issue);setView('rules');
  });
  ['about-button','footer-about'].forEach(id=>$(id).addEventListener('click',()=>$('about-dialog').showModal()));
  window.addEventListener('hashchange',()=>setView(location.hash.slice(1)));
  window.addEventListener('storage',event=>{if(event.key===STORE){readSaved();renderSaved();}});
}
async function init() {
  try {
    const response=await fetch('/history.json');if(!response.ok)throw new Error();data=await response.json();
    try{const cached=JSON.parse(localStorage.getItem(CACHE)||'{}');for(const which of Object.keys(GAMES))if(Array.isArray(cached[which]))data.games[which].draws=mergeDraws(which,data.games[which].draws,cached[which]);}catch{}
    rules=setupRules();readSaved();wire();renderConfig();renderSaved();renderLatest();renderHistory();generate();setView(location.hash.slice(1)||'generate');refreshData();
    cloud=setupCloudSync({getEntries:()=>saved,onEntries:entries=>{saved=entries;try{localStorage.setItem(STORE,JSON.stringify(saved));}catch{}renderSaved();},notify:toast});
  }catch{errorAt('page-error','历史数据未能加载，请刷新页面重试。');$('generate-button').disabled=true;$('results').innerHTML='<div class="loading">数据加载失败</div>';}
}
init();
