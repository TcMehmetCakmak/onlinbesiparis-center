# 👜 Sümeyra Çanta (`sumeyra-canta`) Sıfırdan Kurulum Rehberi

Bu rehber, **Sümeyra Çanta** işletmesini sıfırdan açmak için gereken tüm adımları (Süper Admin, Supabase Veritabanı, Klasör/Dosya Kurulumu ve Yayına Alma) sırasıyla içerir.

---

## 📋 Özet Bilgiler
- **Dükkan Adı:** `Sümeyra Çanta`
- **Slug (URL Kısa Adı):** `sumeyra-canta`
- **İşletme Tipi:** `E-ticaret` (`ecommerce`)
- **Merkezi (Süper Admin) Supabase Ref:** `dfurcmkuqdjnaibbnoac`
- **Ortak Operasyon (Tenant) Supabase Ref:** `otxzntnfpkgeqlfswzcb`
- **Müşteri Sayfası Adresi:** `https://shopping.abcsepeti.com/sumeyra-canta/`
- **Admin Paneli Adresi:** `https://shopping.abcsepeti.com/sumeyra-canta/admin.html`

---

## 1. Adım: Süper Admin Panelinden İşletmeyi Oluşturma

1. `super-admin.html` üzerinden **Süper Admin** paneline giriş yapın.
2. Sağ üstteki **+ İşletme Ekle** butonuna tıklayın ve alanları şu şekilde doldurun:
   - **İşletme sahibi:** İşletme sahibinin adı soyadı (Örn: `Sümeyra Hanım`)
   - **Dükkan adı:** `Sümeyra Çanta`
   - **Slug:** `sumeyra-canta`
   - **İlk lisans (ay):** `1` (veya istediğiniz ay süresi)
   - **Tenant Project Ref:** `otxzntnfpkgeqlfswzcb`
   - **İşletme tipi:** `E-ticaret`
3. **İşletmeyi Oluştur** butonuna tıklayın.
4. Ekrana gelen onay penceresindeki şu bilgileri kopyalayıp güvenli bir yere not edin:
   - **Business Public Key** *(Örn: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)*
   - **Business Token** *(Sadece bu ekranda bir kez gösterilir)*
   - **Lisans sonu**

   Business Public Key
  6e8133c4-e519-4047-8392-93973849bb7d
  Business Token
  7c42330b434d7a4e76924a7fee134f4dd73e46a6e66b6aa3c250e6ef326297c7
  Lisans sonu
  2026-11-16

---

## 2. Adım: Merkezi Supabase'den `business_id` Değerini Alma

1. **Merkezi Supabase** (`dfurcmkuqdjnaibbnoac`) projesinde **SQL Editor** ekranını açın.
2. Aşağıdaki sorguyu çalıştırarak yeni oluşturulan işletmenin `business_id` değerini alın:

```sql
select
  id as business_id,
  public_key,
  shop_name,
  slug,
  business_type,
  license_end_date,
  manual_enabled
from public.businesses
where slug = 'sumeyra-canta';

business_id: 67ec0a96-6062-4648-b39c-90731839a545
```

3. Sorgu sonucunda dönen **`business_id`** (UUID) değerini kopyalayın (4. adımda kullanacağız).

---

## 3. Adım: Ortak Operasyon Supabase'de Admin Kullanıcısı Oluşturma

1. **Ortak Operasyon Supabase** (`otxzntnfpkgeqlfswzcb`) projesini açın.
2. Sol menüden **Authentication** → **Users** sayfasına gidin.
3. Sağ üstten **Add User** → **Create new user** seçeneğine tıklayın:
   - **Email:** `admin@sumeyracanta.com` (veya tercih ettiğiniz e-posta)
   - **Password:** İşletme sahibine vereceğiniz şifre
   - **Auto Confirm User:** İşaretli (Aktif) olsun
4. **Create user** butonuna basın.
5. Kullanıcı listesinde oluşan yeni kullanıcının **`User UID`** (UUID) değerini kopyalayın.
fd95cdad-9dc1-4733-ac53-cc1302de2afc

---

## 4. Adım: Ortak Operasyon Supabase'de Profil, Ayar ve Ürünleri Tanımlama

**Ortak Operasyon Supabase** (`otxzntnfpkgeqlfswzcb`) projesinde **SQL Editor** ekranını açın ve aşağıdaki SQL komutlarında:
- `'BURAYA_ADMIN_USER_UUID_YAZIN'` kısmına **3. adımda aldığınız User UID** değerini,
- `'BURAYA_BUSINESS_ID_YAZIN'` kısmına **2. adımda aldığınız `business_id`** değerini
yazarak sırasıyla çalıştırın:

### 4.1. Admin Kullanıcısını `profiles` Tablosuna Bağlama
```sql
insert into public.profiles (
  id,
  role,
  business_id
)
values (
  'BURAYA_ADMIN_USER_UUID_YAZIN',
  'admin',
  'BURAYA_BUSINESS_ID_YAZIN'
)
on conflict (id) do update
set
  role = excluded.role,
  business_id = excluded.business_id;
```

### 4.2. `app_settings` (Dükkan Genel Ayarları) Oluşturma
```sql
insert into public.app_settings (
  business_id,
  shop_name,
  shop_icon,
  background_color
)
values (
  'BURAYA_BUSINESS_ID_YAZIN',
  'Sümeyra Çanta',
  '👜',
  '#f5f5f5'
)
on conflict (business_id) do update
set
  shop_name = excluded.shop_name,
  shop_icon = excluded.shop_icon,
  background_color = excluded.background_color,
  updated_at = now();
```

**Kontrol sorgusu:**
```sql
select
  id,
  business_id,
  shop_name,
  shop_icon,
  background_color
from public.app_settings
where business_id = 'BURAYA_BUSINESS_ID_YAZIN';
```

### 4.3. Başlangıç Ürünlerini Ekleme (Opsiyonel - Admin Panelinden de Eklenebilir)
```sql
insert into public.products (
  business_id,
  id,
  name,
  icon,
  price,
  active
)
values
  (
    'BURAYA_BUSINESS_ID_YAZIN',
    'omuz-cantasi',
    'Kadın Omuz Çantası',
    '👜',
    450.00,
    true
  ),
  (
    'BURAYA_BUSINESS_ID_YAZIN',
    'el-cantasi',
    'Şık El Çantası',
    '👛',
    350.00,
    true
  ),
  (
    'BURAYA_BUSINESS_ID_YAZIN',
    'sirt-cantasi',
    'Günlük Sırt Çantası',
    '🎒',
    550.00,
    true
  )
on conflict (business_id, id) do update
set
  name = excluded.name,
  icon = excluded.icon,
  price = excluded.price,
  active = excluded.active;
```

---

## 5. Adım: Repo İçinde `sumeyra-canta` Klasörünü Oluşturma

Proje ana dizininde (`onlinbesiparis-center`) **`sumeyra-canta`** adında yeni bir klasör oluşturun (veya mevcut `orgu-sepeti` klasörünü kopyalayıp adını `sumeyra-canta` yapın) ve içindeki dosyaları aşağıdaki gibi ayarlayın:

### 5.1. `sumeyra-canta/admin.html`
```html
<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Yönetim Paneli</title>
<script>
location.replace("../admin.html?tenant=sumeyra-canta");
</script>
</head>
<body>Yönlendiriliyor...</body>
</html>
```

### 5.2. `sumeyra-canta/manifest.json`
```json
{
  "id": "/pwa/sumeyra-canta",
  "name": "Sümeyra Çanta",
  "short_name": "Sümeyra Çanta",
  "description": "Sümeyra Çanta online sipariş uygulaması",
  "lang": "tr",
  "start_url": "/sumeyra-canta/",
  "scope": "/sumeyra-canta/",
  "display": "standalone",
  "background_color": "#f5f5f5",
  "theme_color": "#e63946",
  "icons": [
    {
      "src": "icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

### 5.3. `sumeyra-canta/service-worker.js`
1. satırdaki `CACHE_NAME` değerini `sumeyra-canta-pwa-v1` olarak ayarlayın:
```javascript
const CACHE_NAME = "sumeyra-canta-pwa-v1";
const STATIC_ASSETS = [
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(STATIC_ASSETS.map(url => cache.add(url).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname.toLowerCase();
  const dynamic =
    event.request.mode === "navigate" ||
    path.endsWith("/index.html") ||
    path.endsWith("/admin.html") ||
    path.endsWith("/supabase-config.js") ||
    path.endsWith("/platform-config.js");

  if (dynamic) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then(response => response)
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached =>
      cached ||
      fetch(event.request).then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        }
        return response;
      })
    )
  );
});
```

### 5.4. `sumeyra-canta/index.html`
Diğer dükkanlardaki (`orgu-sepeti/index.html` veya `ceyiz-sandigi/index.html`) standart yükleyici `index.html` dosyasını birebir kopyalayın (URL'den `sumeyra-canta` slug'ını otomatik algılar ve ana dizindeki `../index.html` dosyasını yükler).

### 5.5. İkon Dosyaları
`sumeyra-canta/` klasörünün içine dükkanın logosunu içeren şu 3 görseli ekleyin:
- `icon-192.png`
- `icon-512.png`
- `icon-512-maskable.png`

---

## 6. Adım: GitHub'a Gönderme (Deploy) ve Son Kontroller

1. Terminalden yeni dükkan klasörünü commit ve push edin:
   ```bash
   git add sumeyra-canta
   git commit -m "Added sumeyra-canta shop"
   git push
   ```
2. GitHub Pages yayını tamamlandığında (yaklaşık 1 dakika içinde) linkleri test edin:
   - **Müşteri Sipariş Sayfası:** `https://shopping.abcsepeti.com/sumeyra-canta/`
   - **Admin Yönetim Paneli:** `https://shopping.abcsepeti.com/sumeyra-canta/admin.html`
3. **Admin Paneli İlk Giriş & Genel Ayarlar:**
   - 3. adımda oluşturduğunuz e-posta ve şifre ile `https://shopping.abcsepeti.com/sumeyra-canta/admin.html` adresinden giriş yapın *(ilk giriş yaptığınızda şifre Süper Admin panelindeki şifre kutusuna otomatik kaydedilir)*.
   - **Genel Ayarlar** sekmesine giderek **WhatsApp / Telefon Numarası**, **Instagram Adresi** ve **Ödeme Yöntemlerini (Nakit / Kart / Havale-EFT)** seçip **Kaydet** butonuna basın.

