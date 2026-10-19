-- Ürünlerin tutulduğu ortak/tenant Supabase projesinde bir kez çalıştırın.
-- Mevcut beden/boyut alanı (product_type) korunur.
begin;

alter table public.products
  add column if not exists product_category text not null default 'all'
  constraint products_product_category_check
  check (product_category in ('all', 'realestate', 'vehicle', 'food', 'clothing_accessories'));

comment on column public.products.product_category is
  'Ürün tipi: all=Hepsi, realestate=Emlak, vehicle=Vasıta, food=Yemek, clothing_accessories=Giyim&Aksesuar';

commit;

notify pgrst, 'reload schema';
