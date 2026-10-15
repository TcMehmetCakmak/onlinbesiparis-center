-- ŞİFRE SIFIRLAMA VE İŞLETME ŞİFRE TAKİP TABLOSU
-- Not: Bu SQL'i işletme/müşteri verilerinin bulunduğu Supabase projesinde (otxzntnfpkgeqlfswzcb) SQL Editor üzerinden çalıştırın.
-- İsterseniz merkezi Supabase projesinde (dfurcmkuqdjnaibbnoac) de çalıştırabilirsiniz; sistem her ikisine de kayıt/güncelleme deneyecektir.

create table if not exists public.business_passwords (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,
  business_id uuid,
  email text,
  shop_name text,
  owner_name text,
  owner_phone text,
  customer_page_url text,
  password text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists business_passwords_business_id_uq
  on public.business_passwords (business_id)
  where business_id is not null;

-- Otomatik updated_at güncellemesi
create or replace function public.set_business_passwords_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_business_passwords_updated_at on public.business_passwords;
create trigger trg_business_passwords_updated_at
before update on public.business_passwords
for each row execute function public.set_business_passwords_updated_at();

-- Güvenli RPC fonksiyonu: password-reset.html veya admin.html üzerinden çağrıldığında
-- kaydı oluşturur veya (varsa) şifreyi ve işletme bilgilerini günceller.
create or replace function public.upsert_business_password(
  p_user_id uuid,
  p_business_id uuid,
  p_email text,
  p_shop_name text,
  p_owner_name text,
  p_owner_phone text,
  p_customer_page_url text,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is not null and exists (select 1 from public.business_passwords where user_id = p_user_id) then
    update public.business_passwords
       set business_id = coalesce(p_business_id, business_id),
           email = coalesce(nullif(btrim(p_email), ''), email),
           shop_name = coalesce(nullif(btrim(p_shop_name), ''), shop_name),
           owner_name = coalesce(nullif(btrim(p_owner_name), ''), owner_name),
           owner_phone = coalesce(nullif(btrim(p_owner_phone), ''), owner_phone),
           customer_page_url = coalesce(nullif(btrim(p_customer_page_url), ''), customer_page_url),
           password = p_password,
           updated_at = now()
     where user_id = p_user_id;
  elsif p_business_id is not null and exists (select 1 from public.business_passwords where business_id = p_business_id) then
    update public.business_passwords
       set user_id = coalesce(p_user_id, user_id),
           email = coalesce(nullif(btrim(p_email), ''), email),
           shop_name = coalesce(nullif(btrim(p_shop_name), ''), shop_name),
           owner_name = coalesce(nullif(btrim(p_owner_name), ''), owner_name),
           owner_phone = coalesce(nullif(btrim(p_owner_phone), ''), owner_phone),
           customer_page_url = coalesce(nullif(btrim(p_customer_page_url), ''), customer_page_url),
           password = p_password,
           updated_at = now()
     where business_id = p_business_id;
  else
    insert into public.business_passwords (
      user_id, business_id, email, shop_name, owner_name, owner_phone, customer_page_url, password
    ) values (
      p_user_id, p_business_id, btrim(p_email), btrim(p_shop_name), btrim(p_owner_name), btrim(p_owner_phone), btrim(p_customer_page_url), p_password
    );
  end if;
end;
$$;

alter table public.business_passwords enable row level security;

-- Okuma / Yazma izinleri
drop policy if exists business_passwords_all_access on public.business_passwords;
create policy business_passwords_all_access on public.business_passwords
for all to anon, authenticated
using (true)
with check (true);

grant select, insert, update on public.business_passwords to anon, authenticated;
grant execute on function public.upsert_business_password(uuid, uuid, text, text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

