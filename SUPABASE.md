# Supabase setup

Siga estes passos no painel do Supabase para substituir o Firebase:

1) Crie um novo projeto
- No site do Supabase, crie um projeto (org e banco Postgres).
- Anote as variáveis:
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY

2) Crie as tabelas e políticas (SQL)
- No menu SQL, execute o script abaixo para criar tabelas, índices e RLS.

```sql
-- Tabela de serviços
create table if not exists public.services_catalog (
  id bigserial primary key,
  title text not null,
  price numeric(10,2) not null default 0,
  minutes integer not null default 0,
  image text null,
  created_at timestamptz not null default now()
);

-- Tabela de agendamentos
create table if not exists public.bookings (
  id bigserial primary key,
  date date not null,
  time text not null check (time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  name text not null,
  phone text null,
  service text null,
  price numeric(10,2) null,
  duration_minutes integer null,
  created_at timestamptz not null default now(),
  constraint bookings_unique_slot unique (date, time)
);

-- Tabela de configurações/flags simples
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Habilitar RLS
alter table public.services_catalog enable row level security;
alter table public.bookings enable row level security;
alter table public.settings enable row level security;

-- Políticas básicas
-- Público (anon) pode: listar serviços, listar/assinar bookings do dia e criar um booking
create policy "public read services" on public.services_catalog
  for select
  using (true);

create policy "public read bookings" on public.bookings
  for select
  using (true);

create policy "public insert bookings" on public.bookings
  for insert
  with check (true);

-- Somente usuários logados (barbeiro) podem alterar/excluir serviços e bookings
create policy "auth manage services" on public.services_catalog
  for all
  to authenticated
  using (true)
  with check (true);

create policy "auth manage bookings" on public.bookings
  for delete
  to authenticated
  using (true);

-- settings: somente autenticado pode ler/escrever
create policy "auth manage settings" on public.settings
  for all
  to authenticated
  using (true)
  with check (true);

-- Realtime: habilite public.bookings e public.services_catalog em Replication → Realtime
```

3) Ative Realtime
- Em Realtime, habilite as tabelas `public.bookings` e `public.services_catalog`.

4) Autenticação (barbeiro)
- Em Authentication → Providers, mantenha Email habilitado.
- Crie um usuário pela aba Users (email/senha) para o barbeiro.

5) Variáveis no Netlify
- No site do Netlify → Site settings → Environment variables, adicione:
  - NEXT_PUBLIC_SUPABASE_URL = (URL do projeto)
  - NEXT_PUBLIC_SUPABASE_ANON_KEY = (anon key)
- Faça um novo deploy.

6) Migração de dados (opcional)
- Você pode recriar manualmente os serviços no Admin após login.
- Se precisar migrar bookings históricos do Firebase, podemos criar um script específico.
