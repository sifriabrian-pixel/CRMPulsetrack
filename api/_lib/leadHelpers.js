const https = require('https');

function supabaseRequest(method, path, body, env, authToken) {
  return new Promise((resolve, reject) => {
    const url = new URL(env.SUPABASE_URL);
    const options = {
      hostname: url.hostname,
      path: `/rest/v1${path}`,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${authToken || env.SUPABASE_ANON_KEY}`,
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

const QUESTION_LABELS = {
  'respuesta_1': '¿Ya estás viendo propiedades para comprar activamente?',
  'respuesta_2': '¿Cuál es tu situación de compra hoy?',
  'respuesta_3': '¿Estás buscando comprar dentro de los próximos días/semanas?'
};

function buildLeadFromBody(body) {
  const d = new Date();
  const fecha = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

  const nombre    = body.nombre   || '';
  const apellido  = body.apellido || '';
  const email     = body.email    || '';
  const telefono  = body.telefono || '';
  const propiedad = body.propiedad || '';

  const respuestas = {};
  Object.entries(QUESTION_LABELS).forEach(([key, label]) => {
    if (body[key] && String(body[key]).trim()) {
      respuestas[label] = cleanMetaValue(body[key]);
    }
  });

  return { nombre, apellido, email, telefono, propiedad,
    stage: body.stage || 'Nuevo', fecha, notas: '', respuestas };
}

async function findDuplicateLead(lead, env, authToken, clientId) {
  const clientFilter = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '';
  if (lead.email && lead.email !== '(sin email)') {
    const existing = await supabaseRequest('GET',
      `/leads?email=eq.${encodeURIComponent(lead.email)}${clientFilter}&limit=1`, null, env, authToken);
    return existing.data && Array.isArray(existing.data) && existing.data.length > 0;
  } else if (lead.nombre && lead.telefono) {
    const existing = await supabaseRequest('GET',
      `/leads?nombre=eq.${encodeURIComponent(lead.nombre)}&telefono=eq.${encodeURIComponent(lead.telefono)}${clientFilter}&limit=1`, null, env, authToken);
    return existing.data && Array.isArray(existing.data) && existing.data.length > 0;
  }
  return false;
}

module.exports = { supabaseRequest, cleanMetaValue, buildLeadFromBody, findDuplicateLead };
