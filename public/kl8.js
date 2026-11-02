// Regular prizes effective from issue 2025350 (2025-12-30).
// null means a floating prize; published draw amounts take precedence.
export const KL8_PRIZES = {
  1:{1:4.5}, 2:{2:19}, 3:{3:52,2:3}, 4:{4:93,3:5,2:3},
  5:{5:1000,4:20,3:3}, 6:{6:2880,5:30,4:10,3:3},
  7:{7:8500,6:300,5:30,4:4,0:2},
  8:{8:50000,7:800,6:80,5:10,4:3,0:2},
  9:{9:null,8:2000,7:225,6:22,5:5,4:3,0:2},
  10:{10:null,9:8000,8:720,7:80,6:5,5:3,0:2}
};
const numerals=['零','一','二','三','四','五','六','七','八','九','十'];
export const kl8Name = pick => `选${numerals[pick]}`;
export function kl8RankName(rank) {
  const match=/^x(10|[1-9])z(10|[0-9])$/.exec(rank);
  return match ? `${kl8Name(Number(match[1]))}${Number(match[2]) ? '中'+numerals[Number(match[2])] : '全不中'}` : '';
}
export function kl8Distribution(pick) {
  if(!Number.isInteger(pick)||pick<1||pick>10)throw new Error('快乐8请选择选一至选十');
  // Hypergeometric distribution, computed with short products to avoid huge counts.
  const combination=(n,k)=>{if(k<0||k>n)return 0;let v=1;for(let i=1;i<=k;i++)v=v*(n-i+1)/i;return v;};
  return Array.from({length:pick+1},(_,hits)=>({hits,probability:combination(20,hits)*combination(60,pick-hits)/combination(80,pick),wins:Object.hasOwn(KL8_PRIZES[pick],hits)}));
}
