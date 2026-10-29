import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDraws } from '../public/domain.js';
import { normalize, normalizeJiangsu, fetchDraws, drawsResponse, PROVIDERS } from '../server/draws.js';

const latest={issue:'26123',date:'2026-10-28',main:[13,18,19,20,28],extra:[9,11]};
const previous={issue:'26122',date:'2026-10-26',main:[2,14,21,22,24],extra:[2,12]};
const html=rows=>`<table><tr><td>发布日期</td><td>期号</td></tr>${rows.map(r=>`<tr><td>${r.date}</td><td>${r.issue}</td><td>${[...r.main,...r.extra].join(' ')}</td><td><a href="/cms/example.html">详细</a></td></tr>`).join('')}</table>`;
const gansu=rows=>({code:'000000',data:{prize_history_list:rows.map(r=>({issue_num:r.issue,prize_time:r.date,prize_num:[...r.main,...r.extra].map(String)}))}});

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
