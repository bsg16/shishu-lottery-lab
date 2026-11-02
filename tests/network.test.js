import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchJSON} from '../public/network.js';

test('one transient read failure retries and returns JSON without native timeout support',async()=>{
  let calls=0;
  const fetcher=async(url,options)=>{
    assert.equal(url,'/api/sync-code');
    assert.ok(options.signal instanceof AbortSignal);
    if(++calls===1)throw new TypeError('Failed to fetch');
    return Response.json({ok:true});
  };
  const {result}=await fetchJSON('/api/sync-code',{}, {fetcher,retries:1,retryDelayMs:0});
  assert.deepEqual(result,{ok:true});assert.equal(calls,2);
});

test('lost write responses are not replayed and HTTP errors are preserved for conflict handling',async()=>{
  for(const method of ['POST','PUT']) {
    let calls=0;
    await assert.rejects(fetchJSON('/api/vault',{method},{retries:1,fetcher:async()=>{calls++;throw new TypeError('lost response');}}),{code:'NETWORK'});
    assert.equal(calls,1);
  }
  let calls=0;
  const {response,result}=await fetchJSON('/api/vault',{}, {retries:1,fetcher:async()=>{calls++;return Response.json({error:'conflict'},{status:409});}});
  assert.equal(response.status,409);assert.equal(result.error,'conflict');assert.equal(calls,1);
});

test('deadline aborts stalled requests and stalled JSON bodies without relying on cancellation',async()=>{
  for(const bodyOnly of [false,true]) {
    let signal;
    const fetcher=async(url,options)=>{signal=options.signal;return bodyOnly?{json:()=>new Promise(()=>{})}:new Promise(()=>{});};
    await assert.rejects(fetchJSON('/api/vault',{}, {fetcher,timeoutMs:10}),{code:'TIMEOUT'});
    assert.equal(signal.aborted,true);
  }
});

test('successful requests clear their abort timer and HTML replies are diagnosed separately',async()=>{
  let signal;
  const fetcher=async(url,options)=>{signal=options.signal;return Response.json({ok:true});};
  await fetchJSON('/api/health',{}, {fetcher,timeoutMs:10});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(signal.aborted,false);
  let calls=0;
  await assert.rejects(fetchJSON('/api/vault',{}, {retries:1,fetcher:async()=>{calls++;return new Response('<html>unavailable</html>');}}),{code:'INVALID_RESPONSE'});
  assert.equal(calls,1);
});

test('persistent connection failures stop after the single read retry',async()=>{
  let calls=0;
  await assert.rejects(fetchJSON('/api/sync-code',{}, {retries:1,retryDelayMs:0,fetcher:async()=>{calls++;throw new TypeError('network');}}),{code:'NETWORK'});
  assert.equal(calls,2);
});
