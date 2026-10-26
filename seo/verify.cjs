const fs=require('node:fs/promises');
const path=require('node:path');
const {load,root}=require('./core.cjs');
const {createServer}=require('./server.cjs');
async function verify(){
  const data=await load();
  const server=createServer(async()=>data);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    const xml=await(await fetch(base+'/sitemap.xml')).text();
    const results=[];
    for(const route of ['/','/orgu-sepeti/','/sifa-eczanesi/','/sifa-eczane/','/sirius-ayakkabi/']){
      const first=await fetch(base+route,{redirect:'manual'});
      const target=first.headers.get('location');
      const response=target?await fetch(base+target):first;
      const html=await response.text();
      const result={route,status:first.status,redirect:target,finalStatus:response.status,
        title:html.match(/<title>(.*?)<\/title>/)?.[1],
        description:html.match(/id="appDescription" name="description" content="([^"]*)"/)?.[1],
        canonical:html.match(/rel="canonical" href="([^"]*)"/)?.[1],
        businessH1:route==='/'?'Shopping ABC Sepeti - Online Alışveriş':html.match(/<span id="shopName">(.*?)<\/span>/)?.[1],
        robots:html.match(/name="robots" content="([^"]*)"/)?.[1],
        sitemap:xml.includes(`https://shopping.abcsepeti.com${route}</loc>`)};
      if(!result.title||!result.description||!result.canonical||response.status!==200)throw new Error(`Verification failed: ${route}`);
      results.push(result);
    }
    await fs.mkdir(path.join(root,'.temp'),{recursive:true});
    await fs.writeFile(path.join(root,'.temp/seo-verification.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify(results,null,2));
  }finally{await new Promise(resolve=>server.close(resolve));}
}
verify().catch(error=>{console.error(error);process.exitCode=1;});
