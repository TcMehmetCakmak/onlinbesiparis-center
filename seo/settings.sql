-- Run in the OPERATIONAL Supabase project, where app_settings already exists.
-- Existing authenticated app_settings policies govern editing these fields.
alter table public.app_settings add column if not exists description text;
alter table public.app_settings add column if not exists seo_image_url text;
alter table public.app_settings add column if not exists seo_indexable boolean not null default true;
alter table public.app_settings add column if not exists is_public boolean not null default true;
-- description: business-authored factual description, never copied from products.
-- seo_image_url: approved public HTTPS business image, never prescription uploads.
-- Pharmacy records remain noindex regardless of these flags.
