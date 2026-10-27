import { canonicalIssue, validateDraw } from './public/domain.js';
import { vaultRequest } from './server/vault.js';
export { LotteryVault } from './server/vault.js';
export const PROVIDERS = {
  ssq: 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=100&issueStart=&issueEnd=&dayStart=&dayEnd=',
  dlt: 'https://www.gstc.org.cn/workapi/prize_history_list'
};
const responseJSON = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function normalize(game, raw) {
  let rows;
  if (game === 'ssq') {
    if (raw.state !== 0 || !Array.isArray(raw.result)) throw new Error('Invalid provider response');
    rows = raw.result.map(r=>({issue:r.code,date:r.date.slice(0,10),main:r.red.split(',').map(Number),extra:r.blue.split(',').map(Number),prizes:Object.fromEntries((r.prizegrades || []).filter(p=>Number(p.type)<=6).map(p=>[String(p.type),Number(String(p.typemoney).replaceAll(',',''))||null]))}));
  } else {
    if (raw.code !== '000000' || !Array.isArray(raw.data?.prize_history_list)) throw new Error('Invalid provider response');
    rows = raw.data.prize_history_list.map(r=>({issue:r.issue_num,date:r.prize_time,main:r.prize_num.slice(0,5).map(Number),extra:r.prize_num.slice(5).map(Number)}));
  }
  if (!rows.length || rows.some(r=>!validateDraw(game,r) || !/^\d{4}-\d{2}-\d{2}$/.test(r.date))) throw new Error('Invalid draw data');
  return rows.map(r=>({...r,issue:canonicalIssue(game,r.issue),main:r.main.sort((a,b)=>a-b),extra:r.extra.sort((a,b)=>a-b)}));
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname === '/api/vault') return vaultRequest(request,env);
    if (request.method !== 'GET') return responseJSON({error:'仅支持查询'},405);
    if (url.pathname === '/api/health') return responseJSON({ok:true,version:'1.2.0'});
    if (url.pathname !== '/api/draws') return responseJSON({error:'未找到'},404);
    const game = url.searchParams.get('game');
    if (!Object.hasOwn(PROVIDERS,game)) return responseJSON({error:'彩种不支持'},400);
    const cacheKey = new Request(`${url.origin}/api/draws?game=${game}`);
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached;
    try {
      const upstream = await fetch(PROVIDERS[game],{
        method:game === 'dlt' ? 'POST' : 'GET',
        headers:{'User-Agent':'Mozilla/5.0','Content-Type':'application/json'},
        ...(game === 'dlt' ? {body:JSON.stringify({type_id:'001',page_no:1,page_size:100})} : {}),
        signal:AbortSignal.timeout(9000)
      });
      if (!upstream.ok) throw new Error('Source unavailable');
      const draws = normalize(game,await upstream.json());
      const res = Response.json({game,draws,checkedAt:new Date().toISOString(),source:'official',fallback:false},{headers:{'Cache-Control':'public, max-age=900','X-Content-Type-Options':'nosniff'}});
      ctx.waitUntil(caches.default.put(cacheKey,res.clone()));
      return res;
    } catch {
      return responseJSON({game,draws:[],fallback:true,message:'官方数据源暂不可用，正在显示已收录数据。可手动输入开奖号码核对。'},503);
    }
  }
};
