import {cp,mkdir,rm,writeFile} from 'node:fs/promises';

const output=new URL('../pages/dist/',import.meta.url);
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await cp(new URL('../public/',import.meta.url),output,{recursive:true});
await cp(new URL('../pages/worker.js',import.meta.url),new URL('_worker.js',output));
await writeFile(new URL('_routes.json',output),JSON.stringify({version:1,include:['/api/*'],exclude:[]},null,2)+'\n');
console.log('Built Pages assets and internal API binding. No personal ticket files included.');
