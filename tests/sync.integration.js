import test from 'node:test';
import assert from 'node:assert/strict';
import {newSyncCode,syncKeys,emptyDocument,encryptDocument,decryptDocument} from '../public/sync-model.js';
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
