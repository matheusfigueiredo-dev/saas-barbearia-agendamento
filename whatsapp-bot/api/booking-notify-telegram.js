// /api/booking-notify-telegram.js (VERSÃO DEBUG v3 - Comprimento)

// Funções auxiliares (iguais)
function findField(data, keys) {
  for (const key of keys) {
    if (data[key]) return data[key];
  }
  return null;
}
function formatDate(dateString) {
  try {
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
  } catch (e) {
    return dateString;
  }
}

// A função principal
export default async (req, context) => {
  const { 
    TELEGRAM_BOT_TOKEN, 
    TELEGRAM_CHAT_ID, 
    SHARED_WEBHOOK_SECRET 
  } = process.env;

  // 1. Validar Segredo
  const secret = req.headers["x-webhook-secret"];

  // --- NOVO DEBUG ---
  // Vamos verificar o que a Netlify está lendo
  // ISSO É SEGURO, não vai vazar o segredo, só o tamanho.
  console.log("--- INICIANDO DEBUG DO SEGREDO ---");
  if (SHARED_WEBHOOK_SECRET) {
      console.log("Segredo ARMAZENADO (Tamanho):", SHARED_WEBHOOK_SECRET.length);
  } else {
      console.log("ERRO GRAVE: Variável 'SHARED_WEBHOOK_SECRET' NÃO FOI ENCONTRADA no Netlify.");
  }

  if (secret) {
      console.log("Segredo RECEBIDO (Tamanho):", secret.length);
  } else {
      console.log("ERRO GRAVE: Header 'x-webhook-secret' NÃO FOI RECEBIDO do Supabase.");
  }
  console.log("--- FIM DO DEBUG DO SEGREDO ---");
  // --- FIM DO NOVO DEBUG ---


  if (secret !== SHARED_WEBHOOK_SECRET) {
    console.error("Falha na validação do segredo! (O 'if' falhou)"); 
    return new Response("Acesso não autorizado", { status: 401 });
  }

  // Se passar daqui, o segredo estava CORRETO
  console.log("Validação do segredo OK!");

  let booking;
  try {
    // 2. Pegar os dados
    const payload = await req.json();
    booking = payload.record; 

    // 3. "Detecção Inteligente" de Campos
    const nome = findField(booking, ['name', 'nome', 'customer_name', 'client_name']);
    const data = findField(booking, ['date', 'book_date', 'booking_date']);
    const hora = findField(booking, ['time', 'book_time', 'booking_time']);

    if (!nome || !data || !hora) {
      console.error("Campos obrigatórios não encontrados", booking);
      return new Response("Campos incompletos", { status: 400 });
    }

    // 4. Formatar a Mensagem
    const dataFormatada = formatDate(data);
    const horaFormatada = hora.substring(0, 5);
    const mensagem = `🔔 *Novo Agendamento:*\n\n*Cliente:* ${nome}\n*Data:* ${dataFormatada}\n*Hora:* ${horaFormatada}`;

    // 5. Enviar para o Telegram e OUVIR a resposta
    console.log("Tentando enviar mensagem para o Telegram...");
    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: mensagem,
        parse_mode: 'Markdown',
      }),
    });

    // 6. Analisar a resposta do Telegram
    if (!response.ok) {
      const errorData = await response.json();
      console.error("ERRO DO TELEGRAM:", errorData);
      return new Response(`Erro do Telegram: ${errorData.description}`, { status: 502 });
    }

    // 7. Sucesso!
    console.log("Mensagem enviada com sucesso para o Telegram.");
    return new Response("Mensagem enviada!", { status: 200 });

  } catch (error) {
    console.error("Erro geral na função:", error.message, booking);
    return new Response(`Erro interno: ${error.message}`, { status: 500 });
  }
};