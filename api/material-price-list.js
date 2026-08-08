const SHEET_ID = '18iyz77_Hgj2zdK0sIP5ciSsk-ZrTsP4Sxa2xcFnwCfg';
const SHEET_GID = '875431659';

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else {
      if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch !== '\r') field += ch;
    }
  }
  row.push(field);
  if (row.some(v => String(v).trim())) rows.push(row);
  return rows;
}

function norm(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[._/\\()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function numberValue(v) {
  let s = String(v ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[^0-9,.-]/g, '')
    .trim();
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  else if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  return Number(s) || 0;
}

const ALIASES = {
  name: ['найменування', 'наименование', 'назва', 'наименування', 'матеріал', 'материал', 'товар', 'позиція', 'позиция', 'номенклатура'],
  unit: ['одиниця', 'ед изм', 'единица', 'од', 'ед', 'unit'],
  price: ['ціна', 'цена', 'вартість', 'стоимость', 'price', 'опт', 'роздріб'],
  sku: ['артикул', 'код', 'sku'],
  category: ['категорія', 'категория', 'група', 'группа', 'розділ', 'раздел']
};

function findHeader(rows) {
  let best = { score: -1, index: 0, map: {} };
  for (let ri = 0; ri < Math.min(rows.length, 25); ri++) {
    const cells = rows[ri].map(norm);
    const map = {};
    for (const [key, aliases] of Object.entries(ALIASES)) {
      for (let i = 0; i < cells.length; i++) {
        if (aliases.some(a => cells[i] === a || cells[i].includes(a))) {
          map[key] = i;
          break;
        }
      }
    }
    const score =
      (map.name != null ? 4 : 0) +
      (map.price != null ? 4 : 0) +
      (map.unit != null ? 1 : 0) +
      (map.sku != null ? 1 : 0) +
      (map.category != null ? 1 : 0);

    if (score > best.score) best = { score, index: ri, map };
  }
  return best;
}

function normalizeRows(rows) {
  const header = findHeader(rows);

  if (header.score < 8 || header.map.name == null || header.map.price == null) {
    const preview = rows.slice(0, 8).map(r => r.slice(0, 12));
    const err = new Error(
      'Не вдалося визначити колонки «найменування» та «ціна» у Google-прайсі.'
    );
    err.preview = preview;
    throw err;
  }

  const items = [];

  for (const row of rows.slice(header.index + 1)) {
    const name = String(row[header.map.name] || '').trim();
    const price = numberValue(row[header.map.price]);

    if (!name || !price) continue;

    items.push({
      name,
      price,
      unit: String(row[header.map.unit] || 'шт').trim() || 'шт',
      sku: String(row[header.map.sku] || '').trim(),
      category: String(row[header.map.category] || '').trim()
    });
  }

  if (!items.length) {
    throw new Error('У Google-прайсі не знайдено позицій з назвою та ціною.');
  }

  return {
    items,
    headerRow: header.index + 1,
    columns: header.map
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  const url =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Potolok-Pixel/44.11'
      }
    });

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: `Google Sheets відповів ${response.status}. Перевірте доступ «усім за посиланням».`
      });
    }

    const csv = await response.text();
    const result = normalizeRows(parseCsv(csv));

    res.setHeader(
      'Cache-Control',
      req.query?.refresh
        ? 'no-store'
        : 's-maxage=300, stale-while-revalidate=600'
    );

    return res.status(200).json({
      ok: true,
      sheetId: SHEET_ID,
      gid: SHEET_GID,
      updatedAt: new Date().toISOString(),
      count: result.items.length,
      headerRow: result.headerRow,
      columns: result.columns,
      items: result.items
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Не вдалося завантажити прайс.',
      preview: error?.preview || undefined
    });
  }
};
