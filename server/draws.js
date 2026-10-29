import { canonicalIssue, validateDraw, mergeDraws } from '../public/domain.js';

export const PROVIDERS = {
  ssq: 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=100&issueStart=&issueEnd=&dayStart=&dayEnd=',
  dlt: 'https://www.gstc.org.cn/workapi/prize_history_list',
  jiangsu: 'https://api.js-lottery.com/wfzq/dlt/data'
};

function validateRows(game, rows) {
  if (!rows.length || rows.some(r=>!validateDraw(game,r) || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || new Date(`${r.date}T00:00:00Z`).toISOString().slice(0,10)!==r.date)) throw new Error('Invalid draw data');
  const draws=rows.map(r=>({...r,issue:canonicalIssue(game,r.issue),main:r.main.sort((a,b)=>a-b),extra:r.extra.sort((a,b)=>a-b)})).sort((a,b)=>Number(b.issue)-Number(a.issue));
  // One draw per date: reject copied dates and backwards dates in provider feeds.
  if(draws.some((r,i)=>i && (r.issue===draws[i-1].issue || r.date>=draws[i-1].date))) throw new Error('Inconsistent draw dates');
  return draws;
}

export function normalize(game, raw) {
  let rows;
  if(game==='ssq') {
    if(raw.state!==0 || !Array.isArray(raw.result)) throw new Error('Invalid provider response');
    rows=raw.result.map(r=>({issue:r.code,date:r.date.slice(0,10),main:r.red.split(',').map(Number),extra:r.blue.split(',').map(Number),prizes:Object.fromEntries((r.prizegrades||[]).filter(p=>Number(p.type)<=6).map(p=>[String(p.type),Number(String(p.typemoney).replaceAll(',',''))||null]))}));
  } else {
    if(raw.code!=='000000' || !Array.isArray(raw.data?.prize_history_list)) throw new Error('Invalid provider response');
    rows=raw.data.prize_history_list.map(r=>({issue:r.issue_num,date:r.prize_time,main:r.prize_num.slice(0,5).map(Number),extra:r.prize_num.slice(5).map(Number)}));
  }
  return validateRows(game,rows);
}

export function normalizeJiangsu(html) {
  const rows=[];
  for(const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells=[...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1].replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').trim());
    if(!/^\d{5}$/.test(cells[1]||''))continue;
    const numbers=cells[2].trim().split(/\s+/).map(Number);
    rows.push({issue:cells[1],date:cells[0],main:numbers.slice(0,5),extra:numbers.slice(5)});
  }
  return validateRows('dlt',rows);
}

export async function fetchDraws(game, fetcher=fetch) {
  const sources=game==='dlt' ? [
    {url:PROVIDERS.dlt,name:'甘肃体彩网',post:true,parse:r=>r.json().then(raw=>normalize(game,raw))},
    {url:PROVIDERS.jiangsu,name:'江苏体彩网',parse:r=>r.text().then(normalizeJiangsu)}
  ] : [{url:PROVIDERS.ssq,name:'中国福彩网',parse:r=>r.json().then(raw=>normalize(game,raw))}];
  const results=await Promise.allSettled(sources.map(async source=>{
    const response=await fetcher(source.url,{
      method:source.post?'POST':'GET',headers:{'User-Agent':'Mozilla/5.0',...(source.post?{'Content-Type':'application/json'}:{})},
      ...(source.post?{body:JSON.stringify({type_id:'001',page_no:1,page_size:100})}:{}),signal:AbortSignal.timeout(8000)
    });
    if(!response.ok)throw new Error('Source unavailable');
    return {draws:await source.parse(response),sourceName:source.name,sourceUrl:source.url};
  }));
  const valid=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
  if(!valid.length)throw new Error('No valid official source');
  const draws=valid.reduce((all,result)=>mergeDraws(game,all,result.draws),[]);
  const latestSource=valid.findLast(result=>result.draws[0].issue===draws[0].issue);
  return {game,draws,checkedAt:new Date().toISOString(),source:'official',sourceName:latestSource.sourceName,sourceUrl:latestSource.sourceUrl,fallback:false};
}

export async function drawsResponse(request, ctx, cache=caches.default, fetcher=fetch) {
  const url=new URL(request.url),game=url.searchParams.get('game');
  const json=(body,status)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  if(!['ssq','dlt'].includes(game))return json({error:'彩种不支持'},400);
  // Version the edge key to retire old cached responses, including incorrect dates.
  const key=new Request(`${url.origin}/api/draws?game=${game}&schema=2`);
  if(url.searchParams.get('refresh')!=='1') {
    const cached=await cache.match(key);
    if(cached)return json(await cached.json(),200);
  }
  try {
    const result=await fetchDraws(game,fetcher);
    ctx.waitUntil(cache.put(key,Response.json(result,{headers:{'Cache-Control':'public, max-age=300'}})).catch(()=>{}));
    return json(result,200);
  } catch {
    return json({game,draws:[],fallback:true,message:'官方数据源暂不可用，正在显示已收录数据。可手动输入开奖号码核对。'},503);
  }
}
