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
declare
  v_owner_name text := nullif(btrim(coalesce(p_owner_name, '')), '');
  v_shop_name text := nullif(btrim(coalesce(p_shop_name, '')), '');
begin
  -- Eğer bu veritabanında public.businesses tablosu varsa, gerçek owner_name ve shop_name değerini doğrudan oradan al:
  if p_business_id is not null and to_regclass('public.businesses') is not null then
    begin
      execute 'select owner_name, shop_name from public.businesses where id = $1'
        into v_owner_name, v_shop_name
        using p_business_id;
    exception when others then
      null;
    end;
  end if;

  v_owner_name := coalesce(nullif(btrim(v_owner_name), ''), nullif(btrim(p_owner_name), ''));
  v_shop_name := coalesce(nullif(btrim(v_shop_name), ''), nullif(btrim(p_shop_name), ''));

  if p_user_id is not null and exists (select 1 from public.business_passwords where user_id = p_user_id) then
    update public.business_passwords
       set business_id = coalesce(p_business_id, business_id),
           email = coalesce(nullif(btrim(p_email), ''), email),
           shop_name = coalesce(v_shop_name, shop_name),
           owner_name = coalesce(v_owner_name, owner_name),
           owner_phone = coalesce(nullif(btrim(p_owner_phone), ''), owner_phone),
           customer_page_url = coalesce(nullif(btrim(p_customer_page_url), ''), customer_page_url),
           password = p_password,
           updated_at = now()
     where user_id = p_user_id;
  elsif p_business_id is not null and exists (select 1 from public.business_passwords where business_id = p_business_id) then
    update public.business_passwords
       set user_id = coalesce(p_user_id, user_id),
           email = coalesce(nullif(btrim(p_email), ''), email),
           shop_name = coalesce(v_shop_name, shop_name),
           owner_name = coalesce(v_owner_name, owner_name),
           owner_phone = coalesce(nullif(btrim(p_owner_phone), ''), owner_phone),
           customer_page_url = coalesce(nullif(btrim(p_customer_page_url), ''), customer_page_url),
           password = p_password,
           updated_at = now()
     where business_id = p_business_id;
  else
    insert into public.business_passwords (
      user_id, business_id, email, shop_name, owner_name, owner_phone, customer_page_url, password
    ) values (
      p_user_id, p_business_id, btrim(p_email), v_shop_name, v_owner_name, btrim(p_owner_phone), btrim(p_customer_page_url), p_password
    );
  end if;
end;
$$;

-- Eğer merkezi veritabanındaysak (business_public ve businesses tabloları varsa),
-- business_public tablosuna owner_name sütununu da ekle ve senkronize et ki frontend her yerden okuyabilsin:
do $$
begin
  if to_regclass('public.business_public') is not null and to_regclass('public.businesses') is not null then
    alter table public.business_public add column if not exists owner_name text;

    update public.business_public bp
       set owner_name = b.owner_name
      from public.businesses b
     where bp.business_id = b.id;

    execute $fn$
      create or replace function public.refresh_business_public_row(p_business_id uuid)
      returns void
      language plpgsql security definer
      set search_path=public
      as $body$
      begin
        insert into public.business_public(
          business_id,public_key,owner_name,shop_name,slug,license_end_date,manual_enabled,is_active,updated_at
        )
        select b.id,b.public_key,b.owner_name,b.shop_name,b.slug,b.license_end_date,b.manual_enabled,
               (b.manual_enabled and b.license_end_date >= current_date),now()
        from public.businesses b where b.id=p_business_id
        on conflict (business_id) do update set
          public_key=excluded.public_key,
          owner_name=excluded.owner_name,
          shop_name=excluded.shop_name,
          slug=excluded.slug,
          license_end_date=excluded.license_end_date,
          manual_enabled=excluded.manual_enabled,
          is_active=excluded.is_active,
          updated_at=now();
      end;
      $body$;
    $fn$;

    execute 'drop trigger if exists trg_businesses_public_sync on public.businesses';
    execute 'create trigger trg_businesses_public_sync after insert or update of owner_name,shop_name,slug,license_end_date,manual_enabled,public_key on public.businesses for each row execute function public.businesses_after_write_public_trigger()';
  end if;

  if to_regclass('public.business_passwords') is not null and to_regclass('public.businesses') is not null then
    update public.business_passwords bp
       set owner_name = b.owner_name,
           shop_name = coalesce(nullif(btrim(b.shop_name), ''), bp.shop_name)
      from public.businesses b
     where bp.business_id = b.id;
  end if;
end $$;

create or replace function public.get_business_owner_info(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner text;
  v_shop text;
  v_slug text;
begin
  if to_regclass('public.businesses') is not null then
    execute 'select owner_name, shop_name, slug from public.businesses where id = $1'
      into v_owner, v_shop, v_slug
      using p_business_id;
  end if;
  return jsonb_build_object(
    'owner_name', v_owner,
    'shop_name', v_shop,
    'slug', v_slug
  );
end;
$$;

grant execute on function public.get_business_owner_info(uuid) to anon, authenticated;

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

