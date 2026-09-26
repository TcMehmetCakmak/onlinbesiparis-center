-- CENTRAL: Süper admin işletme düzenleme RPC'si
-- Bunu SADECE merkezi Supabase projesinde çalıştırın.

create or replace function public.super_admin_update_business(
  p_business_id uuid,
  p_owner_name text,
  p_shop_name text,
  p_slug text,
  p_tenant_project_ref text,
  p_manual_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.businesses%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Yetkisiz işlem.';
  end if;

  if btrim(coalesce(p_owner_name,'')) = '' then
    raise exception 'İşletme sahibi gerekli.';
  end if;

  if btrim(coalesce(p_shop_name,'')) = '' then
    raise exception 'Dükkan adı gerekli.';
  end if;

  if btrim(coalesce(p_slug,'')) = '' then
    raise exception 'Slug gerekli.';
  end if;

  if exists (
    select 1
    from public.businesses
    where id <> p_business_id
      and lower(btrim(shop_name)) = lower(btrim(p_shop_name))
  ) then
    raise exception 'Bu dükkan adı başka bir işletmede kullanılıyor.';
  end if;

  if exists (
    select 1
    from public.businesses
    where id <> p_business_id
      and lower(btrim(slug)) = lower(btrim(p_slug))
  ) then
    raise exception 'Bu slug başka bir işletmede kullanılıyor.';
  end if;

  update public.businesses
     set owner_name = btrim(p_owner_name),
         shop_name = btrim(p_shop_name),
         slug = lower(btrim(p_slug)),
         tenant_project_ref = nullif(btrim(coalesce(p_tenant_project_ref,'')), ''),
         manual_enabled = coalesce(p_manual_enabled, false)
   where id = p_business_id
   returning * into v_row;

  if not found then
    raise exception 'İşletme bulunamadı.';
  end if;

  -- business_public trigger ile otomatik senkronize olur.
  return jsonb_build_object(
    'id', v_row.id,
    'public_key', v_row.public_key,
    'shop_name', v_row.shop_name,
    'slug', v_row.slug,
    'manual_enabled', v_row.manual_enabled
  );
end;
$$;

revoke all on function public.super_admin_update_business(uuid,text,text,text,text,boolean) from public;
grant execute on function public.super_admin_update_business(uuid,text,text,text,text,boolean) to authenticated;

notify pgrst, 'reload schema';
