-- Multi-tenant barbers setup
-- Replace the placeholders below with the real auth.users.id values before running.
-- Lucas Dantas UUID:    <LUCAS_AUTH_UID>
-- Victor Emanuel UUID:  <VICTOR_AUTH_UID>

create extension if not exists pgcrypto;

create table if not exists public.barbers (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  photo_url text null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.barbers enable row level security;

create table if not exists public.services_catalog (
  id bigserial primary key,
  barber_id uuid,
  title text not null,
  price numeric(10,2) not null default 0,
  minutes integer not null default 0,
  image text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id bigserial primary key,
  barber_id uuid,
  date date not null,
  time text not null check (time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  name text not null,
  phone text null,
  service text null,
  price numeric(10,2) null,
  duration_minutes integer null,
  created_at timestamptz not null default now()
);

alter table public.services_catalog
  add column if not exists barber_id uuid;

alter table public.bookings
  add column if not exists barber_id uuid;

-- Seed / backfill: replace the UUIDs below before running.
-- If your project already has these rows, the ON CONFLICT clauses keep them updated.
do $$
declare
  lucas_uid uuid := '<LUCAS_AUTH_UID>'::uuid;
  victor_uid uuid := '<VICTOR_AUTH_UID>'::uuid;
begin
  insert into public.barbers (id, display_name, photo_url, sort_order, active)
  values
    (lucas_uid, 'Lucas Dantas', null, 1, true),
    (victor_uid, 'Victor Emanuel', null, 2, true)
  on conflict (id) do update
  set display_name = excluded.display_name,
      photo_url = excluded.photo_url,
      sort_order = excluded.sort_order,
      active = excluded.active,
      updated_at = now();

  update public.services_catalog
    set barber_id = lucas_uid
    where barber_id is null;

  update public.bookings
    set barber_id = lucas_uid
    where barber_id is null;

  -- Cloneia o catálogo do Lucas para o Victor mantendo os registros separados.
  -- A cópia é idempotente: serviços já existentes no Victor, com o mesmo título,
  -- não são duplicados.
  insert into public.services_catalog (barber_id, title, price, minutes, image, created_at, updated_at)
  select
    victor_uid,
    s.title,
    s.price,
    s.minutes,
    s.image,
    now(),
    now()
  from public.services_catalog s
  where s.barber_id = lucas_uid
    and not exists (
      select 1
      from public.services_catalog existing
      where existing.barber_id = victor_uid
        and existing.title = s.title
    );
end $$;

alter table public.services_catalog
  alter column barber_id set not null;

alter table public.bookings
  alter column barber_id set not null;

alter table public.services_catalog
  add constraint services_catalog_barber_id_fkey
  foreign key (barber_id) references auth.users(id) on delete cascade;

alter table public.bookings
  add constraint bookings_barber_id_fkey
  foreign key (barber_id) references auth.users(id) on delete cascade;

create unique index if not exists bookings_unique_slot_per_barber
  on public.bookings (barber_id, date, time);

create index if not exists bookings_barber_date_idx
  on public.bookings (barber_id, date);

create index if not exists bookings_barber_status_idx
  on public.bookings (barber_id, date, time);

create index if not exists services_catalog_barber_title_idx
  on public.services_catalog (barber_id, title);

create index if not exists barbers_active_sort_idx
  on public.barbers (active, sort_order, display_name);

-- Row Level Security
alter table public.services_catalog enable row level security;
alter table public.bookings enable row level security;

-- Public browsing: the client reads the selected barber's rows.
create policy "public read services catalog" on public.services_catalog
  for select
  using (true);

create policy "public read bookings" on public.bookings
  for select
  using (true);

create policy "public insert bookings" on public.bookings
  for insert
  with check (true);

-- Authenticated barber management: only rows owned by auth.uid().
create policy "barber read own services" on public.services_catalog
  for select
  to authenticated
  using (barber_id = auth.uid());

create policy "barber insert own services" on public.services_catalog
  for insert
  to authenticated
  with check (barber_id = auth.uid());

create policy "barber update own services" on public.services_catalog
  for update
  to authenticated
  using (barber_id = auth.uid())
  with check (barber_id = auth.uid());

create policy "barber delete own services" on public.services_catalog
  for delete
  to authenticated
  using (barber_id = auth.uid());

create policy "barber read own bookings" on public.bookings
  for select
  to authenticated
  using (barber_id = auth.uid());

create policy "barber insert own bookings" on public.bookings
  for insert
  to authenticated
  with check (barber_id = auth.uid());

create policy "barber update own bookings" on public.bookings
  for update
  to authenticated
  using (barber_id = auth.uid())
  with check (barber_id = auth.uid());

create policy "barber delete own bookings" on public.bookings
  for delete
  to authenticated
  using (barber_id = auth.uid());

create policy "read active barbers" on public.barbers
  for select
  using (active = true or auth.uid() = id);

create policy "manage own barber profile" on public.barbers
  for all
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Realtime: enable public.bookings, public.services_catalog and public.barbers.
