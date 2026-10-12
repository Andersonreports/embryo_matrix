// Writes backend/app/client_directory.json from frontend/clients.js so the server resolves client names
// exactly like the browser does. Run after rebuilding clients.js:  node tools/client_directory/export_json.js
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..','..'),src=fs.readFileSync(path.join(root,'frontend','clients.js'),'utf8');
const patched=src.replace("global.resolveClient=resolveClient;","global.__dir={BRANCHES,ALIASES,NOT_LISTED_NAMES,STOP:[...STOP]};global.resolveClient=resolveClient;");
if(patched===src)throw new Error('clients.js layout changed');
const g={};new Function('globalThis','module',patched.replace("(typeof window!=='undefined'?window:globalThis)","(globalThis)"))(g,undefined);
fs.writeFileSync(path.join(root,'backend','app','client_directory.json'),JSON.stringify(g.__dir));
console.log('client_directory.json:',g.__dir.BRANCHES.length,'branches,',g.__dir.ALIASES.length,'aliases');
