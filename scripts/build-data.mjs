import fs from 'node:fs/promises';
import { mergeDraws } from '../public/domain.js';
const analysis = JSON.parse(await fs.readFile(new URL('../five-year-analysis.json', import.meta.url)));
const ssqRaw = JSON.parse(await fs.readFile(new URL('../data/ssq-five-year-raw.json', import.meta.url)));
const latest = JSON.parse(await fs.readFile(new URL('../data/latest-draws.json', import.meta.url)));
const ssqPrizes = new Map(ssqRaw.response.result.map(r => [r.code, Object.fromEntries(r.prizegrades.filter(p => Number(p.type) <= 6).map(p => [String(p.type), Number(String(p.typemoney).replaceAll(',', '')) || null]))]));
const payload = { snapshotDate: analysis.end, sources: {
  ssq: 'https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/',
  ssqBackup: 'https://www.scflcp.com.cn/ssq',
  dlt: 'https://api.js-lottery.com/wfzq/dlt/data',
  dltHistory: 'https://www.gstc.org.cn/wanfa/dlt_history'
}, games: {} };
for (const [game, data] of Object.entries(analysis.games)) {
  payload.games[game] = {
    draws: data.draws.map(r => ({ ...r, ...(game === 'ssq' ? { prizes: ssqPrizes.get(r.issue) } : {}) })).reverse(),
    study: { from: analysis.start, to: analysis.end, count: data.draws.length, structure: data.structure,
      backtests: Object.values(data.backtests).map(r => ({ name: r.name, count: r.draw_count, mean: r.mean_hits, baseline: r.null_mean_hits, p: r.p_holm })) }
  };
  if(latest.games[game]) {
    payload.games[game].draws=mergeDraws(game,payload.games[game].draws,latest.games[game].draws);
    payload.games[game].sourceName=latest.games[game].sourceName;
    payload.snapshotDate=[payload.snapshotDate,latest.games[game].checkedAt.slice(0,10)].sort().at(-1);
  }
}
await fs.mkdir(new URL('../public/', import.meta.url), { recursive: true });
await fs.writeFile(new URL('../public/history.json', import.meta.url), JSON.stringify(payload));
console.log(`Built public data: ${Object.values(payload.games).reduce((n, g) => n + g.draws.length, 0)} draws. No saved personal tickets included.`);
