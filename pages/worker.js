export default {
  async fetch(request,env) {
    if(!new URL(request.url).pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
    try {
      // Preserve the URL, Origin and encrypted body for the existing API's checks.
      return await env.LOTTERY_API.fetch(request);
    } catch {
      return Response.json({error:'云端暂时连接失败，请稍后重试；本机号码会保留'},
        {status:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
  }
};
