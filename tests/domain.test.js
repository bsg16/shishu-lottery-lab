import test from 'node:test';
import assert from 'node:assert/strict';
import { choose, prizeRank, checkEntry, planTotals, generatePlan, validateEntry, ticketKey, mergeDraws, canonicalIssue } from '../public/domain.js';
import { normalize } from '../worker.js';
const base = {game:'dlt',mode:'compound',multiplier:1,additional:false,tickets:[{main:[1,2,3,4,5,6],extra:[1,2,3]}]};
const draw = {issue:'26122',main:[1,2,3,4,5],extra:[1,2]};
function combinations(values,k) {
  if(!k)return [[]];
  return values.flatMap((v,i)=>combinations(values.slice(i+1),k-1).map(rest=>[v,...rest]));
}
test('compound cost, additional and multiplier use elementary ticket counts',()=>{
  assert.equal(choose(35,5)*choose(12,2),21425712);
  assert.deepEqual(planTotals(base),{combinations:18,bets:18,cost:36,jackpot:18/21425712});
  assert.equal(planTotals({...base,multiplier:3,additional:true}).cost,162);
  assert.equal(planTotals({...base,multiplier:3,additional:true}).jackpot,planTotals(base).jackpot);
});
test('6+3 results match independently expanded elementary tickets',()=>{
  const result=checkEntry({...base,multiplier:2,additional:true},draw);
  assert.deepEqual(result.ranks,{1:2,2:4,3:10,4:20});
  assert.equal(result.winningBets,36);assert.equal(result.additionalWinningBets,6);
  const ranks={};
  for(const main of combinations(base.tickets[0].main,5))for(const extra of combinations(base.tickets[0].extra,2)){
    const rank=prizeRank('dlt',main.filter(n=>draw.main.includes(n)).length,extra.filter(n=>draw.extra.includes(n)).length,draw.issue);
    if(rank)ranks[rank]=(ranks[rank]||0)+2;
  }
  assert.deepEqual(result.ranks,ranks);
});
test('SSQ compound 7+2 has fourteen elementary bets with correct tiers',()=>{
  const entry={game:'ssq',mode:'compound',multiplier:1,additional:false,tickets:[{main:[1,2,3,4,5,6,7],extra:[1,2]}]};
  assert.equal(planTotals(entry).cost,28);
  assert.deepEqual(checkEntry(entry,{issue:'2026122',main:[1,2,3,4,5,6],extra:[1]}).ranks,{1:1,2:1,3:6,4:6});
});
test('historical DLT rules switch at 26014, special SSQ prize is excluded',()=>{
  assert.equal(prizeRank('dlt',4,2,'26013'),4);
  assert.equal(prizeRank('dlt',4,2,'26014'),3);
  assert.equal(prizeRank('dlt',3,0,'25092'),9);
  assert.equal(prizeRank('dlt',3,0,'26122'),7);
  assert.equal(prizeRank('ssq',3,0,'2026122'),0);
  assert.equal(prizeRank('ssq',0,1,'2026122'),6);
  assert.equal(canonicalIssue('dlt','2026122'),'26122');
  assert.throws(()=>canonicalIssue('ssq','26122'));
});
test('validation rejects malformed, duplicate and out-of-range selections',()=>{
  assert.equal(validateEntry({...base,multiplier:0}),false);
  assert.equal(validateEntry({...base,tickets:[{main:[1,1,2,3,4,5],extra:[1,2]}]}),false);
  assert.equal(validateEntry({...base,tickets:[{main:[1,2,3,4,5,36],extra:[1,2]}]}),false);
  assert.equal(validateEntry({...base,mode:'single'}),false);
  assert.throws(()=>checkEntry(base,{...draw,extra:[1,1]}));
});
test('generators produce legal unique tickets and spread blue coverage',()=>{
  for(const game of ['ssq','dlt'])for(const strategy of ['random','hot','cold','overdue']){
    const plan=generatePlan({game,mode:'single',strategy,count:50,multiplier:1,additional:false,spread:true});
    assert.equal(validateEntry(plan),true);assert.equal(new Set(plan.tickets.map(ticketKey)).size,50);
    if(game==='ssq')assert.equal(new Set(plan.tickets.slice(0,16).map(t=>t.extra[0])).size,16);
    else assert.equal(new Set(plan.tickets.map(t=>t.extra.join(','))).size,50);
  }
});
test('duplicate basic tickets do not increase jackpot coverage',()=>{
  const ticket={main:[1,2,3,4,5],extra:[1,2]};
  const result=planTotals({...base,mode:'single',tickets:[ticket,ticket]});
  assert.equal(result.cost,4);assert.equal(result.jackpot,1/21425712);
});
test('actual amounts require a published award and keep additional awards unestimated',()=>{
  const entry={...base,mode:'single',tickets:[{main:[1,2,3,4,5],extra:[1,2]}]};
  assert.equal(checkEntry(entry,{...draw,prizes:{1:5000000}}).knownAmount,5000000);
  assert.equal(checkEntry(entry,draw).allAmountsKnown,false);
  assert.equal(checkEntry({...entry,additional:true},{...draw,prizes:{1:5000000}}).allAmountsKnown,false);
});
test('provider adapter validates data and merges by issue',()=>{
  const raw={code:'000000',data:{prize_history_list:[{issue_num:'26122',prize_time:'2026-10-26',prize_num:['01','02','03','04','05','01','02']} ]}};
  const normalized=normalize('dlt',raw);assert.equal(normalized[0].main[4],5);
  assert.equal(mergeDraws('dlt',normalized,normalized).length,1);
  assert.throws(()=>normalize('dlt',{code:'error'}));
  raw.data.prize_history_list[0].prize_num[0]='99';assert.throws(()=>normalize('dlt',raw));
});
