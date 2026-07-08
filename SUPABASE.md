# Supabase setup

Siga estes passos no painel do Supabase para substituir o Firebase:

1) Crie um novo projeto
- No site do Supabase, crie um projeto (org e banco Postgres).
- Anote as variáveis:
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY

2) Crie as tabelas e políticas (SQL)
- No menu SQL, execute [scripts/supabase-multi-tenant.sql](scripts/supabase-multi-tenant.sql).
- Antes de rodar, substitua os placeholders `<LUCAS_AUTH_UID>` e `<VICTOR_AUTH_UID>` pelos UUIDs reais do Supabase Auth.
- O app do cliente também pode ler `VITE_LUCAS_BARBER_ID` e `VITE_VICTOR_BARBER_ID` como fallback, caso você prefira configurar por ambiente.
- O script já clona automaticamente o catálogo de serviços do Lucas para o Victor, mantendo cada barbeiro com seu próprio conjunto editável no painel.

3) Ative Realtime
- Em Realtime, habilite as tabelas `public.bookings` e `public.services_catalog`.

4) Autenticação (barbeiro)
- Em Authentication → Providers, mantenha Email habilitado.
- Garanta que os dois usuários existentes no Auth estejam vinculados às linhas da tabela `barbers`.

5) Variáveis no Netlify
- No site do Netlify → Site settings → Environment variables, adicione:
  - NEXT_PUBLIC_SUPABASE_URL = (URL do projeto)
  - NEXT_PUBLIC_SUPABASE_ANON_KEY = (anon key)
  - VITE_LUCAS_BARBER_ID = (UUID auth do Lucas)
  - VITE_VICTOR_BARBER_ID = (UUID auth do Victor)
  - VITE_LUCAS_BARBER_PHOTO = (opcional)
  - VITE_VICTOR_BARBER_PHOTO = (opcional)
- Faça um novo deploy.

6) Migração de dados (opcional)
- Você pode recriar manualmente os serviços no Admin após login.
- Se precisar migrar bookings históricos do Firebase, podemos criar um script específico.
