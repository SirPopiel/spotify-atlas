import {cpSync, mkdirSync, rmSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.cwd(),out=join(root,'dist');
rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
for(const f of ['index.html','favicon.svg','src/app.mjs','src/core.mjs','src/worker.mjs','src/styles.css','vendor/jszip.min.js']){
  const target=join(out,f);mkdirSync(join(target,'..'),{recursive:true});cpSync(join(root,f),target);
}
const text=readFileSync(join(out,'index.html'),'utf-8');
if(!text.includes('src/app.mjs'))throw Error('index.html does not reference app module.');
console.log('Built static GitHub Pages site in dist/ with zero personal data or fixtures.');
