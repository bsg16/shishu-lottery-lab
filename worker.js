import { vaultRequest } from './server/vault.js';
import { drawsResponse } from './server/draws.js';
import { syncCodeRequest } from './server/sync-codes.js';
export { LotteryVault } from './server/vault.js';
export { PROVIDERS, normalize } from './server/draws.js';
const responseJSON = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname === '/api/vault') return vaultRequest(request,env);
    if (url.pathname === '/api/sync-code') return syncCodeRequest(request,env);
    if (request.method !== 'GET') return responseJSON({error:'仅支持查询'},405);
    if (url.pathname === '/api/health') return responseJSON({ok:true,version:'1.4.1'});
    if (url.pathname !== '/api/draws') return responseJSON({error:'未找到'},404);
    return drawsResponse(request,ctx);
  }
};
