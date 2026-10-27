const MAX_BYTES = 1_900_000;
export const json = (data,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function validEnvelope(e) {
  return e && e.v === 1 && typeof e.iv === 'string' && /^[A-Za-z0-9_-]{16}$/.test(e.iv) && typeof e.ciphertext === 'string' && e.ciphertext.length >= 24 && e.ciphertext.length <= 1_800_000 && /^[A-Za-z0-9_-]+$/.test(e.ciphertext);
}
export async function vaultRequest(request,env) {
  if (!['GET','POST','PUT'].includes(request.method)) return json({error:'不支持的请求方式'},405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({error:'请求来源不匹配'},403);
  const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) return json({error:'请先连接私人同步码'},401);
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BYTES) return json({error:'同步数据过大，请整理号码后重试'},413);
  // Only a digest is used as the private object address. No code or token in URLs.
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  const name = Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  return env.VAULTS.get(env.VAULTS.idFromName(name)).fetch(request);
}
export class LotteryVault {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS vault (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, envelope TEXT NOT NULL, updated_at TEXT NOT NULL)');
  }
  async fetch(request) {
    if (request.method === 'GET') {
      const row = this.ctx.storage.sql.exec('SELECT revision, envelope, updated_at FROM vault WHERE id = 1').toArray()[0];
      return row ? json({revision:row.revision,envelope:JSON.parse(row.envelope),updatedAt:row.updated_at}) : json({error:'未找到该同步空间，请检查同步码'},404);
    }
    if (!['POST','PUT'].includes(request.method)) return json({error:'不支持的请求方式'},405);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({error:'请求格式不正确'},415);
    let body;
    try {
      const reader = request.body?.getReader();
      if (!reader) return json({error:'缺少同步数据'},400);
      const chunks = []; let length = 0;
      while (true) {
        const {done,value} = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > MAX_BYTES) { await reader.cancel(); return json({error:'同步数据过大'},413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch { return json({error:'同步数据格式不正确'},400); }
    if (!validEnvelope(body.envelope) || !Number.isSafeInteger(body.revision) || body.revision < 0) return json({error:'同步数据格式不正确'},400);
    return this.ctx.storage.transactionSync(()=>{
      const row = this.ctx.storage.sql.exec('SELECT revision FROM vault WHERE id = 1').toArray()[0];
      if (request.method === 'POST' && row) return json({error:'同步空间已存在'},409);
      if (request.method === 'PUT' && !row) return json({error:'同步空间不存在'},404);
      if (body.revision !== (row?.revision || 0)) return json({error:'云端有新记录，请合并后重试'},409);
      const revision = body.revision + 1, updatedAt = new Date().toISOString();
      this.ctx.storage.sql.exec('INSERT INTO vault (id, revision, envelope, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, envelope=excluded.envelope, updated_at=excluded.updated_at',revision,JSON.stringify(body.envelope),updatedAt);
      return json({revision,updatedAt},request.method === 'POST' ? 201 : 200);
    });
  }
}
