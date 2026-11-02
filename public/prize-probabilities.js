import { GAMES, choose, prizeRank } from './domain.js';

// Exactly one highest regular prize per basic bet; rank 0 means no regular prize.
// For KL8, count equally likely k-number selections against a fixed 20-number draw.
export function singleBetOdds(game, { issue, pick = 10 } = {}) {
  const cfg = GAMES[game];
  if (!cfg) throw new Error('不支持的彩种');
  const counts = {};
  const add = (rank, count) => { counts[rank] = (counts[rank] || 0) + count; };
  let total;
  if (game === 'kl8') {
    if (!Number.isInteger(pick) || pick < 1 || pick > 10) throw new Error('快乐8玩法不合法');
    total = choose(80, pick);
    for (let hits = 0; hits <= pick; hits++) {
      add(prizeRank(game, hits, 0, issue ?? '2025350', pick), choose(20, hits) * choose(60, pick - hits));
    }
  } else {
    total = cfg.total;
    for (let main = 0; main <= cfg.mainK; main++) for (let extra = 0; extra <= cfg.extraK; extra++) {
      const count = choose(cfg.mainK, main) * choose(cfg.mainN - cfg.mainK, cfg.mainK - main)
        * choose(cfg.extraK, extra) * choose(cfg.extraN - cfg.extraK, cfg.extraK - extra);
      add(prizeRank(game, main, extra, issue ?? '26014'), count);
    }
  }
  const probabilities = Object.fromEntries(Object.entries(counts).map(([rank, count]) => [rank, count / total]));
  const noPrize = (counts[0] || 0) / total;
  return { total, counts, probabilities, noPrize, anyPrize: (total - (counts[0] || 0)) / total };
}

export function formatOdds(probability) {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('概率不合法');
  // Significant digits keep jackpot probabilities visible instead of rounding to 0%.
  const percent = `${(probability * 100).toLocaleString('zh-CN', { maximumSignificantDigits: 4 })}%`;
  const denominator = 1 / probability;
  const oneIn = probability === 0 ? null : denominator.toLocaleString('zh-CN', { maximumFractionDigits: denominator < 1000 ? 2 : 0 });
  return { percent, oneIn };
}
