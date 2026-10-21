import fs from 'node:fs';
import path from 'node:path';
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);
for(const file of [...walk('app'),...walk('components')].filter(f=>/\.(jsx|js)$/.test(f))){
 let s=fs.readFileSync(file,'utf8');
 s=s.replace(/src="\/(mycrobo[^" ]+)\.png"/g,'src="/images/$1.webp"');
 fs.writeFileSync(file,s);
}
let css=fs.readFileSync('app/globals.css','utf8').replaceAll('.product-autonomy-hero h2','.product-autonomy-hero :is(h1,h2)').replace(/\.control-hero\.product-autonomy-hero h1\{[^}]+\}/,'');
fs.writeFileSync('app/globals.css',css);
const p=JSON.parse(fs.readFileSync('package.json','utf8'));
p.devDependencies.sharp=JSON.parse(fs.readFileSync('node_modules/sharp/package.json','utf8')).version;
p.scripts['build']='next build && node scripts/export-aliases.mjs';
p.scripts['assets']='node scripts/optimize-assets.mjs';
fs.writeFileSync('package.json',JSON.stringify(p,null,2));
