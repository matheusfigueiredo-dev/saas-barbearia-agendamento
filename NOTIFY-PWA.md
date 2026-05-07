# Notificador PWA (sem QR, 24/7, grátis)

Este módulo envia uma notificação push para o celular do barbeiro a cada novo agendamento (nome, data, horário), sem precisar manter terminal ligado nem escanear QR code. Ele usa:
- Netlify Functions (serverless, sempre online)
- Web Push API (VAPID)
- Supabase Webhooks (dispara no INSERT da tabela bookings)

Arquivos adicionados:
```
notify-pwa/              # Página separada para ativar as notificações
  index.html
  main.js
  sw.js
  manifest.webmanifest
netlify/functions/
  push-vapid-public.js   # expõe a VAPID public key
  push-register.js       # salva inscrições push no Supabase
  booking-notify-push.js # recebe webhook e envia push para inscritos
scripts/
  copy-notify-pwa.cjs    # copia notify-pwa para dist/notify no build
```

Durante o build, a pasta `notify-pwa` é copiada para `dist/notify`, ficando acessível em `https://seusite.netlify.app/notify/`.

---

## 1) Gerar chaves VAPID (uma vez)
Use qualquer gerador de VAPID (pode ser local usando `npx web-push generate-vapid-keys`). Se preferir, posso te enviar um comando quando você pedir.

Você terá:
- VAPID_PUBLIC_KEY
- VAPID_PRIVATE_KEY

## 2) Variáveis na Netlify
No painel do seu site → Site configuration → Environment variables:
- SUPABASE_URL = URL do projeto
- SUPABASE_SERVICE_KEY = service_role (somente nas functions; não exposta ao cliente)
- VAPID_PUBLIC_KEY = (da etapa 1)
- VAPID_PRIVATE_KEY = (da etapa 1)
- VAPID_SUBJECT = mailto:seuemail@dominio.com (ou URL do site)
- (Opcional) SHARED_WEBHOOK_SECRET = um segredo forte para validar o webhook

Faça um deploy após salvar as variáveis.

## 3) Criar tabela de inscrições no Supabase
Execute no SQL editor do Supabase:
```sql
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  subscription jsonb not null,
  enabled boolean not null default true,
  label text,
  created_at timestamp with time zone default now()
);
-- (Opcional) Política RLS básica
alter table public.push_subscriptions enable row level security;
create policy "allow insert via service" on public.push_subscriptions
  for insert to authenticated, anon using (true) with check (true);
```
Obs.: as Functions usam Service Key, então RLS não bloqueia. Se preferir, mantenha RLS desativado.

## 4) Habilitar o Webhook do Supabase
- Supabase Dashboard → Realtime → Webhooks → Add webhook
  - Event: INSERT
  - Schema: public
  - Table: bookings
  - URL: `https://SEU-SITE.netlify.app/api/booking-notify-push`
  - Headers (se tiver segredo): `x-webhook-secret: <SHARED_WEBHOOK_SECRET>`

## 5) Ativar no celular do barbeiro
- Acesse `https://SEU-SITE.netlify.app/notify/` no celular (Android/Chrome, iOS/Safari também funciona quando instalado como PWA).
- Toque em “Ativar notificações” e aceite a permissão.
- Pronto! Você pode fechar a página.

## 6) Teste
- Faça um agendamento normal no site (ou `INSERT` em `bookings`).
- O barbeiro recebe a notificação push com:
```
Novo agendamento:
Fulano da Silva
27/10/2025 às 14:30
```

## Observações
- iOS: para receber push na tela, instale a PWA (Compartilhar → Adicionar à Tela de Início) e aceite notificações.
- Segurança: o endpoint de envio está protegido com `SHARED_WEBHOOK_SECRET` (se definido). As chaves VAPID privadas ficam apenas nas Functions (servidor).
- Trocar telefone? Não precisa: o push é por navegador/dispositivo. Para outro aparelho, abra `/notify/` e ative.
- Revogar: apague linhas na tabela `push_subscriptions` ou ajuste `enabled=false`.
