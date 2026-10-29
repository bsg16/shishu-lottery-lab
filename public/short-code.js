import { normalizeCode } from './sync-model.js';

const alphabet='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const encoder=new TextEncoder(),decoder=new TextDecoder();
const context=encoder.encode('shishu-short-code-v1');
const base64=bytes=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const unbase64=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));

export function normalizeShortCode(value) {
  const code=String(value).replace(/[\s-]/g,'').toUpperCase();
  if(!/^[2-9A-HJ-NP-Z]{8}$/.test(code))throw new Error('请输入8位字母数字同步码，也支持原来的 SS1- 长码');
  return code;
}
export const formatShortCode=value=>{const code=normalizeShortCode(value);return `${code.slice(0,4)}-${code.slice(4)}`;};
export const newShortCode=()=>formatShortCode(Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>alphabet[b&31]).join(''));

export async function shortCodeKeys(value) {
  const material=await crypto.subtle.importKey('raw',encoder.encode(normalizeShortCode(value)),'PBKDF2',false,['deriveBits']);
  const stretched=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:context,iterations:600000},material,256);
  const root=await crypto.subtle.importKey('raw',stretched,'HKDF',false,['deriveBits','deriveKey']);
  const parameters=label=>({name:'HKDF',hash:'SHA-256',salt:context,info:encoder.encode(label)});
  const token=base64(new Uint8Array(await crypto.subtle.deriveBits(parameters('lookup'),root,256)));
  const key=await crypto.subtle.deriveKey(parameters('wrapping'),root,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  return {token,key};
}
export async function wrapSyncCode(code,key) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:context},key,encoder.encode(normalizeCode(code)));
  return {v:1,iv:base64(iv),ciphertext:base64(new Uint8Array(encrypted))};
}
export async function unwrapSyncCode(envelope,key) {
  try {
    if(envelope?.v!==1)throw new Error();
    const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(envelope.iv),additionalData:context},key,unbase64(envelope.ciphertext));
    return normalizeCode(decoder.decode(raw));
  } catch {throw new Error('同步码无法验证，请检查后重试；本机号码已保留');}
}
