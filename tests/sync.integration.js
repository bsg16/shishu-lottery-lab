import test from 'node:test';
import assert from 'node:assert/strict';
import {newSyncCode,syncKeys,emptyDocument,encryptDocument,decryptDocument} from '../public/sync-model.js';
import {newShortCode,shortCodeKeys,wrapSyncCode,unwrapSyncCode} from '../public/short-code.js';
import {SyncClient} from '../public/sync-client.js';
const endpoint=`${process.env.TEST_BASE_URL||'http://localhost:8787'}/api/vault`;
test('real Worker and SQLite isolate vaults, validate requests, and reject stale writes',async()=>{
  const a=await syncKeys(newSyncCode()),b=await syncKeys(newSyncCode());
  const request=(keys,method='GET',body,extra={})=>fetch(endpoint,{method,headers:{...(keys?{Authorization:`Bearer ${keys.token}`} :{}),...(body?{'Content-Type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request()).status,401);
  assert.equal((await request(a,'GET',undefined,{Origin:'https://other.example'})).status,403);
  assert.equal((await request(a)).status,404);
  const envelope=await encryptDocument(emptyDocument(),a.key);
  assert.equal((await request(a,'POST',{revision:0,envelope})).status,201);
  assert.equal((await request(a,'POST',{revision:0,envelope})).status,409);
  const restored=await(await request(a)).json();assert.equal(restored.revision,1);
  assert.deepEqual(await decryptDocument(restored.envelope,a.key),emptyDocument());
  assert.equal((await request(b)).status,404);
  assert.equal((await request(a,'PUT',{revision:0,envelope})).status,409);
  const writes=await Promise.all([request(a,'PUT',{revision:1,envelope}),request(a,'PUT',{revision:1,envelope})]);
  assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);
  assert.equal((await request(a,'PUT',{revision:2,envelope:{v:1,iv:'invalid',ciphertext:'invalid'}})).status,400);
  assert.equal((await request(a,'DELETE')).status,405);
  assert.equal((await(await request(a)).json()).revision,2);
  if(process.env.TEST_PEER_BASE_URL) {
    const peer=new URL('/api/vault',process.env.TEST_PEER_BASE_URL);
    const headers={Authorization:`Bearer ${a.token}`,Origin:peer.origin};
    const shared=await(await fetch(peer,{headers})).json();
    assert.equal(shared.revision,2);
    assert.deepEqual(await decryptDocument(shared.envelope,a.key),emptyDocument());
    const update=await fetch(peer,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({revision:2,envelope})});
    assert.equal(update.status,200);
    assert.equal((await(await request(a)).json()).revision,3);
  }
});
test('eight-character codes restore the same real vault and work through both site entrances',async()=>{
  const legacy=newSyncCode(),vault=await syncKeys(legacy),short=newShortCode(),keys=await shortCodeKeys(short);
  const aliasEndpoint=new URL('/api/sync-code',endpoint);
  const headers={Authorization:`Bearer ${keys.token}`,'Content-Type':'application/json'};
  const wrapped=await wrapSyncCode(legacy,keys.key);
  const envelope=await encryptDocument(emptyDocument(),vault.key);
  assert.equal((await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${vault.token}`,'Content-Type':'application/json'},body:JSON.stringify({revision:0,envelope})})).status,201);
  assert.equal((await fetch(aliasEndpoint,{headers})).status,404);
  assert.equal((await fetch(aliasEndpoint,{method:'POST',headers,body:JSON.stringify({envelope:wrapped})})).status,201);
  assert.equal((await fetch(aliasEndpoint,{method:'POST',headers,body:JSON.stringify({envelope:wrapped})})).status,409);
  const resolve=async base=>{
    const response=await fetch(new URL('/api/sync-code',base),{headers:{Authorization:`Bearer ${keys.token}`,Origin:new URL(base).origin}});
    assert.equal(response.status,200);
    const restoredCode=await unwrapSyncCode((await response.json()).envelope,(await shortCodeKeys(short.toLowerCase().replace('-',''))).key);
    assert.equal(restoredCode,legacy);
    const restoredKeys=await syncKeys(restoredCode);
    const restored=await(await fetch(new URL('/api/vault',base),{headers:{Authorization:`Bearer ${restoredKeys.token}`}})).json();
    assert.deepEqual(await decryptDocument(restored.envelope,restoredKeys.key),emptyDocument());
  };
  await resolve(endpoint);
  if(process.env.TEST_PEER_BASE_URL)await resolve(process.env.TEST_PEER_BASE_URL);
});
test('custom Chinese names and changed names resolve the same vault across real site entrances',async()=>{
  const device=base=>{
    const values=new Map();let entries=[];
    return new SyncClient({storage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},fetcher:(path,options)=>fetch(new URL(path,base),options),getEntries:()=>entries,onEntries:next=>{entries=next;}});
  };
  const a=device(endpoint),b=device(process.env.TEST_PEER_BASE_URL||endpoint);
  const name=`测试_${crypto.randomUUID().slice(0,8)}`,next=`${name}_new`;
  try {
    await a.create(name);const original=a.read().code;
    await assert.rejects(b.create(name),/已被占用/);assert.equal(b.read(),null);
    await b.connect(name.toUpperCase());assert.equal(b.read().code,original);
    await a.setSyncName(next);assert.equal(a.displayCode(),next);
    b.disconnect();await b.connect(next);assert.equal(b.read().code,original);
    b.disconnect();await b.connect(name);assert.equal(b.read().code,original);
    b.disconnect();await b.connect(original);assert.equal(b.read().code,original);
  } finally {a.disconnect();b.disconnect();}
});
