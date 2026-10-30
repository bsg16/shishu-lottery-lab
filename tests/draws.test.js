import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mergeDraws } from '../public/domain.js';
import { normalize, normalizeJiangsu, normalizeSichuan, fetchDraws, drawsResponse, PROVIDERS } from '../server/draws.js';

const latest={issue:'26123',date:'2026-10-28',main:[13,18,19,20,28],extra:[9,11]};
const previous={issue:'26122',date:'2026-10-26',main:[2,14,21,22,24],extra:[2,12]};
const html=rows=>`<table><tr><td>发布日期</td><td>期号</td></tr>${rows.map(r=>`<tr><td>${r.date}</td><td>${r.issue}</td><td>${[...r.main,...r.extra].join(' ')}</td><td><a href="/cms/example.html">详细</a></td></tr>`).join('')}</table>`;
const gansu=rows=>({code:'000000',data:{prize_history_list:rows.map(r=>({issue_num:r.issue,prize_time:r.date,prize_num:[...r.main,...r.extra].map(String)}))}});
const sichuan=await readFile(new URL('./fixtures/sichuan-ssq.html',import.meta.url),'utf8');
const ssqLatest={issue:'2026124',date:'2026-10-29',main:[3,11,17,22,23,29],extra:[9],prizes:{1:6656899,2:75313,3:3000,4:200,5:10,6:5}};
const cwl=rows=>({state:0,result:rows.map(r=>({code:r.issue,date:r.date,red:r.main.join(','),blue:r.extra.join(','),prizegrades:Object.entries(r.prizes).map(([type,money])=>({type,typemoney:String(money)}))}))});

test('new issue stays first even when a cached provider date duplicates the previous date',()=>{
  const badDate={...latest,date:previous.date};
  assert.equal(mergeDraws('dlt',[previous],[badDate])[0].issue,latest.issue);
  const corrected=mergeDraws('dlt',[badDate,previous],[latest]);
  assert.equal(corrected.length,2);
  assert.deepEqual(corrected[0],latest);
});

test('official HTML adapter validates dates, counts, duplicate numbers and missing content',()=>{
  assert.deepEqual(normalizeJiangsu(html([latest,previous])),[latest,previous]);
  for(const rows of [[{...latest,date:'2026-02-30'}],[{...latest,main:[13,13,19,20,28]}],[{...latest,extra:[9]}],[{...latest,date:previous.date},previous]]) {
    assert.throws(()=>normalizeJiangsu(html(rows)));
  }
  assert.throws(()=>normalizeJiangsu('<html>verification required</html>'));
  assert.throws(()=>normalize('dlt',gansu([{...latest,date:previous.date},previous])));
});

test('a broken or incorrect-date source cannot hide the other official source',async()=>{
  const result=await fetchDraws('dlt',async url=>url===PROVIDERS.jiangsu?new Response(html([latest,previous])):Response.json(gansu([{...latest,date:previous.date},previous])));
  assert.deepEqual(result.draws[0],latest);
  assert.equal(result.sourceName,'江苏体彩网');
  const fallback=await fetchDraws('dlt',async url=>url===PROVIDERS.jiangsu?new Response('unavailable',{status:503}):Response.json(gansu([latest,previous])));
  assert.deepEqual(fallback.draws[0],latest);
  assert.equal(fallback.sourceName,'甘肃体彩网');
  await assert.rejects(fetchDraws('dlt',async()=>new Response('unavailable',{status:503})));
});

test('the newest issue wins across sources; corrected dates replace matching old records',async()=>{
  const result=await fetchDraws('dlt',async url=>url===PROVIDERS.jiangsu?new Response(html([previous])):Response.json(gansu([latest,previous])));
  assert.equal(result.draws[0].issue,'26123');
  assert.equal(result.sourceName,'甘肃体彩网');
});

test('manual refresh bypasses cached draws and replaces edge cache without browser caching',async()=>{
  let stored=Response.json({draws:[previous]}),calls=0;const pending=[];
  const cache={match:async()=>stored.clone(),put:async(_key,response)=>{stored=response;}};
  const ctx={waitUntil:promise=>pending.push(promise)};
  const fetcher=async url=>{calls++;return url===PROVIDERS.jiangsu?new Response(html([latest,previous])):Response.json(gansu([latest,previous]));};
  const cached=await drawsResponse(new Request('https://example.test/api/draws?game=dlt'),ctx,cache,fetcher);
  assert.equal((await cached.json()).draws[0].issue,'26122');assert.equal(calls,0);
  const fresh=await drawsResponse(new Request('https://example.test/api/draws?game=dlt&refresh=1'),ctx,cache,fetcher);
  assert.equal((await fresh.json()).draws[0].issue,'26123');assert.equal(calls,2);
  assert.equal(fresh.headers.get('Cache-Control'),'no-store');
  await Promise.all(pending);assert.equal((await stored.json()).draws[0].issue,'26123');
});

test('unavailable sources return an explicit failure, not a successful empty latest draw',async()=>{
  const response=await drawsResponse(new Request('https://example.test/api/draws?game=dlt&refresh=1'),{waitUntil(){}},{},async()=>new Response('',{status:503}));
  assert.equal(response.status,503);assert.equal((await response.json()).fallback,true);
});

test('Sichuan official page pairs issues, dates, ball colours and six prize amounts',()=>{
  const draws=normalizeSichuan(sichuan);
  assert.equal(draws.length,2);assert.deepEqual(draws[0],ssqLatest);
  assert.equal(draws[1].issue,'2026123');assert.equal(draws[1].date,'2026-10-27');
  assert.deepEqual(draws[1].main,[4,5,20,21,26,30]);assert.deepEqual(draws[1].extra,[12]);
  assert.equal(draws[1].prizes[1],8447916);
  assert.deepEqual(Object.keys(draws[0].prizes),['1','2','3','4','5','6']);
});

test('Sichuan parser rejects mismatched panels, missing colours, bad dates and incomplete prizes',()=>{
  for(const invalid of [
    '<html>verification required</html>',
    sichuan.replace('<option value="1">2026123</option>',''),
    sichuan.replace('value="1"','value="2"'),
    sichuan.replace('2026124','2026123'),
    sichuan.replace('2026-10-29','2026-02-30'),
    sichuan.replace('2026-10-29','2026-10-27'),
    sichuan.replace('<span>11</span>','<span>03</span>'),
    sichuan.replace('class="blue-classification"','class="red"'),
    sichuan.replace('6656899 ','未公布'),
    sichuan.replace('六等奖','福运奖')
  ])assert.throws(()=>normalizeSichuan(invalid));
});

test('SSQ continues with an official provincial source when the national API fails or returns HTML',async()=>{
  for(const broken of [()=>new Response('blocked',{status:412}),()=>new Response('<html>verification required</html>'),()=>{throw new Error('timeout');}]) {
    const result=await fetchDraws('ssq',async url=>url===PROVIDERS.sichuan?new Response(sichuan):broken());
    assert.deepEqual(result.draws[0],ssqLatest);assert.equal(result.sourceName,'四川福彩官网');
    assert.equal(result.fallback,false);assert.equal(result.sourceUrl,PROVIDERS.sichuan);
  }
});

test('SSQ chooses the newest official issue and prefers national figures on equal issues',async()=>{
  const previous=normalizeSichuan(sichuan)[1];
  const stale=await fetchDraws('ssq',async url=>url===PROVIDERS.sichuan?new Response(sichuan):Response.json(cwl([previous])));
  assert.deepEqual(stale.draws[0],ssqLatest);assert.equal(stale.sourceName,'四川福彩官网');
  const both=await fetchDraws('ssq',async url=>url===PROVIDERS.sichuan?new Response(sichuan):Response.json(cwl([ssqLatest,previous])));
  assert.equal(both.sourceName,'中国福彩网');assert.equal(both.draws.length,2);
  const primaryOnly=await fetchDraws('ssq',async url=>url===PROVIDERS.sichuan?new Response('layout changed'):Response.json(cwl([ssqLatest])));
  assert.deepEqual(primaryOnly.draws[0],ssqLatest);assert.equal(primaryOnly.sourceName,'中国福彩网');
});

test('SSQ refresh serves backup data, while a complete outage stays an explicit error',async()=>{
  const pending=[];let stored;
  const response=await drawsResponse(new Request('https://example.test/api/draws?game=ssq&refresh=1'),{waitUntil:p=>pending.push(p)},{put:async(_key,value)=>{stored=value;}},async url=>url===PROVIDERS.sichuan?new Response(sichuan):new Response('',{status:503}));
  assert.equal(response.status,200);assert.deepEqual((await response.json()).draws[0],ssqLatest);
  await Promise.all(pending);assert.equal((await stored.json()).sourceName,'四川福彩官网');
  const outage=await drawsResponse(new Request('https://example.test/api/draws?game=ssq&refresh=1'),{waitUntil(){}},{},async()=>new Response('',{status:503}));
  assert.equal(outage.status,503);assert.equal((await outage.json()).fallback,true);
});
