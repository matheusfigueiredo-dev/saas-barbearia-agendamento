-- ============================================================================
-- Corrige o bloqueio indevido de horários entre profissionais diferentes.
--
-- Problema: a constraint antiga `bookings_unique_slot` era UNIQUE (date, time),
-- ou seja, um agendamento do Victor às 14:00 impedia o Lucas de agendar 14:00
-- no mesmo dia (erro 23505 / "Esse horário acabou de ser reservado").
--
-- Solução: a unicidade passa a ser por profissional:
--   UNIQUE (date, time, barber_id)
--
-- Como aplicar: Supabase Dashboard -> SQL Editor -> cole este arquivo -> Run.
-- O script é idempotente e pode ser executado mais de uma vez.
-- ============================================================================

begin;

-- 1) Remove constraints UNIQUE antigas que cobrem exatamente (date, time).
do $$
declare
  con record;
  cols text[];
begin
  for con in
    select c.oid, c.conname, c.conrelid, c.conkey
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'bookings'
      and c.contype = 'u'
  loop
    select array_agg(a.attname order by a.attname)
      into cols
      from pg_attribute a
      where a.attrelid = con.conrelid
        and a.attnum = any (con.conkey);

    if cols = array['date', 'time'] then
      execute format('alter table public.bookings drop constraint %I', con.conname);
      raise notice 'Constraint antiga removida: %', con.conname;
    end if;
  end loop;
end $$;

-- 2) Remove índices UNIQUE avulsos que também cobrem exatamente (date, time).
do $$
declare
  idx record;
  cols text[];
begin
  for idx in
    select i.indexrelid, i.indrelid, i.indkey, ic.relname as indexname
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_class ic on ic.oid = i.indexrelid
    where n.nspname = 'public'
      and t.relname = 'bookings'
      and i.indisunique
      and not exists (
        select 1 from pg_constraint c where c.conindid = i.indexrelid
      )
  loop
    select array_agg(a.attname order by a.attname)
      into cols
      from pg_attribute a
      where a.attrelid = idx.indrelid
        and a.attnum = any (idx.indkey);

    if cols = array['date', 'time'] then
      execute format('drop index if exists public.%I', idx.indexname);
      raise notice 'Índice antigo removido: %', idx.indexname;
    end if;
  end loop;
end $$;

-- 3) Garante que não existam duplicatas por profissional antes de criar a constraint.
do $$
declare
  dup_count integer;
begin
  select count(*) into dup_count
  from (
    select 1
    from public.bookings
    where barber_id is not null
    group by date, time, barber_id
    having count(*) > 1
  ) d;

  if dup_count > 0 then
    raise exception
      'Existem % combinações duplicadas de (date, time, barber_id). Resolva-as antes de aplicar esta migração.',
      dup_count;
  end if;
end $$;

-- 4) Cria a unicidade correta por profissional (idempotente).
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'bookings'
      and c.conname = 'bookings_unique_slot_barber'
  ) then
    alter table public.bookings
      add constraint bookings_unique_slot_barber unique (date, time, barber_id);
    raise notice 'Constraint criada: bookings_unique_slot_barber (date, time, barber_id)';
  else
    raise notice 'Constraint bookings_unique_slot_barber já existe.';
  end if;
end $$;

commit;

-- Verificação (deve mostrar a constraint com barber_id):
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.bookings'::regclass and contype = 'u';
