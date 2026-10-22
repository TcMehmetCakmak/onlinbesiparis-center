-- Operasyonel Supabase projesinde çalıştırın: otxzntnfpkgeqlfswzcb
-- Önce seo/settings.sql uygulanmış olmalıdır.
update public.app_settings
set description = 'Örgü Sepeti''nde el yapımı amigurumi oyuncaklar, örgü bebekler, çantalar, bebek hırkaları ve el emeği ürünleri keşfedin. ABC Sepeti üzerinden inceleyin.',
    updated_at = now()
where business_id = 'f3db0a7a-5a97-4ea2-8815-a7388d26f2e6'
returning business_id, description;
