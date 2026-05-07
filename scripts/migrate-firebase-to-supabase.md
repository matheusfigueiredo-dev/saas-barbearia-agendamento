# Migração opcional de dados (Firebase → Supabase)

Como o site agora usa Supabase, você pode:

Opção simples (recomendada):
- Recriar manualmente os serviços no `/admin` (leva poucos minutos).
- Os agendamentos futuros serão criados diretamente no Supabase.

Opção avançada (histórico):
1. Exporte os dados do Firestore (coleções `services_catalog` e `bookings`) para JSON.
2. Use a interface SQL do Supabase para importar com `insert` em lote ou via CSV.

Mapeamento de campos:
- services_catalog: { title, price, minutes, image }
- bookings: { date, time, name, phone, service, price, duration_minutes }

Observação:
- A unicidade de (date, time) é garantida no banco via constraint, evitando double-book.