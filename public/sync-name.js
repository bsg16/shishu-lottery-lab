import { aliasKeys, formatShortCode, shortCodeKeys } from './short-code.js';

export function normalizeSyncName(value) {
  const name=String(value).normalize('NFKC').trim().toLowerCase();
  if(!/^[\p{Script=Han}a-z0-9_-]{2,32}$/u.test(name))throw new Error('同步名请输入2–32个字符，可用中文、字母、数字、下划线或短横线，不含空格');
  if(name.startsWith('ss1-'))throw new Error('SS1- 是旧同步码的专用前缀，请换一个名字');
  // Names that look like old short codes share their namespace, avoiding ambiguous connections.
  try{return formatShortCode(name);}catch{return name;}
}

export async function syncNameKeys(value) {
  const name=normalizeSyncName(value);
  try{return shortCodeKeys(formatShortCode(name));}
  catch{return aliasKeys(name,'shishu-sync-name-v1');}
}
