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

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
  };

  // GET: obtener todos los leads
  if (req.method === 'GET') {
    try {
      const result = await supabaseRequest('GET', '/leads?order=created_at.desc', null, env);
      return res.status(200).json(result.data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST: crear nuevo lead (viene desde Make/webhook)
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const d = new Date();
      const fecha = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

      const lead = {
        nombre:     body.nombre     || body.first_name  || '',
        apellido:   body.apellido   || body.last_name   || '',
        email:      body.email      || '',
        telefono:   body.telefono   || body.phone       || '',
        propiedad:  body.propiedad  || body.property    || '',
        stage:      body.stage      || 'Nuevo',
        fecha:      body.fecha      || fecha,
        notas:      '',
        respuestas: body.respuestas || body.answers     || {}
      };

      const result = await supabaseRequest('POST', '/leads', lead, env);
      return res.status(201).json(result.data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // PATCH: actualizar un lead (stage, notas)
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
