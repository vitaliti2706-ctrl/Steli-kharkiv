// /api/telegram-submit.js

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method Not Allowed',
    });
  }

  try {
    let body = req.body || {};

    // На случай, если тело запроса пришло строкой
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    const name = String(
      body.name ||
      body.clientName ||
      ''
    ).trim();

    const phone = String(
      body.phone ||
      body.clientPhone ||
      ''
    ).trim();

    const comment = String(
      body.comment ||
      body.message ||
      ''
    ).trim();

    const contact = String(
      body.contact ||
      body.messenger ||
      'Телефон'
    ).trim();

    const source = String(
      body.source ||
      'Potolok.in.ua'
    ).trim();

    const page = String(
      body.page ||
      ''
    ).trim();

    const suppliedText = String(
      body.text ||
      ''
    ).trim();

    // Имя необязательно, телефон обязателен
    if (!phone || phone.replace(/\D/g, '').length < 9) {
      return res.status(400).json({
        ok: false,
        error: 'Missing or invalid phone',
      });
    }

    const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!TOKEN || !CHAT_ID) {
      return res.status(500).json({
        ok: false,
        error: 'Missing TELEGRAM_* env vars',
      });
    }

    const now = new Date();

    const formattedDate = now.toLocaleDateString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Europe/Kyiv',
    });

    const formattedTime = now.toLocaleTimeString('uk-UA', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Europe/Kyiv',
    });

    let telegramText;

    // Если страница уже сформировала полный текст — используем его
    if (suppliedText) {
      telegramText =
        suppliedText +
        '\n\n' +
        'Дата: ' + formattedDate + '\n' +
        'Час: ' + formattedTime;
    } else {
      const lines = [
        '📩 Нова заявка Potolok.in.ua',
        '',
        'Джерело: ' + source,
        'Імʼя: ' + (name || 'не вказано'),
        'Телефон: ' + phone,
        'Звʼязатися через: ' + contact,
        comment ? 'Коментар: ' + comment : 'Коментар: без коментаря',
        page ? 'Сторінка: ' + page : null,
        '',
        'Дата: ' + formattedDate,
        'Час: ' + formattedTime,
      ].filter(Boolean);

      telegramText = lines.join('\n');
    }

    const tgResp = await fetch(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: telegramText,
          disable_web_page_preview: true,
        }),
      }
    );

    const telegramResult = await tgResp
      .json()
      .catch(() => null);

    if (!tgResp.ok || !telegramResult?.ok) {
      return res.status(500).json({
        ok: false,
        error: 'Telegram send failed',
        detail: telegramResult,
      });
    }

    return res.status(200).json({
      ok: true,
      message: 'Application sent',
    });

  } catch (error) {
    console.error('telegram-submit error:', error);

    return res.status(500).json({
      ok: false,
      error: error?.message || String(error),
    });
  }
}
