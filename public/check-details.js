import { gameConfig, pad, winningCombinations } from './domain.js';
import { kl8RankName } from './kl8.js';

const names=['','一等奖','二等奖','三等奖','四等奖','五等奖','六等奖','七等奖','八等奖','九等奖'];
const rankName=(game,rank)=>game==='kl8'?kl8RankName(rank):names[rank];
const amount=value=>value.toLocaleString('zh-CN',{maximumFractionDigits:2});

function matchedBalls(ticket,draw,cfg) {
  const zone=(numbers,drawn,label,extra=false)=>numbers.map(n=>{
    const hit=drawn.includes(n);
    return `<span class="ball${extra?' extra':''}${hit?' hit':' miss'}" aria-label="${label}${pad(n)}，${hit?'命中':'未命中'}">${pad(n)}${hit?'<span class="hit-mark" aria-hidden="true">✓</span>':''}</span>`;
  }).join('');
  return zone(ticket.main,draw.main,cfg.mainLabel)+(ticket.extra.length?'<span class="ball-divider" aria-hidden="true">＋</span>'+zone(ticket.extra,draw.extra,cfg.extraLabel,true):'');
}

function prizeAmount(entry,draw,rank) {
  if(!rank)return '';
  if(entry.additional&&Number(rank)<=2)return '<p class="check-ticket-money">含追加奖金权益，实际金额以当期公告为准。</p>';
  const value=draw.prizes?.[rank];
  return typeof value==='number'&&Number.isFinite(value)&&value>0
    ? `<p class="check-ticket-money">公告单注 ${amount(value)} 元 × ${entry.multiplier} 倍 = <strong>${amount(value*entry.multiplier)} 元</strong>（税前）</p>` : '';
}

function ticketCard(entry,draw,ticket,title,rank,cfg) {
  const main=ticket.main.filter(n=>draw.main.includes(n)).length,extra=ticket.extra.filter(n=>draw.extra.includes(n)).length;
  return `<article class="check-ticket${rank?' won':''}"><div class="check-ticket-heading"><h4>${title}</h4><strong class="check-ticket-rank">${rank?rankName(entry.game,rank):'未中常规奖'}</strong></div>
    <div class="ball-row check-ticket-balls">${matchedBalls(ticket,draw,cfg)}</div>
    <p class="check-ticket-hits">${cfg.mainLabel}命中 ${main} 个${cfg.extraK?` · ${cfg.extraLabel}命中 ${extra} 个`:''}${entry.multiplier>1?` · ${entry.multiplier} 倍`:''}</p>${prizeAmount(entry,draw,rank)}</article>`;
}

export function renderCheckDetails(container,entry,draw,result) {
  const cfg=gameConfig(entry),section=document.createElement('section');
  section.className='check-details';section.setAttribute('aria-label','逐注核奖明细');
  if(entry.mode==='single') {
    const winners=[],losers=[];
    entry.tickets.forEach((ticket,index)=>{
      const rank=Object.keys(result.matches[index].ranks)[0];
      (rank?winners:losers).push(ticketCard(entry,draw,ticket,`第 ${index+1} 注`,rank,cfg));
    });
    section.innerHTML=`<h3>逐注核奖明细</h3><p class="check-detail-note">编号与保存时的顺序一致。带 ✓ 的号码为命中号码。</p>
      <p class="check-detail-count">${winners.length} 注号码中奖 · ${losers.length} 注号码未中奖${entry.multiplier>1?`（上方中奖注数已乘 ${entry.multiplier} 倍）`:''}</p>
      ${winners.join('')}${losers.length?`<details class="check-losing"${winners.length?'':' open'}><summary>查看 ${losers.length} 注未中奖号码</summary>${losers.join('')}</details>`:''}`;
  } else {
    const ticket=entry.tickets[0],match=result.matches[0];
    section.innerHTML=`<h3>复式中奖明细</h3><p class="check-detail-note">原号码池包含 ${amount(result.total.combinations)} 注基本组合，每组合 ${entry.multiplier} 倍。带 ✓ 的号码为命中号码。</p>
      <div class="check-ticket"><h4>原复式号码池</h4><div class="ball-row check-ticket-balls">${matchedBalls(ticket,draw,cfg)}</div>
      <p class="check-ticket-hits">号码池中${cfg.mainLabel}命中 ${match.main} 个${cfg.extraK?` · ${cfg.extraLabel}命中 ${match.extra} 个`:''}；各基本组合分别计奖。</p></div>
      ${Object.entries(result.ranks).map(([rank,count])=>`<details class="check-combinations" data-rank="${rank}"><summary>${rankName(entry.game,rank)} · ${amount(count/entry.multiplier)} 个基本组合 × ${entry.multiplier} 倍 = ${amount(count)} 注</summary>
      <p class="check-detail-note">以下编号只表示本奖级内的查看顺序。</p><div class="check-combination-list"></div><button type="button" class="text-button check-more">再显示20个中奖组合 ↓</button><p class="check-combination-progress check-detail-note" role="status"></p></details>`).join('')}
      ${result.winningBets?'':'<p class="check-detail-note">该号码池包含的所有基本组合均未中常规奖。</p>'}`;
    section.querySelectorAll('.check-combinations').forEach(details=>{
      const rank=details.dataset.rank,total=result.ranks[rank]/entry.multiplier;
      const iterator=winningCombinations(entry,draw,rank),list=details.querySelector('.check-combination-list'),button=details.querySelector('.check-more');
      let shown=0;
      const more=()=>{
        const rows=[];
        for(let i=0;i<20&&shown<total;i++) {
          const next=iterator.next();if(next.done)break;
          rows.push(ticketCard(entry,draw,next.value,`中奖组合 ${++shown}`,next.value.rank,cfg));
        }
        list.insertAdjacentHTML('beforeend',rows.join(''));
        button.hidden=shown>=total;
        details.querySelector('.check-combination-progress').textContent=`已显示 ${amount(shown)} / ${amount(total)} 个中奖组合`;
      };
      details.addEventListener('toggle',()=>{if(details.open&&!shown)more();});
      button.addEventListener('click',more);
    });
  }
  container.append(section);
}
