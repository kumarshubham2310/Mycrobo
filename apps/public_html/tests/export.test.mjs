import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'parse5';
const routes=JSON.parse(fs.readFileSync('docs/routes.json','utf8'));
function collect(node, predicate, results=[]){ if(predicate(node))results.push(node);for(const child of node.childNodes||[])collect(child,predicate,results);return results; }
const attr=(node,key)=>node.attrs?.find(a=>a.name===key)?.value;
for(const {route,title} of routes){
 test(`${route}: export, SEO, images and internal destinations`,()=>{
  const html=fs.readFileSync(path.join('out',route,'index.html'),'utf8');
  const doc=parse(html);
  assert.ok(html.includes(title.replaceAll('&','&amp;')));
  assert.equal(collect(doc,n=>n.tagName==='h1').length,1);
  assert.ok(collect(doc,n=>n.tagName==='meta'&&attr(n,'name')==='description').length);
  assert.ok(collect(doc,n=>n.tagName==='link'&&attr(n,'rel')==='canonical').length);
  for(const image of collect(doc,n=>n.tagName==='img')){
   assert.notEqual(attr(image,'alt'),undefined);
   const src=attr(image,'src');if(src?.startsWith('/'))assert.ok(fs.existsSync(path.join('out',decodeURIComponent(src))),src);
  }
  for(const link of collect(doc,n=>n.tagName==='a')){
   const href=attr(link,'href');if(!href?.startsWith('/')||href.startsWith('//'))continue;
   const [destination,hash]=href.split('#');
   const file=path.extname(destination)?path.join('out',destination):path.join('out',destination,'index.html');
   assert.ok(fs.existsSync(file),`${route} → ${href}`);
   if(hash){const target=parse(fs.readFileSync(file,'utf8'));assert.ok(collect(target,n=>attr(n,'id')===hash).length,href);}
  }
 });
}
