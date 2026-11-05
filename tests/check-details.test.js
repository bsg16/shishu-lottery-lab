import test from 'node:test';
import assert from 'node:assert/strict';
import {checkEntry,winningCombinations,prizeRank,ticketKey} from '../public/domain.js';

const range=(n,start=1)=>Array.from({length:n},(_,i)=>i+start);
const plan=(game,tickets,options={})=>({game,tickets,mode:'single',multiplier:1,additional:false,...options});
const subsets=(values,k)=>k===0?[[]]:values.flatMap((n,i)=>subsets(values.slice(i+1),k-1).map(rest=>[n,...rest]));

test('single-bet details retain original positions, individual prize tiers and matched numbers',()=>{
  const winner={main:[1,2,3,4,5,7],extra:[8]};
  const entry=plan('ssq',[
    {main:[10,11,12,13,14,15],extra:[2]},winner,
    {main:[1,2,3,10,11,12],extra:[8]},winner
  ],{multiplier:3});
  const draw={issue:'2026125',main:[1,2,3,4,5,6],extra:[8]};
  const result=checkEntry(entry,draw);
  assert.deepEqual(result.matches.map(m=>m.ranks),[{}, {3:3},{5:3},{3:3}]);
  assert.deepEqual(result.matches[1].mainNumbers,[1,2,3,4,5]);
  assert.deepEqual(result.matches[1].extraNumbers,[8]);
  assert.deepEqual(result.matches.map(m=>m.winningBets),[0,3,3,3]);
  assert.deepEqual(result.ranks,{3:6,5:3});
  const details=[...winningCombinations(entry,draw)];
  assert.deepEqual(details.map(d=>d.ticketIndex),[1,2,3]);
  assert.deepEqual(details.map(d=>d.rank),[3,5,3]);
  assert.equal(result.winningBets,details.reduce((sum,d)=>sum+d.multiplier,0));
});

test('compound winning numbers exactly match independent full expansion in both DLT rule versions and SSQ',()=>{
  const cases=[
    {entry:plan('dlt',[{main:range(7),extra:range(4)}],{mode:'compound',multiplier:3,additional:true}),draw:{issue:'26014',main:[1,2,3,4,20],extra:[1,9]},k:5,b:2},
    {entry:plan('dlt',[{main:range(7),extra:range(4)}],{mode:'compound',multiplier:2}),draw:{issue:'26013',main:[1,2,3,4,20],extra:[1,2]},k:5,b:2},
    {entry:plan('ssq',[{main:range(8),extra:[1,2]}],{mode:'compound',multiplier:4}),draw:{issue:'2026125',main:[1,2,3,4,5,30],extra:[1]},k:6,b:1}
  ];
  for(const {entry,draw,k,b} of cases) {
    const expected=[];
    for(const main of subsets(entry.tickets[0].main,k))for(const extra of subsets(entry.tickets[0].extra,b)) {
      const rank=prizeRank(entry.game,main.filter(n=>draw.main.includes(n)).length,extra.filter(n=>draw.extra.includes(n)).length,draw.issue);
      if(rank)expected.push({main,extra,rank});
    }
    const key=row=>`${row.rank}:${ticketKey(row)}`;
    const actual=[...winningCombinations(entry,draw)],result=checkEntry(entry,draw);
    assert.deepEqual(actual.map(key).sort(),expected.map(key).sort());
    assert.equal(new Set(actual.map(key)).size,actual.length);
    assert.equal(actual.length*entry.multiplier,result.winningBets);
    for(const [rank,count] of Object.entries(result.ranks)) {
      const filtered=[...winningCombinations(entry,draw,rank)];
      assert.equal(filtered.length*entry.multiplier,count);
      assert.ok(filtered.every(row=>String(row.rank)===rank));
    }
    assert.deepEqual(result.matches[0].ranks,result.ranks);
  }
});

test('KL8 winning combinations handle all ten play types including zero-hit awards',()=>{
  for(let pick=1;pick<=10;pick++)for(const hits of [0,Math.min(pick,5),pick]) {
    const pool=range(pick+1),draw={issue:'2026291',main:[...range(hits),...range(20-hits,40)],extra:[]};
    const entry=plan('kl8',[{main:pool,extra:[]}],{pick,mode:'compound',multiplier:2});
    const expected=subsets(pool,pick).map(main=>({main,extra:[],rank:prizeRank('kl8',main.filter(n=>draw.main.includes(n)).length,0,draw.issue,pick)})).filter(row=>row.rank);
    const actual=[...winningCombinations(entry,draw)],result=checkEntry(entry,draw);
    const key=row=>`${row.rank}:${ticketKey(row)}`;
    assert.deepEqual(actual.map(key).sort(),expected.map(key).sort());
    assert.equal(actual.length*2,result.winningBets);
    if(hits===0&&pick>=7)assert.ok(actual.every(row=>row.rank===`x${pick}z0`));
  }
});

test('large compound pools yield a bounded page without expanding millions of combinations',()=>{
  const entry=plan('ssq',[{main:range(33),extra:range(16)}],{mode:'compound'});
  const draw={issue:'2026125',main:range(6),extra:[1]},iterator=winningCombinations(entry,draw,6);
  const page=Array.from({length:20},()=>iterator.next().value);
  assert.equal(new Set(page.map(ticketKey)).size,20);
  assert.ok(page.every(row=>row.rank===6&&row.main.length===6&&row.extra[0]===1));
  iterator.return();
  assert.throws(()=>[...winningCombinations(entry,{...draw,extra:[1,1]})]);
});
