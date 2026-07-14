const { supabaseRequest, buildLeadFromBody, findDuplicateLead } = require('./_lib/leadHelpers');
const { notifyAssignment } = require('./_lib/notify');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
  };

  // Forward the logged-in client's session token so Postgres RLS scopes every
  // query to their own leads. Without a valid token, RLS returns/accepts nothing.
  const authHeader = req.headers['authorization'] || '';
  const authToken = authHeader.replace(/^Bearer\s+/i, '') || null;

  // Extract ID from URL path /api/leads/:id
  const urlParts = (req.url || '').split('?')[0].split('/').filter(Boolean);
  const leadId = urlParts.length > 2 ? urlParts[urlParts.length - 1] : null;

  // GET: fetch all leads (RLS scopes to the caller's client)
  if (req.method === 'GET') {
    try {
      const result = await supabaseRequest('GET', '/leads?order=created_at.desc', null, env, authToken);
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
      await supabaseRequest('DELETE', `/leads?id=eq.${id}`, null, env, authToken);
      return res.status(200).json({ deleted: true, id });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST: create lead (manual add from the UI, scoped to the logged-in client)
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const lead = buildLeadFromBody(body);

      if (await findDuplicateLead(lead, env, authToken)) {
        return res.status(200).json({ skipped: true, reason: 'duplicate' });
      }

      const result = await supabaseRequest('POST', '/leads', lead, env, authToken);
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
      const isAssignment = Object.prototype.hasOwnProperty.call(updates, 'assigned_to');
      const result = await supabaseRequest('PATCH', `/leads?id=eq.${id}`, updates, env, authToken);

      if (isAssignment && updates.assigned_to) {
        try {
          const leadRes = await supabaseRequest('GET',
            `/leads?id=eq.${id}&select=nombre,apellido,propiedad&limit=1`, null, env, authToken);
          const lead = leadRes.data && leadRes.data[0];
          await notifyAssignment(updates.assigned_to, lead, env, authToken);
        } catch (notifyErr) { /* el email nunca debe romper la asignacion */ }
      }

      return res.status(200).json(result.data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Metodo no permitido' });
};
