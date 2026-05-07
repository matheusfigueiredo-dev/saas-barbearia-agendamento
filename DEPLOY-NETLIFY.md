# Deploy do site (web/) no Netlify

Requisitos: conta no Netlify e repositório Git com este projeto.

## Opção 1 — Pelo painel do Netlify (GUI)
1. No Netlify, clique em "Add new site" > "Import an existing project".
2. Conecte ao repositório (GitHub/GitLab/Bitbucket) e selecione o repo do monorepo.
3. Em "Base directory", informe `web` (isso garante que o build rode dentro da pasta web/).
4. Em "Build command", deixe `npm run build`.
5. Em "Publish directory", deixe `.next`.
6. Salve e faça o primeiro deploy.

Se quiser SSR/ISR mais consistente com Next.js 13+, ative o plugin:
- Em "Site settings > Plugins": adicione `@netlify/plugin-nextjs`.

Variáveis de ambiente (Supabase):
- Em "Site settings > Build & deploy > Environment > Environment variables" adicionar:
	- `NEXT_PUBLIC_SUPABASE_URL`
	- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
	Use o prefixo `NEXT_PUBLIC_` para variáveis usadas no cliente.

## Opção 2 — Via Netlify CLI
1. Instale a CLI global: `npm i -g netlify-cli`.
2. Na raiz do monorepo: `netlify init` e confirme a pasta base `web`.
3. Faça o deploy: `netlify deploy --prod --filter web`.

## Verificação mobile
- O Netlify entrega HTTPS e otimizações para acesso por celular.
- Teste abrindo a URL em um navegador mobile e valide se: datas/horários carregam, bloqueio de double-book funciona, e o modal de confirmação aparece.
 - No painel do Supabase, ative Realtime para as tabelas `public.bookings` e `public.services_catalog` para que atualizações apareçam ao vivo.