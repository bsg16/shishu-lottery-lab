import { validateEntry, canonicalIssue } from './domain.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_RECORDS = 5000;
export const MAX_SAVED = 200;
const base64 = bytes => btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
function unbase64(value) {
  return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0));
}
export function newSyncCode() { return `SS1-${base64(crypto.getRandomValues(new Uint8Array(32)))}`; }
export function normalizeCode(value) {
  const code = String(value).trim();
  if (!/^SS1-[A-Za-z0-9_-]{43}$/.test(code)) throw new Error('同步码格式不正确，请完整复制以 SS1- 开头的同步码');
  if (base64(unbase64(code.slice(4))) !== code.slice(4)) throw new Error('同步码格式不正确');
  return code;
}
export async function syncKeys(code) {
  const raw = unbase64(normalizeCode(code).slice(4));
  const material = await crypto.subtle.importKey('raw',raw,'HKDF',false,['deriveBits','deriveKey']);
  const parameters = label => ({name:'HKDF',hash:'SHA-256',salt:encoder.encode('shishu-vault-v1'),info:encoder.encode(label)});
  const token = base64(new Uint8Array(await crypto.subtle.deriveBits(parameters('authentication'),material,256)));
  const key = await crypto.subtle.deriveKey(parameters('encryption'),material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  return {token,key};
}
export function emptyDocument() { return {version:1,records:{}}; }
export function validateDocument(doc) {
  if (!doc || doc.version !== 1 || !doc.records || Array.isArray(doc.records) || typeof doc.records !== 'object') throw new Error('云端记录格式不正确');
  const records = Object.entries(doc.records);
  if (records.length > MAX_RECORDS) throw new Error('同步记录已满，请导出备份后创建新的同步空间');
  for (const [id,r] of records) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || ['__proto__','constructor','prototype'].includes(id) || !r || !Number.isSafeInteger(r.clock) || r.clock < 1 || !/^[a-zA-Z0-9_-]{1,100}$/.test(r.actor)) throw new Error('云端记录格式不正确');
    if (r.entry !== null) {
      if (!validateEntry(r.entry) || r.entry.id !== id || typeof r.entry.createdAt !== 'string' || !Number.isFinite(Date.parse(r.entry.createdAt))) throw new Error('云端号码或投注参数不合法');
      if (r.entry.targetIssue) canonicalIssue(r.entry.game,r.entry.targetIssue);
    }
  }
  if (entriesFrom(doc).length > MAX_SAVED) throw new Error('合并后超过200组，请先导出备份并整理号码再同步');
  return doc;
}
export function entriesFrom(doc) {
  return Object.values(doc.records).filter(r=>r.entry !== null).map(r=>r.entry).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
}
export function reconcileEntries(doc, entries, actor, clockFloor = 0) {
  const records = {...doc.records};
  const clock = Math.max(clockFloor,0,...Object.values(records).map(r=>r.clock)) + 1;
  const ids = new Set(entries.map(e=>e.id));
  for (const entry of entries) {
    const old = records[entry.id];
    // A deletion is permanent for this ID; importing a backup creates new IDs.
    if (old?.entry === null) continue;
    if (!old || JSON.stringify(old.entry) !== JSON.stringify(entry)) records[entry.id] = {entry,clock,actor};
  }
  for (const [id,r] of Object.entries(records)) if (r.entry !== null && !ids.has(id)) records[id] = {entry:null,clock,actor};
  return validateDocument({version:1,records});
}
export function mergeDocuments(left,right) {
  validateDocument(left); validateDocument(right);
  const records = {...left.records};
  for (const [id,r] of Object.entries(right.records)) {
    const old = records[id];
    if (!old || (r.entry === null && old.entry !== null) || ((old.entry === null) === (r.entry === null) && (r.clock > old.clock || (r.clock === old.clock && r.actor > old.actor)))) records[id] = r;
  }
  return validateDocument({version:1,records});
}
export const documentSignature = doc => JSON.stringify(Object.entries(doc.records).sort(([a],[b])=>a.localeCompare(b)));
export async function encryptDocument(doc,key) {
  validateDocument(doc);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = encoder.encode(JSON.stringify(doc));
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('shishu-vault-v1')},key,bytes);
  return {v:1,iv:base64(iv),ciphertext:base64(new Uint8Array(ciphertext))};
}
export async function decryptDocument(envelope,key) {
  let raw;
  try {
    if (!envelope || envelope.v !== 1) throw new Error();
    raw = await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(envelope.iv),additionalData:encoder.encode('shishu-vault-v1')},key,unbase64(envelope.ciphertext));
  } catch { throw new Error('无法解密云端记录，请检查同步码；本机号码保持不变'); }
  return validateDocument(JSON.parse(decoder.decode(raw)));
}
