# WhatsApp Bot (Baileys + Supabase)

Um chatbot gratuito que conecta o WhatsApp do barbeiro via QR Code (modo WhatsApp Web) e automatiza agendamentos integrados ao Supabase.

> Observação importante: como é baseado em WhatsApp Web, o processo precisa ficar em execução 24/7. Para ser realmente 100% gratuito, rode em uma máquina sua (PC/servidor) ou em um VPS Always Free (ex.: Oracle Cloud Free Tier). Serviços gratuitos serverless (Workers/Functions) não mantêm conexão persistente com o WhatsApp e não servem para isso.

## Recursos
- Conexão via QR Code (sem custos) usando Baileys
- Fluxo "agendar" guiado: nome → data → serviços → horários disponíveis → confirmação
- Integração ao banco: insere o agendamento na tabela `bookings` (com colunas detectadas automaticamente)
- Lista serviços direto de `services_catalog`
- Respeita horários de funcionamento e bloqueios (intervalos ocupados) do dia
 - Notificador simples: envia um WhatsApp automático ao barbeiro a cada novo agendamento no Supabase

## Estrutura
```
whatsapp-bot/
  src/
    index.js          # bot principal (Baileys)
    supabase.js       # client do Supabase
    bookingsSchema.js # detecção dinâmica de colunas em bookings
    slots.js          # geração de grade e checagem de intervalos ocupados
  .env.example        # variáveis de ambiente
  package.json
  README.md
```

## Pré-requisitos
- Node.js 18+
- Uma conta Supabase (URL + Service Key)
- A tabela `bookings` e `services_catalog` como já usadas no site

## Configuração
1. Copie `.env.example` para `.env` e preencha:
```
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
TZ=America/Sao_Paulo
BARBER_PHONE=55DDDNUMERO
```
2. Instale dependências:
```
npm install
```
3. Rode (primeira vez pede QR):
```
npm start
```
Escaneie o QR no console com o WhatsApp do barbeiro (Dispositivos conectados).

### Notificador de novos agendamentos (simples)
Este modo não abre conversa com clientes. Ele apenas escuta novos registros na tabela `bookings` e envia um aviso para o número do barbeiro com: nome do cliente, data e horário.

1) Configure o `.env` com o número do barbeiro:
  - `BARBER_PHONE=55DDDNUMERO` (ex.: `5585999999999`)
2) Rode o notificador:
```
npm run notify
```
Na primeira vez, será exibido um QR Code — escaneie com a conta do barbeiro.

3) Faça um teste: crie um agendamento no site ou insira na tabela `bookings`. Você deve receber no WhatsApp uma mensagem como:
```
Novo agendamento:
Fulano da Silva
27/10/2025 às 14:30
```

Notas:
- O notificador detecta automaticamente as colunas de data/hora da tabela (`bookingsSchema`). Para o nome, tenta os campos: `name`, `nome`, `customer_name`, `client_name`, `full_name`.
- Caso sua tabela tenha outro nome, ajuste no `.env`: `NOTIFIER_TABLE` e/ou `NOTIFIER_SCHEMA`.

Teste opcional via script (insere um registro fictício usando sua key do Supabase):
```
npm run test:insert
```

### Solução de problemas (env)
- Erro: `Missing SUPABASE_URL or SUPABASE_SERVICE_KEY` ou `supabaseUrl is required`
  - Crie o arquivo `.env` na pasta `whatsapp-bot` com as chaves corretas.
  - Em Supabase Dashboard: Settings → API
    - SUPABASE_URL = Project URL
    - SUPABASE_SERVICE_KEY = service_role key (NÃO compartilhe publicamente)
  - Alternativamente, você pode usar a anon key se as RLS permitirem escrita para `bookings`:
    - SUPABASE_ANON_KEY=... (o bot tenta usar service primeiro e faz fallback para anon)

      - Se aparecer "fetch failed" ao listar serviços:
        - Confirme que o log inicial mostra seu host correto: `Supabase host: <seu>.supabase.co`.
        - Verifique rede/antivírus/proxy. Alguns ambientes interceptam TLS e o Node não confia no certificado.
        - Diagnóstico rápido: defina `WHATSAPP_BOT_INSECURE_TLS=1` no `.env` e reinicie. Se funcionar, é questão de certificado.
          - Solução correta: instale o certificado raiz da sua rede/antivírus no Windows e configure `NODE_EXTRA_CA_CERTS` apontando para o `.pem`.

No Windows PowerShell (exemplo de criação rápida do .env):
```
Copy-Item .env.example .env
notepad .env
```

## Rodando 24/7 (gratuito)
- Máquina própria (Windows): deixe um terminal aberto OU use [PM2](https://pm2.keymetrics.io/) como serviço:
```
npm i -g pm2
pm2 start npm --name whatsapp-bot -- start
pm2 save
pm2 startup windows
```
- VPS Always Free (recomendado): crie uma instância gratuita (ex.: Oracle Cloud Free Tier, Ampere) e use os mesmos passos com PM2.

> Dica: Baileys guarda a sessão em `./auth`. Faça backup dessa pasta para recuperar a sessão se mover o bot para outro servidor.

## Como usar
- Envie “agendar” para o número do barbeiro:
  1) O bot pergunta nome
  2) Pergunta data ("hoje", "amanhã" ou dd/mm)
  3) Mostra serviços (1,2,3...)
  4) Lista horários disponíveis do dia (respeitando bloqueios)
  5) Confirma e grava no Supabase

Comandos:
- `ajuda`/`menu`: mostra ajuda
- `cancelar`: cancela o fluxo atual

## Observações e limites
- Como é via WhatsApp Web, o número precisa permanecer ativo; evite abrir o WhatsApp Web em muitos lugares ao mesmo tempo.
- Este bot insere diretamente o agendamento se o horário estiver livre. Se preferir marcar como solicitação, adapte `tryCreateBooking` para prefixar `AGENDAR:` no campo `service` ou usar `status='agendar'` quando essa coluna existir.
- Políticas RLS: para inserir, use o Service Key OU garanta permissões de escrita para o anon key específico do bot.

## Próximos passos (opcional)
- Persistir estado de conversa em tabela `bot_sessions` (resiliente a reinícios)
- Mensagens de lembrete/confirmacão automáticas
- Ajustar cálculo de disponibilidade por duração real dos serviços escolhidos
