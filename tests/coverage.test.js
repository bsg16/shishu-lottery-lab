import test from 'node:test';
import assert from 'node:assert/strict';
import {exactCoverage,generateCoveragePlan} from '../public/coverage.js';
import {choose,GAMES,validateEntry,ticketKey,planTotals,prizeRank} from '../public/domain.js';

function rng(seed=13579){return()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};}
const options=(game,count=10)=>({game,count,mode:'single',multiplier:1,additional:false});
const entry=(game,tickets)=>({...options(game,tickets.length),tickets});
function allCombinations(n,k) {
  const result=[],current=[];
  function visit(start){if(current.length===k){result.push([...current]);return;}for(let v=start;v<=n-(k-current.length)+1;v++){current.push(v);visit(v+1);current.pop();}}
  visit(1);return result;
}
test('exact single coverage agrees with every official hit class',()=>{
  for(const [game,g] of Object.entries(GAMES)){
    const t={main:Array.from({length:g.mainK},(_,i)=>g.mainN-i),extra:Array.from({length:g.extraK},(_,i)=>g.extraN-i)};
    let count=0;
    for(let a=0;a<=g.mainK;a++)for(let b=0;b<=g.extraK;b++)if(prizeRank(game,a,b,game==='ssq'?'2026125':'26125'))count+=choose(g.mainK,a)*choose(g.mainN-g.mainK,g.mainK-a)*choose(g.extraK,b)*choose(g.extraN-g.extraK,g.extraK-b);
    assert.equal(exactCoverage(entry(game,[t])).winningOutcomes,count);
    assert.equal(count,game==='ssq'?1188988:1429197);
  }
});
test('SSQ construction attains the union-bound upper limit for every count below 16',()=>{
  for(let count=1;count<16;count++){
    const p=generateCoveragePlan(options('ssq',count),rng(count));
    assert.ok(validateEntry(p));assert.equal(new Set(p.tickets.map(t=>t.extra[0])).size,count);
    for(let i=0;i<count;i++)for(let j=0;j<i;j++)assert.equal(p.tickets[i].main.filter(n=>p.tickets[j].main.includes(n)).length,1);
    const maximum=count*1107568+(16-count)*count*5428;
    assert.equal(exactCoverage(p).winningOutcomes,maximum);
    assert.equal(p.coverage.winningOutcomes,maximum);
    assert.equal(p.coverage.method,'proven-optimal');
    assert.ok(p.coverage.probability>=p.coverage.baselineProbability);
  }
});
test('SSQ complete blue coverage works at count boundaries without duplicate full tickets',()=>{
  for(const count of [16,17,31,32,50]){
    const p=generateCoveragePlan(options('ssq',count),rng(count));
    assert.ok(validateEntry(p));assert.equal(p.tickets.length,count);
    assert.equal(new Set(p.tickets.map(ticketKey)).size,count);
    assert.equal(new Set(p.tickets.map(t=>t.extra[0])).size,16);
    assert.equal(exactCoverage(p).probability,1);assert.equal(p.coverage.probability,1);
    assert.equal(planTotals(p).cost,count*2);
  }
});
test('DLT union counts agree with independent enumeration of all 21,425,712 outcomes',()=>{
  const tickets=[{main:[1,2,3,34,35],extra:[11,12]},{main:[1,7,18,22,34],extra:[10,12]},{main:[4,9,16,25,33],extra:[1,2]}];
  const extraDraws=allCombinations(12,2);
  const extraHits=extraDraws.map(draw=>tickets.map(t=>t.extra.filter(n=>draw.includes(n)).length));
  // Classify front draws independently, using direct number membership. The 6^3
  // hit classes are then expanded over all 66 back draws with the rule checker.
  const classes=new Uint32Array(216);
  const membership=tickets.map(t=>new Set(t.main));
  for(let a=1;a<=31;a++)for(let b=a+1;b<=32;b++)for(let c=b+1;c<=33;c++)for(let d=c+1;d<=34;d++)for(let e=d+1;e<=35;e++){
    const hits=membership.map(set=>Number(set.has(a))+Number(set.has(b))+Number(set.has(c))+Number(set.has(d))+Number(set.has(e)));
    classes[hits[0]+6*hits[1]+36*hits[2]]++;
  }
  assert.equal(classes.reduce((a,b)=>a+b,0),324632);
  let expected=0;
  for(let code=0;code<216;code++)if(classes[code]){
    const hits=[code%6,Math.floor(code/6)%6,Math.floor(code/36)];
    for(const extra of extraHits)if(hits.some((a,i)=>prizeRank('dlt',a,extra[i],'26125')>0))expected+=classes[code];
  }
  assert.equal(exactCoverage(entry('dlt',tickets)).winningOutcomes,expected);
  assert.equal(exactCoverage(entry('dlt',[...tickets,tickets[0]])).winningOutcomes,expected);
});
test('DLT candidates retain exact counts and never underperform their own random control',()=>{
  for(const count of [2,10,50]){
    const p=generateCoveragePlan(options('dlt',count),rng(105+count));
    assert.ok(validateEntry(p));assert.equal(p.tickets.length,count);
    assert.equal(new Set(p.tickets.map(t=>t.extra.join(','))).size,count);
    assert.equal(exactCoverage(p).winningOutcomes,p.coverage.winningOutcomes);
    assert.ok(p.coverage.probability>=p.coverage.baselineProbability);
    assert.equal(p.coverage.method,'candidate-search');
    assert.equal(planTotals(p).cost,count*2);
  }
});
test('compound probabilities count draw intersections, and ignore multipliers and additional stakes',()=>{
  for(const game of ['ssq','dlt']){
    const base={...options(game),mode:'compound',mainSize:game==='ssq'?7:6,extraSize:game==='ssq'?2:3};
    const p=generateCoveragePlan(base,rng(88)),g=GAMES[game];
    let expected=0;
    for(let a=0;a<=g.mainK;a++)for(let b=0;b<=g.extraK;b++){
      // Explicitly expand a representative compound ticket against each hit
      // class; this does not use the optimizer's any-prize shortcut.
      const main=Array.from({length:base.mainSize},(_,i)=>i+1),extra=Array.from({length:base.extraSize},(_,i)=>i+1);
      const mainDraw=[...main.slice(0,a),...Array.from({length:g.mainK-a},(_,i)=>base.mainSize+i+1)];
      const extraDraw=[...extra.slice(0,b),...Array.from({length:g.extraK-b},(_,i)=>base.extraSize+i+1)];
      const hit=allCombinations(base.mainSize,g.mainK).some(m=>allCombinations(base.extraSize,g.extraK).some(e=>prizeRank(game,m.filter(n=>mainDraw.includes(n)).length,e.filter(n=>extraDraw.includes(n)).length,game==='ssq'?'2026125':'26125')));
      if(hit)expected+=choose(base.mainSize,a)*choose(g.mainN-base.mainSize,g.mainK-a)*choose(base.extraSize,b)*choose(g.extraN-base.extraSize,g.extraK-b);
    }
    assert.equal(p.coverage.method,'fixed-size');assert.equal(p.coverage.winningOutcomes,expected);
    assert.deepEqual(exactCoverage({...p,multiplier:9,additional:game==='dlt'}),exactCoverage(p));
    assert.equal(exactCoverage({...p,tickets:[{main:Array.from({length:g.mainN},(_,i)=>i+1),extra:Array.from({length:g.extraN},(_,i)=>i+1)}]}).probability,1);
  }
});
test('invalid requests fail and saved coverage metadata is never trusted for probability calculation',()=>{
  assert.throws(()=>generateCoveragePlan(options('invalid'),rng()));
  assert.throws(()=>generateCoveragePlan(options('ssq',0),rng()));
  assert.throws(()=>exactCoverage(entry('ssq',[{main:[1,1,2,3,4,5],extra:[1]}])));
  const p=generateCoveragePlan(options('ssq',10),rng());p.coverage.probability=1;
  assert.equal(exactCoverage(p).winningOutcomes,11401360);
  assert.ok(exactCoverage(p).probability<1);
});
