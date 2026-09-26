-- CENTRAL PLATFORM DATABASE
-- Run this ONLY in the central Supabase project used by super-admin.html.

create extension if not exists pgcrypto;

create table if not exists public.super_admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  public_key uuid not null default gen_random_uuid() unique,
  owner_name text not null,
  shop_name text not null,
  slug text not null,
  tenant_project_ref text,
  license_start_date date not null default current_date,
  license_end_date date not null,
  total_license_months integer not null default 0 check (total_license_months >= 0),
  manual_enabled boolean not null default true,
  api_token_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists businesses_shop_name_ci_uq
  on public.businesses (lower(btrim(shop_name)));
create unique index if not exists businesses_slug_ci_uq
  on public.businesses (lower(btrim(slug)));

create table if not exists public.business_license_history (
  id bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  months_added integer not null check (months_added > 0),
  previous_end_date date,
  new_end_date date not null,
  changed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.name_change_requests (
  id bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  current_name text not null,
  requested_name text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  rejection_reason text
);

create unique index if not exists name_change_one_pending_per_business
  on public.name_change_requests(business_id)
  where status='pending';

-- Public projection contains no owner/contact/admin secrets.
create table if not exists public.business_public (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  public_key uuid not null unique,
  shop_name text not null,
  slug text not null,
  license_end_date date not null,
  manual_enabled boolean not null,
  is_active boolean not null,
  updated_at timestamptz not null default now()
);

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer
set search_path=public
as $$
  select exists(select 1 from public.super_admin_profiles p where p.user_id=auth.uid());
$$;

create or replace function public.refresh_business_public_row(p_business_id uuid)
returns void
language plpgsql security definer
set search_path=public
as $$
begin
  insert into public.business_public(
    business_id,public_key,shop_name,slug,license_end_date,manual_enabled,is_active,updated_at
  )
  select b.id,b.public_key,b.shop_name,b.slug,b.license_end_date,b.manual_enabled,
         (b.manual_enabled and b.license_end_date >= current_date),now()
  from public.businesses b where b.id=p_business_id
  on conflict (business_id) do update set
    public_key=excluded.public_key,
    shop_name=excluded.shop_name,
    slug=excluded.slug,
    license_end_date=excluded.license_end_date,
    manual_enabled=excluded.manual_enabled,
    is_active=excluded.is_active,
    updated_at=now();
end;
$$;

create or replace function public.businesses_sync_public_trigger()
returns trigger
language plpgsql security definer
set search_path=public
as $$
begin
  new.updated_at:=now();
  return new;
end;
$$;

drop trigger if exists trg_businesses_updated_at on public.businesses;
create trigger trg_businesses_updated_at
before update on public.businesses
for each row execute function public.businesses_sync_public_trigger();

create or replace function public.businesses_after_write_public_trigger()
returns trigger
language plpgsql security definer
set search_path=public
as $$
begin
  perform public.refresh_business_public_row(new.id);
  return new;
end;
$$;

drop trigger if exists trg_businesses_public_sync on public.businesses;
create trigger trg_businesses_public_sync
after insert or update of shop_name,slug,license_end_date,manual_enabled,public_key
on public.businesses
for each row execute function public.businesses_after_write_public_trigger();

create or replace function public.super_admin_list_businesses()
returns table(
  id uuid, public_key uuid, owner_name text, shop_name text, slug text, tenant_project_ref text,
  license_start_date date, license_end_date date, total_license_months integer,
  active_months numeric, manual_enabled boolean, is_active boolean, created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer set search_path=public
as $$
begin
  if not public.is_super_admin() then raise exception 'Yetkisiz işlem.'; end if;
  return query
  select b.id,b.public_key,b.owner_name,b.shop_name,b.slug,b.tenant_project_ref,
         b.license_start_date,b.license_end_date,b.total_license_months,
         round((greatest(0,(least(current_date,b.license_end_date)-b.license_start_date))::numeric / 30.44),1),
         b.manual_enabled,(b.manual_enabled and b.license_end_date>=current_date),b.created_at,b.updated_at
  from public.businesses b order by b.created_at desc;
end;
$$;

create or replace function public.super_admin_create_business(
  p_owner_name text,
  p_shop_name text,
  p_slug text,
  p_initial_months integer default 1,
  p_tenant_project_ref text default null
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare
  v_id uuid;
  v_public_key uuid;
  v_token text:=encode(gen_random_bytes(32),'hex');
  v_start date:=current_date;
  v_end date;
begin
  if not public.is_super_admin() then raise exception 'Yetkisiz işlem.'; end if;
  if btrim(coalesce(p_owner_name,''))='' then raise exception 'İşletme sahibi gerekli.'; end if;
  if btrim(coalesce(p_shop_name,''))='' then raise exception 'Dükkan adı gerekli.'; end if;
  if btrim(coalesce(p_slug,''))='' then raise exception 'Slug gerekli.'; end if;
  if coalesce(p_initial_months,0)<1 then raise exception 'Başlangıç lisansı en az 1 ay olmalı.'; end if;
  if exists(select 1 from public.businesses where lower(btrim(shop_name))=lower(btrim(p_shop_name))) then
    raise exception 'Bu dükkan adı daha önce kullanılmış.';
  end if;
  if exists(select 1 from public.businesses where lower(btrim(slug))=lower(btrim(p_slug))) then
    raise exception 'Bu slug daha önce kullanılmış.';
  end if;
  v_end:=(v_start + make_interval(months=>p_initial_months))::date;
  insert into public.businesses(owner_name,shop_name,slug,tenant_project_ref,license_start_date,license_end_date,total_license_months,api_token_hash)
  values(btrim(p_owner_name),btrim(p_shop_name),lower(btrim(p_slug)),nullif(btrim(coalesce(p_tenant_project_ref,'')),''),v_start,v_end,p_initial_months,
         encode(extensions.digest(v_token,'sha256'),'hex'))
  returning id,public_key into v_id,v_public_key;
  insert into public.business_license_history(business_id,months_added,previous_end_date,new_end_date,changed_by)
  values(v_id,p_initial_months,null,v_end,auth.uid());
  return jsonb_build_object('business_id',v_id,'public_key',v_public_key,'business_token',v_token,'license_end_date',v_end);
end;
$$;

create or replace function public.super_admin_extend_license(p_business_id uuid,p_months integer)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare b public.businesses%rowtype; v_base date; v_new date;
begin
  if not public.is_super_admin() then raise exception 'Yetkisiz işlem.'; end if;
  if coalesce(p_months,0)<1 then raise exception 'Ay sayısı en az 1 olmalı.'; end if;
  select * into b from public.businesses where id=p_business_id for update;
  if not found then raise exception 'İşletme bulunamadı.'; end if;
  v_base:=case when b.license_end_date>=current_date then b.license_end_date else current_date end;
  v_new:=(v_base + make_interval(months=>p_months))::date;
  update public.businesses set license_end_date=v_new,total_license_months=total_license_months+p_months where id=p_business_id;
  insert into public.business_license_history(business_id,months_added,previous_end_date,new_end_date,changed_by)
  values(p_business_id,p_months,b.license_end_date,v_new,auth.uid());
  return jsonb_build_object('license_end_date',v_new,'total_license_months',b.total_license_months+p_months);
end;
$$;

create or replace function public.super_admin_set_business_enabled(p_business_id uuid,p_enabled boolean)
returns void
language plpgsql security definer set search_path=public
as $$
begin
  if not public.is_super_admin() then raise exception 'Yetkisiz işlem.'; end if;
  update public.businesses set manual_enabled=p_enabled where id=p_business_id;
  if not found then raise exception 'İşletme bulunamadı.'; end if;
end;
$$;

create or replace function public.super_admin_list_name_requests()
returns table(
  id bigint,business_id uuid,current_name text,requested_name text,status text,requested_at timestamptz,
  reviewed_at timestamptz,rejection_reason text,owner_name text,shop_name text
)
language plpgsql security definer set search_path=public
as $$
begin
  if not public.is_super_admin() then raise exception 'Yetkisiz işlem.'; end if;
  return query
  select r.id,r.business_id,r.current_name,r.requested_name,r.status,r.requested_at,r.reviewed_at,r.rejection_reason,b.owner_name,b.shop_name
  from public.name_change_requests r join public.businesses b on b.id=r.business_id
  order by case when r.status='pending' then 0 else 1 end,r.requested_at desc;
end;
$$;

create or replace function public.super_admin_approve_name_request(p_request_id bigint)
returns void
language plpgsql security definer set search_path=public
as $$
declare r public.name_change_requests%rowtype;
begin
  if not public.is_super_admin() then raise exception 'Yetkisiz işlem.'; end if;
  select * into r from public.name_change_requests where id=p_request_id for update;
  if not found or r.status<>'pending' then raise exception 'Bekleyen talep bulunamadı.'; end if;
  if exists(select 1 from public.businesses where id<>r.business_id and lower(btrim(shop_name))=lower(btrim(r.requested_name))) then
    raise exception 'Bu dükkan adı artık başka bir işletme tarafından kullanılıyor.';
  end if;
  update public.businesses set shop_name=btrim(r.requested_name) where id=r.business_id;
  update public.name_change_requests set status='approved',reviewed_at=now(),reviewed_by=auth.uid() where id=p_request_id;
end;
$$;

create or replace function public.super_admin_reject_name_request(p_request_id bigint,p_reason text default null)
returns void
language plpgsql security definer set search_path=public
as $$
begin
  if not public.is_super_admin() then raise exception 'Yetkisiz işlem.'; end if;
  update public.name_change_requests
     set status='rejected',reviewed_at=now(),reviewed_by=auth.uid(),rejection_reason=nullif(btrim(coalesce(p_reason,'')),'')
   where id=p_request_id and status='pending';
  if not found then raise exception 'Bekleyen talep bulunamadı.'; end if;
end;
$$;

alter table public.super_admin_profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_license_history enable row level security;
alter table public.name_change_requests enable row level security;
alter table public.business_public enable row level security;

revoke all on public.super_admin_profiles,public.businesses,public.business_license_history,public.name_change_requests from anon,authenticated;
revoke all on public.business_public from anon,authenticated;
grant select on public.business_public to anon,authenticated;

create policy business_public_read on public.business_public for select to anon,authenticated using (true);

revoke all on function public.super_admin_list_businesses() from public;
revoke all on function public.super_admin_create_business(text,text,text,integer,text) from public;
revoke all on function public.super_admin_extend_license(uuid,integer) from public;
revoke all on function public.super_admin_set_business_enabled(uuid,boolean) from public;
revoke all on function public.super_admin_list_name_requests() from public;
revoke all on function public.super_admin_approve_name_request(bigint) from public;
revoke all on function public.super_admin_reject_name_request(bigint,text) from public;
grant execute on function public.super_admin_list_businesses() to authenticated;
grant execute on function public.super_admin_create_business(text,text,text,integer,text) to authenticated;
grant execute on function public.super_admin_extend_license(uuid,integer) to authenticated;
grant execute on function public.super_admin_set_business_enabled(uuid,boolean) to authenticated;
grant execute on function public.super_admin_list_name_requests() to authenticated;
grant execute on function public.super_admin_approve_name_request(bigint) to authenticated;
grant execute on function public.super_admin_reject_name_request(bigint,text) to authenticated;


-- Existing rows are also projected when this migration is re-run.
insert into public.business_public(business_id,public_key,shop_name,slug,license_end_date,manual_enabled,is_active,updated_at)
select b.id,b.public_key,b.shop_name,b.slug,b.license_end_date,b.manual_enabled,
       (b.manual_enabled and b.license_end_date >= current_date),now()
from public.businesses b
on conflict (business_id) do update set
  public_key=excluded.public_key, shop_name=excluded.shop_name, slug=excluded.slug,
  license_end_date=excluded.license_end_date, manual_enabled=excluded.manual_enabled,
  is_active=excluded.is_active, updated_at=now();

-- Super admin SELECT policies are required for Realtime subscriptions in super-admin.html.
drop policy if exists super_admin_businesses_select on public.businesses;
create policy super_admin_businesses_select on public.businesses
for select to authenticated using (public.is_super_admin());

drop policy if exists super_admin_name_requests_select on public.name_change_requests;
create policy super_admin_name_requests_select on public.name_change_requests
for select to authenticated using (public.is_super_admin());

drop policy if exists super_admin_license_history_select on public.business_license_history;
create policy super_admin_license_history_select on public.business_license_history
for select to authenticated using (public.is_super_admin());

drop policy if exists super_admin_profiles_self_select on public.super_admin_profiles;
create policy super_admin_profiles_self_select on public.super_admin_profiles
for select to authenticated using (user_id=auth.uid());

-- Table privileges are still required in addition to RLS for Realtime/SELECT.
grant select on public.businesses to authenticated;
grant select on public.name_change_requests to authenticated;
grant select on public.business_license_history to authenticated;
grant select on public.super_admin_profiles to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.business_public;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.name_change_requests;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.businesses;
exception when duplicate_object then null; end $$;

-- Rotate a tenant connection token if the one-time token is lost/compromised.
create or replace function public.super_admin_rotate_business_token(p_business_id uuid)
returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare v_token text:=encode(gen_random_bytes(32),'hex');
begin
  if not public.is_super_admin() then raise exception 'Yetkisiz işlem.'; end if;
  update public.businesses
     set api_token_hash=encode(extensions.digest(v_token,'sha256'),'hex')
   where id=p_business_id;
  if not found then raise exception 'İşletme bulunamadı.'; end if;
  return jsonb_build_object('business_token',v_token);
end;
$$;
revoke all on function public.super_admin_rotate_business_token(uuid) from public;
grant execute on function public.super_admin_rotate_business_token(uuid) to authenticated;
