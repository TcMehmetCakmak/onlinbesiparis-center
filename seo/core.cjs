const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const origin = 'https://shopping.abcsepeti.com';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const validSlug = value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const pharmacy = b => /eczane|pharmacy/i.test(`${b.shop_name} ${b.slug} ${b.business_type}`);
const active = b => b.is_active === true && b.manual_enabled === true && String(b.license_end_date) >= new Date().toLocaleDateString('sv-SE', {timeZone:'Europe/Istanbul'});
const indexable = b => active(b) && b.is_public !== false && b.seo_indexable !== false && !pharmacy(b);
async function config(file, name) {
  const context = {window:{}};
  vm.runInNewContext(await fs.readFile(path.join(root, file), 'utf8'), context, {timeout:1000});
  return context.window[name];
}
async function rows(cfg, table, select) {
  const result = [];
  for (let offset = 0; ; offset += 500) {
    const url = new URL(`/rest/v1/${table}`, cfg.url);
    url.searchParams.set('select', select);
    url.searchParams.set('order', table === 'business_public' ? 'business_id' : 'business_id');
    url.searchParams.set('limit', '500');
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, {headers:{apikey:cfg.key}, signal:AbortSignal.timeout(15000)});
    if (!response.ok) {
      const detail = await response.json().catch(()=>({}));
      const error = new Error(`${table}: HTTP ${response.status}`); error.code=detail.code; throw error;
    }
    const page = await response.json();
    result.push(...page);
    if (page.length < 500) return result;
  }
}
async function load() {
  const [central, tenant, template] = await Promise.all([
    config('platform-config.js','PLATFORM_CONFIG'), config('supabase-config.js','SUPABASE_CONFIG'), fs.readFile(path.join(root,'index.html'),'utf8')
  ]);
  const [businesses, settings] = await Promise.all([
    rows(central,'business_public','business_id,shop_name,slug,business_type,is_active,manual_enabled,license_end_date,updated_at'),
    // Explicit projection: never publish settings wholesale (tokens or private fields).
    rows(tenant,'app_settings','business_id,description,seo_image_url,seo_indexable,is_public,phone,updated_at').catch(error => {
      if (error.code !== '42703') throw error;
      console.warn('SEO settings migration is pending; using existing public settings and factual fallback descriptions.');
      return rows(tenant,'app_settings','business_id,phone,updated_at');
    })
  ]);
  const byId = new Map(settings.map(s => [s.business_id,s]));
  return {template, businesses:businesses.filter(b => validSlug(b.slug)).map(b => ({...byId.get(b.business_id),...b}))};
}
function metadata(b) {
  if (!b) return {title:'Shopping ABC Sepeti | Online Alışveriş ve Dijital Mağazalar', description:'Shopping ABC Sepeti ile aylık dijital mağaza kiralayın. İşletmenize özel online mağaza, sipariş takibi, müşteri iletişimi ve tanıtım çözümlerini keşfedin.', url:origin+'/', index:true, schema:{'@context':'https://schema.org','@type':'WebSite',name:'ABC Sepeti Shopping',alternateName:'ABC Sepeti',url:origin+'/'}};
  const url = `${origin}/${b.slug}/`;
  const description = pharmacy(b) ? `${b.shop_name} işletme kaydı.` : String(b.description || `${b.shop_name} işletmesinin ABC Sepeti üzerindeki bilgilerini inceleyin.`).trim().slice(0,320);
  // A physical location is not verified by the current data model: Organization is deliberate.
  const schema = {'@context':'https://schema.org','@type':'Organization',name:b.shop_name,url};
  let image;
  try {const u = new URL(b.seo_image_url); if (u.protocol === 'https:' && !pharmacy(b)) image = u.href;} catch {}
  if (image) schema.image = image;
  if (b.phone && !pharmacy(b)) schema.telephone = b.phone;
  return {title:`${b.shop_name} | ABC Sepeti Shopping`,description,url,index:indexable(b),image,schema};
}
function render(template, businesses, b) {
  const m = metadata(b);
  let html = template.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escape(m.title)}</title>`)
    .replace(/<meta\s+id="appDescription"[\s\S]*?>/i, `<meta id="appDescription" name="description" content="${escape(m.description)}">`)
    .replace(/<link rel="canonical"[^>]*>/i, `<link rel="canonical" href="${escape(m.url)}">`)
    .replace(/<meta name="robots"[^>]*>/i, `<meta name="robots" content="${m.index?'index, follow':'noindex, follow'}">`)
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/i, `<script type="application/ld+json">${json(m.schema)}</script>`);
  const og = [['title',m.title],['description',m.description],['url',m.url],['type','website'],...(m.image?[['image',m.image]]:[])];
  html = html.replace('</head>', og.map(([key,value]) => `<meta property="og:${key}" content="${escape(value)}">`).join('\n') + `\n<script>window.SERVER_SEO=${json(m)};</script>\n</head>`);
  const content = b ? `<details><summary>İşletme hakkında</summary><p>${escape(m.description)}</p></details>` : `<details><summary>İşletmeler</summary><nav aria-label="İşletmeler">${businesses.filter(indexable).map(item => `<a href="/${item.slug}/">${escape(item.shop_name)}</a>`).join(' · ')}</nav></details>
    <section class="platform-services" aria-labelledby="platformServicesTitle">
      <h2 id="platformServicesTitle">İşletmenize özel dijital mağaza, aylık kiralama modeliyle</h2>
      <p>Shopping ABC Sepeti; küçük işletmelerden büyük işletmelere kadar, ürünlerini internette sergilemek ve siparişlerini takip etmek isteyen işletmeler için dijital mağaza kiralama hizmeti sunar. Yüksek komisyonlu pazaryerlerine alternatif arayan işletmeler, aylık abonelik modeliyle kendilerine özel bir online mağaza oluşturabilir.</p>
      <div class="platform-services-grid">
        <article><h3>İşletmeye özel online mağaza</h3><p>Markanızı, ürünlerinizi ve işletme bilgilerinizi kendi dijital dükkanınızda tanıtın. Müşterileriniz ürünlerinizi mağazanıza özel bağlantıdan inceleyebilsin.</p></article>
        <article><h3>Sipariş takibi ve müşteri iletişimi</h3><p>Online siparişlerinizi ve siparişle iletilen müşteri iletişim bilgilerini işletme panelinizden takip edin. Müşterilerinizle iletişiminizi ve sipariş sürecinizi yönetin.</p></article>
        <article><h3>İşletme tanıtımı ve reklam içerikleri</h3><p>İşletmenize özel mağaza görünümü, ürün tanıtımları ve reklam içerikleriyle markanızı anlatın. Dijital mağazanızın bağlantısını müşterilerinizle paylaşın.</p></article>
      </div>
      <p>Aylık kiralık e-ticaret mağazası, online sipariş sistemi ve işletme tanıtımı ihtiyaçlarınız için abonelik seçeneklerini inceleyin.</p>
      <button type="button" class="platform-services-cta" onclick="openFranchisePage()">Dijital mağaza paketlerini inceleyin</button>
    </section>`;
  if (b) {
    html = html.replace('<base href="./">','<base href="../">')
      .replace('<span id="shopName">İşletme</span>',`<span id="shopName">${escape(b.shop_name)}</span>`);
  } else {
    html = html.replace('id="rootLanding" class="root-landing hidden"','id="rootLanding" class="root-landing"')
      .replace('id="tenantAppContainer" class="container"','id="tenantAppContainer" class="container hidden"');
  }
  html = html.replace('</head>', `<style>
    .business-info-footer{box-sizing:border-box;width:100%;padding:12px 24px 24px;color:#666;font:14px/1.6 Arial,sans-serif;overflow-wrap:anywhere}
    .business-info-footer summary{cursor:pointer;width:fit-content}
    .business-info-footer nav,.business-info-footer p{margin:8px 0 0}
    .business-info-footer a{color:inherit;display:inline-block;margin:0 8px 4px 0}
    .platform-services{max-width:1120px;margin:24px auto 0;padding:24px;border:1px solid #e5e7eb;border-radius:18px;background:#fff;color:#374151}
    .platform-services h2{font-size:24px;line-height:1.3;color:#222;margin:0 0 12px}
    .platform-services h3{font-size:17px;line-height:1.4;color:#222;margin:0 0 8px}
    .platform-services-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:20px;margin:24px 0}
    .platform-services-cta{border:0;border-radius:10px;padding:12px 18px;margin-top:16px;background:#167a4a;color:white;font:inherit;cursor:pointer}
    .platform-services-cta:focus-visible{outline:3px solid #222;outline-offset:3px}
    @media(max-width:600px){.platform-services{padding:18px}.platform-services h2{font-size:20px}}
  </style></head>`);
  html = html.replace('</body>', `<footer class="business-info-footer" id="businessSeoContent">${content}</footer>\n</body>`);
  return html;
}
function sitemap(businesses) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/',...businesses.filter(indexable).map(b => `/${b.slug}/`)].map(p => `<url><loc>${origin}${escape(p)}</loc></url>`).join('')}</urlset>`;
}
module.exports = {root,origin,escape,active,indexable,pharmacy,load,metadata,render,sitemap};
