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

function markupName(type) {
  const names = {
    spot: "recessed spot light",
    chandelier: "chandelier",
    track: "black recessed magnetic track",
    surfaceTrack: "surface-mounted track",
    lightline: "linear LED light line",
    cornice: "hidden curtain cornice",
    floating: "floating ceiling profile with LED glow",
    shadow: "black shadow-gap ceiling profile",
  };
  return names[type] || type || "ceiling element";
}

function buildMarkupText(markup) {
  if (!Array.isArray(markup) || !markup.length) return "";

  return markup
    .map((item, index) => {
      const start =
        Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.y))
          ? `start at normalized position (${Number(item.x).toFixed(3)}, ${Number(item.y).toFixed(3)})`
          : "";

      const end =
        Number.isFinite(Number(item.x2)) && Number.isFinite(Number(item.y2))
          ? `end at normalized position (${Number(item.x2).toFixed(3)}, ${Number(item.y2).toFixed(3)})`
          : "";

      return `${index + 1}. ${markupName(item.type)}${start ? `, ${start}` : ""}${end ? `, ${end}` : ""}`;
    })
    .join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const {
      imageBase64,
      annotatedImageBase64,
      originalImageBase64,
      phone,
      manufacturer,
      color,
      colorHex,
      material,
      options = [],
      customRequest = "",
      instruction = "",
      markup = [],

      // Старые параметры оставлены для совместимости
      keepLight,
      shadowProfile,
      ledLine,
    } = req.body || {};

    // При наличии разметки используем именно размеченное фото.
    const sourceImage =
      annotatedImageBase64 ||
      imageBase64 ||
      originalImageBase64;

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
        error:
          "Ліміт AI-візуалізацій з цього пристрою на сьогодні вичерпано. Напишіть нам у Telegram.",
      });
    }

    if (!cleanPhone) {
      if (getCount(limits.noPhone, noPhoneKey) >= NO_PHONE_LIMIT) {
        return res.status(429).json({
          error: "Для додаткових AI-візуалізацій введіть номер телефону.",
        });
      }
    } else if (getCount(limits.phone, phoneKey) >= PHONE_LIMIT) {
      return res.status(429).json({
        error:
          "Ви використали безкоштовний ліміт AI-візуалізацій. Напишіть нам у Telegram для консультації.",
      });
    }

    if (!sourceImage) {
      return res.status(400).json({ error: "Фото не отримано" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res
        .status(500)
        .json({ error: "OPENAI_API_KEY не додано у Vercel" });
    }

    const match = sourceImage.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);

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

    const selectedOptions = Array.isArray(options)
      ? options.filter(Boolean).join(", ")
      : String(options || "");

    const markupText = buildMarkupText(markup);

    let legacyExtras = "";
    if (keepLight) {
      legacyExtras +=
        "Keep the existing chandelier, lamps and lighting fixtures unchanged.\n";
    }
    if (shadowProfile) {
      legacyExtras +=
        "Add a clean black shadow profile around the ceiling perimeter.\n";
    }
    if (ledLine) {
      legacyExtras +=
        "Add soft warm LED ambient lighting around the ceiling perimeter.\n";
    }

    const prompt = `
Edit this real room photo as a professional stretch-ceiling visualization.

CEILING MATERIAL:
- Manufacturer: ${manufacturer || "not specified"}
- Color: ${color || "white"}
- Color reference: ${colorHex || "not specified"}
- Texture: ${material || "matte"}

STRICT ROOM PRESERVATION:
- Keep the walls, floor, doors, windows, furniture and room geometry unchanged.
- Keep the original camera viewpoint and perspective.
- Do not redesign the room.
- Modify only the ceiling and requested ceiling elements.

MARKUP RULES:
- The input image may contain dark or colored guide lines, numbered labels and round handles.
- These markings are instructions, not final decoration.
- Convert every marked line into the requested real ceiling element at the same position, angle, length and perspective.
- Remove all guide lines, numbers, labels, circles and handles from the final image.
- Do not ignore the markup.

MARKED ELEMENTS:
${markupText || "No drawn markup was provided."}

SELECTED OPTIONS:
${selectedOptions || "No additional checkbox options selected."}

CUSTOM REQUEST:
${customRequest || "No additional request."}

ADDITIONAL INSTRUCTION:
${instruction || "Create a photorealistic result."}

${legacyExtras}

IMPORTANT:
If the photo contains a trapezoid, square, L-shape, U-shape or parallel lines drawn on the ceiling, reproduce that exact arrangement as real ceiling tracks or light lines. Do not replace it with a plain empty ceiling.
Make the result photorealistic, clean and suitable for showing a client.
`.trim();

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

