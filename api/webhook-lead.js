const { supabaseRequest, buildLeadFromBody, findExistingLead, mergeLeadUpdates } = require('./_lib/leadHelpers');

// Server-to-server ingest endpoint (Meta Ads via Make.com, future WhatsApp bots, etc).
// No browser session exists here, so it authenticates via a per-client static
// token in the URL and uses the service_role key (bypasses RLS) for the insert.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido' });
  }

  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
  };
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const urlParts = (req.url || '').split('?')[0].split('/').filter(Boolean);
  const token = urlParts[urlParts.length - 1];
  if (!token) return res.status(401).json({ error: 'token requerido' });

  try {
    const clientLookup = await supabaseRequest('GET',
      `/clients?webhook_token=eq.${encodeURIComponent(token)}&select=id&limit=1`, null, env, serviceKey);
    const client = Array.isArray(clientLookup.data) && clientLookup.data[0];
    if (!client) {
      return res.status(401).json({
        error: 'token invalido',
        debug: { hasServiceKey: !!serviceKey }
      });
    }

    const body = req.body || {};
    const lead = buildLeadFromBody(body);

    // Un bot de WhatsApp puede mandar el mismo contacto varias veces a medida
    // que la conversación avanza (primero nombre+telefono, despues las
    // respuestas de calificacion). Si ya existe, se completa en vez de crear
    // un lead duplicado o descartar la info nueva.
    const existing = await findExistingLead(lead, env, serviceKey, client.id);
    if (existing) {
      const updates = mergeLeadUpdates(existing, lead);
      if (Object.keys(updates).length === 0) {
        return res.status(200).json({ updated: false, id: existing.id });
      }
      const result = await supabaseRequest('PATCH', `/leads?id=eq.${existing.id}`, updates, env, serviceKey);
      return res.status(200).json({ updated: true, id: existing.id, data: result.data });
    }

    lead.client_id = client.id;
    const result = await supabaseRequest('POST', '/leads', lead, env, serviceKey);
    return res.status(201).json(result.data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
