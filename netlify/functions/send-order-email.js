// Sends the order confirmation email through Mailgun.
// It re-reads the order from Supabase using the customer's own login token,
// so nobody can trigger emails for orders that are not theirs.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const naira = n => '₦' + Number(n).toLocaleString('en-NG');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const { SUPABASE_URL, SUPABASE_ANON_KEY, MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_FROM, MAILGUN_REGION } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !MAILGUN_API_KEY || !MAILGUN_DOMAIN)
    return { statusCode: 500, body: 'Server is missing environment variables' };

  const token = (event.headers.authorization || '').replace(/^Bearer /i, '');
  let orderId;
  try { orderId = JSON.parse(event.body || '{}').order_id; } catch (e) {}
  if (!token || !/^[0-9a-f-]{36}$/i.test(orderId || '')) return { statusCode: 400, body: 'Bad request' };

  const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=*,order_items(*)`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  const rows = r.ok ? await r.json() : [];
  const o = rows[0];
  if (!o) return { statusCode: 404, body: 'Order not found' };

  const items = o.order_items.map(i =>
    `<tr><td style="padding:6px 0">${esc(i.name)} × ${i.quantity}</td><td align="right">${naira(i.price * i.quantity)}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#2a1a22">
    <h2 style="color:#7a2e4d">Thank you for your order, ${esc(o.full_name)}!</h2>
    <p>We have received your order <b>#${esc(o.id.slice(0, 8).toUpperCase())}</b>.</p>
    <table width="100%" style="border-collapse:collapse;border-top:1px solid #eee">${items}
    <tr><td style="padding-top:10px;border-top:1px solid #eee"><b>Total</b></td><td align="right" style="border-top:1px solid #eee;padding-top:10px"><b>${naira(o.total)}</b></td></tr></table>
    <p><b>Delivery to:</b><br>${esc(o.address)}, ${esc(o.city)}, ${esc(o.state)}<br>${esc(o.phone)}</p>
    <p style="color:#888;font-size:12px">Glowra is a demo store created for a class project.</p></div>`;

  const base = MAILGUN_REGION === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
  const form = new URLSearchParams({
    from: MAILGUN_FROM || `Glowra <postmaster@${MAILGUN_DOMAIN}>`,
    to: o.email, subject: `Your Glowra order #${o.id.slice(0, 8).toUpperCase()}`, html
  });
  const m = await fetch(`${base}/v3/${MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from('api:' + MAILGUN_API_KEY).toString('base64') },
    body: form
  });
  return { statusCode: m.ok ? 200 : 502, body: m.ok ? 'sent' : await m.text() };
};
