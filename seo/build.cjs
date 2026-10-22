const fs = require('node:fs/promises');
const path = require('node:path');
const {root,load,render,sitemap} = require('./core.cjs');
async function build(data, output = path.join(root,'dist')) {
  if (path.resolve(output) === path.join(root,'dist')) {
    const stat=await fs.lstat(output).catch(error=>{if(error.code!=='ENOENT')throw error;});
    if(stat?.isSymbolicLink()) throw new Error('dist must not be a symbolic link');
    if(stat && await fs.realpath(output) !== path.join(await fs.realpath(root),'dist')) throw new Error('Unexpected output path');
    await fs.rm(output,{recursive:true,force:true});
  }
  await fs.mkdir(output,{recursive:true});
  // Only browser assets; do not upload repository SQL, docs, or server code.
  for (const entry of await fs.readdir(root,{withFileTypes:true})) {
    if (entry.isFile() && /\.(?:html|js|json|png|ico)$/.test(entry.name) && !/^(?:package|package-lock)\.json$/.test(entry.name)) await fs.copyFile(path.join(root,entry.name),path.join(output,entry.name));
    if (entry.isDirectory() && (entry.name === 'medya' || data.businesses.some(b=>b.slug===entry.name && b.is_public !== false))) await fs.cp(path.join(root,entry.name),path.join(output,entry.name),{recursive:true});
  }
  await fs.writeFile(path.join(output,'index.html'),render(data.template,data.businesses));
  for (const b of data.businesses.filter(b=>b.is_public !== false)) {
    const dir = path.join(output,b.slug);
    await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,'index.html'),render(data.template,data.businesses,b));
  }
  // GitHub Pages cannot issue HTTP 301. Keep this alias out of sitemap.
  if (data.businesses.some(b=>b.slug==='sifa-eczane' && b.is_public !== false)) {
    const dir = path.join(output,'sifa-eczanesi'); await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Şifa Eczane | ABC Sepeti</title><meta name="robots" content="noindex, follow"><link rel="canonical" href="https://shopping.abcsepeti.com/sifa-eczane/"><meta http-equiv="refresh" content="0;url=/sifa-eczane/"></head><body><a href="/sifa-eczane/">Şifa Eczane</a></body></html>');
  }
  await fs.writeFile(path.join(output,'sitemap.xml'),sitemap(data.businesses));
  await fs.writeFile(path.join(output,'robots.txt'),'User-agent: *\nAllow: /\nSitemap: https://shopping.abcsepeti.com/sitemap.xml\n');
  await fs.writeFile(path.join(output,'404.html'),'<!doctype html><html lang="tr"><head><meta name="robots" content="noindex"><title>Sayfa bulunamadı</title></head><body><h1>Sayfa bulunamadı</h1><a href="/">Ana sayfa</a></body></html>');
  await fs.writeFile(path.join(output,'.nojekyll'),'');
  await fs.writeFile(path.join(output,'CNAME'),'shopping.abcsepeti.com\n');
}
if(require.main===module) load().then(data=>build(data)).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={build};
