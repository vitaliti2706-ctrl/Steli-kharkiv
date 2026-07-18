// /api/telegram-submit.js

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const name = String(body.name || body.clientName || '').trim();
    const phone = String(body.phone || body.clientPhone || '').trim();
    const comment = String(body.comment || body.message || '').trim();
    const contact = String(body.contact || body.messenger || 'Телефон').trim();
    const source = String(body.source || 'Potolok.in.ua').trim();
    const page = String(body.page || '').trim();
    const suppliedText = String(body.text || '').trim();
    const photos = Array.isArray(body.photos) ? body.photos.slice(0, 5) : [];

    if (!phone || phone.replace(/\D/g, '').length < 9) {
      return res.status(400).json({ ok: false, error: 'Missing or invalid phone' });
    }

    const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!TOKEN || !CHAT_ID) {
      return res.status(500).json({ ok: false, error: 'Missing TELEGRAM_* env vars' });
    }

    const now = new Date();
    const formattedDate = now.toLocaleDateString('uk-UA', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Kyiv',
    });
    const formattedTime = now.toLocaleTimeString('uk-UA', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Kyiv',
    });

    let telegramText;

    if (suppliedText) {
      telegramText = suppliedText + '\n\nДата: ' + formattedDate + '\nЧас: ' + formattedTime;
    } else {
      telegramText = [
        '📩 Нова заявка Potolok.in.ua',
        '',
        'Джерело: ' + source,
        'Імʼя: ' + (name || 'не вказано'),
        'Телефон: ' + phone,
        'Звʼязатися через: ' + contact,
        comment ? 'Коментар: ' + comment : 'Коментар: без коментаря',
        'Фото / план: ' + (photos.length ? photos.length + ' шт.' : 'не додано'),
        page ? 'Сторінка: ' + page : null,
        '',
        'Дата: ' + formattedDate,
        'Час: ' + formattedTime,
      ].filter(Boolean).join('\n');
    }

    const tgResp = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: telegramText.slice(0, 4096),
        disable_web_page_preview: true,
      }),
    });

    const tgJson = await tgResp.json().catch(() => null);

    if (!tgResp.ok || !tgJson?.ok) {
      return res.status(500).json({ ok: false, error: 'Telegram message send failed', detail: tgJson });
    }

    let photosSent = 0;

    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index] || {};
      const parsed = parseImageDataUrl(String(photo.dataUrl || ''));
      if (!parsed || parsed.buffer.length > 9 * 1024 * 1024) continue;

      const form = new FormData();
      form.append('chat_id', CHAT_ID);
      form.append('caption', ('📎 ' + String(photo.caption || ('Фото / план ' + (index + 1))).trim() + '\n☎ ' + phone).slice(0, 1024));
      form.append('photo', new Blob([parsed.buffer], { type: parsed.mime }), safeFileName(photo.name, index, parsed.extension));

      const photoResp = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, {
        method: 'POST',
        body: form,
      });

      const photoJson = await photoResp.json().catch(() => null);
      if (photoResp.ok && photoJson?.ok) photosSent += 1;
    }

    return res.status(200).json({
      ok: true,
      message: 'Application sent',
      photosSent,
      photosRequested: photos.length,
    });

  } catch (error) {
    console.error('telegram-submit error:', error);
    return res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
}

function parseImageDataUrl(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;

  const mime = match[1];
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';

  return {
    mime,
    extension,
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function safeFileName(originalName, index, extension) {
  const clean = String(originalName || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.[^.]+$/, '')
    .slice(0, 60);

  return (clean || ('photo_' + (index + 1))) + '.' + extension;
}

