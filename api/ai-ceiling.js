export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

const limits = globalThis.__potolokAiLimits || {
  phone: new Map(),
  ip: new Map(),
  noPhone: new Map(),
  cooldown: new Map(),
};

globalThis.__potolokAiLimits = limits;

const PHONE_LIMIT = 5;
const IP_LIMIT = 10;
const NO_PHONE_LIMIT = 1;
const COOLDOWN_MS = 30 * 1000;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    "unknown"
  );
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function getCount(map, key) {
  return map.get(key) || 0;
}

function inc(map, key) {
  map.set(key, getCount(map, key) + 1);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const {
      imageBase64,
      phone,
      color,
      material,
      keepLight,
      shadowProfile,
      ledLine,
    } = req.body || {};

    const ip = getClientIp(req);
    const day = todayKey();
    const cleanPhone = normalizePhone(phone);

    const ipKey = `${ip}:${day}`;
    const noPhoneKey = `${ip}:${day}:no-phone`;
    const phoneKey = `${cleanPhone}:${day}`;
    const cooldownKey = cleanPhone || ip;

    const now = Date.now();
    const lastTime = limits.cooldown.get(cooldownKey) || 0;

    if (now - lastTime < COOLDOWN_MS) {
      return res.status(429).json({
        error: "Зачекайте 30 секунд перед наступною генерацією.",
      });
    }

    if (getCount(limits.ip, ipKey) >= IP_LIMIT) {
      return res.status(429).json({
        error: "Ліміт AI-візуалізацій з цього пристрою на сьогодні вичерпано. Напишіть нам у Telegram.",
      });
    }

    if (!cleanPhone) {
      if (getCount(limits.noPhone, noPhoneKey) >= NO_PHONE_LIMIT) {
        return res.status(429).json({
          error: "Для додаткових AI-візуалізацій введіть номер телефону.",
        });
      }
    } else {
      if (getCount(limits.phone, phoneKey) >= PHONE_LIMIT) {
        return res.status(429).json({
          error: "Ви використали безкоштовний ліміт AI-візуалізацій. Напишіть нам у Telegram для консультації.",
        });
      }
    }

    if (!imageBase64) {
      return res.status(400).json({ error: "Фото не отримано" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY не додано у Vercel" });
    }

    const match = imageBase64.match(/^data:(image\/\w+);base64,(.+)$/);

    if (!match) {
      return res.status(400).json({ error: "Невірний формат фото" });
    }

    limits.cooldown.set(cooldownKey, now);
    inc(limits.ip, ipKey);

    if (cleanPhone) {
      inc(limits.phone, phoneKey);
    } else {
      inc(limits.noPhone, noPhoneKey);
    }

    const mimeType = match[1];
    const base64Data = match[2];
    const imageBuffer = Buffer.from(base64Data, "base64");

    let extras = "";

    if (keepLight) {
      extras += "Keep existing chandelier, lamps and lighting fixtures unchanged. ";
    }

    if (shadowProfile) {
      extras += "Add a clean black shadow profile around the ceiling perimeter. ";
    }

    if (ledLine) {
      extras += "Add soft warm LED ambient lighting around the ceiling perimeter. ";
    }

    const prompt = `
Edit this real room photo.
Replace ONLY the ceiling with a ${color} ${material} stretch ceiling.
Keep walls, floor, doors, windows, furniture and room geometry exactly the same.
Do not redesign the room.
Do not change perspective.
Do not change wall color.
Do not change floor color.
Do not remove or add furniture.
Make the result photorealistic, clean and natural.
${extras}
`;

    const formData = new FormData();

    formData.append(
      "image",
      new Blob([imageBuffer], { type: mimeType }),
      mimeType === "image/png" ? "room.png" : "room.jpg"
    );

    formData.append("model", "gpt-image-1");
    formData.append("prompt", prompt);
    formData.append("size", "1024x1024");
    formData.append("n", "1");

    const openaiRes = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: formData,
    });

    const data = await openaiRes.json();

    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json({
        error: data?.error?.message || "OpenAI error",
        details: data,
      });
    }

    const generatedBase64 = data?.data?.[0]?.b64_json;

    if (!generatedBase64) {
      return res.status(500).json({
        error: "AI не повернув зображення",
        details: data,
      });
    }

    return res.status(200).json({
      ok: true,
      image: `data:image/png;base64,${generatedBase64}`,
      remaining: cleanPhone
        ? Math.max(0, PHONE_LIMIT - getCount(limits.phone, phoneKey))
        : 0,
    });

  } catch (error) {
    return res.status(500).json({
      error: "Помилка сервера",
      details: error.message,
    });
  }
}
