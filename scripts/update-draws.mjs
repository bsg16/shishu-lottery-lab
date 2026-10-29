import fs from 'node:fs/promises';
import { fetchDraws } from '../server/draws.js';

const path=new URL('../data/latest-draws.json',import.meta.url);
const snapshot=await fs.readFile(path,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return {games:{}};throw error;});
const results=await Promise.allSettled(['ssq','dlt'].map(async game=>{
  const result=await fetchDraws(game);
  snapshot.games[game]=result;
  console.log(`${game}: ${result.draws[0].issue} (${result.draws[0].date}), ${result.sourceName}`);
}));
for(const [index,result] of results.entries())if(result.status==='rejected')console.warn(`${['ssq','dlt'][index]}: source unavailable; keeping the previous snapshot.`);
if(results.every(r=>r.status==='rejected'))throw new Error('No official source available; snapshot unchanged.');
await fs.writeFile(path,JSON.stringify(snapshot,null,2)+'\n');
