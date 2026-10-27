import { emptyDocument, entriesFrom, reconcileEntries, mergeDocuments, validateDocument, newSyncCode, normalizeCode, syncKeys, encryptDocument, decryptDocument, documentSignature } from './sync-model.js';

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
  status(kind,message) { this.onStatus({kind,message}); }
  start() {
    try { const state=this.read(); if (state) { this.viewDoc=state.doc; this.onEntries(entriesFrom(state.doc)); void this.sync(); } else this.status('off','仅保存在本机 · 可启用云端同步'); }
    catch { this.status('error','同步设置无法读取，请用同步码重新连接；本机号码已保留'); }
  }
  async request(code,method='GET',body) {
    const {token} = await this.credentials(code);
    let response;
    try {
      response = await this.fetcher('/api/vault',{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(15000)});
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
  async create() {
    if (this.read()) throw new Error('请先断开当前同步空间');
    const epoch=this.epoch, code=newSyncCode(), {key}=await this.credentials(code);
    const doc=reconcileEntries(emptyDocument(),this.getEntries(),this.actor);
    const result=await this.request(code,'POST',{revision:0,envelope:await encryptDocument(doc,key)});
    if (epoch!==this.epoch) return;
    this.persist({code,doc:reconcileEntries(doc,this.getEntries(),this.actor),dirty:true,lastSyncedAt:result.updatedAt});
    await this.sync(); return code;
  }
  async connect(value) {
    if (this.read()) throw new Error('请先断开当前同步空间');
    const epoch=this.epoch, code=normalizeCode(value), {key}=await this.credentials(code);
    const remote=await this.request(code), remoteDoc=await decryptDocument(remote.envelope,key);
    if (epoch!==this.epoch) return;
    const localDoc=reconcileEntries(emptyDocument(),this.getEntries(),this.actor);
    this.persist({code,doc:mergeDocuments(localDoc,remoteDoc),dirty:true,lastSyncedAt:remote.updatedAt});
    await this.sync(); return code;
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
