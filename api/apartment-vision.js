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
          wall_lengths_m: Array.isArray(room?.wall_lengths_m) ? room.wall_lengths_m.map(v => {
            const n = Number(v);
            return Number.isFinite(n) && n > 0 ? n : 0;
          }) : [],
          wall_ids: Array.isArray(room?.wall_ids) ? room.wall_ids.map(String) : [],
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

  const walls = Array.isArray(data?.walls)
    ? data.walls.map((item, index) => ({
        id: String(item?.id || `wall-${index + 1}`),
        x1: clamp01(item?.x1), y1: clamp01(item?.y1),
        x2: clamp01(item?.x2), y2: clamp01(item?.y2),
        length_m: Math.max(0, Number(item?.length_m) || 0),
        kind: item?.kind === "outer" ? "outer" : "inner",
        confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
      })).filter(w => Math.hypot(w.x2-w.x1,w.y2-w.y1) > 0.003)
    : [];

  const openings = Array.isArray(data?.openings)
    ? data.openings.map((item, index) => ({
        id: String(item?.id || `opening-${index + 1}`),
        type: item?.type === "window" ? "window" : "door",
        x1: clamp01(item?.x1),
        y1: clamp01(item?.y1),
        x2: clamp01(item?.x2),
        y2: clamp01(item?.y2),
        width_m: Math.max(0, Number(item?.width_m) || 0),
        rotation: Number.isFinite(Number(item?.rotation)) ? Number(item.rotation) : 0,
        swing: item?.swing === "right" ? "right" : "left",
        opens: item?.opens === "out" ? "out" : "in",
        room_ids: Array.isArray(item?.room_ids) ? item.room_ids.map(String) : [],
        wall_id: item?.wall_id ? String(item.wall_id) : "",
        confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
      }))
    : [];

  return {
    ok: true,
    rooms,
    walls,
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
Ти технічний кресляр. Віднови з плану БТІ єдиний узгоджений каркас квартири, а не набір приблизних прямокутників.

Працюй у такому порядку:
1. Зовнішній контур.
2. Усі внутрішні стіни.
3. Дверні та віконні прорізи на конкретних стінах.
4. Замкнені контури кімнат із цих стін.
5. Видимі площі та лінійні розміри.
6. Перевір спільні стіни сусідніх кімнат.

Критично:
- Не домальовуй форму за площею.
- Не спрощуй ніші, виступи, шахти, Г- та П-подібні кімнати.
- Не плутай балкон, гардероб, комору й лоджію. Якщо не впевнений — назви "Приміщення".
- Точки став тільки у фактичних зламах стін.
- Спільна стіна сусідніх кімнат повинна мати однакові координати.
- wall_lengths_m відповідає ребрам points. Нерозбірливий розмір = 0.
- Двері та вікна повинні лежати на стіні.
- Для дверей визнач swing left/right та opens in/out за дугою. Якщо не видно — confidence нижче 0.5.
- Не вигадуй дані. Невпевнені місця запиши в notes.
- Координати x/y від 0 до 1 відносно всього зображення.

Поверни тільки JSON за заданою схемою.
`.trim();

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        store: false,
        reasoning: { effort: "medium" },
        text: {
          format: {
            type: "json_schema",
            name: "apartment_plan",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["walls","rooms","openings","scaleHint","notes"],
              properties: {
                walls: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id","x1","y1","x2","y2","length_m","kind","confidence"],
                    properties: {
                      id:{type:"string"}, x1:{type:"number"}, y1:{type:"number"},
                      x2:{type:"number"}, y2:{type:"number"}, length_m:{type:"number"},
                      kind:{type:"string",enum:["outer","inner"]}, confidence:{type:"number"}
                    }
                  }
                },
                rooms: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id","name","type","areaLabel","confidence","points","wall_lengths_m","wall_ids"],
                    properties: {
                      id:{type:"string"}, name:{type:"string"}, type:{type:"string"},
                      areaLabel:{type:"string"}, confidence:{type:"number"},
                      points:{
                        type:"array", minItems:3,
                        items:{
                          type:"object", additionalProperties:false,
                          required:["x","y"], properties:{x:{type:"number"},y:{type:"number"}}
                        }
                      },
                      wall_lengths_m:{type:"array",items:{type:"number"}},
                      wall_ids:{type:"array",items:{type:"string"}}
                    }
                  }
                },
                openings: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id","type","x1","y1","x2","y2","width_m","rotation","swing","opens","room_ids","wall_id","confidence"],
                    properties: {
                      id:{type:"string"}, type:{type:"string",enum:["door","window"]},
                      x1:{type:"number"}, y1:{type:"number"}, x2:{type:"number"}, y2:{type:"number"},
                      width_m:{type:"number"}, rotation:{type:"number"},
                      swing:{type:"string",enum:["left","right"]},
                      opens:{type:"string",enum:["in","out"]},
                      room_ids:{type:"array",items:{type:"string"}},
                      wall_id:{type:"string"}, confidence:{type:"number"}
                    }
                  }
                },
                scaleHint:{type:"string"},
                notes:{type:"array",items:{type:"string"}}
              }
            }
          }
        },
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageBase64, detail: "high" }
          ]
        }]
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

    if (!result.rooms.length || !result.walls.length) {
      return res.status(422).json({
        error: "AI не зміг побудувати узгоджений каркас стін і приміщень. Спробуйте чіткіше або обрізане зображення.",
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

