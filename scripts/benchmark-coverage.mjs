import {generateCoveragePlan} from '../public/coverage.js';
const rng=initial=>{let seed=initial;return()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};};
for(const game of ['ssq','dlt']){
  const rows=[];
  for(let i=1;i<=20;i++){
    const start=performance.now();
    const {coverage}=generateCoveragePlan({game,mode:'single',count:10,multiplier:1,additional:false},rng(i*104729));
    rows.push({seed:i*104729,probability:coverage.probability,randomControl:coverage.baselineProbability,milliseconds:Math.round(performance.now()-start)});
  }
  const mean=key=>rows.reduce((sum,r)=>sum+r[key],0)/rows.length;
  console.log(JSON.stringify({game,count:10,seeds:20,meanProbability:mean('probability'),meanRandomControl:mean('randomControl'),meanGainPercentagePoints:100*(mean('probability')-mean('randomControl')),minProbability:Math.min(...rows.map(r=>r.probability)),maxProbability:Math.max(...rows.map(r=>r.probability)),maxMilliseconds:Math.max(...rows.map(r=>r.milliseconds)),rows},null,2));
}
