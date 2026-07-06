export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { imageBase64, color, material } = req.body || {};

    if (!imageBase64) {
      return res.status(400).json({ error: "Фото не отримано" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY не додано у Vercel" });
    }

    const prompt = `
Replace ONLY the ceiling in this room photo with a ${color} ${material} stretch ceiling.
Keep walls, floor, doors, windows, furniture, lighting fixtures and room geometry exactly the same.
Do not redesign the room.
Do not change perspective.
Make result photorealistic, clean and natural.
`;

    return res.status(200).json({
      ok: true,
      message: "API отримав фото і параметри. Наступний крок — підключення генерації зображення.",
      prompt
    });

  } catch (error) {
    return res.status(500).json({
      error: "Помилка сервера",
      details: error.message
    });
  }
}
