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

// Extract value from Meta field_data array
// field_data: [{key: "full_name", values: ["John Doe"]}, ...]
function extractFromFieldData(fieldData, keys) {
  if (!Array.isArray(fieldData)) return '';
  for (const key of keys) {
    const field = fieldData.find(f =>
      f.key && f.key.toLowerCase().replace(/\s/g,'_') === key.toLowerCase().replace(/\s/g,'_')
    );
    if (field && field.values && field.values[0]) return field.values[0];
  }
  return '';
}

// Build respuestas object from field_data
function buildRespuestas(fieldData) {
  if (!Array.isArray(fieldData)) return {};
  const skip = ['full_name','email','phone_number','first_name','last_name','phone'];
  const resp = {};
  fieldData.forEach(f => {
    if (!skip.includes((f.key||'').toLowerCase()) && f.values && f.values[0]) {
      resp[f.key] = f.values[0];
    }
  });
  return resp;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
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

  // POST: create lead — supports both direct fields and Meta field_data format
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const d = new Date();
      const fecha = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

      // Support Meta field_data format (array of {key, values})
      const fieldData = body.field_data || [];
      
      // Try to get name from full_name or first_name + last_name
      const fullName = extractFromFieldData(fieldData, ['full_name']) ||
                       body.nombre || body.full_name || '';
      const firstName = extractFromFieldData(fieldData, ['first_name']) || body.nombre || '';
      const lastName  = extractFromFieldData(fieldData, ['last_name'])  || body.apellido || '';

      const nombre   = fullName || firstName || '';
      const apellido = fullName ? '' : lastName;
      const email    = extractFromFieldData(fieldData, ['email']) || body.email || '';
      const telefono = extractFromFieldData(fieldData, ['phone_number','phone']) || body.telefono || body.phone_number || '';
      
      // Propiedad: use form_name or ad_name from body
      const propiedad = body.propiedad || body.form_name || body.ad_name || '';

      // Build respuestas from remaining field_data fields
      const respuestas = fieldData.length > 0
        ? buildRespuestas(fieldData)
        : (body.respuestas || {});

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

      // Log for debugging
      console.log('Lead received:', JSON.stringify(body).slice(0, 500));
      console.log('Lead parsed:', JSON.stringify(lead));

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
