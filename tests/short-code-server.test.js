import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { codeRateLimit, shortCodeRecord, syncCodeRequest } from '../server/sync-codes.js';

function sqlite(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  return {storage:{sql:{exec(query,...params){const rows=db.prepare(query).all(...params);return {toArray:()=>rows};}},transactionSync(action){db.exec('BEGIN IMMEDIATE');try{const result=action();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}}};
}
test('short-code guessing and creation are rate limited with independent reset windows',async t=>{
  const ctx=sqlite(t),now=1000;
  for(let i=0;i<20;i++)assert.equal(codeRateLimit(ctx,'GET',now).status,200);
  const blocked=codeRateLimit(ctx,'GET',now);assert.equal(blocked.status,429);assert.equal(blocked.headers.get('Retry-After'),'300');
  for(let i=0;i<10;i++)assert.equal(codeRateLimit(ctx,'POST',now).status,200);
  assert.equal(codeRateLimit(ctx,'POST',now).status,429);
  assert.equal(codeRateLimit(ctx,'GET',now+300000).status,200);
  assert.equal(codeRateLimit(ctx,'POST',now+300000).status,429);
  assert.equal(codeRateLimit(ctx,'POST',now+3600000).status,200);
});
test('short-code records are immutable and reject oversized or unencrypted submissions',async t=>{
  const ctx=sqlite(t),url='https://example.test/api/sync-code';
  const post=body=>shortCodeRecord(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),ctx);
  assert.equal((await shortCodeRecord(new Request(url),ctx)).status,404);
  assert.equal((await post({code:'SS1-this-must-not-be-stored'})).status,400);
  assert.equal((await post({envelope:{ciphertext:'x'.repeat(1500)}})).status,413);
  const envelope={v:1,iv:'a'.repeat(16),ciphertext:'b'.repeat(84)};
  assert.equal((await post({envelope})).status,201);
  assert.equal((await post({envelope:{...envelope,ciphertext:'c'.repeat(84)}})).status,409);
  const response=await shortCodeRecord(new Request(url),ctx);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(await response.json(),{envelope});
});
test('public short-code API rejects invalid origin, method and credentials before storage access',async()=>{
  const env={VAULTS:{idFromName(){throw new Error('must not access storage');}}};
  const url='https://example.test/api/sync-code';
  assert.equal((await syncCodeRequest(new Request(url),env)).status,401);
  assert.equal((await syncCodeRequest(new Request(url,{method:'DELETE'}),env)).status,405);
  assert.equal((await syncCodeRequest(new Request(url,{headers:{Origin:'https://other.test',Authorization:`Bearer ${'a'.repeat(43)}`}}),env)).status,403);
});
