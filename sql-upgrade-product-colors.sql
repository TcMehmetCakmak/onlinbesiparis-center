-- Ürünlerin ve siparişlerin tutulduğu Supabase projesinde çalıştırın.
-- Ardından create-licensed-order Edge Function'ını yeniden yayınlayın.
begin;

alter table public.products
  add column if not exists color_options jsonb not null default '[]'::jsonb
  check (jsonb_typeof(color_options) = 'array');

-- Fotoğraf silinirse o fotoğrafa bağlı renk de kaldırılır.
create or replace function public.remove_deleted_product_image_color()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.products p
  set color_options = coalesce((
    select jsonb_agg(c.value order by c.ordinality)
    from jsonb_array_elements(p.color_options) with ordinality c
    where c.value->>'image_path' is distinct from old.storage_path
  ), '[]'::jsonb)
  where p.id = old.product_id and p.business_id = old.business_id;
  return old;
end;
$$;
revoke all on function public.remove_deleted_product_image_color() from public, anon, authenticated;
drop trigger if exists product_image_color_cleanup on public.product_images;
create trigger product_image_color_cleanup after delete on public.product_images
for each row execute function public.remove_deleted_product_image_color();

-- Mevcut fiyat/kupon/yemek doğrulamasını koruyarak renk anlık görüntüsünü
-- aynı işlem içinde siparişe ekler. İstemcinin renk adı/fotoğrafı kabul edilmez.
create or replace function public.create_pending_whatsapp_order_with_colors(
  p_business_id uuid,
  p_name text,
  p_address text,
  p_payment text,
  p_note text,
  p_latitude numeric,
  p_longitude numeric,
  p_google_maps_url text,
  p_phone_number text,
  p_items jsonb,
  p_coupon_codes text[]
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  incoming jsonb;
  colors jsonb;
  selected_color jsonb;
  normalized jsonb := '[]'::jsonb;
  result jsonb;
  saved_items jsonb;
  enriched jsonb := '[]'::jsonb;
  saved jsonb;
  original jsonb;
  has_colors boolean := false;
  idx integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Siparişte ürün bulunmuyor.';
  end if;

  for incoming in select value from jsonb_array_elements(p_items) loop
    select p.color_options into colors from public.products p
    where p.id::text = incoming->>'productId' and p.business_id = p_business_id
    for share;
    if not found then raise exception 'Ürün bu işletmede bulunamadı.'; end if;

    selected_color := null;
    if jsonb_array_length(colors) > 0 then
      select value into selected_color from jsonb_array_elements(colors)
      where value->>'id' = incoming->>'colorId' limit 1;
      if selected_color is null then raise exception 'Lütfen geçerli bir renk seçiniz.'; end if;
      has_colors := true;
    elsif coalesce(incoming->>'colorId', '') <> '' then
      raise exception 'Seçilen renk artık mevcut değil.';
    end if;

    normalized := normalized || jsonb_build_array(
      (incoming - 'colorId' - 'colorName' - 'colorImage') || jsonb_build_object(
        'colorId', selected_color->>'id',
        'colorName', selected_color->>'name',
        'colorImage', selected_color->>'image_path'
      )
    );
  end loop;

  select to_jsonb(public.create_pending_whatsapp_order_with_coupons(
    p_business_id => p_business_id,
    p_name => p_name,
    p_address => p_address,
    p_payment => p_payment,
    p_note => p_note,
    p_latitude => p_latitude,
    p_longitude => p_longitude,
    p_google_maps_url => p_google_maps_url,
    p_phone_number => p_phone_number,
    p_items => normalized,
    p_coupon_codes => p_coupon_codes
  )) into result;

  if not has_colors then return result; end if;

  select o.items into saved_items from public.orders o
  where o.id::text = result->>'id' and o.business_id = p_business_id for update;
  if not found or jsonb_typeof(saved_items) is distinct from 'array' then
    raise exception 'Siparişin renk bilgileri kaydedilemedi.';
  end if;
  if jsonb_array_length(saved_items) <> jsonb_array_length(normalized) then
    raise exception 'Sipariş satırları renklerle eşleştirilemedi; işlem geri alındı.';
  end if;

  for idx in 0..jsonb_array_length(saved_items)-1 loop
    saved := saved_items->idx;
    original := normalized->idx;
    -- Eski RPC farklı renkleri birleştirirse veya sıralamayı değiştirirse
    -- yanlış renk kaydetmek yerine tüm siparişi geri al.
    if saved->>'productId' is distinct from original->>'productId'
       or coalesce(saved->>'variantId','') <> coalesce(original->>'variantId','')
       or (saved->>'quantity')::numeric is distinct from (original->>'quantity')::numeric then
      raise exception 'Sipariş satırları renklerle eşleştirilemedi; işlem geri alındı.';
    end if;
    enriched := enriched || jsonb_build_array(saved || jsonb_build_object(
      'colorId', original->>'colorId',
      'colorName', original->>'colorName',
      'colorImage', original->>'colorImage'
    ));
  end loop;

  update public.orders set items = enriched
  where id::text = result->>'id' and business_id = p_business_id;
  return jsonb_set(result, '{items}', enriched);
end;
$$;

revoke all on function public.create_pending_whatsapp_order_with_colors(
  uuid,text,text,text,text,numeric,numeric,text,text,jsonb,text[]
) from public, anon, authenticated;
grant execute on function public.create_pending_whatsapp_order_with_colors(
  uuid,text,text,text,text,numeric,numeric,text,text,jsonb,text[]
) to service_role;

commit;
notify pgrst, 'reload schema';
