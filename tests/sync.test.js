import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDocument,newSyncCode,normalizeCode,syncKeys,encryptDocument,decryptDocument,reconcileEntries,mergeDocuments,entriesFrom,documentSignature} from '../public/sync-model.js';
import {SyncClient} from '../public/sync-client.js';
const entry=id=>({id,game:'ssq',mode:'single',multiplier:1,additional:false,createdAt:'2026-10-27T10:00:00Z',tickets:[{main:[1,2,3,4,5,6],extra:[7]}]});
const doc=(id,actor)=>reconcileEntries(emptyDocument(),[entry(id)],actor);
function storage(){const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
function server(){
  const vaults=new Map();let offline=false;
  return {setOffline(value){offline=value;},vaults,async fetcher(_url,options){
    if(offline)throw new Error('offline');
    const token=options.headers.Authorization,old=vaults.get(token);
    if(options.method==='GET')return Response.json(old||{error:'未找到'},{status:old?200:404});
    const body=JSON.parse(options.body);
    if((options.method==='POST'&&old)||body.revision!==(old?.revision||0))return Response.json({error:'conflict'},{status:409});
    const next={revision:body.revision+1,envelope:body.envelope,updatedAt:new Date().toISOString()};vaults.set(token,next);return Response.json(next);
  }};
}
function device(remote,initial=[]){
  let entries=initial,status;
  const client=new SyncClient({storage:storage(),fetcher:remote.fetcher,getEntries:()=>entries,onEntries:value=>{entries=value;},onStatus:value=>{status=value;}});
  return {client,get entries(){return entries;},get status(){return status;}};
}
test('sync codes derive independent authentication and encryption keys; ciphertext rejects tampering',async()=>{
  const code=newSyncCode();assert.equal(normalizeCode(code),code);assert.throws(()=>normalizeCode('123456'));
  const a=await syncKeys(code),same=await syncKeys(code),other=await syncKeys(newSyncCode());
  assert.equal(a.token,same.token);assert.notEqual(a.token,code.slice(4));
  const original=doc('one','phone'),encrypted=await encryptDocument(original,a.key);
  assert.deepEqual(await decryptDocument(encrypted,same.key),original);
  assert.equal(JSON.stringify(encrypted).includes('tickets'),false);
  await assert.rejects(decryptDocument(encrypted,other.key));
  await assert.rejects(decryptDocument({...encrypted,iv:encrypted.iv.replace(/^./,encrypted.iv[0]==='A'?'B':'A')},a.key));
});
test('independent devices merge additions and preserve deletions despite offline updates',()=>{
  const first=doc('one','phone'),other=doc('two','desktop');
  const merged=mergeDocuments(first,other);assert.equal(entriesFrom(merged).length,2);
  const removed=reconcileEntries(merged,[entry('two')],'phone');
  const stale=reconcileEntries(merged,[{...entry('one'),lastCheck:{winningBets:1}},entry('two')],'desktop');
  assert.deepEqual(entriesFrom(mergeDocuments(removed,stale)).map(x=>x.id),['two']);
  assert.equal(documentSignature(mergeDocuments(removed,stale)),documentSignature(mergeDocuments(stale,removed)));
});
test('two devices restore, merge simultaneous saves, and synchronize deletions',async()=>{
  const remote=server(),a=device(remote,[entry('one')]),b=device(remote);
  const code=await a.client.create();await b.client.connect(code);assert.equal(b.entries[0].id,'one');
  a.client.update([...a.entries,entry('two')]);b.client.update([...b.entries,entry('three')]);
  await Promise.all([a.client.sync(),b.client.sync()]);await a.client.sync();await b.client.sync();
  assert.deepEqual(a.entries.map(e=>e.id),['one','three','two']);assert.deepEqual(a.entries,b.entries);
  a.client.update(a.entries.filter(e=>e.id!=='one'));await a.client.sync();await b.client.sync();
  assert.equal(b.entries.some(e=>e.id==='one'),false);
  a.client.disconnect();b.client.disconnect();
});
test('offline edits survive failed sync and reach a second device after reconnect',async()=>{
  const remote=server(),a=device(remote);const code=await a.client.create();
  remote.setOffline(true);a.client.update([entry('offline')]);await a.client.sync();
  assert.equal(a.status.kind,'error');assert.equal(a.entries[0].id,'offline');assert.equal(a.client.read().dirty,true);
  remote.setOffline(false);await a.client.sync();const b=device(remote);await b.client.connect(code);
  assert.equal(b.entries[0].id,'offline');assert.equal(a.client.read().dirty,false);
  a.client.disconnect();b.client.disconnect();
});
test('unknown sync code never creates a vault or changes local numbers',async()=>{
  const remote=server(),a=device(remote,[entry('local')]);
  await assert.rejects(a.client.connect(newSyncCode()));assert.equal(remote.vaults.size,0);assert.equal(a.entries[0].id,'local');assert.equal(a.client.read(),null);
});
test('saving during an in-flight synchronization is not lost',async()=>{
  const remote=server(),a=device(remote);const code=await a.client.create();
  const original=a.client.request.bind(a.client);let inserted=false;
  a.client.request=async(...args)=>{
    if(args[1]==='PUT'&&!inserted){inserted=true;a.client.update([...a.entries,entry('during-upload')]);}
    return original(...args);
  };
  a.client.update([entry('before-upload')]);await a.client.sync();
  const b=device(remote);await b.client.connect(code);assert.deepEqual(b.entries.map(e=>e.id),['before-upload','during-upload']);
  a.client.disconnect();b.client.disconnect();
});
test('a stale tab preserves an unseen addition from a second tab sharing local storage',async()=>{
  const remote=server(),shared=storage();let first=[],second=[];
  const a=new SyncClient({storage:shared,fetcher:remote.fetcher,getEntries:()=>first,onEntries:e=>{first=e;}});
  const b=new SyncClient({storage:shared,fetcher:remote.fetcher,getEntries:()=>second,onEntries:e=>{second=e;}});
  await a.create();b.start();await b.sync();
  a.update([entry('from-first-tab')]);
  b.update([entry('from-second-tab')]);
  assert.deepEqual(second.map(e=>e.id),['from-first-tab','from-second-tab']);
  a.disconnect();b.disconnect();
});
