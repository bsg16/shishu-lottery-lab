const requestError=(code,message)=>Object.assign(new Error(message),{code});

// Keep the deadline active until JSON finishes downloading. AbortController is
// supported by browsers that predate AbortSignal.timeout; the timer also bounds
// requests from transports that do not honor cancellation.
export async function fetchJSON(url,options={}, {fetcher=(...args)=>globalThis.fetch(...args),timeoutMs=15000,retries=0,retryDelayMs=300}={}) {
  const method=(options.method||'GET').toUpperCase();
  for(let attempt=0;;attempt++) {
    const controller=new AbortController();
    let timer,timedOut=false;
    try {
      const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{
        timedOut=true;
        reject(requestError('TIMEOUT','连接云端超时，请检查网络后重试；本机号码已保留'));
        controller.abort();
      },timeoutMs);});
      const operation=(async()=>{
        const response=await fetcher(url,{...options,signal:controller.signal});
        let result;
        try{result=await response.json();}
        catch(error){
          if(error instanceof SyntaxError)throw requestError('INVALID_RESPONSE','云端返回的内容异常，请刷新页面后重试；本机号码已保留');
          throw error;
        }
        return {response,result};
      })();
      return await Promise.race([operation,deadline]);
    } catch(error) {
      const failure=timedOut?requestError('TIMEOUT','连接云端超时，请检查网络后重试；本机号码已保留')
        :error?.code==='INVALID_RESPONSE'?error
        :requestError('NETWORK','暂时无法连接云端，请刷新页面或切换网络后重试；本机号码已保留');
      // Never replay a write: its response may have been lost after it succeeded.
      if(method!=='GET'||attempt>=retries||failure.code==='INVALID_RESPONSE')throw failure;
    } finally {clearTimeout(timer);}
    await new Promise(resolve=>setTimeout(resolve,retryDelayMs));
  }
}
