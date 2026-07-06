export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { imageBase64, color, material, keepLight, shadowProfile, ledLine } = req.body || {};

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
      "room.png"
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
  console.log("OPENAI RESPONSE:");
  console.log(JSON.stringify(data, null, 2));

  return res.status(openaiRes.status).json({
    error: "OpenAI error",
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
    });

  } catch (error) {
    return res.status(500).json({
      error: "Помилка сервера",
      details: error.message,
    });
  }
}
