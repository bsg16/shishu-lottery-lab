import { GAMES, prizeRank, canonicalIssue } from './domain.js';
import { KL8_PRIZES, kl8Name, kl8RankName } from './kl8.js';
import { singleBetOdds, formatOdds } from './prize-probabilities.js';

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
const probabilityCell = probability => {
  const {percent,oneIn}=formatOdds(probability);
  return `<td class="rule-probability" data-label="单注概率"><strong>${percent}</strong><small>约 ${oneIn} 分之一</small></td>`;
};
const floatingPrize = rank => rank===1
  ? '浮动奖金<small>奖池＜1亿：最高500万元<br>奖池≥1亿：最高1,000万元</small>'
  : '浮动奖金<small>最高500万元</small>';
const tableHead = '<tr><th scope="col">奖级</th><th scope="col">命中条件</th><th scope="col">基本单注奖金</th><th scope="col">单注概率</th></tr>';

export function setupRules() {
  const $ = id => document.getElementById(id);
  let game = 'ssq', renderedGame, odds;
  const version = () => game === 'ssq' ? 'ssq' : $('rules-period').value;
  const issue = () => version() === 'historical' ? '26013' : '26014';

  function showOdds(pick) {
    odds=singleBetOdds(game,{issue:game==='kl8'?'2025350':issue(),pick});
    $('rules-any-probability').textContent=formatOdds(odds.anyPrize).percent;
    $('rules-no-probability').textContent=formatOdds(odds.noPrize).percent;
    $('rules-probability-note').textContent='按2元基本单注、各合法开奖组合等可能计算；每注只计最高常规奖级，同奖级的多种命中条件已合并。百分比与“分之一”均为近似值。追加、倍投不改变同一组号码的命中概率，复式和多注的整体概率不能直接套用本表。';
    $('rules-return-note').textContent=game==='kl8'&&pick>=7?'任意常规奖包含全不中返还2元；中奖不等于盈利。':'任意常规奖包含小奖；中奖不等于盈利。';
  }

  function matchOdds(rank) {
    const {percent,oneIn}=formatOdds(odds.probabilities[rank]);
    $('rules-match-probability').textContent=`${rank?'该奖级（全部命中条件合计）':'未中常规奖'}的单注概率：${percent}，约 ${oneIn} 分之一。`;
  }

  function showMatch() {
    if(game==='kl8') {
      const pick=Number($('rules-kl8-pick').value),hits=Number($('rules-main').value),rank=prizeRank(game,hits,0,'2025350',pick),value=KL8_PRIZES[pick][hits];
      $('rules-match-title').textContent=rank?kl8RankName(rank):'未中常规奖';
      $('rules-match-result').classList.toggle('won',!!rank);
      $('rules-match-detail').textContent=`${kl8Name(pick)}，命中 ${hits} 个。`+(rank?(value===null?'浮动奖金，以对应期开奖公告为准。':`常规单注奖金 ${money(value)}，限额赔付等调整以公告为准。`):'此命中情况没有常规奖。');
      matchOdds(rank);
      document.querySelectorAll('#rules-table-body tr').forEach(row=>{const matched=row.dataset.rank===rank;row.classList.toggle('matched',matched);row.querySelector('.rule-match-flag').hidden=!matched;});
      return;
    }
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
    matchOdds(rank);
    document.querySelectorAll('#rules-table-body tr').forEach(row=>{
      row.classList.toggle('matched',Number(row.dataset.rank)===rank);
      row.querySelector('.rule-match-flag').hidden=Number(row.dataset.rank)!==rank;
    });
  }

  function render(nextGame=game, selectedPick) {
    game=nextGame;
    $('rules-kl8-wrap').hidden=game!=='kl8';
    $('rules-extra').parentElement.hidden=game==='kl8';
    if(game==='kl8') {
      if(selectedPick)$('rules-kl8-pick').value=selectedPick;
      const pick=Number($('rules-kl8-pick').value);
      showOdds(pick);
      $('rules-period-wrap').hidden=true;$('rules-pool-note').hidden=true;
      $('rules-caption').textContent=`快乐8 · ${kl8Name(pick)} · 第2025350期起`;
      $('rules-legend').textContent=`每注从1–80选择${pick}个号码，与当期开出的20个号码比较；顺序不限。只计常规奖。`;
      $('rules-main-label').textContent='命中个数';
      const previous=Number($('rules-main').value);
      $('rules-main').innerHTML=Array.from({length:pick+1},(_,i)=>`<option value="${i}">${i} 个</option>`).join('');
      $('rules-main').value=Math.min(previous,pick);renderedGame=game;
      $('rules-table-head').innerHTML=tableHead;
      $('rules-table-body').innerHTML=Object.entries(KL8_PRIZES[pick]).sort(([a],[b])=>b-a).map(([hits,value])=>{
        const rank=`x${pick}z${hits}`;
        return `<tr data-rank="${rank}"><th scope="row">${kl8RankName(rank)}<span class="rule-match-flag" hidden>当前命中</span></th><td class="rule-condition" data-label="命中条件">${hits==='0'?'全部未命中':`命中 ${hits} 个`}</td><td class="rule-prize" data-label="基本单注奖金">${value===null?`浮动奖金<small>最高${pick===9?'25':'500'}万元</small>`:money(value)}</td>${probabilityCell(odds.probabilities[rank])}</tr>`;
      }).join('');
      $('rules-additional-title').textContent='全不中与复式怎么算';
      $('rules-additional-note').textContent='选七至选十全部未命中时，每基本注返还2元。选一至选六全不中时不设奖；快乐8没有追加。倍数1–15倍，每组含倍投最多10000注。';
      $('rules-example').textContent='例如选十的11号码复式包含11注，金额22元。若这11个号码中命中5个，则6注各中3元，合计18元；中得奖金也可能低于投入。';
      $('rules-source').textContent='四川福彩 · 快乐8现行游戏规则 ↗';$('rules-source').href='https://www.scflcp.com.cn/yxgz/823144315.jhtml';
      showMatch();return;
    }
    const cfg=GAMES[game], current=version()==='current';
    showOdds();
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
    $('rules-table-head').innerHTML=tableHead;
    const groups=new Map();
    for(let a=cfg.mainK;a>=0;a--)for(let b=cfg.extraK;b>=0;b--) {
      const rank=prizeRank(game,a,b,issue());
      if(rank){if(!groups.has(rank))groups.set(rank,[]);groups.get(rank).push([a,b]);}
    }
    $('rules-table-body').innerHTML=[...groups].sort(([a],[b])=>a-b).map(([rank,pairs])=>{
      const value=fixedPrizes[version()][rank];
      const conditions=pairs.map(([a,b])=>`<span class="rule-pair"><b>${a}</b><span>＋</span><b class="extra">${b}</b></span>`).join('<span class="rule-or">或</span>');
      const prize=!value ? floatingPrize(rank) : Array.isArray(value)
        ? `<span class="rule-prize-tier"><small>奖池＜8亿</small>${money(value[0])}</span><span class="rule-prize-tier"><small>奖池≥8亿</small>${money(value[1])}</span>` : money(value);
      return `<tr data-rank="${rank}"><th scope="row">${names[rank]}<span class="rule-match-flag" hidden>当前命中</span></th><td class="rule-condition" data-label="命中条件"><div class="rule-conditions">${conditions}</div></td><td class="rule-prize" data-label="基本单注奖金">${prize}</td>${probabilityCell(odds.probabilities[rank])}</tr>`;
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
  $('rules-kl8-pick').addEventListener('change',()=>render());
  ['rules-main','rules-extra'].forEach(id=>$(id).addEventListener('change',showMatch));
  return {
    render,
    selectIssue(nextGame,value,pick) {
      let historical=false;
      if(nextGame==='dlt'&&value)try{historical=Number(canonicalIssue(nextGame,value))<26014;}catch{}
      $('rules-period').value=historical?'historical':'current';
      render(nextGame,pick);
    }
  };
}
