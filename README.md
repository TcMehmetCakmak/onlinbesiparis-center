# onlinbesiparis-center
# Yeni işletme Ekleme
1. Super Admin panelinde: işletme ekle (Çakmak Tatlıcı)
İşletme sahibi:
Gerçek işletme sahibinin adı

Dükkan adı:
Çakmak Tatlıcı

Slug:
cakmak-tatlici

İlk lisans:
1 Ay

Tenant Project Ref:
otxzntnfpkgeqlfswzcb

Not: Tenant Project Ref (otxzntnfpkgeqlfswzcb) olarak özellikle Dürümcü ile aynı ortak Supabase'i kullanıyoruz:

2. **Business Public Key**
c04ccab5-1b3e-4320-95b8-8001a7c02893
**Business Token**
13644d57d3b4757d63ef70c4e71ea6eff27aef945862faaedee4097d954104e0
**Lisans sonu**
2026-10-26

3. süper admin databaseinde 
select
  id as business_id,
  public_key,
  shop_name,
  slug,
  license_end_date,
  manual_enabled
from public.businesses
where public_key = 'c04ccab5-1b3e-4320-95b8-8001a7c02893'; çalıştır ve business_id değerini al

4. Çakmak Tatlıcı admin kullanıcısını oluşturuyoruz.
Authentication
→ Users
→ Add User (admin@cakmaktatlici.com, bildiğimiz_şifre)

5. Admin kullanıcısını oluşturduktan UUID kısmını ile profiles tablosuna bağlayacağız. (05725712-5725-496c-828a-9db787780983)

6. profile olarak ekliyoruz 
insert into public.profiles (
  id,
  role,
  business_id
)
values (
  '05725712-5725-496c-828a-9db787780983',
  'admin',
  'd88862fe-850d-466f-83f5-9f96612e8a43'
)
on conflict (id) do update
set
  role = excluded.role,
  business_id = excluded.business_id;

7. app_settings oluşturuyoruz.
insert into public.app_settings (
  business_id,
  shop_name,
  shop_icon,
  background_color
)
values (
  'd88862fe-850d-466f-83f5-9f96612e8a43',
  'Çakmak Tatlıcı',
  '🍰',
  '#f5f5f5'
)
on conflict (business_id) do update
set
  shop_name = excluded.shop_name,
  shop_icon = excluded.shop_icon,
  background_color = excluded.background_color,
  updated_at = now();

  kontrol:
  select
  id,
  business_id,
  shop_name,
  shop_icon,
  background_color
from public.app_settings
where business_id = 'd88862fe-850d-466f-83f5-9f96612e8a43';

8. Çakmak Tatlıcı için başlangıç ürünlerini ekleyeceğiz.
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
    'd88862fe-850d-466f-83f5-9f96612e8a43',
    'baklava',
    'Baklava',
    '🍯',
    250.00,
    true
  ),
  (
    'd88862fe-850d-466f-83f5-9f96612e8a43',
    'kunefe',
    'Künefe',
    '🧀',
    220.00,
    true
  ),
  (
    'd88862fe-850d-466f-83f5-9f96612e8a43',
    'sutlac',
    'Sütlaç',
    '🍮',
    120.00,
    true
  )
on conflict (business_id, id) do update
set
  name = excluded.name,
  icon = excluded.icon,
  price = excluded.price,
  active = excluded.active;

Kontrol:
select
  business_id,
  id,
  name,
  price,
  active
from public.products
where business_id = 'd88862fe-850d-466f-83f5-9f96612e8a43'
order by id;

9. OnlineSipariş reposunda dükkan adı ile bir klasör oluştur ve ayarları ekle
İlgili dükkan klasörüne bu iki dosyayı koy ve adlarını şu şekilde kullan:
supabase-config.js
platform-config.js

supabase-config.js ortak operasyon Supabase’e bağlı.
platform-config.js ise Çakmak Tatlıcı’nın şu businessKey değerini kullanıyor:
c04ccab5-1b3e-4320-95b8-8001a7c02893

10. cakmak-tatlici-index.html doyasını cakmak-tatlıcı klasörüne index.html ekle
11. pushlayınca artık mevcut url'in sonuna /cakmak-tatlici olarak görüntülenir
