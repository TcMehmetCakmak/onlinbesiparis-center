# Çok İşletmeli Lisanslı Sipariş Platformu

Bu paket iki ayrı Supabase katmanından oluşur:

- `central/`: yalnızca platform sahibinin kullandığı merkezi Supabase + `super-admin.html`.
- `tenant/`: her işletmenin kendi Supabase projesinde çalışan müşteri/admin uygulaması.

> Güvenlik: `service_role` anahtarını hiçbir HTML/JS dosyasına koymayın. Browser dosyalarında yalnız publishable/anon key bulunur.

## 1. Merkezi Supabase projesini kur

1. Supabase Dashboard'da yeni bir proje aç. Örn: `abcsepeti-platform-control`.
2. SQL Editor'da `central/central-platform.sql` dosyasının tamamını çalıştır.
3. Authentication > Users bölümünden yalnız senin kullanacağın süper admin kullanıcı hesabını oluştur.
4. Bu kullanıcının UUID'sini kopyala ve SQL Editor'da şu komutu çalıştır:

```sql
insert into public.super_admin_profiles(user_id)
values ('SUPER_ADMIN_USER_UUID');
```

5. Project Settings/API bölümünden Project URL ve publishable key'i al.
6. `central/central-config.js` dosyasını düzenle:

```js
window.CENTRAL_SUPABASE_CONFIG = {
  url: "https://MERKEZI_PROJECT_REF.supabase.co",
  key: "MERKEZI_PUBLISHABLE_KEY"
};
```

7. Supabase CLI ile merkezi Edge Function'ı deploy et. Fonksiyon kendi business token doğrulamasını yaptığı için JWT doğrulamasını kapatıyoruz:

```bash
supabase login
supabase functions deploy tenant-name-request \
  --project-ref MERKEZI_PROJECT_REF \
  --no-verify-jwt
```

Komutu `central/` klasöründen çalıştırabilirsiniz.

8. `central/super-admin.html` + `central/central-config.js` dosyalarını yalnız senin erişeceğin siteye koy.
9. Süper admin hesabınla giriş yap.

## 2. İlk işletmeyi oluştur

Süper admin panelinde `+ İşletme Ekle`:

- İşletme sahibi: örn. `Ahmet Çaçure`
- Dükkan adı: örn. `Dürümcü`
- Slug: örn. `durumcu`
- İlk lisans: örn. `1`
- Tenant Project Ref: işletmenin Supabase project ref'i (opsiyonel ama önerilir)

Oluşturunca iki önemli değer bir kez gösterilir:

- `Business Public Key`
- `Business Token`

**Business Token'ı kaybetmeyin.** Kaybolursa süper admin panelindeki `Token Yenile` ile yenisini üretirsiniz; eski token geçersiz olur.

## 3. İşletmenin kendi Supabase projesini bağla

Her işletme için ayrı Supabase projesi açın. Mevcut restoran uygulamasının tablo/RPC migration'ları bu projede zaten kurulu olmalıdır.

### 3.1 Tenant SQL

Önce mevcut sistemde yoksa:

```text
sql-upgrade-app-settings.sql
```

Sonra mutlaka:

```text
tenant-platform-bridge.sql
```

`tenant-platform-bridge.sql`, sipariş oluşturma RPC'sine frontend'den doğrudan erişimi kapatır. Sipariş bundan sonra lisans kontrolü yapan Edge Function üzerinden oluşur.

### 3.2 Tenant Edge Function secret'ları

Tenant projesinde şu secret'ları tanımlayın:

```bash
supabase secrets set \
  PLATFORM_CONTROL_URL=https://MERKEZI_PROJECT_REF.supabase.co \
  PLATFORM_CONTROL_PUBLISHABLE_KEY=MERKEZI_PUBLISHABLE_KEY \
  PLATFORM_BUSINESS_KEY=SUPER_ADMINDE_URETILEN_PUBLIC_KEY \
  PLATFORM_BUSINESS_TOKEN=SUPER_ADMINDE_URETILEN_BUSINESS_TOKEN \
  --project-ref TENANT_PROJECT_REF
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` ve `SUPABASE_SERVICE_ROLE_KEY` Edge Function ortamında Supabase tarafından otomatik sağlanır.

### 3.3 Tenant Edge Function'ları deploy et

Müşteri anonim olarak sipariş verebildiği için `create-licensed-order` public çağrılır; fonksiyon kendi lisans kontrolünü yapar:

```bash
supabase functions deploy create-licensed-order \
  --project-ref TENANT_PROJECT_REF \
  --no-verify-jwt
```

İsim değişikliği yalnız giriş yapmış işletme admininden geleceği için JWT doğrulaması açık kalır:

```bash
supabase functions deploy request-shop-name-change \
  --project-ref TENANT_PROJECT_REF
```

### 3.4 Tenant browser config

`tenant/platform-config.js` dosyasını düzenleyin:

```js
window.PLATFORM_CONFIG = {
  url: "https://MERKEZI_PROJECT_REF.supabase.co",
  key: "MERKEZI_PUBLISHABLE_KEY",
  businessKey: "SUPER_ADMINDE_URETILEN_PUBLIC_KEY"
};
```

Bu dosyadaki üç değer browser-safe'tir. **Business Token burada bulunmaz.**

Tenant sitesinde şu dosyalar birlikte bulunmalı:

```text
index.html
admin.html
supabase-config.js       # tenant Supabase URL + publishable key
platform-config.js       # merkezi public bağlantı
manifest.json / service-worker.js / ikonlar ... mevcut dosyalarınız
```

## 4. Dükkan adı değişikliği nasıl çalışır?

1. İşletme admini `Genel Ayarlar` sayfasından yeni dükkan adını yazar.
2. İkon ve arka plan rengi tenant DB'ye hemen kaydolur.
3. Dükkan adı merkezi Edge Function'a talep olarak gider.
4. Merkezi sistem önce:
   - mevcut işletme adlarında aynı isim var mı,
   - başka bir işletmenin bekleyen isim talebinde aynı isim rezerve edilmiş mi
   kontrol eder.
5. Varsa işletmeye hata döner.
6. Yoksa talep `pending` olur.
7. Süper admin panelinde `İsim Talepleri` sekmesine anlık düşer.
8. Sen `Onayla` dediğinde merkezi `businesses.shop_name` değişir.
9. `business_public` Realtime değişikliği tenant `index.html` ve `admin.html` sayfalarına anında yansır.

Dükkan adı değişse bile `business_id` ve `public_key` değişmediği için sipariş/ürün geçmişi bozulmaz.

## 5. Lisans nasıl çalışır?

Süper admin panelinde her işletmede:

- Lisans başlangıcı
- Lisans sonu
- Toplam satın alınan lisans ayı
- Geçen lisans süresi
- Aktif / Deaktif rozeti
- `+1 Ay`, `+3 Ay`, `+6 Ay`, `+12 Ay`
- `Manuel Deaktif Et / Aktif Et`

bulunur.

Lisans uzatılırken:

- mevcut lisans bitişi gelecekteyse mevcut tarihin üstüne ay eklenir,
- lisans geçmişse bugünden itibaren ay eklenir.

Tenant müşteri sayfası lisans durumunu merkezi Realtime'dan görür. Daha önemlisi, `create-licensed-order` Edge Function her yeni siparişte merkezi lisansı tekrar kontrol eder. Böylece frontend değiştirilerek lisans kontrolü atlanamaz.

## 6. Realtime

Merkezi SQL şunları Realtime publication'a ekler:

- `business_public`
- `businesses`
- `name_change_requests`

Sonuç:

- Süper admin lisans uzatınca tenant ekranı yenilenmeden görür.
- Süper admin işletmeyi deaktif edince tenant ekranı yenilenmeden kapanır.
- Dükkan adı onaylanınca tenant müşteri/admin ekranında anında değişir.
- Yeni isim talebi süper admin paneline anında gelir.

Tarih gece yarısı kendiliğinden geçtiğinde DB write olmadığı için tenant sayfası ayrıca periyodik olarak tarih kontrolü yapar; sipariş anındaki backend kontrolü her zaman günceldir.

## 7. Yeni tenant ekleme kısa kontrol listesi

1. Yeni Supabase tenant projesi oluştur.
2. Mevcut restoran schema/migration'larını çalıştır.
3. Süper adminden işletmeyi oluştur.
4. Public Key ve Token'ı al.
5. Tenant'ta `tenant-platform-bridge.sql` çalıştır.
6. Tenant Edge Function secret'larını gir.
7. İki tenant Edge Function'ı deploy et.
8. `platform-config.js` içine merkezi URL/key/public business key'i yaz.
9. Güncel `index.html` ve `admin.html` dosyalarını deploy et.
10. Test siparişi ver ve isim değişikliği talebi oluştur.

