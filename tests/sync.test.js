import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDocument,newSyncCode,normalizeCode,syncKeys,encryptDocument,decryptDocument,reconcileEntries,mergeDocuments,entriesFrom,documentSignature} from '../public/sync-model.js';
import {SyncClient} from '../public/sync-client.js';
import {normalizeShortCode,newShortCode,shortCodeKeys,wrapSyncCode,unwrapSyncCode} from '../public/short-code.js';
import {normalizeSyncName,syncNameKeys} from '../public/sync-name.js';
const entry=id=>({id,game:'ssq',mode:'single',multiplier:1,additional:false,createdAt:'2026-10-27T10:00:00Z',tickets:[{main:[1,2,3,4,5,6],extra:[7]}]});
const doc=(id,actor)=>reconcileEntries(emptyDocument(),[entry(id)],actor);
function storage(){const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
function server(){
  const vaults=new Map(),codes=new Map();let offline=false;
  return {setOffline(value){offline=value;},vaults,codes,async fetcher(url,options){
    if(offline)throw new Error('offline');
    const token=options.headers.Authorization;
    if(url==='/api/sync-code'){
      const old=codes.get(token);
      if(options.method==='GET')return Response.json(old||{error:'未找到'},{status:old?200:404});
      if(old)return Response.json({error:'conflict'},{status:409});
      codes.set(token,JSON.parse(options.body));return Response.json({ok:true},{status:201});
    }
    const old=vaults.get(token);
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
test('eight-character codes normalize case and separators; encrypted aliases reject wrong keys',async()=>{
  const short=newShortCode();assert.equal(normalizeShortCode(short).length,8);
  assert.equal(normalizeShortCode(short.toLowerCase().replace('-',' ')),normalizeShortCode(short));
  for(const invalid of ['12345678','ABCDEFGI','ABCDEFG0','ABCD234','ABCD23456'])assert.throws(()=>normalizeShortCode(invalid));
  const keys=await shortCodeKeys(short),same=await shortCodeKeys(short.toLowerCase()),other=await shortCodeKeys(newShortCode());
  assert.equal(keys.token,same.token);
  const long=newSyncCode(),envelope=await wrapSyncCode(long,keys.key);
  assert.equal(envelope.ciphertext.length,84);
  assert.equal(JSON.stringify(envelope).includes(long),false);
  assert.equal(await unwrapSyncCode(envelope,same.key),long);
  await assert.rejects(unwrapSyncCode(envelope,other.key));
});
test('a short alias restores the existing vault and stays compatible with legacy devices',async()=>{
  const remote=server(),legacy=newSyncCode(),keys=await syncKeys(legacy);
  remote.vaults.set(`Bearer ${keys.token}`,{revision:1,envelope:await encryptDocument(doc('legacy','old-device'),keys.key),updatedAt:new Date().toISOString()});
  const a=device(remote),b=device(remote),oldDevice=device(remote);
  await a.client.connect(legacy);const short=await a.client.shorten();
  assert.equal(a.client.read().code,legacy);assert.equal(a.client.displayCode(),short);
  await b.client.connect(short.toLowerCase().replace('-',''));
  await oldDevice.client.connect(legacy);
  assert.equal(b.entries[0].id,'legacy');assert.equal(remote.vaults.size,1);
  oldDevice.client.update([...oldDevice.entries,entry('new-from-old-device')]);await oldDevice.client.sync();await b.client.sync();
  assert.deepEqual(oldDevice.entries,b.entries);
  assert.equal(JSON.stringify([...remote.codes]).includes(legacy),false);
  assert.equal(JSON.stringify([...remote.codes]).includes(short),false);
  a.client.disconnect();b.client.disconnect();oldDevice.client.disconnect();
});
test('an unknown short code leaves local records and connection state untouched',async()=>{
  const remote=server(),a=device(remote,[entry('keep-local')]);
  await assert.rejects(a.client.connect(newShortCode()));
  assert.equal(a.client.read(),null);assert.equal(a.entries[0].id,'keep-local');assert.equal(remote.vaults.size,0);
});
test('a failed short-code registration keeps the usable legacy connection',async()=>{
  const remote=server(),a=device(remote,[entry('keep-local')]);
  const original=a.client.fetcher;
  a.client.fetcher=(url,options)=>url==='/api/sync-code'?Promise.resolve(Response.json({error:'later'},{status:503})):original(url,options);
  await assert.rejects(a.client.create());
  const legacy=a.client.read().code;assert.match(legacy,/^SS1-/);assert.equal(a.entries[0].id,'keep-local');
  const b=device(remote);await b.client.connect(legacy);assert.equal(b.entries[0].id,'keep-local');
  a.client.fetcher=original;const short=await a.client.shorten();assert.equal(normalizeShortCode(short).length,8);
  a.client.disconnect();b.client.disconnect();
});
test('short-code collisions retry without replacing existing codes or losing an in-flight save',async()=>{
  const remote=server(),a=device(remote);const original=a.client.fetcher;let attempts=0;
  a.client.fetcher=async(url,options)=>{
    if(url==='/api/sync-code'&&options.method==='POST') {
      attempts++;
      if(attempts===1)return Response.json({error:'conflict'},{status:409});
      a.client.update([entry('during-shortening')]);
    }
    return original(url,options);
  };
  const short=await a.client.create();await a.client.sync();
  assert.equal(attempts,2);assert.equal(a.entries[0].id,'during-shortening');
  const b=device(remote);await b.client.connect(short);assert.equal(b.entries[0].id,'during-shortening');
  a.client.disconnect();b.client.disconnect();
});
test('custom names accept user-chosen lengths and normalize Chinese, Latin case and full-width text',async()=>{
  assert.equal(normalizeSyncName(' 小川选号_27 '),'小川选号_27');
  assert.equal(normalizeSyncName('Ａlice_２７'),'alice_27');
  assert.equal(normalizeSyncName('小川'),'小川');
  assert.equal(normalizeSyncName('𠀀'.repeat(32)),'𠀀'.repeat(32));
  for(const invalid of ['', '川', '小川'.repeat(17), '小 川', '<script>', '🙂🙂', 'SS1-name'])assert.throws(()=>normalizeSyncName(invalid));
  const a=await syncNameKeys('Ａlice_２７'),b=await syncNameKeys('alice_27'),c=await syncNameKeys('小川选号_27');
  assert.equal(a.token,b.token);assert.notEqual(a.token,c.token);
  const long=newSyncCode(),envelope=await wrapSyncCode(long,a.key);
  assert.equal(await unwrapSyncCode(envelope,b.key),long);
  await assert.rejects(unwrapSyncCode(envelope,c.key));
  assert.equal((await syncNameKeys('abcd-efgh')).token,(await shortCodeKeys('ABCDEFGH')).token);
  assert.equal((await shortCodeKeys('ABCD-EFGH')).token,'pKAZSVivgH46ET-bRdCfarQt1vqaKR2BbiFB0sXAE4s');
});
test('custom names create and restore a vault; changing names preserves old names, codes and devices',async()=>{
  const remote=server(),a=device(remote,[entry('original')]),b=device(remote),c=device(remote),old=device(remote);
  assert.equal(await a.client.create('小川选号_27'),'小川选号_27');
  await b.client.connect('小川选号_27');
  const long=a.client.read().code,short=await a.client.shorten();
  assert.equal(await a.client.setSyncName('My_lottery'),'my_lottery');
  assert.equal(a.client.displayCode(),'my_lottery');
  b.client.update([...b.entries,entry('from-old-name')]);await b.client.sync();
  await c.client.connect('MY_LOTTERY');await old.client.connect(long);
  assert.deepEqual(c.entries,b.entries);assert.deepEqual(old.entries,b.entries);
  old.client.disconnect();await old.client.connect(short);assert.deepEqual(old.entries,b.entries);
  old.client.disconnect();await old.client.connect('小川选号_27');assert.deepEqual(old.entries,b.entries);
  assert.equal(remote.vaults.size,1);
  assert.equal(JSON.stringify([...remote.codes]).includes('小川选号_27'),false);
  for(const d of [a,b,c,old])d.client.disconnect();
});
test('occupied names never connect a creator to someone else or replace their current alias',async()=>{
  const remote=server(),a=device(remote,[entry('owner')]),b=device(remote,[entry('local')]);
  await a.client.create('小川选号_27');
  await assert.rejects(b.client.create('小川选号_27'),/已被占用/);
  assert.equal(b.client.read(),null);assert.equal(b.entries[0].id,'local');assert.equal(remote.vaults.size,1);
  await b.client.create('另一位用户');const before=b.client.read();
  await assert.rejects(b.client.setSyncName('小川选号_27'),/已被占用/);
  assert.deepEqual(b.client.read(),before);assert.equal(b.entries[0].id,'local');
  const oldCode=await a.client.shorten();
  await assert.rejects(b.client.setSyncName(oldCode.toLowerCase().replace('-','')),/已被占用/);
  assert.equal(b.client.displayCode(),'另一位用户');
  a.client.disconnect();b.client.disconnect();
});
test('invalid and unknown names leave local data and cloud connection unchanged',async()=>{
  const remote=server(),a=device(remote,[entry('local')]);
  for(const name of ['单', '有 空格', '名字'.repeat(17)])await assert.rejects(a.client.create(name));
  await assert.rejects(a.client.connect('不存在的名字'));
  assert.equal(a.client.read(),null);assert.equal(a.entries[0].id,'local');assert.equal(remote.vaults.size,0);
});
test('a lost nickname-registration response can be retried without losing in-flight saves',async()=>{
  const remote=server(),a=device(remote,[entry('original')]);const short=await a.client.create();
  const original=a.client.fetcher;let fail=true;
  a.client.fetcher=async(url,options)=>{
    const response=await original(url,options);
    if(fail&&url==='/api/sync-code'&&options.method==='POST'){
      fail=false;a.client.update([...a.entries,entry('during-registration')]);throw new Error('lost response');
    }
    return response;
  };
  await assert.rejects(a.client.setSyncName('我的选号库'));
  assert.equal(a.client.displayCode(),short);
  await a.client.setSyncName('我的选号库');await a.client.sync();
  const b=device(remote);await b.client.connect('我的选号库');
  assert.deepEqual(b.entries.map(e=>e.id),['during-registration','original']);
  await a.client.setSyncName('另一个名字');await a.client.setSyncName('我的选号库');
  assert.equal(a.client.displayCode(),'我的选号库');assert.equal(remote.vaults.size,1);
  a.client.disconnect();b.client.disconnect();
});
test('a nickname claimed between availability check and registration preserves the new owner vault',async()=>{
  const remote=server(),a=device(remote,[entry('local')]),other=newSyncCode(),keys=await syncNameKeys('同时取名');
  const original=a.client.fetcher;let race=true;
  a.client.fetcher=async(url,options)=>{
    if(race&&url==='/api/sync-code'&&options.method==='POST'){
      race=false;remote.codes.set(`Bearer ${keys.token}`,{envelope:await wrapSyncCode(other,keys.key)});
    }
    return original(url,options);
  };
  await assert.rejects(a.client.create('同时取名'),/已被占用/);
  assert.notEqual(a.client.read().code,other);assert.match(a.client.displayCode(),/^SS1-/);
  assert.equal(a.entries[0].id,'local');
  await a.client.setSyncName('重试新名字');
  const b=device(remote);await b.client.connect('重试新名字');assert.equal(b.entries[0].id,'local');
  a.client.disconnect();b.client.disconnect();
});
test('storage events across tabs do not restart sync endlessly or interrupt naming a new vault',async()=>{
  const remote=server(),values=new Map(),tabs=[];let requests=0;
  const fetcher=(...args)=>{assert.ok(++requests<20,'storage events must not cause a request loop');return remote.fetcher(...args);};
  const device=index=>{
    let entries=[];
    const notify=(key,oldValue)=>queueMicrotask(()=>tabs.forEach((tab,i)=>{if(i!==index)tab.storageChanged(oldValue);}));
    const shared={getItem:k=>values.get(k)??null,setItem:(k,v)=>{const old=values.get(k)??null;values.set(k,v);if(old!==v)notify(k,old);},removeItem:k=>{const old=values.get(k)??null;values.delete(k);if(old!==null)notify(k,old);}};
    return new SyncClient({storage:shared,fetcher,getEntries:()=>entries,onEntries:e=>{entries=e;}});
  };
  const a=device(0),b=device(1);tabs.push(a,b);
  assert.equal(await a.create('多页测试'),'多页测试');
  await Promise.all([a.busy,b.busy]);
  assert.equal(a.displayCode(),'多页测试');assert.equal(b.displayCode(),'多页测试');
  a.update([entry('shared')]);clearTimeout(a.timer);await a.sync();
  assert.equal(entriesFrom(b.viewDoc)[0].id,'shared');
  const settled=requests;await new Promise(resolve=>setTimeout(resolve,25));assert.equal(requests,settled);
  assert.equal(a.epoch,0);a.disconnect();b.disconnect();
});
