import { emptyDocument, entriesFrom, reconcileEntries, mergeDocuments, validateDocument, newSyncCode, normalizeCode, syncKeys, encryptDocument, decryptDocument, documentSignature } from './sync-model.js';
import { newShortCode, formatShortCode, shortCodeKeys, wrapSyncCode, unwrapSyncCode } from './short-code.js';
import { normalizeSyncName, syncNameKeys } from './sync-name.js';

export const SYNC_STORE = 'shishu.sync.v1';
export class SyncClient {
  constructor({storage,fetcher=(...args)=>globalThis.fetch(...args),getEntries,onEntries,onStatus=()=>{}}) {
    Object.assign(this,{storage,fetcher,getEntries,onEntries,onStatus});
    this.actor = crypto.randomUUID(); this.epoch = 0; this.busy = null; this.timer = null; this.requested = false; this.keys = new Map();
  }
  read() {
    const raw = this.storage.getItem(SYNC_STORE); if (!raw) return null;
    const state = JSON.parse(raw); normalizeCode(state.code); validateDocument(state.doc); return state;
  }
  persist(state) { this.storage.setItem(SYNC_STORE,JSON.stringify(state)); this.viewDoc=state.doc; this.onEntries(entriesFrom(state.doc)); }
  credentials(code) { if (!this.keys.has(code)) this.keys.set(code,syncKeys(code)); return this.keys.get(code); }
  displayCode() { const state=this.read();return state?.syncName|| (state?.shortCode?formatShortCode(state.shortCode):state?.code||''); }
  status(kind,message) { this.onStatus({kind,message}); }
  start() {
    try { const state=this.read(); if (state) { this.viewDoc=state.doc; this.onEntries(entriesFrom(state.doc)); void this.sync(); } else this.status('off','仅保存在本机 · 可启用云端同步'); }
    catch { this.status('error','同步设置无法读取，请用同步码重新连接；本机号码已保留'); }
  }
  storageChanged(oldValue) {
    let previous;try{previous=JSON.parse(oldValue);}catch{}
    const state=this.read();
    if(previous?.code!==state?.code){this.epoch++;clearTimeout(this.timer);this.start();return;}
    if(!state)return;
    // Another tab already schedules its own upload. Reflect its state without starting a sync loop.
    this.viewDoc=state.doc;this.onEntries(entriesFrom(state.doc));
    this.status(state.dirty?'pending':'synced',state.dirty?'已保存到本机 · 等待同步':'云端已同步');
  }
  async request(code,method='GET',body) {
    const {token} = await this.credentials(code);
    return this.authorizedRequest('/api/vault',token,method,body);
  }
  async authorizedRequest(path,token,method='GET',body) {
    let response;
    try {
      response = await this.fetcher(path,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(15000)});
    } catch { throw new Error('暂时无法连接云端，号码已保存在本机，联网后可重试'); }
    let result; try { result=await response.json(); } catch { throw new Error('云端暂不可用，请稍后重试'); }
    if (!response.ok) { const error=new Error(result.error||'同步失败，请稍后重试'); error.status=response.status; throw error; }
    return result;
  }
  update(entries) {
    const state = this.read(); if (!state) return false;
    // Diff against what this tab actually displayed, preserving unseen additions from another tab.
    const clock=Math.max(0,...Object.values(state.doc.records).map(r=>r.clock));
    const changes=reconcileEntries(this.viewDoc||state.doc,entries,this.actor,clock);
    this.persist({...state,doc:mergeDocuments(state.doc,changes),dirty:true});
    this.status('pending','已保存到本机 · 等待同步');
    clearTimeout(this.timer); this.timer=setTimeout(()=>void this.sync(),350);
    return true;
  }
  async create(value) {
    if (this.read()) throw new Error('请先断开当前同步空间');
    const epoch=this.epoch,name=value===undefined?null:normalizeSyncName(value);
    if(name) {
      const {token}=await syncNameKeys(name);
      let exists=true;
      try{await this.authorizedRequest('/api/sync-code',token);}
      catch(error){if(error.status!==404)throw error;exists=false;}
      if(exists)throw new Error('这个同步名已被占用，请换一个；如果是你原来的名字，请在下方连接');
    }
    if(epoch!==this.epoch)return;
    const code=newSyncCode(), {key}=await this.credentials(code);
    const doc=reconcileEntries(emptyDocument(),this.getEntries(),this.actor);
    const result=await this.request(code,'POST',{revision:0,envelope:await encryptDocument(doc,key)});
    if (epoch!==this.epoch) return;
    this.persist({code,doc:reconcileEntries(doc,this.getEntries(),this.actor),dirty:true,lastSyncedAt:result.updatedAt});
    await this.sync();
    if(epoch!==this.epoch||this.read()?.code!==code)return;
    return name?this.setSyncName(name):this.shorten();
  }
  async setSyncName(value) {
    const name=normalizeSyncName(value),initial=this.read();
    if(!initial)throw new Error('请先连接原来的同步空间');
    if(initial.syncName===name)return name;
    const epoch=this.epoch,code=initial.code,{token,key}=await syncNameKeys(name);
    const envelope=await wrapSyncCode(code,key);
    try{await this.authorizedRequest('/api/sync-code',token,'POST',{envelope});}
    catch(error){
      if(error.status!==409)throw error;
      // A lost registration response or a previously used name is safe to retry for the same vault.
      const record=await this.authorizedRequest('/api/sync-code',token);
      let existing;try{existing=await unwrapSyncCode(record.envelope,key);}catch{}
      if(existing!==code)throw new Error('这个同步名已被占用，请换一个；当前号码库和同步方式均已保留');
    }
    const current=this.read();if(epoch!==this.epoch||current?.code!==code)return;
    this.persist({...current,syncName:name});return name;
  }
  async shorten() {
    const initial=this.read();if(!initial)throw new Error('请先连接原来的同步空间');
    if(initial.shortCode)return formatShortCode(initial.shortCode);
    const epoch=this.epoch,code=initial.code;
    for(let attempt=0;attempt<3;attempt++) {
      const shortCode=newShortCode(),{token,key}=await shortCodeKeys(shortCode);
      const envelope=await wrapSyncCode(code,key);
      try {await this.authorizedRequest('/api/sync-code',token,'POST',{envelope});}
      catch(error){if(error.status===409)continue;throw error;}
      const current=this.read();if(epoch!==this.epoch||current?.code!==code)return;
      this.persist({...current,shortCode});return shortCode;
    }
    throw new Error('短码暂时无法生成，请稍后重试；原同步码仍可使用');
  }
  async connect(value) {
    if (this.read()) throw new Error('请先断开当前同步空间');
    const epoch=this.epoch;let code,shortCode,syncName;
    if(String(value).trim().startsWith('SS1-'))code=normalizeCode(value);
    else {
      try{shortCode=formatShortCode(value);}catch{syncName=normalizeSyncName(value);}
      const shortKeys=shortCode?await shortCodeKeys(shortCode):await syncNameKeys(syncName);
      const record=await this.authorizedRequest('/api/sync-code',shortKeys.token);
      code=await unwrapSyncCode(record.envelope,shortKeys.key);
    }
    const {key}=await this.credentials(code);
    const remote=await this.request(code), remoteDoc=await decryptDocument(remote.envelope,key);
    if (epoch!==this.epoch) return;
    const localDoc=reconcileEntries(emptyDocument(),this.getEntries(),this.actor);
    this.persist({code,...(shortCode?{shortCode}:{}),...(syncName?{syncName}:{}),doc:mergeDocuments(localDoc,remoteDoc),dirty:true,lastSyncedAt:remote.updatedAt});
    await this.sync(); return syncName||shortCode||code;
  }
  disconnect() {
    this.epoch++; clearTimeout(this.timer); this.requested=false; this.storage.removeItem(SYNC_STORE); this.keys.clear(); this.viewDoc=null;
    this.status('off','已断开云端 · 本机号码已保留');
  }
  sync() {
    if (this.busy) { this.requested=true; return this.busy; }
    const epoch=this.epoch;
    this.busy=this.run(epoch).catch(error=>{ if (epoch===this.epoch) this.status('error',error.message); }).finally(()=>{
      this.busy=null;
      if(this.requested){this.requested=false;void this.sync();}
    });
    return this.busy;
  }
  async run(epoch) {
    const initial=this.read(); if(!initial)return;
    const code=initial.code, {key}=await this.credentials(code);
    const current=()=>{const state=this.read();return epoch===this.epoch&&state?.code===code?state:null;};
    this.status('syncing','正在同步…');
    for(let attempt=0;attempt<5;attempt++){
      const remote=await this.request(code);
      const remoteDoc=await decryptDocument(remote.envelope,key), state=current(); if(!state)return;
      const merged=mergeDocuments(state.doc,remoteDoc);
      this.persist({...state,doc:merged,dirty:true});
      if(documentSignature(merged)===documentSignature(remoteDoc)){
        this.persist({...state,doc:merged,dirty:false,lastSyncedAt:remote.updatedAt});
        this.status('synced','云端已同步'); return;
      }
      const envelope=await encryptDocument(merged,key); if(!current())return;
      let result;
      try { result=await this.request(code,'PUT',{revision:remote.revision,envelope}); }
      catch(error){ if(error.status===409)continue; throw error; }
      const latest=current(); if(!latest)return;
      const dirty=documentSignature(latest.doc)!==documentSignature(merged);
      this.persist({...latest,dirty,lastSyncedAt:result.updatedAt});
      if(!dirty){this.status('synced','云端已同步');return;}
    }
    throw new Error('其他设备正在更新，号码已保存在本机，请稍后再同步');
  }
}
