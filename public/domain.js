export const GAMES = {
  ssq: { name: '双色球', mainN: 33, mainK: 6, extraN: 16, extraK: 1, mainLabel: '红球', extraLabel: '蓝球', total: 17721088 },
  dlt: { name: '大乐透', mainN: 35, mainK: 5, extraN: 12, extraK: 2, mainLabel: '前区', extraLabel: '后区', total: 21425712 }
};
export const pad = n => String(n).padStart(2, '0');
export function choose(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || n < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= Math.min(k, n - k); i++) r = r * (n - i + 1) / i;
  return Math.round(r);
}
export function canonicalIssue(game, value) {
  const s = String(value).trim();
  if (s.endsWith('000')) throw new Error('期号末三位不能为000');
  if (game === 'dlt' && /^20\d{5}$/.test(s)) return s.slice(2);
  if (game === 'dlt' && /^\d{5}$/.test(s)) return s;
  if (game === 'ssq' && /^20\d{5}$/.test(s)) return s;
  throw new Error(game === 'ssq' ? '双色球期号应为7位，例如2026122' : '大乐透期号应为5位，例如26122');
}
export function validateNumbers(numbers, n, min, max = min) {
  return Array.isArray(numbers) && numbers.length >= min && numbers.length <= max && new Set(numbers).size === numbers.length && numbers.every(v => Number.isInteger(v) && v >= 1 && v <= n);
}
export function validateDraw(game, draw) {
  const cfg = GAMES[game];
  return !!cfg && !!draw && validateNumbers(draw.main, cfg.mainN, cfg.mainK) && validateNumbers(draw.extra, cfg.extraN, cfg.extraK);
}
export function validateEntry(entry) {
  const cfg = GAMES[entry?.game];
  if (!cfg || !['single', 'compound'].includes(entry.mode) || !Number.isInteger(entry.multiplier) || entry.multiplier < 1 || entry.multiplier > 99 || typeof entry.additional !== 'boolean') return false;
  if (entry.game === 'ssq' && entry.additional) return false;
  if (!Array.isArray(entry.tickets) || entry.tickets.length < 1 || entry.tickets.length > 50 || (entry.mode === 'compound' && entry.tickets.length !== 1)) return false;
  return entry.tickets.every(t => validateNumbers(t.main, cfg.mainN, cfg.mainK, entry.mode === 'single' ? cfg.mainK : cfg.mainN) && validateNumbers(t.extra, cfg.extraN, cfg.extraK, entry.mode === 'single' ? cfg.extraK : cfg.extraN));
}
export function ticketKey(ticket) { return `${[...ticket.main].sort((a,b)=>a-b).join(',')}|${[...ticket.extra].sort((a,b)=>a-b).join(',')}`; }
export function planTotals(entry) {
  if (!validateEntry(entry)) throw new Error('方案参数不完整或号码不合法');
  const g = GAMES[entry.game];
  const combinations = entry.tickets.reduce((sum,t) => sum + choose(t.main.length,g.mainK) * choose(t.extra.length,g.extraK), 0);
  const unique = entry.mode === 'single' ? new Set(entry.tickets.map(ticketKey)).size : combinations;
  return { combinations, bets: combinations * entry.multiplier, cost: combinations * entry.multiplier * (entry.additional ? 3 : 2), jackpot: unique / g.total };
}
export function prizeRank(game, main, extra, issue) {
  if (game === 'ssq') {
    if (main === 6) return extra ? 1 : 2;
    if (main === 5) return extra ? 3 : 4;
    if (main === 4) return extra ? 4 : 5;
    if (main === 3 && extra) return 5;
    if (extra) return 6;
    return 0;
  }
  if (Number(canonicalIssue(game,issue)) < 21123) throw new Error('暂仅支持大乐透第21123期及以后的常规规则核对');
  const modern = Number(canonicalIssue(game,issue)) >= 26014;
  const groups = modern ? [[[5,2]],[[5,1]],[[5,0],[4,2]],[[4,1]],[[4,0],[3,2]],[[3,1],[2,2]],[[3,0],[2,1],[1,2],[0,2]]]
    : [[[5,2]],[[5,1]],[[5,0]],[[4,2]],[[4,1]],[[3,2]],[[4,0]],[[3,1],[2,2]],[[3,0],[2,1],[1,2],[0,2]]];
  const i = groups.findIndex(group => group.some(([a,b]) => a === main && b === extra));
  return i < 0 ? 0 : i + 1;
}
export function checkEntry(entry, draw) {
  if (!validateEntry(entry) || !validateDraw(entry.game, draw)) throw new Error('方案或开奖号码不合法');
  canonicalIssue(entry.game,draw.issue);
  const g = GAMES[entry.game], ranks = {}, matches = [];
  for (const ticket of entry.tickets) {
    const hitMain = ticket.main.filter(n => draw.main.includes(n)).length;
    const hitExtra = ticket.extra.filter(n => draw.extra.includes(n)).length;
    matches.push({ main: hitMain, extra: hitExtra });
    for (let a = 0; a <= g.mainK; a++) for (let b = 0; b <= g.extraK; b++) {
      const ways = choose(hitMain,a) * choose(ticket.main.length-hitMain,g.mainK-a) * choose(hitExtra,b) * choose(ticket.extra.length-hitExtra,g.extraK-b);
      const rank = prizeRank(entry.game,a,b,draw.issue);
      if (ways && rank) ranks[rank] = (ranks[rank] || 0) + ways * entry.multiplier;
    }
  }
  const winningBets = Object.values(ranks).reduce((a,b)=>a+b,0);
  let knownAmount = 0, allAmountsKnown = winningBets > 0;
  for (const [rank,count] of Object.entries(ranks)) {
    const value = draw.prizes?.[rank];
    if (typeof value !== 'number' || value <= 0 || (entry.additional && Number(rank) <= 2)) allAmountsKnown = false;
    else knownAmount += value * count;
  }
  return { ranks, matches, winningBets, additionalWinningBets: entry.additional ? (ranks[1] || 0) + (ranks[2] || 0) : 0, knownAmount, allAmountsKnown, total: planTotals(entry) };
}
export function statistics(draws, game, zone, limit = 50) {
  const cfg = GAMES[game], n = zone === 'main' ? cfg.mainN : cfg.extraN;
  const recent = [...draws].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,limit);
  return Array.from({length:n},(_,i) => {
    const number = i + 1;
    const last = recent.findIndex(r => r[zone].includes(number));
    return { number, count: recent.filter(r=>r[zone].includes(number)).length, omission: last < 0 ? recent.length : last };
  });
}
function randomUnit() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
function weightedSample(values, size, weight, random) {
  const pool = [...values], result = [];
  for (let i = 0; i < size; i++) {
    let point = random() * pool.reduce((sum,n) => sum + weight(n),0), index = pool.length - 1;
    for (let j = 0; j < pool.length; j++) { point -= weight(pool[j]); if (point < 0) { index = j; break; } }
    result.push(pool.splice(index,1)[0]);
  }
  return result;
}
export function generatePlan(options, draws = [], random = randomUnit) {
  const g = GAMES[options.game];
  if (!g || !['random','hot','cold','overdue'].includes(options.strategy)) throw new Error('请选择有效的彩种与选号方式');
  const count = options.mode === 'compound' ? 1 : options.count;
  const mainSize = options.mode === 'compound' ? options.mainSize : g.mainK;
  const extraSize = options.mode === 'compound' ? options.extraSize : g.extraK;
  if (!Number.isInteger(count) || count < 1 || count > 50 || !Number.isInteger(mainSize) || mainSize < g.mainK || mainSize > g.mainN || !Number.isInteger(extraSize) || extraSize < g.extraK || extraSize > g.extraN) throw new Error('请检查注数与复式号码数量');
  const weightFor = zone => {
    const stats = statistics(draws,options.game,zone,50), max = Math.max(0,...stats.map(x=>x.count));
    return number => { const x = stats[number-1]; return options.strategy === 'hot' ? x.count+1 : options.strategy === 'cold' ? max-x.count+1 : options.strategy === 'overdue' ? x.omission+1 : 1; };
  };
  const mainWeight = weightFor('main'), extraWeight = weightFor('extra');
  const mainPool = Array.from({length:g.mainN},(_,i)=>i+1), extraPool = Array.from({length:g.extraN},(_,i)=>i+1);
  const extraPairs = g.extraK === 1 ? extraPool.map(x=>[x]) : extraPool.flatMap((a,i)=>extraPool.slice(i+1).map(b=>[a,b]));
  const used = new Set(), tickets = [];
  let remainingPairs = [...extraPairs];
  for (let attempt = 0; tickets.length < count && attempt < 5000; attempt++) {
    const main = weightedSample(mainPool,mainSize,mainWeight,random).sort((a,b)=>a-b);
    let extra, pair;
    if (options.spread && options.mode === 'single') {
      if (!remainingPairs.length) remainingPairs = [...extraPairs];
      pair = weightedSample(remainingPairs,1,p => p.reduce((v,n)=>v*extraWeight(n),1),random)[0];
      extra = [...pair];
    } else extra = weightedSample(extraPool,extraSize,extraWeight,random).sort((a,b)=>a-b);
    const key = ticketKey({main,extra});
    if (used.has(key)) continue;
    used.add(key); tickets.push({main,extra});
    if (pair) remainingPairs.splice(remainingPairs.indexOf(pair),1);
  }
  if (tickets.length !== count) throw new Error('本次未能生成足够的不同组合，请重试');
  const result = { game: options.game, mode: options.mode, multiplier: options.multiplier, additional: options.game === 'dlt' && !!options.additional, strategy: options.strategy, tickets };
  planTotals(result);
  return result;
}
export function ticketText(entry) { return entry.tickets.map(t => `${t.main.map(pad).join(' ')} + ${t.extra.map(pad).join(' ')}`).join('\n'); }
export function mergeDraws(game, existing, updates) {
  const map = new Map(existing.map(r=>[canonicalIssue(game,r.issue),r]));
  for (const r of updates) if (validateDraw(game,r) && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) map.set(canonicalIssue(game,r.issue),{...map.get(canonicalIssue(game,r.issue)),...r,issue:canonicalIssue(game,r.issue)});
  return [...map.values()].sort((a,b)=>Number(b.issue)-Number(a.issue));
}
