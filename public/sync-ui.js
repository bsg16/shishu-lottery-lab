import { SyncClient, SYNC_STORE } from './sync-client.js';
export function setupCloudSync({getEntries,onEntries,notify}) {
  const $=id=>document.getElementById(id);
  const client=new SyncClient({storage:localStorage,getEntries,onEntries,onStatus:({kind,message})=>{
    $('cloud-status').textContent=message; $('cloud-status').dataset.state=kind;
    $('cloud-dialog-status').textContent=message;
    $('cloud-now').disabled=kind==='syncing'||kind==='off';
    $('cloud-manage').textContent=kind==='off'?'启用云端同步 ↗':'管理同步码 ↗';
  }});
  const render=()=>{
    let state;try{state=client.read();}catch{}
    $('cloud-start').hidden=!!state; $('cloud-connected').hidden=!state;
    $('sync-code').type='password';$('sync-code').value=state?client.displayCode():'';$('cloud-reveal').textContent='显示同步码';
    $('cloud-shorten').hidden=!state||!!state.shortCode;
    $('sync-code-hint').textContent=state?.shortCode?'8位字母数字，不区分大小写；输入时可以省略横线。原长码仍可连接同一号码库。':'原长码仍可使用；生成8位短码后，号码库和已连接设备保持不变。';
  };
  const act=async action=>{
    $('cloud-error').hidden=true;
    for(const id of ['cloud-create','cloud-connect','cloud-shorten','cloud-disconnect'])$(id).disabled=true;
    try{await action();}
    catch(error){$('cloud-error').textContent=error.message;$('cloud-error').hidden=false;}
    finally{render();for(const id of ['cloud-create','cloud-connect','cloud-shorten','cloud-disconnect'])$(id).disabled=false;}
  };
  $('cloud-manage').addEventListener('click',()=>{$('cloud-error').hidden=true;render();$('cloud-dialog').showModal();});
  $('cloud-now').addEventListener('click',()=>void client.sync());
  $('cloud-create').addEventListener('click',()=>act(async()=>{if(await client.create())notify('已创建8位同步码，请妥善保存');}));
  $('cloud-shorten').addEventListener('click',()=>act(async()=>{if(await client.shorten())notify('已生成8位短码，原来的号码和设备连接均保留');}));
  $('cloud-connect-form').addEventListener('submit',event=>{event.preventDefault();void act(async()=>{await client.connect($('cloud-input').value);$('cloud-input').value='';notify('已连接，当前设备与云端号码已合并');});});
  $('cloud-reveal').addEventListener('click',()=>{$('sync-code').type=$('sync-code').type==='password'?'text':'password';$('cloud-reveal').textContent=$('sync-code').type==='password'?'显示同步码':'隐藏同步码';});
  $('cloud-copy').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(client.displayCode());notify('同步码已复制，请仅保存在你信任的地方');}
    catch{$('sync-code').type='text';$('sync-code').select();notify('请选中并复制同步码');}
  });
  $('cloud-disconnect').addEventListener('click',()=>{client.disconnect();render();notify('已断开同步，本机和云端号码均保留');});
  $('cloud-dialog').addEventListener('close',()=>{$('sync-code').value='';$('cloud-input').value='';});
  window.addEventListener('online',()=>void client.sync());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void client.sync();});
  window.addEventListener('storage',event=>{if(event.key===SYNC_STORE){client.epoch++;client.start();}});
  client.start(); return client;
}
