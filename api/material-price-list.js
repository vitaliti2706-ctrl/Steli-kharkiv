const SHEET_ID = '18iyz77_Hgj2zdK0sIP5ciSsk-ZrTsP4Sxa2xcFnwCfg';
const SHEET_GID = '875431659';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') quoted = true;
      else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (ch !== '\r') {
        field += ch;
      }
    }
  }

  row.push(field);
  if (row.some(v => String(v).trim())) rows.push(row);
  return rows;
}

function norm(v) {
  return String(v ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\u00a0/g, ' ')
    .replace(/[._/\\()\[\]{}-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(v) {
  return String(v ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function numberValue(v) {
  const raw = String(v ?? '').replace(/\u00a0/g, ' ');
  const match = raw.match(/-?\d[\d\s.,]*/);
  if (!match) return 0;

  let s = match[0]
    .replace(/\s/g, '')
    .replace(/[.,]+$/g, '')
    .trim();

  if (!s) return 0;

  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');

  if (comma >= 0 && dot >= 0) {
    // Последний разделитель считаем десятичным, остальные — разделителями тысяч.
    if (comma > dot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (comma >= 0) {
    s = s.replace(',', '.');
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function looksLikePriceCell(v) {
  const s = cleanText(v);
  if (!s) return false;
  if (/(грн|₴|uah)/i.test(s) && numberValue(s) > 0) return true;
  return false;
}

function canonicalUnit(v) {
  const s = norm(v);
  if (!s) return '';

  if (/^(шт|штук|штука|шт\s*)$/.test(s)) return 'шт';
  if (/^(пог\s*м|погонн\w*\s*м|п\s*м|м\s*п)$/.test(s)) return 'м.п.';
  if (/^(м2|м²|кв\s*м)$/.test(s)) return 'м²';
  if (/^(м|метр|метри|метров|метра)$/.test(s)) return 'м';
  if (/^(компл|комплект|комплекти)$/.test(s)) return 'компл.';
  if (/^(уп|упак|упаковка|пачка)$/.test(s)) return 'упак.';
  if (/^(рулон|рул)$/.test(s)) return 'рулон';
  if (/^(кг|кілограм|килограмм)$/.test(s)) return 'кг';
  if (/^(л|літр|литр)$/.test(s)) return 'л';
  if (/^(пар|пара)$/.test(s)) return 'пар';
  if (/^(набір|набор)$/.test(s)) return 'набір';

  return '';
}

function looksLikeCode(v) {
  const s = cleanText(v);
  if (!s || s.length > 40) return false;
  if (looksLikePriceCell(s) || canonicalUnit(s)) return false;
  if (/[а-яіїєґ]/i.test(s)) return false;

  // UK17, UK17T63D, 3218 3219, A-12/4 etc.
  return /^[A-ZА-Я0-9][A-ZА-Я0-9 ._+\-/]*$/i.test(s) && /[0-9]/.test(s);
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

  for (let ri = 0; ri < Math.min(rows.length, 30); ri++) {
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

function normalizeByHeader(rows) {
  const header = findHeader(rows);

  if (header.score < 8 || header.map.name == null || header.map.price == null) {
    return null;
  }

  const items = [];

  for (const row of rows.slice(header.index + 1)) {
    const name = cleanText(row[header.map.name]);
    const price = numberValue(row[header.map.price]);
    if (!name || !price) continue;

    items.push({
      name,
      price,
      unit: canonicalUnit(row[header.map.unit]) || cleanText(row[header.map.unit]) || 'шт',
      sku: cleanText(row[header.map.sku]),
      category: cleanText(row[header.map.category]),
      source: 'google-sheet'
    });
  }

  return items.length ? { items, mode: 'header', headerRow: header.index + 1, columns: header.map } : null;
}

function scoreNameCell(v) {
  const s = cleanText(v);
  if (!s || s.length < 4) return -999;
  if (looksLikePriceCell(s) || canonicalUnit(s) || looksLikeCode(s)) return -999;
  if (!/[a-zа-яіїєґ]/i.test(s)) return -999;

  let score = Math.min(s.length, 120);
  score += (s.match(/\s+/g) || []).length * 4;
  if (/[а-яіїєґ]/i.test(s)) score += 12;
  if (/(проф|карниз|заглуш|встав|самор|дюб|полотно|трек|світ|свет|клем|платформ|кільц|кольц|термо|брус|кріп|креп|кут|угол|стріч|лента|блок|дріт|провод|кабель)/i.test(s)) score += 18;
  return score;
}

function normalizeLayoutRows(rows) {
  const items = [];
  let currentCategory = '';

  for (const row of rows) {
    const cells = row.map(cleanText);
    const nonEmpty = cells
      .map((value, index) => ({ value, index }))
      .filter(x => x.value);

    if (!nonEmpty.length) continue;

    const priceCells = nonEmpty.filter(x => looksLikePriceCell(x.value));

    if (!priceCells.length) {
      // Возможный заголовок раздела прайса.
      const categoryCandidates = nonEmpty
        .filter(x => !looksLikeCode(x.value) && !canonicalUnit(x.value))
        .sort((a, b) => scoreNameCell(b.value) - scoreNameCell(a.value));

      if (categoryCandidates.length === 1) {
        const candidate = categoryCandidates[0].value;
        if (candidate.length >= 4 && candidate.length <= 80) currentCategory = candidate;
      }
      continue;
    }

    const bestName = nonEmpty
      .map(x => ({ ...x, score: scoreNameCell(x.value) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)[0];

    if (!bestName) continue;

    // Берём первую явно указанную цену в грн.
    const priceCell = priceCells[0];
    const price = numberValue(priceCell.value);
    if (!price) continue;

    let unit = '';
    for (const x of nonEmpty) {
      const u = canonicalUnit(x.value);
      if (u) {
        unit = u;
        break;
      }
    }
    if (!unit) unit = 'шт';

    const codeParts = nonEmpty
      .filter(x => x.index < bestName.index && looksLikeCode(x.value))
      .slice(0, 2)
      .map(x => x.value);

    const sku = codeParts.join(' / ');

    items.push({
      name: bestName.value,
      price,
      unit,
      sku,
      category: currentCategory,
      source: 'google-sheet'
    });
  }

  // Удаляем только точные дубли, не склеивая разные артикулы/варианты.
  const seen = new Set();
  const deduped = [];

  for (const item of items) {
    const key = norm(`${item.sku}|${item.name}|${item.price}|${item.unit}`);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped.length ? { items: deduped, mode: 'layout', headerRow: null, columns: null } : null;
}

function normalizeRows(rows) {
  const byHeader = normalizeByHeader(rows);
  if (byHeader) return byHeader;

  const byLayout = normalizeLayoutRows(rows);
  if (byLayout) return byLayout;

  const err = new Error('Не вдалося розібрати структуру Google-прайсу.');
  err.preview = rows.slice(0, 12).map(r => r.slice(0, 20));
  throw err;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Potolok-Pixel/44.12' }
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
      req.query?.refresh ? 'no-store' : 's-maxage=300, stale-while-revalidate=600'
    );

    return res.status(200).json({
      ok: true,
      sheetId: SHEET_ID,
      gid: SHEET_GID,
      updatedAt: new Date().toISOString(),
      parserMode: result.mode,
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
}

