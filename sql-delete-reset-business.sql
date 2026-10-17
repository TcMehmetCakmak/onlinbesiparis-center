-- =====================================================================
-- İŞLETME SİL / SIFIRLA RPC FONKSİYONLARI
-- Hem Merkez DB (dfurcmkuqdjnaibbnoac) hem Operasyonel DB (otxzntnfpkgeqlfswzcb)
-- üzerinde güvenle çalıştırılabilir.
-- =====================================================================

set check_function_bodies = off;

-- 1) MERKEZ VERİTABANI (Central DB: dfurcmkuqdjnaibbnoac)
create or replace function public.super_admin_reset_business(p_business_id uuid)
returns void
language plpgsql security definer set search_path=public
as $$
begin
  if not public.is_super_admin() then raise exception 'Yetkisiz işlem.'; end if;

  update public.businesses
     set inactive_view_count = 0,
         last_inactive_view_at = null,
         updated_at = now()
   where id = p_business_id;

  delete from public.support_ticket_status_public where business_id = p_business_id;
  delete from public.support_tickets where business_id = p_business_id;
  delete from public.name_change_requests where business_id = p_business_id;
  delete from public.package_requests where business_id = p_business_id;
  delete from public.business_passwords
   where email in (
     '__review_mod__:' || p_business_id::text,
     '__inactive_views__:' || p_business_id::text,
     '__active_views__:' || p_business_id::text
   );
end;
$$;

create or replace function public.super_admin_delete_business(p_business_id uuid)
returns void
language plpgsql security definer set search_path=public
as $$
declare
  v_shop_name text;
begin
  if not public.is_super_admin() then raise exception 'Yetkisiz işlem.'; end if;

  select shop_name into v_shop_name from public.businesses where id = p_business_id;

  delete from public.support_ticket_status_public where business_id = p_business_id;
  delete from public.support_tickets where business_id = p_business_id;
  delete from public.package_requests where business_id = p_business_id;
  delete from public.package_subscriptions where business_id = p_business_id;
  delete from public.name_change_requests where business_id = p_business_id;
  delete from public.business_license_history where business_id = p_business_id;
  delete from public.business_passwords
   where business_id = p_business_id
      or (v_shop_name is not null and shop_name = v_shop_name)
      or email in (
        '__review_mod__:' || p_business_id::text,
        '__inactive_views__:' || p_business_id::text,
        '__active_views__:' || p_business_id::text
      );
  delete from public.business_public where business_id = p_business_id;
  delete from public.businesses where id = p_business_id;
end;
$$;

revoke all on function public.super_admin_reset_business(uuid) from public;
revoke all on function public.super_admin_delete_business(uuid) from public;
grant execute on function public.super_admin_reset_business(uuid) to authenticated;
grant execute on function public.super_admin_delete_business(uuid) to authenticated;


-- 2) OPERASYONEL / TENANT VERİTABANI (Tenant DB: otxzntnfpkgeqlfswzcb)
create or replace function public.tenant_collect_business_media_urls(p_business_id uuid)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_bid text := p_business_id::text;
  v_product_paths jsonb;
  v_ad_paths jsonb;
  v_med_paths jsonb;
begin
  select coalesce(jsonb_agg( distinct p ), '[]'::jsonb)
    into v_product_paths
    from (
      select storage_path as p
        from public.product_images
       where business_id::text = v_bid
         and storage_path is not null
         and btrim(storage_path) <> ''
      union
      select name as p
        from storage.objects
       where bucket_id = 'product-images'
         and name like v_bid || '/%'
    ) s;

  select coalesce(jsonb_agg( distinct p ), '[]'::jsonb)
    into v_ad_paths
    from (
      select storage_path as p
        from public.advertisement_images
       where business_id::text = v_bid
         and storage_path is not null
         and btrim(storage_path) <> ''
      union
      select name as p
        from storage.objects
       where bucket_id = 'advertisement-images'
         and name like v_bid || '/%'
    ) s;

  select coalesce(jsonb_agg( distinct p ), '[]'::jsonb)
    into v_med_paths
    from (
      select storage_path as p
        from public.medicine_requests
       where business_id::text = v_bid
         and storage_path is not null
         and btrim(storage_path) <> ''
      union
      select name as p
        from storage.objects
       where bucket_id in ('prescription-requests', 'medicine-prescriptions')
         and name like v_bid || '/%'
    ) s;

  return jsonb_build_object(
    'product_paths', coalesce(v_product_paths, '[]'::jsonb),
    'ad_paths', coalesce(v_ad_paths, '[]'::jsonb),
    'medicine_paths', coalesce(v_med_paths, '[]'::jsonb)
  );
end;
$$;

create or replace function public.tenant_purge_business_data(p_business_id uuid, p_delete_all boolean default false)
returns void
language plpgsql security definer set search_path=public
as $$
declare
  v_bid text := p_business_id::text;
  v_user_ids uuid[];
begin
  delete from public.product_variants
   where product_id::text in (select id::text from public.products where business_id::text = v_bid);

  delete from public.product_images where business_id::text = v_bid;
  delete from public.product_questions where business_id::text = v_bid;
  delete from public.product_reviews where business_id::text = v_bid;
  delete from public.advertisement_images where business_id::text = v_bid;
  delete from public.notifications where business_id::text = v_bid;
  delete from public.order_verifications where business_id::text = v_bid;
  delete from public.orders where business_id::text = v_bid;
  delete from public.reviews where business_id::text = v_bid;
  delete from public.medicine_requests where business_id::text = v_bid;
  delete from public.products where business_id::text = v_bid;
  delete from public.advertisements where business_id::text = v_bid;

  delete from public.business_passwords
   where email in (
     '__review_mod__:' || v_bid,
     '__inactive_views__:' || v_bid,
     '__active_views__:' || v_bid
   );

  begin
    execute 'set local storage.allow_delete_query = ''true''';
    delete from storage.objects
     where name like v_bid || '/%';
  exception when others then
    null;
  end;

  if p_delete_all then
    select array_agg(distinct u_id)
      into v_user_ids
      from (
        select id as u_id from public.profiles where business_id::text = v_bid and id is not null
        union
        select user_id as u_id from public.business_passwords where business_id::text = v_bid and user_id is not null
      ) s;

    delete from public.app_settings where business_id::text = v_bid;
    delete from public.pharmacy_feature_businesses where business_id::text = v_bid;
    delete from public.business_passwords where business_id::text = v_bid;
    delete from public.profiles where business_id::text = v_bid;

    if v_user_ids is not null and array_length(v_user_ids, 1) > 0 then
      delete from auth.users where id = any(v_user_ids);
    end if;
  else
    update public.app_settings
       set shop_icon = '🛍️',
           background_color = '#f5f5f5',
           phone = null,
           instagram_url = null,
           instagram_label = null,
           branches = '[]'::jsonb,
           payment_cash_enabled = true,
           payment_card_enabled = true,
           payment_transfer_enabled = false,
           updated_at = now()
     where business_id::text = v_bid;
  end if;
end;
$$;

grant execute on function public.tenant_collect_business_media_urls(uuid) to anon, authenticated;
grant execute on function public.tenant_purge_business_data(uuid, boolean) to anon, authenticated;

do $$
begin
  if to_regclass('public.orders') is not null then
    alter table public.orders replica identity full;
    drop policy if exists "Admins delete orders" on public.orders;
    create policy "Admins delete orders" on public.orders for delete to authenticated using (public.is_admin_for_business(business_id));
  end if;

  if to_regclass('public.medicine_requests') is not null then
    alter table public.medicine_requests replica identity full;
    drop policy if exists "medicine_requests_admin_delete" on public.medicine_requests;
    create policy "medicine_requests_admin_delete" on public.medicine_requests for delete to authenticated using (public.is_admin_for_business(business_id));
  end if;

  if to_regclass('public.product_questions') is not null then
    alter table public.product_questions replica identity full;
    drop policy if exists "product_questions_admin_delete" on public.product_questions;
    create policy "product_questions_admin_delete" on public.product_questions for delete to authenticated using (public.is_admin_for_business(business_id));
  end if;

  if to_regclass('public.products') is not null then
    alter table public.products replica identity full;
  end if;
  if to_regclass('public.product_images') is not null then
    alter table public.product_images replica identity full;
  end if;
  if to_regclass('public.notifications') is not null then
    alter table public.notifications replica identity full;
  end if;
  if to_regclass('public.advertisements') is not null then
    alter table public.advertisements replica identity full;
  end if;
  if to_regclass('public.advertisement_images') is not null then
    alter table public.advertisement_images replica identity full;
  end if;
  if to_regclass('public.reviews') is not null then
    alter table public.reviews replica identity full;
  end if;
  if to_regclass('public.product_reviews') is not null then
    alter table public.product_reviews replica identity full;
  end if;
end $$;
