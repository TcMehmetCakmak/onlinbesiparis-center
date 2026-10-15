-- ============================================================
-- YORUM ONAY / ARGO DENETİMİ SQL GÜNCELLEMESİ (TENANT DB)
-- Bu sorguyu ürün/yorum tablolarının bulunduğu Supabase SQL Editor'de çalıştırabilirsiniz.
-- ============================================================

-- 1) İşletme yorumları (public.reviews) tablosuna status ve matched_words sütunlarını ekle
alter table public.reviews
  add column if not exists status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected')),
  add column if not exists matched_words text[] not null default '{}'::text[],
  add column if not exists moderated_at timestamptz;

-- 2) Ürün yorumları (public.product_reviews) tablosuna status ve matched_words sütunlarını ekle
alter table public.product_reviews
  add column if not exists status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected')),
  add column if not exists matched_words text[] not null default '{}'::text[],
  add column if not exists moderated_at timestamptz;

-- 3) Adminin yorum durumunu (Onayla / Beklet / Reddet) güncelleyebilmesi için UPDATE yetkisi ve RLS politikaları
grant select, insert, update on public.reviews to anon, authenticated;
grant select, insert, update on public.product_reviews to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'reviews' and policyname = 'reviews_update_moderation_policy'
  ) then
    create policy reviews_update_moderation_policy
      on public.reviews
      for update
      to anon, authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'product_reviews' and policyname = 'product_reviews_update_moderation_policy'
  ) then
    create policy product_reviews_update_moderation_policy
      on public.product_reviews
      for update
      to anon, authenticated
      using (true)
      with check (true);
  end if;
end $$;

