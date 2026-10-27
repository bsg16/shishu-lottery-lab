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
    $('sync-code').type='password';$('sync-code').value=state?.code||'';$('cloud-reveal').textContent='显示同步码';
    $('cloud-error').hidden=true;
  };
  const act=async action=>{
    $('cloud-error').hidden=true;
    $('cloud-create').disabled=true;$('cloud-connect').disabled=true;
    try{await action();render();}
    catch(error){$('cloud-error').textContent=error.message;$('cloud-error').hidden=false;}
    finally{$('cloud-create').disabled=false;$('cloud-connect').disabled=false;}
  };
  $('cloud-manage').addEventListener('click',()=>{render();$('cloud-dialog').showModal();});
  $('cloud-now').addEventListener('click',()=>void client.sync());
  $('cloud-create').addEventListener('click',()=>act(async()=>{await client.create();notify('云端同步已启用，请保存你的私人同步码');}));
  $('cloud-connect-form').addEventListener('submit',event=>{event.preventDefault();void act(async()=>{await client.connect($('cloud-input').value);$('cloud-input').value='';notify('已连接，当前设备与云端号码已合并');});});
  $('cloud-reveal').addEventListener('click',()=>{$('sync-code').type=$('sync-code').type==='password'?'text':'password';$('cloud-reveal').textContent=$('sync-code').type==='password'?'显示同步码':'隐藏同步码';});
  $('cloud-copy').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(client.read().code);notify('同步码已复制，请仅保存在你信任的地方');}
    catch{$('sync-code').type='text';$('sync-code').select();notify('请选中并复制同步码');}
  });
  $('cloud-disconnect').addEventListener('click',()=>{client.disconnect();render();notify('已断开同步，本机和云端号码均保留');});
  $('cloud-dialog').addEventListener('close',()=>{$('sync-code').value='';$('cloud-input').value='';});
  window.addEventListener('online',()=>void client.sync());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void client.sync();});
  window.addEventListener('storage',event=>{if(event.key===SYNC_STORE){client.epoch++;client.start();}});
  client.start(); return client;
}
