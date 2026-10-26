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
  if (!b) return {title:'Shopping ABC Sepeti | Online Alışveriş ve Dijital Mağazalar', description:'Shopping ABC Sepeti ile işletmenize özel web sayfası, masaüstü ve mobil uygulamaya sahip olun. Aylık kiralama ile mağazanızı ve siparişlerinizi yönetin.', url:origin+'/', index:true, schema:{'@context':'https://schema.org','@type':'WebSite',name:'ABC Sepeti Shopping',alternateName:'ABC Sepeti',url:origin+'/'}};
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
  const content = b ? `<details><summary>İşletme hakkında</summary><p>${escape(m.description)}</p></details>` : `<details><summary>İşletmeler</summary><nav aria-label="İşletmeler">${businesses.filter(indexable).map(item => `<a href="/${item.slug}/">${escape(item.shop_name)}</a>`).join(' · ')}</nav></details>`;
  const services = b ? '' : `
    <section class="platform-services" aria-labelledby="platformServicesTitle">
      <span class="platform-services-label">İŞLETMENİZ İÇİN DİJİTAL ÇÖZÜMLER</span>
      <h2 id="platformServicesTitle">İşletmenize özel dijital mağaza</h2>
      <p>İşletmenizi yalnızca bir mağaza bağlantısıyla sınırlamayın: Shopping ABC Sepeti ile markanıza özel web sayfası, masaüstü uygulaması ve mobil uygulamayla müşterilerinizin kullandığı cihazlarda yerinizi alın. Küçük işletmelerden büyük işletmelere kadar, ürünlerini internette sergilemek ve siparişlerini takip etmek isteyen işletmelere aylık dijital mağaza kiralama hizmeti sunuyoruz. Yüksek komisyonlu pazaryerlerine alternatif arayan işletmeler, aylık abonelik modeliyle kendi dijital dükkanına sahip olabilir.</p>
      <div class="platform-services-grid">
        <article><h3>İşletmenize özel web sayfası</h3><p>Markanızı, ürünlerinizi ve işletme bilgilerinizi size özel bir web sayfasında tanıtın. Mağaza bağlantınızı paylaşın; müşterileriniz ürünlerinizi inceleyip sipariş oluşturabilsin.</p></article>
        <article><h3>Masaüstü ve mobil uygulama</h3><p>Mağazanız müşterilerinizin bilgisayarında ve telefonunda da yerini alsın. Uygulama olarak açılabilen dijital mağazanızla ürünlerinize erişimi kolaylaştırın ve yeniden alışveriş yapmak isteyen müşterilerinize pratik bir yol sunun.</p></article>
        <article><h3>Sipariş takibi ve müşteri iletişimi</h3><p>Online siparişlerinizi ve siparişle iletilen müşteri iletişim bilgilerini işletme panelinizden takip edin. Müşterilerinizle iletişiminizi ve sipariş sürecinizi yönetin.</p></article>
        <article><h3>İşletme tanıtımı ve reklam içerikleri</h3><p>İşletmenize özel mağaza görünümü, ürün tanıtımları ve reklam içerikleriyle markanızı anlatın. Dijital mağazanızın bağlantısını müşterilerinizle paylaşın.</p></article>
      </div>
      <p>Web sayfası, masaüstü ve mobil uygulama, online sipariş takibi ve işletme tanıtımını aynı hizmette buluşturun. İşletmenize uygun aylık abonelik seçeneklerini inceleyerek dijital mağazanız için ilk adımı atın.</p>
      <button type="button" class="platform-services-cta" onclick="openFranchisePage()">Dijital mağaza paketlerini inceleyin</button>
      <p class="platform-products-notice"><strong>Mevcut işletmelerimize ve ürünlerine aşağıdaki <a href="#rootProductsHeading">Ürünler</a> bölümünden ulaşabilirsiniz.</strong></p>
    </section>`;
  if (b) {
    html = html.replace('<base href="./">','<base href="../">')
      .replace('<span id="shopName">İşletme</span>',`<span id="shopName">${escape(b.shop_name)}</span>`);
  } else {
    html = html.replace('id="rootLanding" class="root-landing hidden"','id="rootLanding" class="root-landing root-landing-with-services"')
      .replace('id="tenantAppContainer" class="container"','id="tenantAppContainer" class="container hidden"')
      .replace('<!-- ROOT_PLATFORM_SERVICES -->',services);
  }
  html = html.replace('</head>', `<style>
    .business-info-footer{box-sizing:border-box;width:100%;padding:12px 24px 24px;color:#666;font:14px/1.6 Arial,sans-serif;overflow-wrap:anywhere}
    .business-info-footer summary{cursor:pointer;width:fit-content}
    .business-info-footer nav,.business-info-footer p{margin:8px 0 0}
    .business-info-footer a{color:inherit;display:inline-block;margin:0 8px 4px 0}
    #rootLanding.root-landing-with-services{height:auto;min-height:100dvh}
    #rootLanding.root-landing-with-services .root-landing-card{height:auto}
    #rootLanding.root-landing-with-services #rootBusinessList{flex:0 0 auto;height:70dvh;min-height:320px}
    .platform-services{box-sizing:border-box;width:100%;max-width:1120px;margin:24px auto 0;padding:32px;border:1px solid #dce9e3;border-radius:24px;background:linear-gradient(135deg,#f0f9f5 0%,#fff 45%,#f1f5fc 100%);box-shadow:0 12px 36px rgba(24,62,46,.08);color:#475569;font-size:14px;line-height:1.75;isolation:isolate;overflow-wrap:anywhere}
    .platform-services-label{display:inline-block;margin-bottom:12px;padding:6px 12px;border:1px solid #cce7da;border-radius:999px;background:#e6f4ec;color:#166344;font-size:11px;font-weight:700;letter-spacing:1px;line-height:1.5}
    .platform-services h2{font-size:clamp(23px,2.4vw,32px);line-height:1.25;color:#163e30;letter-spacing:-.6px;margin:0 0 16px}
    .platform-services>p{margin:0;max-width:100ch}
    .platform-services h3{font-size:17px;line-height:1.4;color:var(--feature-ink,#155e45);margin:0 0 12px}
    .platform-services-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:28px 0;counter-reset:feature}
    .platform-services-grid article{--feature-ink:#155e45;--feature-tint:#e7f5ed;--feature-border:#d2eadd;position:relative;min-width:0;padding:22px 20px;border:1px solid var(--feature-border);border-top:3px solid var(--feature-ink);border-radius:16px;background:linear-gradient(160deg,var(--feature-tint),#fff 68%);box-shadow:0 5px 18px rgba(15,23,42,.06);counter-increment:feature;transition:transform .2s ease,box-shadow .2s ease}
    .platform-services-grid article:nth-child(2){--feature-ink:#2855a0;--feature-tint:#eaf1ff;--feature-border:#d7e3fa}
    .platform-services-grid article:nth-child(3){--feature-ink:#67409b;--feature-tint:#f2ebfb;--feature-border:#e4d9f4}
    .platform-services-grid article:nth-child(4){--feature-ink:#94510f;--feature-tint:#fff3e2;--feature-border:#f4e1c5}
    .platform-services-grid article::before{content:counter(feature,decimal-leading-zero);display:grid;place-items:center;width:40px;height:40px;margin-bottom:18px;border-radius:12px;background:var(--feature-tint);color:var(--feature-ink);font-size:15px;font-weight:700;border:1px solid var(--feature-border)}
    .platform-services-grid article p{margin:0;color:#475569;font-size:14px;line-height:1.75}
    @media(hover:hover){.platform-services-grid article:hover{transform:translateY(-3px);box-shadow:0 10px 24px rgba(15,23,42,.1)}.platform-services-cta:hover{background:#125e3b;box-shadow:0 6px 16px rgba(22,122,74,.2)}}
    .platform-services-cta{width:auto;border:0;border-radius:12px;padding:14px 22px;margin-top:20px;background:#167a4a;color:#fff;font:inherit;font-weight:700;box-shadow:0 4px 12px rgba(22,122,74,.16);cursor:pointer;transition:background .2s ease,box-shadow .2s ease;white-space:normal}
    .platform-services-cta:focus-visible{outline:3px solid #222;outline-offset:3px}
    .platform-services .platform-products-notice{max-width:none;margin:24px 0 0;padding:18px 20px;border:1px solid #cce6d7;border-left:5px solid #167a4a;border-radius:12px;background:#eaf6ee;color:#14532d;font-size:17px;line-height:1.6}
    .platform-products-notice a{color:inherit;text-decoration:underline;text-underline-offset:3px}
    #rootProductsHeading{scroll-margin-top:20px}
    @media(max-width:1000px){.platform-services-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:600px){.platform-services{padding:20px 16px;border-radius:18px}.platform-services-grid{grid-template-columns:minmax(0,1fr);gap:14px;margin:22px 0}.platform-services-grid article{padding:20px}.platform-services .platform-products-notice{padding:14px;font-size:16px}.platform-services-cta{width:100%}.platform-services-label{font-size:10px;letter-spacing:.6px}}
    @media(prefers-reduced-motion:reduce){.platform-services-grid article,.platform-services-cta{transition:none}.platform-services-grid article:hover{transform:none}}
  </style></head>`);
  html = html.replace('</body>', `<footer class="business-info-footer" id="businessSeoContent">${content}</footer>\n</body>`);
  return html;
}
function sitemap(businesses) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/',...businesses.filter(indexable).map(b => `/${b.slug}/`)].map(p => `<url><loc>${origin}${escape(p)}</loc></url>`).join('')}</urlset>`;
}
module.exports = {root,origin,escape,active,indexable,pharmacy,load,metadata,render,sitemap};
