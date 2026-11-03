import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
await fs.mkdir('public/images',{recursive:true});
for(const name of await fs.readdir('public')){
 if(!name.endsWith('.png'))continue;
 const width=name.includes('logo')?600:name.includes('mark')?256:1680;
 await sharp(path.join('public',name)).resize({width,withoutEnlargement:true}).webp({quality:88}).toFile(path.join('public/images',name.replace('.png','.webp')));
}
console.log('Optimized static WebP images generated; original PNG files preserved.');
