import fs from 'node:fs';
import path from 'node:path';
const routes=JSON.parse(fs.readFileSync('docs/routes.json','utf8'));
for(const {route} of routes){
 if(route==='/')continue;
 fs.copyFileSync(path.join('out',route,'index.html'),path.join('out',route.slice(0,-1)+'.html'));
}
console.log('Legacy .html URLs exported.');
