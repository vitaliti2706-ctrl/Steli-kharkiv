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

function cleanText(v) {
  return String(v ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function norm(v) {
  return cleanText(v)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[._/\\()\[\]{}:;,-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function numberValue(v) {
  const raw = cleanText(v);
  const match = raw.match(/-?\d[\d\s.,]*/);
  if (!match) return 0;
  let s = match[0].replace(/\s/g, '').replace(/[.,]+$/g, '');
  if (!s) return 0;

  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (comma >= 0) {
    s = s.replace(',', '.');
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function hasCurrency(v) {
  return /(грн|₴|uah)/i.test(cleanText(v));
}

function looksLikeExplicitPrice(v) {
  const n = numberValue(v);
  return hasCurrency(v) && n > 0 && n < 10000000;
}

function looksLikePlainPrice(v) {
  const s = cleanText(v);
  if (!s || hasCurrency(s)) return false;
  if (!/^\s*\d[\d\s]*(?:[.,]\d{1,2})?\s*$/.test(s)) return false;
  const n = numberValue(s);
  return n > 0 && n < 1000000;
}

function canonicalUnit(v) {
  const s = norm(v);
  if (!s) return '';

  if (/^(шт|штук|штука|штуки)$/.test(s)) return 'шт';
  if (/^(пог\s*м|погонн\w*\s*м|п\s*м|м\s*п|мп)$/.test(s)) return 'м.п.';
  if (/^(м2|м²|кв\s*м|квм)$/.test(s)) return 'м²';
  if (/^(м|метр|метри|метров|метра)$/.test(s)) return 'м';
  if (/^(компл|комплект|комплекти|комп)$/.test(s)) return 'компл.';
  if (/^(уп|упак|упаковка|пачка|пак)$/.test(s)) return 'упак.';
  if (/^(рулон|рул)$/.test(s)) return 'рулон';
  if (/^(кг|кілограм|килограмм|килограм)$/.test(s)) return 'кг';
  if (/^(л|літр|литр)$/.test(s)) return 'л';
  if (/^(пар|пара)$/.test(s)) return 'пар';
  if (/^(набір|набор)$/.test(s)) return 'набір';
  if (/^(бухта)$/.test(s)) return 'бухта';
  if (/^(короб|коробка)$/.test(s)) return 'коробка';

  return '';
}

function looksLikeCode(v) {
  const s = cleanText(v);
  if (!s || s.length > 60) return false;
  if (looksLikeExplicitPrice(s) || canonicalUnit(s)) return false;
  if (/^(грн|ціна|цена|опт|роздріб|розница)$/i.test(s)) return false;

  // Артикулы/коды: UK17, UK17T63D, 3218 3219, A-12/4, 3614/3615.
  if (/^[A-ZА-ЯІЇЄҐ]{1,8}[A-ZА-ЯІЇЄҐ0-9 ._+\-/]{0,40}$/i.test(s) && /\d/.test(s)) return true;
  if (/^\d{2,8}(?:[\s/,-]+\d{2,8})+$/.test(s)) return true;
  return false;
}

function looksLikeName(v) {
  const s = cleanText(v);
  if (!s || s.length < 3 || s.length > 260) return false;
  if (looksLikeExplicitPrice(s) || canonicalUnit(s) || looksLikeCode(s)) return false;
  if (!/[a-zа-яіїєґ]/i.test(s)) return false;
  if (/^(ціна|цена|артикул|код|одиниця|единица|найменування|наименование|назва|товар|матеріал|материал)$/i.test(s)) return false;
  return true;
}

function nameScore(v) {
  const s = cleanText(v);
  if (!looksLikeName(s)) return -9999;
  let score = Math.min(s.length, 120);
  score += (s.match(/\s+/g) || []).length * 3;
  if (/[а-яіїєґ]/i.test(s)) score += 8;
  if (/(проф|карниз|заглуш|встав|самор|дюб|полотно|трек|світ|свет|клем|платформ|кільц|кольц|термо|брус|кріп|креп|кут|угол|стріч|лента|блок|дріт|провод|кабель|гарпун|маск|шуруп|анкер|підвіс|подвес|кроншт|з'єдн|соедин|адаптер|переход|зажим|крюч|гачок)/i.test(s)) score += 25;
  return score;
}

const ALIASES = {
  name: ['найменування', 'наименование', 'назва', 'наименування', 'матеріал', 'материал', 'товар', 'позиція', 'позиция', 'номенклатура'],
  unit: ['одиниця', 'ед изм', 'единица', 'од', 'ед', 'unit'],
  price: ['ціна', 'цена', 'вартість', 'стоимость', 'price', 'опт', 'роздріб', 'розница'],
  sku: ['артикул', 'код', 'sku'],
  category: ['категорія', 'категория', 'група', 'группа', 'розділ', 'раздел']
};

function findHeader(rows) {
  let best = { score: -1, index: 0, map: {} };
  for (let ri = 0; ri < Math.min(rows.length, 40); ri++) {
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
  if (header.score < 8 || header.map.name == null || header.map.price == null) return null;

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

  return items.length ? {
    items,
    mode: 'header',
    headerRow: header.index + 1,
    columns: header.map,
    diagnostics: { rows: rows.length, explicitPrices: items.length, plainPrices: 0, skipped: 0 }
  } : null;
}

function columnStats(rows) {
  const explicitByCol = new Map();
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (looksLikeExplicitPrice(rows[r][c])) {
        explicitByCol.set(c, (explicitByCol.get(c) || 0) + 1);
      }
    }
  }
  const priceCols = new Set(
    [...explicitByCol.entries()]
      .filter(([, count]) => count >= 2)
      .map(([col]) => col)
  );
  return { explicitByCol, priceCols };
}

function collectWindow(rows, r, c, radiusRows = 4, leftCols = 10, rightCols = 4) {
  const out = [];
  const r0 = Math.max(0, r - radiusRows);
  const r1 = Math.min(rows.length - 1, r + 1);
  for (let rr = r0; rr <= r1; rr++) {
    const c0 = Math.max(0, c - leftCols);
    const c1 = Math.min((rows[rr]?.length || 0) - 1, c + rightCols);
    for (let cc = c0; cc <= c1; cc++) {
      const value = cleanText(rows[rr]?.[cc]);
      if (!value) continue;
      out.push({ value, r: rr, c: cc, dr: Math.abs(r - rr), dc: Math.abs(c - cc) });
    }
  }
  return out;
}

function chooseName(rows, r, c) {
  const candidates = collectWindow(rows, r, c, 5, 12, 5)
    .filter(x => looksLikeName(x.value))
    .map(x => {
      let score = nameScore(x.value);
      score -= x.dr * 12;
      score -= x.dc * 1.7;
      if (x.r === r) score += 22;
      if (x.c <= c) score += 4;
      return { ...x, score };
    })
    .sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

function chooseUnit(rows, r, c, namePos) {
  const candidates = collectWindow(rows, r, c, 3, 10, 5)
    .map(x => ({ ...x, unit: canonicalUnit(x.value) }))
    .filter(x => x.unit)
    .map(x => ({
      ...x,
      score: 100 - x.dr * 14 - x.dc * 2 + (x.r === r ? 15 : 0) + (namePos && Math.abs(x.c - namePos.c) <= 3 ? 8 : 0)
    }))
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.unit || 'шт';
}

function chooseSku(rows, r, c, namePos) {
  const candidates = collectWindow(rows, r, c, 4, 14, 4)
    .filter(x => looksLikeCode(x.value))
    .map(x => {
      let score = 100 - x.dr * 12 - x.dc * 1.5;
      if (x.r === r) score += 15;
      if (namePos && x.c <= namePos.c) score += 8;
      return { ...x, score };
    })
    .sort((a, b) => b.score - a.score);

  const picked = [];
  for (const x of candidates) {
    if (!picked.includes(x.value)) picked.push(x.value);
    if (picked.length >= 2) break;
  }
  return picked.join(' / ');
}

function chooseCategory(rows, r, c, namePos) {
  // Ищем короткий текстовый заголовок выше в том же блоке.
  for (let rr = r - 1; rr >= Math.max(0, r - 12); rr--) {
    const row = rows[rr] || [];
    const c0 = Math.max(0, (namePos?.c ?? c) - 6);
    const c1 = Math.min(row.length - 1, c + 3);
    const texts = [];
    for (let cc = c0; cc <= c1; cc++) {
      const s = cleanText(row[cc]);
      if (looksLikeName(s) && s.length <= 90) texts.push(s);
    }
    if (texts.length === 1) return texts[0];
  }
  return '';
}

function normalizeLayoutRows(rows) {
  const { priceCols } = columnStats(rows);
  const priceCandidates = [];

  // 1) Все явно отформатированные цены (грн/₴/UAH) — обязательно.
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const value = rows[r][c];
      if (looksLikeExplicitPrice(value)) {
        priceCandidates.push({ r, c, value, kind: 'explicit' });
      }
    }
  }

  // 2) Чистые числа в колонках, где уже встречались цены — тоже считаем ценами,
  // но только если рядом удаётся найти название товара.
  for (let r = 0; r < rows.length; r++) {
    for (const c of priceCols) {
      const value = rows[r]?.[c];
      if (!looksLikePlainPrice(value)) continue;
      if (priceCandidates.some(x => x.r === r && x.c === c)) continue;
      if (!chooseName(rows, r, c)) continue;
      priceCandidates.push({ r, c, value, kind: 'plain' });
    }
  }

  const items = [];
  const skipped = [];

  for (const p of priceCandidates) {
    const price = numberValue(p.value);
    if (!price) continue;

    const namePos = chooseName(rows, p.r, p.c);
    if (!namePos) {
      skipped.push({ row: p.r + 1, col: p.c + 1, price: cleanText(p.value), reason: 'name-not-found' });
      continue;
    }

    const unit = chooseUnit(rows, p.r, p.c, namePos);
    const sku = chooseSku(rows, p.r, p.c, namePos);
    const category = chooseCategory(rows, p.r, p.c, namePos);

    items.push({
      name: namePos.value,
      price,
      unit,
      sku,
      category,
      source: 'google-sheet',
      _row: p.r + 1,
      _col: p.c + 1,
      _priceKind: p.kind
    });
  }

  // Точные дубли убираем, разные цены/артикулы сохраняем.
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = norm(`${item.sku}|${item.name}|${item.price}|${item.unit}`);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const { _row, _col, _priceKind, ...publicItem } = item;
    deduped.push(publicItem);
  }

  return deduped.length ? {
    items: deduped,
    mode: 'layout-v3',
    headerRow: null,
    columns: null,
    diagnostics: {
      rows: rows.length,
      priceColumns: [...priceCols].map(c => c + 1),
      explicitPrices: priceCandidates.filter(x => x.kind === 'explicit').length,
      plainPrices: priceCandidates.filter(x => x.kind === 'plain').length,
      candidates: priceCandidates.length,
      parsedBeforeDedup: items.length,
      parsed: deduped.length,
      skipped: skipped.length,
      skippedSample: skipped.slice(0, 20)
    }
  } : null;
}

function normalizeRows(rows) {
  const byHeader = normalizeByHeader(rows);
  if (byHeader && byHeader.items.length >= 10) return byHeader;

  const byLayout = normalizeLayoutRows(rows);
  if (byLayout) return byLayout;
  if (byHeader) return byHeader;

  const err = new Error('Не вдалося розібрати структуру Google-прайсу.');
  err.preview = rows.slice(0, 20).map(r => r.slice(0, 30));
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
      headers: { 'User-Agent': 'Potolok-Pixel/44.12-price-v3' }
    });

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: `Google Sheets відповів ${response.status}. Перевірте доступ «усім за посиланням».`
      });
    }

    const csv = await response.text();
    const rows = parseCsv(csv);
    const result = normalizeRows(rows);

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
      diagnostics: result.diagnostics,
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


