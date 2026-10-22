const fs = require('node:fs/promises');
const path = require('node:path');
const {root, origin} = require('./core.cjs');
const locations = xml => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
async function verifyProduction(expectedXml, request = fetch) {
  const response = await request(`${origin}/sitemap.xml`, {cache:'no-store', signal:AbortSignal.timeout(20000)});
  if (response.status !== 200) throw new Error(`Production sitemap: HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  if (!/^(application|text)\/xml(?:\s*;|$)/i.test(type)) throw new Error(`Production sitemap: unexpected Content-Type ${type}`);
  const xml = await response.text();
  if (!/<urlset\b[^>]*xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9"/.test(xml)) throw new Error('Production sitemap: invalid XML namespace');
  const expected = locations(expectedXml).sort();
  const actual = locations(xml).sort();
  if (!expected.includes(origin+'/') || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Production sitemap differs from the current database build');
  const pages=[];
  for (const url of actual) {
    const page = await request(url, {redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
    if (page.status !== 200) throw new Error(`${url}: HTTP ${page.status}`);
    const html = await page.text();
    if (!html.includes(`rel="canonical" href="${url}"`)) throw new Error(`${url}: incorrect canonical or old loader HTML`);
    if (/<meta\b[^>]*name="robots"[^>]*content="[^"]*noindex/i.test(html)) throw new Error(`${url}: sitemap includes a noindex page`);
    pages.push({url,status:page.status,canonical:url});
  }
  return {url:origin+'/sitemap.xml',status:response.status,contentType:type,entries:actual.length,pages};
}
async function main() {
  const expectedXml = await fs.readFile(path.join(root,'dist/sitemap.xml'),'utf8');
  const attempts = Math.max(1,Number(process.env.SEO_VERIFY_ATTEMPTS || 1));
  for (let attempt=1;attempt<=attempts;attempt++) {
    try {
      const result = await verifyProduction(expectedXml);
      await fs.mkdir(path.join(root,'.temp'),{recursive:true});
      await fs.writeFile(path.join(root,'.temp/seo-production-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),...result},null,2));
      console.log(JSON.stringify(result,null,2));return;
    } catch(error) {
      if(attempt===attempts)throw error;
      console.log(`Verification ${attempt}/${attempts}: ${error.message}; waiting for CDN publication`);
      await new Promise(resolve=>setTimeout(resolve,10000));
    }
  }
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={verifyProduction};
