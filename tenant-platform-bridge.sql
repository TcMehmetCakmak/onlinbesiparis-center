-- TENANT PROJECT BRIDGE
-- Run this in EACH business's own Supabase project AFTER the existing order migrations.
-- It makes order creation server-side only through the create-licensed-order Edge Function.

-- Keep app_settings.shop_name for backwards compatibility, but the platform's central business name is authoritative.

-- Direct anonymous/authenticated execution is disabled so an expired tenant cannot bypass the license check.
do $$ begin
  revoke execute on function public.create_pending_whatsapp_order_with_coupons(
    text,text,text,text,numeric,numeric,text,jsonb,text[]
  ) from anon,authenticated;
exception when undefined_function then null; end $$;

-- service_role bypasses RLS and can call the function from the Edge Function.
-- Explicitly allow postgres/service_role in case privileges were tightened previously.
do $$ begin
  grant execute on function public.create_pending_whatsapp_order_with_coupons(
    text,text,text,text,numeric,numeric,text,jsonb,text[]
  ) to service_role;
exception when undefined_function then null; end $$;
