import { GAMES, choose, generatePlan, validateEntry, ticketKey } from './domain.js';

// Exact outcome counts, assuming independent uniform draws. Only regular prizes.
const C = Array.from({length:36},(_,n)=>Array.from({length:7},(_,k)=>choose(n,k)));
const SSQ_RED_TOTAL = choose(33,6);
const SSQ_RED_WIN = choose(6,4)*choose(27,2)+choose(6,5)*27+1;
const DLT_FRONT_TOTAL = choose(35,5);
const ALL = [0xffffffff,0xffffffff,3];
const PAIRS = Array.from({length:12},(_,a)=>Array.from({length:11-a},(_,j)=>[a+1,a+j+2])).flat();
const PAIR_MASKS = PAIRS.map(pair=>{
  const mask=[0,0,0];
  PAIRS.forEach((other,i)=>{if(other.some(n=>pair.includes(n)))mask[i>>>5]|=1<<(i&31);});
  return mask;
});
function randomUnit() { const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]/4294967296; }
function shuffled(values,random) {
  const copy=[...values];
  for(let i=copy.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}
  return copy;
}
function subsets(values,k) {
  const result=[],current=[];
  function visit(start) {
    if(current.length===k){result.push([...current]);return;}
    for(let i=start;i<=values.length-(k-current.length);i++){current.push(values[i]);visit(i+1);current.pop();}
  }
  visit(0);return result;
}
// Combinatorial number system: sorted k-subsets map bijectively to [0, C(n,k)).
function rankMerged(a,b) {
  let i=0,j=0,rank=0;
  for(let k=1;k<=a.length+b.length;k++){
    const n=j===b.length||(i<a.length&&a[i]<b[j])?a[i++]:b[j++];
    rank+=C[n-1][k];
  }
  return rank;
}
function neighborhoods(main,n,k,hit) {
  const outside=Array.from({length:n},(_,i)=>i+1).filter(v=>!main.includes(v));
  const insideSets=subsets(main,hit),outsideSets=subsets(outside,k-hit);
  const rows=new Uint32Array(insideSets.length*outsideSets.length);
  let i=0;
  for(const a of insideSets)for(const b of outsideSets)rows[i++]=rankMerged(a,b);
  return rows;
}
function wins(game,a,b) { return game==='ssq'?a>=4||b>=1:a>=3||b===2||(a>=2&&b>=1); }
function compoundCount(entry) {
  const g=GAMES[entry.game],t=entry.tickets[0];let count=0;
  for(let a=0;a<=g.mainK;a++)for(let b=0;b<=g.extraK;b++)if(wins(entry.game,a,b)){
    count+=choose(t.main.length,a)*choose(g.mainN-t.main.length,g.mainK-a)*choose(t.extra.length,b)*choose(g.extraN-t.extra.length,g.extraK-b);
  }
  return count;
}
function ssqCount(tickets) {
  const blues=new Set(tickets.flatMap(t=>t.extra)).size;
  if(blues===16)return GAMES.ssq.total;
  const covered=new Uint8Array(SSQ_RED_TOTAL);let redCount=0;
  for(const t of tickets)for(let hits=4;hits<=6;hits++)for(const row of neighborhoods([...t.main].sort((a,b)=>a-b),33,6,hits)){
    if(!covered[row]){covered[row]=1;redCount++;}
  }
  return blues*SSQ_RED_TOTAL+(16-blues)*redCount;
}
function popcount(x) {
  x-=(x>>>1)&0x55555555;x=(x&0x33333333)+((x>>>2)&0x33333333);
  return (((x+(x>>>4))&0x0f0f0f0f)*0x01010101)>>>24;
}
function dltCandidate(ticket) {
  const main=[...ticket.main].sort((a,b)=>a-b),extra=[...ticket.extra].sort((a,b)=>a-b);
  const high=new Uint32Array(4501);let offset=0;
  for(let hits=3;hits<=5;hits++){const rows=neighborhoods(main,35,5,hits);high.set(rows,offset);offset+=rows.length;}
  return {ticket:{main,extra},pair:PAIRS.findIndex(p=>p[0]===extra[0]&&p[1]===extra[1]),high,two:neighborhoods(main,35,5,2)};
}
// One row per possible front draw; three words encode the 66 back-pair outcomes.
// Full back matches are held separately, so scoring never needs a 21M-outcome scan.
function dltState() {
  const low=new Uint32Array(DLT_FRONT_TOTAL),mid=new Uint32Array(DLT_FRONT_TOTAL),high=new Uint32Array(DLT_FRONT_TOTAL);
  const masks=[low,mid,high],global=[0,0,0],columns=new Uint32Array(66);
  let count=0;
  const hasPair=p=>!!(global[p>>>5]&(1<<(p&31)));
  function gain(c) {
    const p=c.pair,word=p>>>5,bit=1<<(p&31);
    const remaining=ALL.map((all,j)=>(all&~global[j]&~(j===word?bit:0))>>>0);
    let total=hasPair(p)?0:DLT_FRONT_TOTAL-columns[p];
    const [a,b,d]=remaining;
    for(const row of c.high)total+=popcount(a&~low[row])+popcount(b&~mid[row])+popcount(d&~high[row]);
    const e=a&PAIR_MASKS[p][0],f=b&PAIR_MASKS[p][1],g=d&PAIR_MASKS[p][2];
    for(const row of c.two)total+=popcount(e&~low[row])+popcount(f&~mid[row])+popcount(g&~high[row]);
    return total;
  }
  function apply(rows,allowed) {
    for(let word=0;word<3;word++){
      const mask=allowed[word]&~global[word],values=masks[word];if(!mask)continue;
      for(const row of rows){
        let delta=(mask&~values[row])>>>0;values[row]|=mask;
        while(delta){const bit=31-Math.clz32(delta&-delta);columns[word*32+bit]++;delta=(delta&(delta-1))>>>0;}
      }
    }
  }
  return {
    gain,hasPair,get count(){return count;},
    add(c,increment=gain(c)) {
      count+=increment;global[c.pair>>>5]|=1<<(c.pair&31);
      apply(c.high,ALL);apply(c.two,PAIR_MASKS[c.pair]);
    }
  };
}
export function exactCoverage(entry) {
  if(!validateEntry(entry))throw new Error('方案参数不完整或号码不合法');
  let winningOutcomes;
  if(entry.mode==='compound')winningOutcomes=compoundCount(entry);
  else if(entry.game==='ssq')winningOutcomes=ssqCount(entry.tickets);
  else {
    const state=dltState();for(const t of entry.tickets)state.add(dltCandidate(t));winningOutcomes=state.count;
  }
  return {winningOutcomes,totalOutcomes:GAMES[entry.game].total,probability:winningOutcomes/GAMES[entry.game].total};
}
// The projective plane PG(2,5): 31 blocks of size six; any two intersect once.
// No six-number draw can hit four red numbers in two such blocks simultaneously.
function ssqTickets(count,random) {
  const labels=shuffled(Array.from({length:33},(_,i)=>i+1),random),lines=[];
  for(let m=0;m<5;m++)for(let b=0;b<5;b++)lines.push([...Array.from({length:5},(_,x)=>5*x+(m*x+b)%5),25+m]);
  for(let x=0;x<5;x++)lines.push([...Array.from({length:5},(_,y)=>5*x+y),30]);
  lines.push([25,26,27,28,29,30]);
  const reds=shuffled(lines,random).map(line=>line.map(i=>labels[i]).sort((a,b)=>a-b));
  const blues=shuffled(Array.from({length:16},(_,i)=>i+1),random),tickets=[];
  for(let i=0;i<count;i++){
    let main=i<reds.length?reds[i]:shuffled(labels,random).slice(0,6).sort((a,b)=>a-b);
    const extra=[blues[i%16]];
    // The construction's first 31 red blocks are distinct. Later rows use a fresh
    // red subset if necessary, while retaining the already complete blue cover.
    let retries=0;
    while(tickets.some(t=>ticketKey(t)===ticketKey({main,extra}))){
      if(++retries>1000)throw new Error('本次未能生成足够的不同组合，请重试');
      main=shuffled(labels,random).slice(0,6).sort((a,b)=>a-b);
    }
    tickets.push({main,extra});
  }
  return tickets;
}
export function generateCoveragePlan(options,random=randomUnit,onProgress=()=>{}) {
  const baseline=generatePlan({...options,strategy:'random',spread:true},[],random);
  const baselineCoverage=exactCoverage(baseline);
  let tickets=baseline.tickets,method='fixed-size',winningOutcomes=baselineCoverage.winningOutcomes,candidateCount=0;
  if(options.mode==='single'&&options.game==='ssq'){
    tickets=ssqTickets(options.count,random);method='proven-optimal';
    winningOutcomes=options.count>=16?GAMES.ssq.total:options.count*SSQ_RED_TOTAL+(16-options.count)*options.count*SSQ_RED_WIN;
  } else if(options.mode==='single'&&options.game==='dlt'&&options.count>1){
    const pool=baseline.tickets.map(dltCandidate),pairs=shuffled(PAIRS,random);let deck;
    for(let i=0;i<pairs.length;i++){
      if(i%7===0)deck=shuffled(Array.from({length:35},(_,j)=>j+1),random);
      pool.push(dltCandidate({main:deck.slice((i%7)*5,(i%7+1)*5),extra:pairs[i]}));
    }
    candidateCount=pool.length;
    const state=dltState(),selected=[];
    for(let i=0;i<options.count;i++){
      let best,bestGain=-1;
      for(const c of pool)if(!state.hasPair(c.pair)){
        const increment=state.gain(c);if(increment>bestGain){best=c;bestGain=increment;}
      }
      state.add(best,bestGain);selected.push(best.ticket);onProgress({completed:i+1,total:options.count});
    }
    if(state.count>=winningOutcomes){tickets=selected;winningOutcomes=state.count;}
    method='candidate-search';
  } else if(options.mode==='single')method='proven-optimal';
  return {...baseline,strategy:'coverage',tickets,coverage:{version:1,method,candidateCount,winningOutcomes,totalOutcomes:GAMES[options.game].total,probability:winningOutcomes/GAMES[options.game].total,baselineProbability:baselineCoverage.probability}};
}
