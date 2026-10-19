-- Ürünlerin tutulduğu Supabase projesinin SQL Editor ekranında çalıştırın.
-- admin.html ve index.html güncellemelerinden önce uygulanmalıdır.
begin;
alter table public.product_variants
  add column if not exists is_sold_out boolean not null default false;
commit;
