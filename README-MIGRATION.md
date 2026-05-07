# Migração para Supabase e Vite (Web)

- A aplicação de agendamento agora usa Vite + React (pasta `src/`) com Supabase.
- As páginas em `app/` do Next.js foram mantidas apenas como placeholders para evitar rotas quebradas.
- O código e integrações com Firebase/Firestore foram removidos da UI usada (Vite). Utilize `src/App.tsx` e `src/routes/Admin.tsx`.

## Onde editar
- Página inicial (cliente): `src/App.tsx`
- Painel admin: `src/routes/Admin.tsx`
- Supabase client: `src/lib/supabase.ts`
- Regras de slots/horários: `src/lib/slots.ts`

## Execução
- `npm run dev`

Se ainda houver diretórios `.next/` antigos, pode apagá-los com segurança.
