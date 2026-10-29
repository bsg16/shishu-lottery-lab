const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');

export async function syncCodeRequest(request,env) {
  if(!['GET','POST'].includes(request.method))return json({error:'不支持的请求方式'},405);
  const origin=request.headers.get('Origin');
  if(origin&&origin!==new URL(request.url).origin)return json({error:'请求来源不匹配'},403);
  const token=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if(!token)return json({error:'请输入私人同步码'},401);
  // Pages preserves CF-Connecting-IP over its internal binding. Never trust X-Forwarded-For.
  const address=request.headers.get('CF-Connecting-IP')||'local';
  const limiter=env.VAULTS.get(env.VAULTS.idFromName(`code-limit:${await digest(address)}`));
  const allowed=await limiter.fetch(new Request(`https://internal/code-limit?operation=${request.method}`,{method:'POST'}));
  if(!allowed.ok)return allowed;
  const registry=env.VAULTS.get(env.VAULTS.idFromName(`short-code:${await digest(token)}`));
  return registry.fetch(request);
}

export function codeRateLimit(ctx,operation,now=Date.now()) {
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS code_limits (operation TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)');
  const max=operation==='POST'?10:20,window=operation==='POST'?3600000:300000;
  return ctx.storage.transactionSync(()=>{
    const old=ctx.storage.sql.exec('SELECT count, reset_at FROM code_limits WHERE operation = ?',operation).toArray()[0];
    const count=old&&old.reset_at>now?old.count:0,resetAt=old&&old.reset_at>now?old.reset_at:now+window;
    if(count>=max)return json({error:'同步码尝试过于频繁，请稍后再试'},429,{'Retry-After':String(Math.ceil((resetAt-now)/1000))});
    ctx.storage.sql.exec('INSERT INTO code_limits (operation, count, reset_at) VALUES (?, ?, ?) ON CONFLICT(operation) DO UPDATE SET count=excluded.count, reset_at=excluded.reset_at',operation,count+1,resetAt);
    return json({ok:true});
  });
}

export async function shortCodeRecord(request,ctx) {
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS short_code (id INTEGER PRIMARY KEY, envelope TEXT NOT NULL)');
  if(request.method==='GET') {
    const row=ctx.storage.sql.exec('SELECT envelope FROM short_code WHERE id = 1').toArray()[0];
    return row?json({envelope:JSON.parse(row.envelope)}):json({error:'未找到该同步码，请检查8位字母数字是否正确'},404);
  }
  if(request.method!=='POST')return json({error:'不支持的请求方式'},405);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'请求格式不正确'},415);
  let body;
  try {
    const reader=request.body?.getReader();if(!reader)throw new Error();
    const chunks=[];let length=0;
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>1024){await reader.cancel();return json({error:'同步码数据过大'},413);}chunks.push(value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    body=JSON.parse(new TextDecoder().decode(bytes));
  } catch {return json({error:'同步码数据格式不正确'},400);}
  const e=body?.envelope;
  // A wrapped legacy code is exactly 47 plaintext bytes plus the GCM authentication tag.
  if(e?.v!==1||typeof e.iv!=='string'||!/^[A-Za-z0-9_-]{16}$/.test(e.iv)||typeof e.ciphertext!=='string'||!/^[A-Za-z0-9_-]{84}$/.test(e.ciphertext))return json({error:'同步码数据格式不正确'},400);
  return ctx.storage.transactionSync(()=>{
    if(ctx.storage.sql.exec('SELECT id FROM short_code WHERE id = 1').toArray().length)return json({error:'同步码已占用，请重试'},409);
    ctx.storage.sql.exec('INSERT INTO short_code (id, envelope) VALUES (1, ?)',JSON.stringify({v:1,iv:e.iv,ciphertext:e.ciphertext}));
    return json({ok:true},201);
  });
}
