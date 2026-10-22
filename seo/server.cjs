const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {root,load,render,sitemap} = require('./core.cjs');
function createServer(provider = load) {
  return http.createServer(async (req,res) => {
    const send = (status,body,type='text/html; charset=utf-8') => {res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method === 'HEAD' ? undefined : body);};
    try {
      if (!['GET','HEAD'].includes(req.method)) return send(405,'Method not allowed');
      const url = new URL(req.url,'http://localhost');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/robots.txt') return send(200,'User-agent: *\nAllow: /\nSitemap: https://shopping.abcsepeti.com/sitemap.xml\n','text/plain');
      const page = pathname === '/' || /^\/[a-z0-9-]+\/(?:index.html)?$/.test(pathname) || /^\/[a-z0-9-]+$/.test(pathname) || pathname === '/index.html';
      if (page || pathname === '/sitemap.xml') {
        const {template,businesses} = await provider();
        if (pathname === '/sitemap.xml') return send(200,sitemap(businesses),'application/xml; charset=utf-8');
        const slug = url.searchParams.get('tenant') || pathname.split('/')[1];
        // Historical typo redirects only if the actual database record exists.
        const alias = slug === 'sifa-eczanesi' && businesses.some(b=>b.slug==='sifa-eczane') ? 'sifa-eczane' : slug;
        const b = businesses.find(b=>b.slug===alias && b.is_public !== false);
        if (slug && slug !== 'index.html' && !b) return send(404,'<h1>İşletme bulunamadı</h1>');
        const canonical = b ? `/${b.slug}/` : '/';
        if (pathname !== canonical || url.searchParams.has('tenant')) {
          url.searchParams.delete('tenant');
          res.writeHead(301,{Location:canonical+url.search}); return res.end();
        }
        return send(200,render(template,businesses,b));
      }
      // Public asset allowlist; SQL, docs, source, dotfiles and credentials are never served.
      if (!/^\/(?:[a-z0-9-]+\/)?(?:[a-zA-Z0-9_-]+\.(?:js|json|png|ico|html)|medya\/[a-zA-Z0-9_.-]+\.(?:mp4|png|jpg|webp))$/.test(pathname)) return send(404,'Not found');
      let file = path.join(root,pathname);
      if (!file.startsWith(root+path.sep)) return send(404,'Not found');
      const types = {'.js':'application/javascript','.json':'application/json','.png':'image/png','.ico':'image/x-icon','.mp4':'video/mp4','.jpg':'image/jpeg','.webp':'image/webp','.html':'text/html; charset=utf-8'};
      return send(200,await fs.readFile(file),types[path.extname(file)]);
    } catch (error) {
      if (error.code === 'ENOENT') return send(404,'Not found');
      console.error(error.message);
      return send(503,'<h1>Geçici olarak kullanılamıyor</h1>');
    }
  });
}
if (require.main === module) createServer().listen(Number(process.env.PORT || 3000),'0.0.0.0');
module.exports = {createServer};
