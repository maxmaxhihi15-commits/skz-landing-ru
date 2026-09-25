// Vercel Serverless Function: приймає заявку з форми і пересилає її далі.
//
// Куди відправляти — налаштовується змінними оточення у Vercel
// (Project → Settings → Environment Variables):
//
//   NETHUNT_WEBHOOK_URL  — адреса вебхука NetHunt (https://nethunt.com/service/automation/hooks/…)
//   NETHUNT_AUTH         — значення заголовка Authorization повністю, напр. "Basic XXXX…"
//                          (секрет! не зберігати в коді / GitHub)
//   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID — (необов'язково) дубль заявки в Telegram

const MAX_LEN = 300;

// Значення за замовчуванням для статичних полів CRM (якщо форма їх не передала)
const DEFAULT_SOURCE = 'Заявка на консультацію (СКЗ новий - Google)';
const DEFAULT_LEADNAME = 'Заявка на безкоштовну консультацію: СКЗ новий - Гугл пошук';

function clean(v) {
  return String(v == null ? '' : v).trim().slice(0, MAX_LEN);
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// Адреса сторінки без параметрів (?utm_…, gclid) і якорів: https://домен/шлях
function cleanUrl(u) {
  try { const x = new URL(u); return x.origin + x.pathname; } catch (e) { return u.split(/[?#]/)[0]; }
}

// Тіло запиту — ті самі ключі, що в налаштуваннях вебхука Creatium → NetHunt
function nethuntBody(lead) {
  const t = lead.tracking;
  return {
    name: lead.name,
    email: '',
    phone: lead.phone.replace(/\D/g, ''), // тільки цифри, без «+»: 380959782201
    nameform: lead.leadname,             // → поле leadname
    source: lead.source,                 // → поле source
    additionally: lead.form,             // «Назва форми»
    sitename: cleanUrl(lead.page),       // «Адреса сторінки» — без UTM-міток і параметрів
    utm_source: t.utm_source || '',
    utm_medium: t.utm_medium || '',
    utm_campaign: t.utm_campaign || '',
    utm_content: t.utm_content || '',
    utm_term: t.utm_term || '',
    gclid: t.gclid || '',
    FBclid: t.fbclid || '',
    'Ніша': t.nisha || '',
    'Lead Token': t.lead_token || '',
  };
}

async function sendNethunt(lead) {
  const url = process.env.NETHUNT_WEBHOOK_URL;
  if (!url) return null;

  const headers = {
    Accept: 'application/json',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Content-Type': 'application/json',
  };
  if (process.env.NETHUNT_AUTH) headers.Authorization = process.env.NETHUNT_AUTH;

  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(nethuntBody(lead)) });
  if (!r.ok) throw new Error(`NetHunt ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return true;
}

async function sendTelegram(lead) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;

  const t = lead.tracking;
  const lines = [
    `<b>Нова заявка</b> — ${escapeHtml(lead.form)}`,
    `Ім'я: ${escapeHtml(lead.name)}`,
    `Телефон: ${escapeHtml(lead.phone)}`,
    `Сторінка: ${escapeHtml(lead.page)}`,
  ];
  const trackLine = Object.keys(t).map((k) => `${k}=${t[k]}`).join(', ');
  if (trackLine) lines.push(`Джерело: ${escapeHtml(trackLine)}`);

  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error(`Telegram ${r.status}: ${await r.text()}`);
  return true;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }

  // Honeypot: боти заповнюють приховане поле — вдаємо успіх і нічого не шлемо
  if (clean(body.website)) return res.status(200).json({ ok: true });

  const tracking = {};
  if (body.tracking && typeof body.tracking === 'object') {
    for (const [k, v] of Object.entries(body.tracking).slice(0, 16)) tracking[clean(k)] = clean(v);
  }

  const lead = {
    name: clean(body.name),
    phone: clean(body.phone),
    form: clean(body.form) || 'Заявка з лендінгу',
    source: clean(body.source) || DEFAULT_SOURCE,
    leadname: clean(body.leadname) || DEFAULT_LEADNAME,
    page: clean(body.page),
    referrer: clean(body.referrer),
    tracking,
    createdAt: new Date().toISOString(),
  };

  if (!lead.name || lead.phone.replace(/\D/g, '').length < 10) {
    return res.status(400).json({ ok: false, error: 'Invalid name or phone' });
  }

  const results = await Promise.allSettled([sendNethunt(lead), sendTelegram(lead)]);
  const delivered = results.some((r) => r.status === 'fulfilled' && r.value === true);
  results.filter((r) => r.status === 'rejected').forEach((r) => console.error('[lead] delivery failed:', r.reason));

  if (!delivered) {
    console.error('[lead] not delivered (no destination configured or all failed):', lead);
    return res.status(502).json({ ok: false, error: 'Lead was not delivered' });
  }
  return res.status(200).json({ ok: true });
};

