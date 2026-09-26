-- TENANT: app_settings kurulumu / onarımı
-- Bunu HER işletmenin kendi Supabase projesinde SQL Editor'da çalıştırın.

create table if not exists public.app_settings (
  id smallint primary key default 1 check (id = 1),
  shop_name text not null default 'Dürümcü',
  shop_icon text not null default '🌯',
  background_color text not null default '#f5f5f5',
  updated_at timestamptz not null default now(),
  constraint app_settings_background_color_check
    check (background_color ~ '^#[0-9A-Fa-f]{6}$')
);

insert into public.app_settings (id, shop_name, shop_icon, background_color)
values (1, 'Dürümcü', '🌯', '#f5f5f5')
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_public_read" on public.app_settings;
create policy "app_settings_public_read"
on public.app_settings
for select
to anon, authenticated
using (true);

drop policy if exists "app_settings_admin_insert" on public.app_settings;
create policy "app_settings_admin_insert"
on public.app_settings
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "app_settings_admin_update" on public.app_settings;
create policy "app_settings_admin_update"
on public.app_settings
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

grant select on public.app_settings to anon, authenticated;
grant insert, update on public.app_settings to authenticated;
revoke delete on public.app_settings from anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_settings'
  ) then
    alter publication supabase_realtime add table public.app_settings;
  end if;
end $$;

-- PostgREST schema cache'i hemen yenilemeye zorla.
notify pgrst, 'reload schema';
