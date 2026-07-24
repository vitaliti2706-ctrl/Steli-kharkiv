export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

function extractJson(text) {
  const cleaned = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("AI не повернув коректний JSON");
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function normalizeResult(data) {
  const rooms = Array.isArray(data?.rooms)
    ? data.rooms
        .map((room, index) => ({
          id: String(room?.id || `room-${index + 1}`),
          name: String(room?.name || `Приміщення ${index + 1}`),
          type: String(room?.type || "room"),
          areaLabel: room?.areaLabel ? String(room.areaLabel) : "",
          confidence: Math.max(0, Math.min(1, Number(room?.confidence) || 0)),
          points: Array.isArray(room?.points)
            ? room.points
                .map((point) => ({
                  x: clamp01(point?.x),
                  y: clamp01(point?.y),
                }))
                .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
            : [],
        }))
        .filter((room) => room.points.length >= 3)
    : [];

  const openings = Array.isArray(data?.openings)
    ? data.openings.map((item, index) => ({
        id: String(item?.id || `opening-${index + 1}`),
        type: item?.type === "window" ? "window" : "door",
        x1: clamp01(item?.x1),
        y1: clamp01(item?.y1),
        x2: clamp01(item?.x2),
        y2: clamp01(item?.y2),
        confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
      }))
    : [];

  return {
    ok: true,
    rooms,
    openings,
    scaleHint: data?.scaleHint ? String(data.scaleHint) : "",
    notes: Array.isArray(data?.notes) ? data.notes.map(String).slice(0, 10) : [],
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Дозволено лише POST-запит" });
  }

  try {
    const imageBase64 = req.body?.imageBase64;

    if (!imageBase64) {
      return res.status(400).json({ error: "Зображення плану не отримано" });
    }

    if (!/^data:image\/[\w.+-]+;base64,/.test(imageBase64)) {
      return res.status(400).json({ error: "Невірний формат зображення" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY не додано у Vercel" });
    }

    const prompt = `
Проаналізуй зображення плану квартири або плану БТІ та перетвори його на приблизний електронний 2D-план.

Поверни ВИКЛЮЧНО JSON без markdown у такому форматі:
{
  "rooms": [
    {
      "id": "room-1",
      "name": "Кухня",
      "type": "kitchen",
      "areaLabel": "6.8 м²",
      "confidence": 0.85,
      "points": [{"x":0.12,"y":0.15},{"x":0.35,"y":0.15},{"x":0.35,"y":0.42},{"x":0.12,"y":0.42}]
    }
  ],
  "openings": [
    {"id":"door-1","type":"door","x1":0.3,"y1":0.5,"x2":0.36,"y2":0.5,"confidence":0.7}
  ],
  "scaleHint": "",
  "notes": []
}

Правила:
- Усі координати нормалізовані від 0 до 1 відносно повного зображення.
- Для кожного приміщення створи замкнений контур без повторення першої точки в кінці.
- Визначай кухню, кімнати, коридор, санвузол, ванну, балкон та інші приміщення лише коли це видно.
- Не включай зовнішні поля, підписи, штампи або меблі як приміщення.
- Якщо контур складний, використай більше точок.
- Не вигадуй точні розміри, яких не видно.
- Двері й вікна додай у openings, якщо вони впевнено видимі.
`.trim();

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        store: false,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              { type: "input_image", image_url: imageBase64, detail: "high" },
            ],
          },
        ],
      }),
    });

    const responseData = await openaiResponse.json();

    if (!openaiResponse.ok) {
      return res.status(openaiResponse.status).json({
        error: responseData?.error?.message || "Помилка OpenAI",
      });
    }

    const outputText =
      responseData?.output_text ||
      responseData?.output
        ?.flatMap((item) => item?.content || [])
        ?.filter((item) => item?.type === "output_text")
        ?.map((item) => item?.text || "")
        ?.join("\n");

    const parsed = extractJson(outputText);
    const result = normalizeResult(parsed);

    if (!result.rooms.length) {
      return res.status(422).json({
        error: "AI не зміг знайти приміщення. Спробуйте чіткіше або обрізане зображення.",
        notes: result.notes,
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      error: "Помилка сервера під час розпізнавання",
      details: error?.message || String(error),
    });
  }
}

