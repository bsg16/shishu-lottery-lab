import { GAMES, prizeRank, canonicalIssue } from './domain.js';

const names = ['','一等奖','二等奖','三等奖','四等奖','五等奖','六等奖','七等奖','八等奖','九等奖'];
const fixedPrizes = {
  ssq: [null,null,null,3000,200,10,5],
  current: [null,null,null,[5000,6666],[300,380],[150,200],[15,18],[5,7]],
  historical: [null,null,null,10000,3000,300,200,100,15,5]
};
const sources = {
  ssq: ['四川福彩 · 双色球游戏规则','https://www.scflcp.com.cn/yxgz/823145252.jhtml'],
  current: ['贵州体彩 · 2026年规则公告及附件','https://www.gzstycp.com/information/5835.html'],
  historical: ['江苏体彩 · 2019年规则公告','https://www.js-lottery.com/tzgg/tzgg/cms/post-86765.html']
};
const money = value => `${value.toLocaleString('zh-CN')} 元`;

export function setupRules() {
  const $ = id => document.getElementById(id);
  let game = 'ssq', renderedGame;
  const version = () => game === 'ssq' ? 'ssq' : $('rules-period').value;
  const issue = () => version() === 'historical' ? '26013' : '26014';

  function showMatch() {
    const cfg=GAMES[game], main=Number($('rules-main').value), extra=Number($('rules-extra').value);
    const rank=prizeRank(game,main,extra,issue()), value=fixedPrizes[version()][rank];
    $('rules-match-title').textContent=rank ? names[rank] : '未中常规奖';
    $('rules-match-result').classList.toggle('won',!!rank);
    let detail=`${cfg.mainLabel}中 ${main} 个，${cfg.extraLabel}中 ${extra} 个。`;
    if(rank) {
      detail+=Array.isArray(value) ? `每注基本奖金：奖池低于8亿元时 ${money(value[0])}，8亿元及以上时 ${money(value[1])}。`
        : value ? `每注基本奖金 ${money(value)}。` : '属于浮动奖，金额以该期开奖公告为准。';
    } else detail+='此命中组合不在常规奖级对照表中。';
    $('rules-match-detail').textContent=detail;
    document.querySelectorAll('#rules-table-body tr').forEach(row=>{
      row.classList.toggle('matched',Number(row.dataset.rank)===rank);
      row.querySelector('.rule-match-flag').hidden=Number(row.dataset.rank)!==rank;
    });
  }

  function render(nextGame=game) {
    game=nextGame;
    const cfg=GAMES[game], current=version()==='current';
    $('rules-period-wrap').hidden=game!=='dlt';
    $('rules-caption').textContent=`${cfg.name} · ${game==='ssq'?'六个常规奖级':current?'七奖级 · 第26014期起':'历史九奖级 · 本站支持第21123–26013期'}`;
    $('rules-legend').textContent=`下表数字表示「${cfg.mainLabel}命中个数 + ${cfg.extraLabel}命中个数」，不是选号数量；同一区内顺序不限。`;
    $('rules-main-label').textContent=`${cfg.mainLabel}命中个数`;
    $('rules-extra-label').textContent=`${cfg.extraLabel}命中个数`;
    if(renderedGame!==game) {
      $('rules-main').innerHTML=Array.from({length:cfg.mainK+1},(_,i)=>`<option value="${i}">${i} 个</option>`).join('');
      $('rules-extra').innerHTML=Array.from({length:cfg.extraK+1},(_,i)=>`<option value="${i}">${i} 个</option>`).join('');
      renderedGame=game;
    }
    $('rules-table-head').innerHTML=`<tr><th scope="col">奖级</th><th scope="col">命中条件</th>${current?'<th scope="col">奖池 &lt; 8亿</th><th scope="col">奖池 ≥ 8亿</th>':'<th scope="col">基本单注奖金</th>'}</tr>`;
    const groups=new Map();
    for(let a=cfg.mainK;a>=0;a--)for(let b=cfg.extraK;b>=0;b--) {
      const rank=prizeRank(game,a,b,issue());
      if(rank){if(!groups.has(rank))groups.set(rank,[]);groups.get(rank).push([a,b]);}
    }
    $('rules-table-body').innerHTML=[...groups].sort(([a],[b])=>a-b).map(([rank,pairs])=>{
      const value=fixedPrizes[version()][rank];
      const conditions=pairs.map(([a,b])=>`<span class="rule-pair"><b>${a}</b><span>＋</span><b class="extra">${b}</b></span>`).join('<span class="rule-or">或</span>');
      const prize=!value ? `<td${current?' colspan="2"':''}>浮动奖金<small>以该期开奖公告为准</small></td>` : Array.isArray(value) ? value.map(v=>`<td>${money(v)}</td>`).join('') : `<td>${money(value)}</td>`;
      return `<tr data-rank="${rank}"><th scope="row">${names[rank]}<span class="rule-match-flag" hidden>当前命中</span></th><td><div class="rule-conditions">${conditions}</div></td>${prize}</tr>`;
    }).join('');
    $('rules-pool-note').hidden=!current;
    $('rules-additional-title').textContent=game==='dlt'?'追加怎么算':'蓝球中了怎么算';
    $('rules-additional-note').textContent=game==='dlt'
      ?'每注基本投注2元，追加再加1元。追加只参与一、二等奖：额外奖金为对应基本单注奖金的80%，合计约为基本奖金的1.8倍；其他常规奖级不增加奖金。'
      :'蓝球命中、红球命中0–2个，为六等奖；红球命中3个及以上时，对照更高奖级。同一基本注只领取最高奖级，双色球没有大乐透式追加。';
    $('rules-example').textContent=game==='dlt'
      ?'例如大乐透6+3复式包含18注基本组合：C(6,5) × C(3,2)。基本投注36元，追加共54元。逐注核对后，可能同时中得多个奖级。'
      :'例如双色球7+2复式包含14注基本组合：C(7,6) × C(2,1)，基本投注28元。逐注核对后，可能同时中得多个奖级。';
    const [label,url]=sources[version()];$('rules-source').textContent=`${label} ↗`;$('rules-source').href=url;
    showMatch();
  }
  $('rules-period').addEventListener('change',()=>render());
  ['rules-main','rules-extra'].forEach(id=>$(id).addEventListener('change',showMatch));
  return {
    render,
    selectIssue(nextGame,value) {
      let historical=false;
      if(nextGame==='dlt'&&value)try{historical=Number(canonicalIssue(nextGame,value))<26014;}catch{}
      $('rules-period').value=historical?'historical':'current';
      render(nextGame);
    }
  };
}
