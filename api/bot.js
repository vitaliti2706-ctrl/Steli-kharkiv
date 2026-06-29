// /api/bot.js — працює на Vercel без Telegraf

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, message: 'Bot webhook is live' });
  }

  try {
    const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const update = req.body || {};

    const msg = update.message;
    const chatId = msg?.chat?.id;
    const text = msg?.text;

    // Команда /start
    if (text === '/start') {
      await fetch(https://api.telegram.org/bot${TOKEN}/sendMessage, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text:
            'Натяжні стелі у Харкові — якісно, швидко та доступно 💪\n\n' +
            '✅ Вартість від 400 грн/м²\n' +
            '🎁 Знижка -10% до кінця тижня\n' +
            '🔧 Профмонтаж, гарантія, безкоштовний виїзд\n\n' +
            'Оберіть дію нижче 👇',
          reply_markup: {
            inline_keyboard: [
              [{ text: '💰 Калькулятор', url: 'https://potolok-kharkov.net.ua/calculator.html' }],
              [{ text: '📸 Галерея', url: 'https://potolok-kharkov.net.ua/galereya.html' }],
              [{ text: '📋 Замовити замір', url: 'https://potolok-kharkov.net.ua/contacts.html' }],
              [{ text: 'ℹ️ Сайт', url: 'https://potolok-kharkov.net.ua/' }]
            ]
          }
        })
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(200).json({ ok: true });
  }
}
