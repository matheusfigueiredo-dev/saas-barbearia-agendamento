# Notificador 24/7 sem QR Code (Telegram + Netlify + Supabase)

Objetivo: enviar notificação automática para o celular do barbeiro sempre que um novo agendamento for criado, SEM precisar rodar terminal nem escanear QR Code.

Como funciona:
- O site já está hospedado na Netlify. Adicionamos uma Function HTTP (`/api/booking-notify-telegram`).
- O banco (Supabase) envia um webhook para essa Function quando um `INSERT` ocorre na tabela `bookings`.
- A Function chama a API do Telegram e entrega a mensagem para o barbeiro.

Custo: Telegram e Netlify têm plano gratuito suficiente para esse uso. Supabase Webhooks/Realtime também.

---

## Passo a passo

1) Criar um bot no Telegram (1 minuto)
- No Telegram, converse com @BotFather
  - Comando: `/start`
  - Depois: `/newbot`
  - Dê um nome e um @username único.
  - Ao final, o BotFather mostrará o `TOKEN` do bot (anote!).
- Abra o chat com o seu bot recém-criado e envie qualquer mensagem (ex.: "oi"). Isso libera o bot para enviar mensagens para você.
- Obter seu `chat_id`:
  - No navegador, abra: `https://api.telegram.org/bot<TOKEN>/getUpdates`
  - Procure por `"chat":{"id":NUMERO,...}` — esse `NUMERO` é o seu `chat_id`.

2) Configurar variáveis na Netlify
- Netlify Dashboard → Site do projeto → Site configuration → Environment variables
  - `TELEGRAM_BOT_TOKEN` = o token dado pelo BotFather
  - `TELEGRAM_CHAT_ID` = o número encontrado no getUpdates
  - (Opcional, recomendado) `SHARED_WEBHOOK_SECRET` = um segredo forte, ex.: `x7P9...`
- Salve e redeploy o site (ou clique em "Deploy site").

3) Endpoint do notificador
- A Function criada expõe a rota:
  - `https://SEU-SITE.netlify.app/api/booking-notify-telegram`
- Ela aceita POST com o payload padrão de webhooks do Supabase. Se `SHARED_WEBHOOK_SECRET` estiver definido, envie o header `x-webhook-secret` com esse valor.

4) Habilitar Webhook no Supabase
- A) Realtime Webhooks (UI simples)
  - Supabase Dashboard → Realtime → Webhooks → Add webhook
  - Event: `INSERT`
  - Schema: `public`
  - Table: `bookings`
  - URL: `https://SEU-SITE.netlify.app/api/booking-notify-telegram`
  - Headers (se usar segredo): `x-webhook-secret: <valor-do-segredo>`
  - Salve.
- B) Database Webhooks (se preferir) — similar, apontando para a mesma URL.

5) Teste rápido
- Faça um agendamento pelo site (ou insira um registro em `bookings`).
- Você deverá receber no Telegram a mensagem:
```
Novo agendamento:
Fulano da Silva
27/10/2025 às 14:30
```

---

## Payloads suportados
A Function tenta extrair o registro novo nas chaves: `record`, `new`, `data.new` ou `event.record`.
- Nome do cliente: tenta as colunas `name`, `nome`, `customer_name`, `client_name`, `full_name`.
- Data: tenta `date`, `book_date`, `booking_date` (formata para DD/MM/YYYY quando vier YYYY-MM-DD).
- Hora: tenta `time`, `book_time`, `booking_time` (normaliza para HH:mm).

## Segurança
- Configure `SHARED_WEBHOOK_SECRET` na Netlify e envie `x-webhook-secret` no webhook do Supabase para evitar chamadas indevidas.

## Dicas
- Se quiser notificar mais de uma pessoa, crie um grupo no Telegram, adicione o bot e use o `chat_id` do grupo (ele começa com `-100...`).
- Para alterar o texto, edite `netlify/functions/booking-notify-telegram.js`.
