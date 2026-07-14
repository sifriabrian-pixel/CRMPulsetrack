const https = require('https');
const { supabaseRequest } = require('./leadHelpers');

function sendEmail(to, subject, html) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return resolve({ skipped: true }); // Resend no configurado todavia: no-op silencioso.
    const payload = JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'Sifer CRM <onboarding@resend.dev>',
      to: [to],
      subject: subject,
      html: html
    });
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data: data }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Avisa por email al asesor que le acaban de asignar un lead. Nunca tira
// error hacia afuera: si falla (o Resend no esta configurado), simplemente
// no manda nada -- la asignacion en si ya quedo guardada antes de llamar a esto.
async function notifyAssignment(memberId, lead, env, authToken) {
  if (!memberId || !lead) return;
  const memberRes = await supabaseRequest('GET',
    `/members?id=eq.${memberId}&select=email,nombre`, null, env, authToken);
  const member = memberRes.data && memberRes.data[0];
  if (!member || !member.email) return;

  const nombreLead = `${lead.nombre || ''} ${lead.apellido || ''}`.trim();
  const propiedadTxt = lead.propiedad ? ` interesado en <strong>${lead.propiedad}</strong>` : '';
  await sendEmail(
    member.email,
    `Nuevo lead asignado: ${nombreLead}`,
    `<p>Hola ${member.nombre || ''},</p><p>Se te asignó el lead <strong>${nombreLead}</strong>${propiedadTxt}.</p>` +
    `<p>Entrá al CRM para verlo.</p>`
  );
}

module.exports = { notifyAssignment, sendEmail };
