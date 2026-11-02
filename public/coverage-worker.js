import { generateCoveragePlan } from './coverage.js';
self.onmessage=event=>{
  try { self.postMessage({type:'result',plan:generateCoveragePlan(event.data,undefined,progress=>self.postMessage({type:'progress',...progress}))}); }
  catch(error){self.postMessage({type:'error',message:error.message||'覆盖计算失败，请重试'});}
};
