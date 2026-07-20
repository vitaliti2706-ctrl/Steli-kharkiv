import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function headers(extra = {}) {
  return {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function makeAccessKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let value = '';
  for (let i = 0; i < 8; i += 1) value += alphabet[bytes[i] % alphabet.length];
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

function hashAccessKey(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function nextObjectNumber() {
  const year = new Date().getFullYear();
  const prefix = `P-${year}-`;
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/objects?select=object_number&object_number=like.${prefix}*&order=object_number.desc&limit=1`,
    { headers: headers() }
  );
  if (!response.ok) throw new Error(await response.text());
  const rows = await response.json();
  const last = rows?.[0]?.object_number || '';
  const n = Number(last.split('-').pop()) || 0;
  return `${prefix}${String(n + 1).padStart(4, '0')}`;
}

function publicView(object, objectNumber, status) {
  return {
    objectNumber,
    status,
    clientName: object.clientName || '',
    address: object.address || '',
    date: object.date || '',
    rooms: Array.isArray(object.rooms) ? object.rooms : [],
    area: Number(object.area || 0),
    perimeter: Number(object.perimeter || 0),
    total: Number(object.total || 0),
    savedAt: object.savedAt || new Date().toISOString(),
  };
}

async function getRow(id) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/objects?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    { headers: headers() }
  );
  if (!response.ok) throw new Error(await response.text());
  const rows = await response.json();
  return rows?.[0] || null;
}

async function patchRow(id, patch) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/objects?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(patch),
    }
  );
  if (!response.ok) throw new Error(await response.text());
  const rows = await response.json();
  return rows?.[0] || null;
}

async function insertRow(row) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/objects`, {
    method: 'POST',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error(await response.text());
  const rows = await response.json();
  return rows?.[0] || null;
}

function dbStatus(status) {
  const value = String(status || 'new');
  const map = {
    new: 'new',
    call: 'new',
    measure_planned: 'measurement',
    measured: 'measurement',
    measurement: 'measurement',
    calculation: 'calculation',
    estimate_sent: 'calculation',
    approval: 'approval',
    contract: 'contract',
    install_planned: 'installation_planned',
    installation_planned: 'installation_planned',
    departure: 'installation_planned',
    installation: 'installation',
    completed: 'completed',
    paid: 'completed',
    review: 'completed',
    rejected: 'cancelled',
    cancelled: 'cancelled',
  };
  return map[value] || 'new';
}

function baseFields(object, status) {
  return {
    client_name: object.clientName || null,
    client_phone: object.clientPhone || null,
    address: object.address || null,
    measurement_date: object.date || null,
    ceiling_height: Number(object.height || 0) || null,
    status: dbStatus(status),
    internal_comment: object.comment || null,
    object_data: object,
  };
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return json(res, 500, { error: 'Supabase environment variables are missing' });
  }

  try {
    if (req.method === 'GET') {
      const id = String(req.query?.id || '').trim();
      const url = id
        ? `${SUPABASE_URL}/rest/v1/objects?id=eq.${encodeURIComponent(id)}&select=*`
        : `${SUPABASE_URL}/rest/v1/objects?select=*&order=updated_at.desc`;

      const response = await fetch(url, { headers: headers() });
      if (!response.ok) throw new Error(await response.text());
      const rows = await response.json();

      return json(res, 200, id ? { object: rows[0] || null } : { objects: rows });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

      if (body.action === 'clientLogin') {
        const objectNumber = String(body.objectNumber || '').trim().toUpperCase();
        const accessKey = String(body.accessKey || '').trim().toUpperCase();

        if (!objectNumber || !accessKey) {
          return json(res, 400, { error: 'Вкажіть номер об’єкта та ключ доступу.' });
        }

        const response = await fetch(
          `${SUPABASE_URL}/rest/v1/objects?object_number=eq.${encodeURIComponent(objectNumber)}&select=access_key_hash,client_view&limit=1`,
          { headers: headers() }
        );
        if (!response.ok) throw new Error(await response.text());

        const rows = await response.json();
        const row = rows?.[0];
        const suppliedHash = hashAccessKey(accessKey);
        const storedHash = String(row?.access_key_hash || '');

        const valid = !!row &&
          storedHash.length === suppliedHash.length &&
          storedHash.length > 0 &&
          crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(suppliedHash));

        if (!valid || !row.client_view) {
          return json(res, 401, { error: 'Невірний номер об’єкта або ключ доступу.' });
        }

        return json(res, 200, { object: row.client_view });
      }

      const actionName = String(body.action || '');
      const actionCloudId = String(body.cloudId || '').trim();

      if (['updateStatus', 'clientData', 'regenerateAccessKey', 'addScheduleEvent', 'deleteScheduleEvent'].includes(actionName)) {
        if (!actionCloudId) return json(res, 400, { error: 'cloudId is required' });
        const current = await getRow(actionCloudId);
        if (!current) return json(res, 404, { error: 'Object not found' });
        const currentObject = current.object_data && typeof current.object_data === 'object' ? current.object_data : {};

        if (actionName === 'updateStatus') {
          const nextStatus = String(body.status || 'new');
          const nextObject = { ...currentObject, cloudStatus: nextStatus };
          const row = await patchRow(actionCloudId, {
            status: dbStatus(nextStatus),
            object_data: nextObject,
            client_view: current.client_view ? publicView(nextObject, current.object_number, nextStatus) : null,
          });
          return json(res, 200, { object: row });
        }

        if (actionName === 'clientData') {
          return json(res, 200, {
            objectNumber: current.object_number,
            accessKey: currentObject._clientAccessKey || '',
            published: !!current.client_view,
          });
        }

        if (actionName === 'regenerateAccessKey') {
          const accessKey = makeAccessKey();
          const nextObject = { ...currentObject, _clientAccessKey: accessKey };
          const row = await patchRow(actionCloudId, {
            access_key_hash: hashAccessKey(accessKey),
            object_data: nextObject,
            client_view: publicView(nextObject, current.object_number, nextObject.cloudStatus || current.status || 'new'),
          });
          return json(res, 200, { accessKey, object: row });
        }

        if (actionName === 'addScheduleEvent') {
          const event = body.event && typeof body.event === 'object' ? body.event : null;
          if (!event || !event.date) return json(res, 400, { error: 'Valid event is required' });
          const schedule = Array.isArray(currentObject.schedule) ? currentObject.schedule : [];
          const nextObject = { ...currentObject, schedule: [...schedule, event] };
          const row = await patchRow(actionCloudId, { object_data: nextObject });
          return json(res, 200, { object: row });
        }

        if (actionName === 'deleteScheduleEvent') {
          const eventId = String(body.eventId || '');
          const schedule = (Array.isArray(currentObject.schedule) ? currentObject.schedule : []).filter(event => String(event.id) !== eventId);
          const nextObject = { ...currentObject, schedule };
          const row = await patchRow(actionCloudId, { object_data: nextObject });
          return json(res, 200, { object: row });
        }
      }

      const object = body.object;
      if (!object || typeof object !== 'object') {
        return json(res, 400, { error: 'object is required' });
      }

      const action = String(body.action || 'publishClient');
      const cloudId = String(body.cloudId || object.cloudId || '').trim();
      const status = String(body.status || object.cloudStatus || 'new');

      if (action === 'historySave') {
        if (cloudId) {
          const current = await getRow(cloudId);
          if (!current) return json(res, 404, { error: 'Object not found' });

          const objectNumber = current.object_number || object.objectNumber || await nextObjectNumber();
          const updatedObject = { ...object, objectNumber };

          const row = await patchRow(cloudId, {
            ...baseFields(updatedObject, status),
            client_view: current.client_view || null,
          });

          return json(res, 200, { created: false, published: !!row?.client_view, object: row });
        }

        const objectNumber = object.objectNumber || await nextObjectNumber();
        const updatedObject = { ...object, objectNumber };

        const row = await insertRow({
          object_number: objectNumber,
          access_key_hash: null,
          ...baseFields(updatedObject, status),
          client_view: null,
        });

        return json(res, 201, { created: true, published: false, object: row });
      }

      if (action === 'publishClient') {
        let accessKey = '';
        let accessKeyHash = '';
        let objectNumber = object.objectNumber || '';

        if (cloudId) {
          const current = await getRow(cloudId);
          if (!current) return json(res, 404, { error: 'Object not found' });

          objectNumber = current.object_number || objectNumber || await nextObjectNumber();

          if (!current.access_key_hash) {
            accessKey = makeAccessKey();
            accessKeyHash = hashAccessKey(accessKey);
          }

          const updatedObject = { ...object, objectNumber, ...(accessKey ? { _clientAccessKey: accessKey } : {}), ...(current.object_data?._clientAccessKey ? { _clientAccessKey: current.object_data._clientAccessKey } : {}) };

          const row = await patchRow(cloudId, {
            ...baseFields(updatedObject, status),
            ...(accessKeyHash ? { access_key_hash: accessKeyHash } : {}),
            client_view: publicView(updatedObject, objectNumber, status),
          });

          return json(res, 200, {
            created: false,
            accessKey: accessKey || undefined,
            object: row,
          });
        }

        objectNumber = objectNumber || await nextObjectNumber();
        accessKey = makeAccessKey();
        accessKeyHash = hashAccessKey(accessKey);
        const updatedObject = { ...object, objectNumber, _clientAccessKey: accessKey };

        const row = await insertRow({
          object_number: objectNumber,
          access_key_hash: accessKeyHash,
          ...baseFields(updatedObject, status),
          client_view: publicView(updatedObject, objectNumber, status),
        });

        return json(res, 201, { created: true, accessKey, object: row });
      }

      return json(res, 400, { error: 'Unknown action' });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '').trim();
      if (!id) return json(res, 400, { error: 'id is required' });

      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/objects?id=eq.${encodeURIComponent(id)}`,
        { method: 'DELETE', headers: headers() }
      );

      if (!response.ok) throw new Error(await response.text());
      return json(res, 200, { ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    console.error('objects API error:', error);
    return json(res, 500, { error: error.message || 'Server error' });
  }
                                    }
