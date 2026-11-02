import test from 'node:test';
import assert from 'node:assert/strict';
import { singleBetOdds, formatOdds } from '../public/prize-probabilities.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-14, `${actual} != ${expected}`);

test('双色球六个常规奖级精确计数，排除3+0福运奖且不重复计算蓝球奖', () => {
  const odds = singleBetOdds('ssq');
  assert.equal(odds.total, 17721088);
  assert.deepEqual(odds.counts, {0:16532100,1:1,2:15,3:162,4:7695,5:137475,6:1043640});
  close(odds.anyPrize, 1188988 / 17721088);
  close(odds.probabilities[1], 1 / 17721088);
  close(Object.values(odds.probabilities).reduce((sum,p)=>sum+p,0), 1);
});

test('大乐透现行七奖级与历史九奖级分别合并正确的命中条件', () => {
  const current = singleBetOdds('dlt', {issue:'26014'});
  const historical = singleBetOdds('dlt', {issue:'26013'});
  assert.equal(current.total, 21425712);
  assert.deepEqual(current.counts, {0:19996515,1:1,2:20,3:195,4:3000,5:11100,6:127600,7:1287281});
  assert.deepEqual(historical.counts, {0:19996515,1:1,2:20,3:45,4:150,5:3000,6:4350,7:6750,8:127600,9:1287281});
  assert.equal(current.anyPrize, historical.anyPrize);
  close(current.anyPrize, 1429197 / 21425712);
  close(current.noPrize + current.anyPrize, 1);
  assert.throws(() => singleBetOdds('dlt', {issue:'21122'}));
});

test('快乐8选一至选十每个奖级与独立BigInt组合计数一致，含全不中返还', () => {
  const combination = (n,k) => {
    let v=1n;
    for(let i=1;i<=k;i++)v=v*BigInt(n-i+1)/BigInt(i);
    return v;
  };
  // Prize-bearing hit counts from the official regular prize table.
  const hitsByPick = [[1],[2],[2,3],[2,3,4],[3,4,5],[3,4,5,6],[0,4,5,6,7],[0,4,5,6,7,8],[0,4,5,6,7,8,9],[0,5,6,7,8,9,10]];
  for(let pick=1;pick<=10;pick++) {
    const odds=singleBetOdds('kl8',{pick}),total=combination(80,pick);
    let winning=0n;
    assert.equal(BigInt(odds.total),total);
    for(const hits of hitsByPick[pick-1]) {
      const count=combination(20,hits)*combination(60,pick-hits);
      assert.equal(BigInt(odds.counts[`x${pick}z${hits}`]),count);
      close(odds.probabilities[`x${pick}z${hits}`],Number(count)/Number(total));
      winning+=count;
    }
    assert.equal(BigInt(odds.counts[0]),total-winning);
    close(odds.anyPrize,Number(winning)/Number(total));
    close(odds.noPrize+odds.anyPrize,1);
  }
  const ten=singleBetOdds('kl8',{pick:10});
  assert.equal(ten.total,1646492110120);
  assert.equal(ten.total-ten.counts[0],181856005870);
  close(singleBetOdds('kl8',{pick:1}).probabilities.x1z1,0.25);
});

test('极小头奖概率不会显示0%，倒数可读且大分母不损失整数位', () => {
  assert.deepEqual(formatOdds(1/17721088),{percent:'0.000005643%',oneIn:'17,721,088'});
  assert.deepEqual(formatOdds(1/21425712),{percent:'0.000004667%',oneIn:'21,425,712'});
  assert.deepEqual(formatOdds(0.25),{percent:'25%',oneIn:'4'});
  assert.deepEqual(formatOdds(0),{percent:'0%',oneIn:null});
  for(const invalid of [-1,1.1,NaN,Infinity])assert.throws(()=>formatOdds(invalid));
  for(const pick of [0,11,1.5])assert.throws(()=>singleBetOdds('kl8',{pick}));
  assert.throws(()=>singleBetOdds('other'));
});
