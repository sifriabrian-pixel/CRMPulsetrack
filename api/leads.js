const https = require('https');

function supabaseRequest(method, path, body, env) {
  return new Promise((resolve, reject) => {
    const url = new URL(env.SUPABASE_URL);
    const options = {
      hostname: url.hostname,
      path: `/rest/v1${path}`,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
        'Prefer': method === 'POST' ? 'return=representation' : ''
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, data: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function cleanMetaValue(v) {
  if (!v || typeof v !== 'string') return v;
  return v.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
          .replace(/^\w/, c => c.toUpperCase());
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
  };

  // Extract ID from URL path /api/leads/:id
  const urlParts = (req.url || '').split('?')[0].split('/').filter(Boolean);
  const leadId = urlParts.length > 2 ? urlParts[urlParts.length - 1] : null;

  // GET: fetch all leads
  if (req.method === 'GET') {
    try {
      const result = await supabaseRequest('GET', '/leads?order=created_at.desc', null, env);
      return res.status(200).json(result.data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE: remove a lead
  if (req.method === 'DELETE') {
    try {
      const id = leadId || (req.body && req.body.id);
      if (!id) return res.status(400).json({ error: 'id requerido' });
      await supabaseRequest('DELETE', `/leads?id=eq.${id}`, null, env);
      return res.status(200).json({ deleted: true, id });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST: create lead
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const d = new Date();
      const fecha = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

      const nombre    = body.nombre   || '';
      const apellido  = body.apellido || '';
      const email     = body.email    || '';
      const telefono  = body.telefono || '';
      const propiedad = body.propiedad || '';

      const questionLabels = {
        'respuesta_1': '¿Ya estás viendo propiedades para comprar activamente?',
        'respuesta_2': '¿Cuál es tu situación de compra hoy?',
        'respuesta_3': '¿Estás buscando comprar dentro de los próximos días/semanas?'
      };

      const respuestas = {};
      Object.entries(questionLabels).forEach(([key, label]) => {
        if (body[key] && String(body[key]).trim()) {
          respuestas[label] = cleanMetaValue(body[key]);
        }
      });

      // ── DUPLICATE CHECK ──
      if (email && email !== '(sin email)') {
        const existing = await supabaseRequest('GET',
          `/leads?email=eq.${encodeURIComponent(email)}&limit=1`, null, env);
        if (existing.data && Array.isArray(existing.data) && existing.data.length > 0) {
          return res.status(200).json({ skipped: true, reason: 'duplicate' });
        }
      } else if (nombre && telefono) {
        const existing = await supabaseRequest('GET',
          `/leads?nombre=eq.${encodeURIComponent(nombre)}&telefono=eq.${encodeURIComponent(telefono)}&limit=1`, null, env);
        if (existing.data && Array.isArray(existing.data) && existing.data.length > 0) {
          return res.status(200).json({ skipped: true, reason: 'duplicate' });
        }
      }

      const lead = { nombre, apellido, email, telefono, propiedad,
        stage: body.stage || 'Nuevo', fecha, notas: '', respuestas };

      const result = await supabaseRequest('POST', '/leads', lead, env);
      return res.status(201).json(result.data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // PATCH: update lead (stage, notas, or full edit)
  if (req.method === 'PATCH') {
    try {
      const body = req.body || {};
      const id = leadId || body.id;
      if (!id) return res.status(400).json({ error: 'id requerido' });
      const { id: _id, ...updates } = body;
      // Map frontend fields to DB columns
      if (updates.tel) { updates.telefono = updates.tel; delete updates.tel; }
      if (updates.resp) { updates.respuestas = updates.resp; delete updates.resp; }
      const result = await supabaseRequest('PATCH', `/leads?id=eq.${id}`, updates, env);
      return res.status(200).json(result.data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Metodo no permitido' });
};
