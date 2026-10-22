const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {root,render,sitemap,metadata}=require('../seo/core.cjs');
const {createServer}=require('../seo/server.cjs');
const {build}=require('../seo/build.cjs');
const businesses=[
  {shop_name:'Örgü Sepeti',slug:'orgu-sepeti'},
  {shop_name:'Şifa Eczane',slug:'sifa-eczane'},
  {shop_name:'Sirius Ayakkabı',slug:'sirius-ayakkabi'}
].map((b,i)=>({...b,business_id:String(i),business_type:'ecommerce',is_active:true,manual_enabled:true,license_end_date:'2099-01-01',description:'Gerçek işletme açıklaması',seo_image_url:'https://example.com/shop.png'}));
test('customer and admin inline JavaScript remains valid',async()=>{
  for(const file of ['index.html','admin.html']){
    const html=await fs.readFile(path.join(root,file),'utf8');
    for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
      if(!/src=|application\/ld\+json|type="module"/i.test(match[1]))new vm.Script(match[2],{filename:file});
    }
  }
});
test('HTTP routes render source HTML, canonical, links, sitemap, aliases and errors',async t=>{
  const template=await fs.readFile(path.join(root,'index.html'),'utf8');
  const server=createServer(async()=>({template,businesses}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  for(const route of ['/','/orgu-sepeti/','/sifa-eczane/','/sirius-ayakkabi/']) {
    const b=businesses.find(b=>route===`/${b.slug}/`),m=metadata(b);
    const response=await fetch(origin+route); assert.equal(response.status,200);
    const html=await response.text();
    assert(html.includes(`<title>${m.title}</title>`));
    assert(html.includes(`content="${m.description}"`));
    assert(html.includes(`rel="canonical" href="${m.url}"`));
    assert(html.includes(b?`<span id="shopName">${b.shop_name}</span>`:'ABC Sepeti Shopping - Online Alışveriş</h1>'));
    if(b) assert(!html.includes('document.write(html)'));
    else assert(html.includes('<a href="/orgu-sepeti/">Örgü Sepeti</a>'));
    const schema=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(schema.name,b?b.shop_name:'ABC Sepeti Shopping');
  }
  for(const route of ['/orgu-sepeti','/orgu-sepeti/index.html','/sifa-eczanesi/','/sifa-eczanesi']) {
    const response=await fetch(origin+route,{redirect:'manual'});assert.equal(response.status,301);
    assert.equal(response.headers.get('location'),route.includes('sifa')?'/sifa-eczane/':'/orgu-sepeti/');
  }
  const legacy=await fetch(origin+'/?tenant=orgu-sepeti&product=42',{redirect:'manual'});
  assert.equal(legacy.status,301);assert.equal(legacy.headers.get('location'),'/orgu-sepeti/?product=42');
  for(const route of ['/missing/','/.git/config','/central-platform.sql','/seo/core.cjs']) assert.equal((await fetch(origin+route)).status,404);
  const xml=await(await fetch(origin+'/sitemap.xml')).text();
  assert(xml.includes('/orgu-sepeti/'));assert(xml.includes('/sirius-ayakkabi/'));assert(!xml.includes('sifa-'));
  assert((await(await fetch(origin+'/sifa-eczane/')).text()).includes('content="noindex, follow"'));
  businesses[0].shop_name='Yeni İşletme Adı';
  assert((await(await fetch(origin+'/orgu-sepeti/')).text()).includes('<title>Yeni İşletme Adı |'));
  businesses[0].shop_name='Örgü Sepeti';
});
test('eligibility, escaping, pharmacy policy, missing image and data changes',async()=>{
  const b=businesses[0];
  for(const override of [{is_active:false},{manual_enabled:false},{license_end_date:'2000-01-01'},{is_public:false},{seo_indexable:false}]) assert(!sitemap([{...b,...override}]).includes('/orgu-sepeti/'));
  assert.equal(metadata({...b,seo_image_url:'javascript:alert(1)'}).image,undefined);
  const template=await fs.readFile(path.join(root,'index.html'),'utf8');
  const malicious={...b,shop_name:'</script><script>alert(1)</script>',description:'"><img src=x onerror=alert(1)>'};
  const html=render(template,[malicious],malicious);
  assert(!html.includes('<title></script>'));assert(html.includes('\\u003c/script>'));
  assert.equal(metadata({...businesses[1],description:'İlaç satın alın'}).description,'Şifa Eczane işletme kaydı.');
  const xml=sitemap([b,{...b,slug:'new-shop'}]);assert(xml.includes('/new-shop/'));
});
test('static artifact has prerendered shops and excludes private directories',async t=>{
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'abc-seo-'));
  t.after(()=>fs.rm(output,{recursive:true,force:true}));
  const template=await fs.readFile(path.join(root,'index.html'),'utf8');
  await build({template,businesses},output);
  assert((await fs.readFile(path.join(output,'orgu-sepeti/index.html'),'utf8')).includes('<title>Örgü Sepeti |'));
  assert((await fs.readFile(path.join(output,'sifa-eczanesi/index.html'),'utf8')).includes('url=/sifa-eczane/'));
  await assert.rejects(fs.access(path.join(output,'central-platform.sql')));
  await assert.rejects(fs.access(path.join(output,'seo/core.cjs')));
});
test('upstream failure is 503, never an empty sitemap or soft 404',async t=>{
  const server=createServer(async()=>{throw new Error('upstream unavailable');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/sitemap.xml`)).status,503);
});
