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

// Fetch lead data from Meta Graph API using leadgen_id
function fetchMetaLead(leadgenId, accessToken) {
  return new Promise((resolve, reject) => {
    const path = `/${leadgenId}?fields=field_data,ad_name,adset_name,campaign_name,created_time&access_token=${accessToken}`;
    const options = {
      hostname: 'graph.facebook.com',
      path: `/v19.0${path}`,
      method: 'GET'
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// Build respuestas object from Meta field_data array
// field_data: [{name: "full_name", values: ["John"]}, {name: "¿pregunta?", values: ["respuesta"]}]
function buildRespuestas(fieldData) {
  if (!Array.isArray(fieldData)) return {};
  const skip = ['full_name', 'email', 'phone_number', 'phone', 'full name'];
  const resp = {};
  fieldData.forEach(f => {
    const key = f.name || f.key || '';
    if (!skip.includes(key.toLowerCase()) && f.values && f.values[0]) {
      // Use the field name as the question label
      resp[key] = f.values[0];
    }
  });
  return resp;
}

// Extract value from field_data by field name
function getField(fieldData, names) {
  if (!Array.isArray(fieldData)) return '';
  for (const name of names) {
    const field = fieldData.find(f => 
      (f.name || f.key || '').toLowerCase() === name.toLowerCase()
    );
    if (field && field.values && field.values[0]) return field.values[0];
  }
  return '';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN
  };

  // GET: fetch all leads
  if (req.method === 'GET') {
    try {
      const result = await supabaseRequest('GET', '/leads?order=created_at.desc', null, env);
      return res.status(200).json(result.data);
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

      let nombre = body.nombre || '';
      let apellido = body.apellido || '';
      let email = body.email || '';
      let telefono = body.telefono || '';
      let propiedad = body.propiedad || '';
      let respuestas = {};

      // If we have leadgen_id and access token, fetch full data from Meta
      if (body.leadgen_id && env.META_ACCESS_TOKEN) {
        console.log('Fetching from Meta Graph API for leadgen_id:', body.leadgen_id);
        const metaLead = await fetchMetaLead(body.leadgen_id, env.META_ACCESS_TOKEN);
        console.log('Meta response:', JSON.stringify(metaLead));
        
        if (metaLead && metaLead.field_data) {
          const fd = metaLead.field_data;
          nombre = nombre || getField(fd, ['full_name', 'full name', 'first_name']);
          email = email || getField(fd, ['email']);
          telefono = telefono || getField(fd, ['phone_number', 'phone']);
          propiedad = propiedad || metaLead.adset_name || metaLead.ad_name || '';
          respuestas = buildRespuestas(fd);
        }
      }

      // Fallback to body fields if Meta fetch didn't work
      if (!nombre) nombre = body.nombre || '';
      if (!email) email = body.email || '';
      if (!telefono) telefono = body.telefono || '';
      if (!propiedad) propiedad = body.propiedad || '';

      // Also check for respuesta_1/2/3 sent directly from Make
      if (Object.keys(respuestas).length === 0) {
        const questionLabels = {
          'respuesta_1': '¿Ya estás viendo propiedades para comprar activamente?',
          'respuesta_2': '¿Cuál es tu situación de compra hoy?',
          'respuesta_3': '¿Estás buscando comprar dentro de los próximos días/semanas?'
        };
        Object.entries(questionLabels).forEach(([key, label]) => {
          if (body[key] && body[key].trim()) {
            respuestas[label] = body[key];
          }
        });
      }

      // ── DUPLICATE CHECK ──
      if (email && email !== '(sin email)') {
        const existing = await supabaseRequest(
          'GET',
          `/leads?email=eq.${encodeURIComponent(email)}&limit=1`,
          null, env
        );
        if (existing.data && Array.isArray(existing.data) && existing.data.length > 0) {
          console.log('Duplicate skipped:', email);
          return res.status(200).json({ skipped: true, reason: 'duplicate' });
        }
      } else if (nombre && telefono) {
        const existing = await supabaseRequest(
          'GET',
          `/leads?nombre=eq.${encodeURIComponent(nombre)}&telefono=eq.${encodeURIComponent(telefono)}&limit=1`,
          null, env
        );
        if (existing.data && Array.isArray(existing.data) && existing.data.length > 0) {
          console.log('Duplicate skipped:', nombre);
          return res.status(200).json({ skipped: true, reason: 'duplicate' });
        }
      }

      const lead = {
        nombre,
        apellido,
        email,
        telefono,
        propiedad,
        stage: body.stage || 'Nuevo',
        fecha: body.fecha || fecha,
        notas: '',
        respuestas
      };

      console.log('Saving lead:', JSON.stringify(lead));
      const result = await supabaseRequest('POST', '/leads', lead, env);
      return res.status(201).json(result.data);
    } catch (err) {
      console.error('Error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // PATCH: update lead
  if (req.method === 'PATCH') {
    try {
      const { id, ...updates } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id requerido' });
      const result = await supabaseRequest('PATCH', `/leads?id=eq.${id}`, updates, env);
      return res.status(200).json(result.data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Método no permitido' });
};
