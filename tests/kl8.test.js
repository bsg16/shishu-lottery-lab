import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generatePlan,validateEntry,validateDraw,planTotals,checkEntry,prizeRank,canonicalIssue,ticketKey,ticketText,choose} from '../public/domain.js';
import {kl8Distribution,kl8RankName} from '../public/kl8.js';
import {exactCoverage,generateCoveragePlan} from '../public/coverage.js';
import {normalize,normalizeSichuanKl8,fetchDraws,drawsResponse,PROVIDERS} from '../server/draws.js';
import {emptyDocument,reconcileEntries,mergeDocuments,entriesFrom,newSyncCode,syncKeys,encryptDocument,decryptDocument} from '../public/sync-model.js';
const cwl=JSON.parse(await readFile(new URL('fixtures/cwl-kl8.json',import.meta.url)));
const html=await readFile(new URL('fixtures/sichuan-kl8.html',import.meta.url),'utf8');
const range=(n,start=1)=>Array.from({length:n},(_,i)=>start+i);
const entry=(pick,main=range(pick),mode='single',multiplier=1)=>({game:'kl8',pick,mode,multiplier,additional:false,tickets:[{main,extra:[]}]});
const draw=(main=range(20))=>({issue:'2026291',main,extra:[]});
function subsets(values,k){const result=[];function walk(start,current){if(current.length===k){result.push(current);return;}for(let i=start;i<=values.length-(k-current.length);i++)walk(i+1,[...current,values[i]]);}walk(0,[]);return result;}

test('KL8 validates ten distinct play types, twenty drawn balls and official ticket limits',()=>{
  for(let pick=1;pick<=10;pick++){assert.ok(validateEntry(entry(pick)));assert.equal(planTotals(entry(pick)).cost,2);}
  for(const pick of [0,11,1.5,undefined])assert.equal(validateEntry(entry(pick)),false);
  assert.ok(validateDraw('kl8',draw()));assert.equal(validateDraw('kl8',draw(range(10))),false);
  assert.equal(validateDraw('kl8',draw([...range(19),81])),false);
  assert.equal(validateDraw('kl8',{...draw(),extra:[1]}),false);
  assert.equal(validateEntry({...entry(10),additional:true}),false);
  assert.equal(validateEntry(entry(10,range(10),'single',16)),false);
  assert.equal(validateEntry(entry(10,range(10),'compound')),false);
  assert.equal(planTotals(entry(10,range(15),'compound',3)).bets,9009);
  assert.equal(validateEntry(entry(10,range(15),'compound',4)),false);
  assert.equal(canonicalIssue('kl8','2026291'),'2026291');
  assert.throws(()=>canonicalIssue('kl8','26291'));
});

test('KL8 award categories include zero-hit returns only for pick seven through ten',()=>{
  const winningHits={1:[1],2:[2],3:[2,3],4:[2,3,4],5:[3,4,5],6:[3,4,5,6],7:[0,4,5,6,7],8:[0,4,5,6,7,8],9:[0,4,5,6,7,8,9],10:[0,5,6,7,8,9,10]};
  for(let pick=1;pick<=10;pick++)for(let hits=0;hits<=pick;hits++){
    const expected=winningHits[pick].includes(hits)?`x${pick}z${hits}`:0;
    assert.equal(prizeRank('kl8',hits,0,'2026291',pick),expected);
  }
  assert.equal(kl8RankName('x10z0'),'选十全不中');
  assert.throws(()=>checkEntry(entry(10),{...draw(),issue:'2025349'}),/2025350/);
});

test('KL8 compound settlement agrees with explicit basic-bet expansion for all play types',()=>{
  for(let pick=1;pick<=10;pick++)for(let hits=0;hits<=pick+2;hits++){
    const pool=range(pick+2),d=draw([...pool.slice(0,hits),...range(20-hits,40)]);
    const expanded={...entry(pick),multiplier:3,tickets:subsets(pool,pick).map(main=>({main,extra:[]}))};
    // Expansion can exceed the UI 50-row limit; independently settle one row at a time.
    const expected={};for(const t of expanded.tickets)for(const [rank,n] of Object.entries(checkEntry({...expanded,tickets:[t]},d).ranks))expected[rank]=(expected[rank]||0)+n;
    assert.deepEqual(checkEntry(entry(pick,pool,'compound',3),d).ranks,expected);
  }
  const p=entry(10,range(11),'compound'),d={...draw([...range(5),...range(15,40)]),prizes:{x10z5:3}};
  const result=checkEntry(p,d);assert.equal(result.winningBets,6);assert.equal(result.knownAmount,18);assert.equal(result.total.cost,22);
});

test('KL8 uses published decimal and floating amounts, never substitutes prize ceilings',()=>{
  const d=normalize('kl8',cwl)[0];
  assert.equal(checkEntry(entry(1,[d.main[0]]),d).knownAmount,4.5);
  assert.equal(checkEntry(entry(9,d.main.slice(0,9)),d).knownAmount,250000);
  assert.equal(checkEntry(entry(10,d.main.slice(0,10)),d).allAmountsKnown,false);
  assert.equal(checkEntry(entry(1,[d.main[0]]),{...d,prizes:{x1z1:3.25}}).knownAmount,3.25);
  assert.equal(checkEntry(entry(1,[d.main[0]]),{...d,prizes:undefined}).allAmountsKnown,false);
});

test('KL8 probability distribution sums to one and keeps multiple-ticket probability unknown',()=>{
  for(let pick=1;pick<=10;pick++){
    const rows=kl8Distribution(pick);
    assert.ok(Math.abs(rows.reduce((n,r)=>n+r.probability,0)-1)<1e-12);
    assert.ok(Math.abs(rows.reduce((n,r)=>n+r.hits*r.probability,0)-pick/4)<1e-12);
    assert.equal(rows.at(-1).probability,choose(20,pick)/choose(80,pick));
  }
  const probability=kl8Distribution(10).filter(r=>r.wins).reduce((n,r)=>n+r.probability,0);
  const comb=(n,k)=>{let v=1n;for(let i=1;i<=k;i++)v=v*BigInt(n-i+1)/BigInt(i);return v;};
  const exact=[0,5,6,7,8,9,10].reduce((v,h)=>v+comb(20,h)*comb(60,10-h),0n);
  assert.ok(Math.abs(probability-Number(exact)/Number(comb(80,10)))<1e-15);
  assert.equal(planTotals(entry(10)).jackpot,null);
  assert.throws(()=>exactCoverage(entry(10)),/暂不支持/);
  assert.throws(()=>generateCoveragePlan({game:'kl8'}),/快乐8/);
});

test('KL8 generators preserve pick, deduplicate tickets and copy without an empty second zone',()=>{
  for(let pick=1;pick<=10;pick++)for(const strategy of ['random','hot','cold','overdue']){
    const p=generatePlan({game:'kl8',pick,mode:'single',count:50,multiplier:15,additional:false,strategy,spread:true},normalize('kl8',cwl));
    assert.ok(validateEntry(p));assert.equal(p.pick,pick);assert.equal(new Set(p.tickets.map(ticketKey)).size,50);
    assert.equal(ticketText(p).includes('+'),false);assert.equal(planTotals(p).cost,1500);
  }
});

test('both official KL8 adapters validate dates and draws; mislabeled provincial prizes stay unconfirmed',()=>{
  const primary=normalize('kl8',cwl),backup=normalizeSichuanKl8(html);
  assert.equal(primary.length,2);assert.equal(backup.length,2);
  assert.deepEqual(backup[0].main,primary[0].main);assert.equal(backup[0].issue,primary[0].issue);
  assert.equal(backup[0].prizes,undefined);assert.equal(primary[0].prizes.x7z5,30);
  for(const mutate of [r=>r.result[0].red='01,01',r=>r.result[0].date='2026-02-30',r=>r.result[0].prizegrades.pop()]){const raw=structuredClone(cwl);mutate(raw);assert.throws(()=>normalize('kl8',raw));}
  assert.throws(()=>normalizeSichuanKl8(html.replace('2026-11-01','2026-11-40')));
  assert.throws(()=>normalizeSichuanKl8(html.replace('id="1x10"','id="0x10"')));
});

test('KL8 fallback remains usable and force refresh bypasses stale edge cache',async()=>{
  const fallback=await fetchDraws('kl8',async url=>url===PROVIDERS.sichuanKl8?new Response(html):new Response('',{status:503}));
  assert.equal(fallback.draws[0].issue,'2026291');assert.equal(fallback.sourceName,'四川福彩官网');
  const both=await fetchDraws('kl8',async url=>url===PROVIDERS.sichuanKl8?new Response(html):Response.json(cwl));
  assert.equal(both.sourceName,'中国福彩网');assert.equal(both.draws[0].prizes.x10z8,720);
  const promises=[];let cacheWrites=0;
  const response=await drawsResponse(new Request('https://example.test/api/draws?game=kl8&refresh=1'),{waitUntil:p=>promises.push(p)},{match:()=>{throw new Error('Must bypass cache');},put:async()=>{cacheWrites++;}},async url=>url===PROVIDERS.kl8?Response.json(cwl):new Response(html));
  assert.equal(response.status,200);assert.equal((await response.json()).draws[0].main.length,20);await Promise.all(promises);assert.equal(cacheWrites,1);
  await assert.rejects(fetchDraws('kl8',async()=>new Response('',{status:503})));
});

test('encrypted sync preserves KL8 play types alongside existing SSQ records',async()=>{
  const a={...entry(10,range(11),'compound'),id:'kl8-record',createdAt:'2026-11-02T01:00:00Z'};
  const b={game:'ssq',mode:'single',multiplier:1,additional:false,tickets:[{main:range(6),extra:[1]}],id:'old-record',createdAt:'2026-11-01T01:00:00Z'};
  const {key}=await syncKeys(newSyncCode());
  const merged=mergeDocuments(reconcileEntries(emptyDocument(),[a],'deviceA'),reconcileEntries(emptyDocument(),[b],'deviceB'));
  const restored=entriesFrom(await decryptDocument(await encryptDocument(merged,key),key));
  assert.deepEqual(restored,[b,a]);assert.equal(planTotals(restored[1]).cost,22);
});
