import { SyncClient, SYNC_STORE } from './sync-client.js';
export function setupCloudSync({getEntries,onEntries,notify}) {
  const $=id=>document.getElementById(id);
  const client=new SyncClient({storage:localStorage,getEntries,onEntries,onStatus:({kind,message})=>{
    $('cloud-status').textContent=message; $('cloud-status').dataset.state=kind;
    $('cloud-dialog-status').textContent=message;
    $('cloud-now').disabled=kind==='syncing'||kind==='off';
    $('cloud-manage').textContent=kind==='off'?'启用云端同步 ↗':'管理同步名 ↗';
  }});
  const render=()=>{
    let state;try{state=client.read();}catch{}
    $('cloud-start').hidden=!!state; $('cloud-connected').hidden=!state;
    $('sync-code').type='password';$('sync-code').value=state?client.displayCode():'';$('cloud-reveal').textContent='显示';
    $('sync-code-label').textContent=state?.syncName?'你的自定义同步名':'你的私人同步码';
    $('sync-code-hint').textContent=state?.syncName?'其他设备输入这个名字即可连接同一号码库；英文不区分大小写。':state?.shortCode?'原8位短码仍可使用，也可以在下面给号码库起个名字。':'原长码仍可使用，也可以在下面给号码库起个名字。';
  };
  const act=async action=>{
    $('cloud-error').hidden=true;
    for(const id of ['cloud-create','cloud-connect','cloud-set-name','cloud-disconnect'])$(id).disabled=true;
    try{await action();}
    catch(error){$('cloud-error').textContent=error.message;$('cloud-error').hidden=false;}
    finally{render();for(const id of ['cloud-create','cloud-connect','cloud-set-name','cloud-disconnect'])$(id).disabled=false;}
  };
  $('cloud-manage').addEventListener('click',()=>{$('cloud-error').hidden=true;render();$('cloud-dialog').showModal();});
  $('cloud-now').addEventListener('click',()=>void client.sync());
  $('cloud-create-form').addEventListener('submit',event=>{event.preventDefault();void act(async()=>{if(await client.create($('cloud-name').value)){$('cloud-name').value='';notify('同步名已创建，其他设备输入同名即可恢复');}});});
  $('cloud-name-form').addEventListener('submit',event=>{event.preventDefault();void act(async()=>{if(await client.setSyncName($('cloud-new-name').value)){$('cloud-new-name').value='';notify('同步名已保存，原号码库和连接方式均保留');}});});
  $('cloud-connect-form').addEventListener('submit',event=>{event.preventDefault();void act(async()=>{await client.connect($('cloud-input').value);$('cloud-input').value='';notify('已连接，当前设备与云端号码已合并');});});
  $('cloud-reveal').addEventListener('click',()=>{$('sync-code').type=$('sync-code').type==='password'?'text':'password';$('cloud-reveal').textContent=$('sync-code').type==='password'?'显示':'隐藏';});
  $('cloud-copy').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(client.displayCode());notify('已复制，请仅保存在你信任的地方');}
    catch{$('sync-code').type='text';$('sync-code').select();notify('请选中并复制');}
  });
  $('cloud-disconnect').addEventListener('click',()=>{client.disconnect();render();notify('已断开同步，本机和云端号码均保留');});
  $('cloud-dialog').addEventListener('close',()=>{for(const id of ['sync-code','cloud-input','cloud-name','cloud-new-name'])$(id).value='';});
  window.addEventListener('online',()=>void client.sync());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void client.sync();});
  window.addEventListener('storage',event=>{if(event.key===SYNC_STORE){client.storageChanged(event.oldValue);if($('cloud-dialog').open)render();}});
  client.start(); return client;
}
