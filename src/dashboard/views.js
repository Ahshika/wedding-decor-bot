import { LANGUAGES, t } from '../i18n.js';
import { LEAD_FIELDS } from '../gemini.js';

/**
 * صفحات لوحة التحكم (HTML من السيرفر، من غير أي framework)
 */

/** تأمين النص قبل ما يتحط في HTML */
export function h(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const LEAD_KEYS = Object.keys(LEAD_FIELDS);

function formatTime(lang, ts, timeZone) {
  if (!ts) return t(lang, 'common.never');
  const options = { dateStyle: 'medium', timeStyle: 'short' };
  const locale = lang === 'ar' ? 'ar-EG' : 'en-GB';
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(new Date(ts));
  } catch {
    return new Intl.DateTimeFormat(locale, options).format(new Date(ts));
  }
}

function timeAgo(lang, ts) {
  const minutes = Math.floor((Date.now() - ts) / 60000);
  if (minutes < 1) return t(lang, 'common.justNow');
  if (minutes < 60) return t(lang, 'common.minutesAgo', { n: minutes });
  if (minutes < 60 * 24) return t(lang, 'common.hoursAgo', { n: Math.floor(minutes / 60) });
  return t(lang, 'common.daysAgo', { n: Math.floor(minutes / 60 / 24) });
}

const CSS = `
:root {
  --bg: #faf7f5; --surface: #ffffff; --surface-2: #f3eeea; --border: #e7dfd9;
  --text: #2a2321; --muted: #7a6e69; --accent: #b4235a; --accent-soft: #fbe7ef;
  --ok: #1f7a4d; --ok-soft: #e3f4ea; --warn: #9a5b00; --warn-soft: #fff2d9; --danger: #b42318;
  --bubble-user: #f3eeea; --bubble-bot: #fbe7ef; --bubble-human: #e3effb;
  --radius: 12px; --shadow: 0 1px 2px rgba(42,35,33,.06), 0 4px 16px rgba(42,35,33,.05);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #171312; --surface: #211b19; --surface-2: #2b2422; --border: #3a312e;
    --text: #f3ece9; --muted: #a99d98; --accent: #f06a9b; --accent-soft: #3b1f2a;
    --ok: #5fd39a; --ok-soft: #173326; --warn: #f2b45a; --warn-soft: #3a2c14; --danger: #ff7a6e;
    --bubble-user: #2b2422; --bubble-bot: #3b1f2a; --bubble-human: #1d2c3d;
    --shadow: none;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.6 system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
header.top { background: var(--surface); border-bottom: 1px solid var(--border); }
.top-inner { max-width: 1100px; margin: 0 auto; padding: 10px 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.brand { font-weight: 700; color: var(--text); }
.brand small { color: var(--muted); font-weight: 400; }
nav.tabs { display: flex; gap: 4px; flex-wrap: wrap; }
nav.tabs a { padding: 6px 12px; border-radius: 999px; color: var(--muted); }
nav.tabs a.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.spacer { flex: 1; }
.top-actions { display: flex; gap: 8px; align-items: center; font-size: 14px; }
main { max-width: 1100px; margin: 0 auto; padding: 20px 16px 60px; }
h1 { font-size: 22px; margin: 0 0 16px; }
h2 { font-size: 17px; margin: 0 0 12px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px; box-shadow: var(--shadow); margin-bottom: 16px; }
.banner { padding: 10px 14px; border-radius: var(--radius); margin-bottom: 16px; }
.banner.warn { background: var(--warn-soft); color: var(--warn); }
.banner.ok { background: var(--ok-soft); color: var(--ok); }
.banner.error { background: var(--accent-soft); color: var(--danger); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
.stat { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; }
.stat b { display: block; font-size: 26px; line-height: 1.2; }
.stat span { color: var(--muted); font-size: 13px; }
.list { list-style: none; margin: 0; padding: 0; }
.list li { border-top: 1px solid var(--border); }
.list li:first-child { border-top: 0; }
.list a.row { display: flex; gap: 12px; padding: 12px 4px; color: inherit; align-items: center; }
.list a.row:hover { background: var(--surface-2); text-decoration: none; }
.avatar { width: 38px; height: 38px; flex: none; border-radius: 50%; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; font-weight: 700; }
.row-main { flex: 1; min-width: 0; }
.row-title { font-weight: 600; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.row-sub { color: var(--muted); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row-time { color: var(--muted); font-size: 12px; white-space: nowrap; }
.badge { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px; background: var(--surface-2); color: var(--muted); }
.badge.ok { background: var(--ok-soft); color: var(--ok); }
.badge.warn { background: var(--warn-soft); color: var(--warn); }
.badge.accent { background: var(--accent-soft); color: var(--accent); }
.grid-2 { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 800px) { .grid-2 { grid-template-columns: 1fr; } }
.chat { display: flex; flex-direction: column; gap: 8px; max-height: 65vh; overflow-y: auto; padding: 4px; }
.bubble { max-width: 80%; padding: 8px 12px; border-radius: 14px; white-space: pre-wrap; word-wrap: break-word; }
.bubble.user { align-self: flex-start; background: var(--bubble-user); }
.bubble.bot { align-self: flex-end; background: var(--bubble-bot); }
.bubble.human { align-self: flex-end; background: var(--bubble-human); }
.bubble small { display: block; color: var(--muted); font-size: 11px; margin-top: 2px; }
dl.lead { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; }
dl.lead dt { color: var(--muted); }
dl.lead dd { margin: 0; word-break: break-word; }
form.stack { display: grid; gap: 14px; }
label { display: grid; gap: 4px; font-weight: 600; font-size: 14px; }
label .hint, .hint { font-weight: 400; color: var(--muted); font-size: 12px; }
label.check { display: flex; gap: 8px; align-items: center; }
input[type=text], input[type=password], input[type=number], select, textarea {
  width: 100%; padding: 9px 11px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--surface); color: var(--text); font: inherit; font-weight: 400;
}
textarea { min-height: 90px; resize: vertical; }
input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: transparent; }
.fields-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
button, .button {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 16px;
  border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer;
}
button.secondary { background: var(--surface-2); color: var(--text); }
button.danger { background: var(--danger); }
button.link { background: none; color: var(--accent); padding: 0; font-weight: 400; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
fieldset { border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; margin: 0; display: grid; gap: 12px; }
legend { font-weight: 700; padding: 0 6px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: start; vertical-align: top; }
th { color: var(--muted); font-weight: 600; white-space: nowrap; }
code { background: var(--surface-2); padding: 1px 6px; border-radius: 6px; font-size: 13px; word-break: break-all; }
.center-card { max-width: 400px; margin: 10vh auto; }
.sticky-save { position: sticky; bottom: 0; background: var(--bg); padding: 12px 0; border-top: 1px solid var(--border); }
`;

/**
 * الهيكل المشترك لكل الصفحات
 * @param {Object} options
 * @param {'ar'|'en'} options.lang
 * @param {string} options.title
 * @param {string} options.body
 * @param {import('./auth.js').DashboardUser} [options.user]
 * @param {import('../businesses.js').Business} [options.business]
 * @param {'conversations'|'leads'|'settings'|'businesses'} [options.active]
 * @param {string} [options.path] - مسار الصفحة الحالية (عشان تغيير اللغة يرجع لنفس الصفحة)
 * @param {boolean} [options.persistent]
 */
export function layout({ lang, title, body, user, business, active, path = '/dashboard', persistent = true }) {
  const tab = (key, href) => `<a href="${href}" class="${active === key ? 'active' : ''}">${t(lang, `nav.${key}`)}</a>`;
  const otherLang = lang === 'ar' ? 'en' : 'ar';

  const nav = user ? `
    <nav class="tabs">
      ${user.role === 'admin' ? tab('businesses', '/dashboard') : ''}
      ${business ? tab('conversations', `/dashboard/b/${business.id}`) + tab('leads', `/dashboard/b/${business.id}/leads`) + tab('settings', `/dashboard/b/${business.id}/settings`) : ''}
    </nav>` : '';

  return `<!doctype html>
<html lang="${lang}" dir="${t(lang, 'dir')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${h(title)} · ${t(lang, 'appName')}</title>
<style>${CSS}</style>
</head>
<body>
<header class="top"><div class="top-inner">
  <span class="brand">🌸 ${t(lang, 'appName')}${business ? ` <small>· ${h(business.name)}</small>` : ''}</span>
  ${nav}
  <span class="spacer"></span>
  <span class="top-actions">
    <a href="/dashboard/lang/${otherLang}?next=${encodeURIComponent(path)}">${LANGUAGES[otherLang]}</a>
    ${user ? `<form method="post" action="/dashboard/logout"><button class="link" type="submit">${t(lang, 'nav.logout')}</button></form>` : ''}
  </span>
</div></header>
<main>
${user && !persistent ? `<div class="banner warn">${t(lang, 'common.notPersistent')}</div>` : ''}
${body}
</main>
</body>
</html>`;
}

export function messagePage(lang, text, user) {
  return layout({ lang, title: text, user, body: `<div class="card center-card"><p>${h(text)}</p><a href="/dashboard">←</a></div>` });
}

export function loginPage({ lang, error, disabled }) {
  const body = disabled
    ? `<div class="card center-card"><p>${t(lang, 'login.disabled')}</p></div>`
    : `<div class="card center-card">
        <h1>${t(lang, 'login.title')}</h1>
        ${error ? `<div class="banner error">${h(error)}</div>` : ''}
        <form method="post" action="/dashboard/login" class="stack">
          <label>${t(lang, 'login.businessId')}
            <input type="text" name="businessId" autocomplete="username" autocapitalize="none" spellcheck="false">
            <span class="hint">${t(lang, 'login.businessIdHint')}</span>
          </label>
          <label>${t(lang, 'login.password')}
            <input type="password" name="password" autocomplete="current-password" required>
          </label>
          <button type="submit">${t(lang, 'login.submit')}</button>
        </form>
      </div>`;
  return layout({ lang, title: t(lang, 'login.title'), body, path: '/dashboard/login' });
}

/**
 * صفحة كل البيزنسات (للأدمن)
 * @param {Object} options
 * @param {Array<{business: import('../businesses.js').Business, conversations: number, leads: number}>} options.rows
 */
export function businessesPage({ lang, user, rows, error, persistent }) {
  const body = `
    <h1>${t(lang, 'biz.title')}</h1>
    <div class="card">
      <ul class="list">
        ${rows.map(({ business, conversations, leads }) => `
          <li><a class="row" href="/dashboard/b/${h(business.id)}">
            <span class="avatar">${h(Array.from(business.name || business.id)[0] || '?')}</span>
            <span class="row-main">
              <span class="row-title">${h(business.name || business.id)}
                <span class="badge ${business.active ? 'ok' : 'warn'}">${t(lang, business.active ? 'biz.active' : 'biz.inactive')}</span>
              </span>
              <span class="row-sub"><code>${h(business.id)}</code> · ${conversations} ${t(lang, 'conv.stats.conversations')} · ${leads} ${t(lang, 'conv.stats.leads')}
                · ${[business.channels.messengerPageId || business.useEnvDefaults ? t(lang, 'channel.messenger') : '', business.channels.whatsappPhoneNumberId || business.useEnvDefaults ? t(lang, 'channel.whatsapp') : ''].filter(Boolean).join(' + ') || '—'}
              </span>
            </span>
          </a></li>`).join('')}
      </ul>
    </div>
    <div class="card">
      <h2>${t(lang, 'biz.new')}</h2>
      ${error ? `<div class="banner error">${h(error)}</div>` : ''}
      <form method="post" action="/dashboard/businesses" class="fields-2">
        <label>${t(lang, 'biz.id')}<input type="text" name="id" required pattern="[a-z0-9][a-z0-9-]{1,39}" autocapitalize="none" spellcheck="false" placeholder="my-decor"></label>
        <label>${t(lang, 'biz.name')}<input type="text" name="name" required maxlength="100"></label>
        <div class="actions"><button type="submit">${t(lang, 'biz.create')}</button></div>
      </form>
    </div>`;
  return layout({ lang, title: t(lang, 'biz.title'), body, user, active: 'businesses', persistent });
}

/**
 * قايمة المحادثات + الإحصائيات
 */
export function conversationsPage({ lang, user, business, conversations, persistent }) {
  const now = Date.now();
  const stats = [
    [conversations.length, 'conv.stats.conversations'],
    [conversations.filter((c) => c.leadComplete).length, 'conv.stats.leads'],
    [conversations.filter((c) => c.pausedUntil && c.pausedUntil > now).length, 'conv.stats.paused'],
    [conversations.filter((c) => now - c.updatedAt < 24 * 60 * 60 * 1000).length, 'conv.stats.today']
  ];

  const body = `
    <h1>${t(lang, 'conv.title')}</h1>
    <div class="stats">${stats.map(([n, key]) => `<div class="stat"><b>${n}</b><span>${t(lang, key)}</span></div>`).join('')}</div>
    <div class="card">
      ${conversations.length ? `<ul class="list">
        ${conversations.map((c) => {
          const title = c.name || c.phone || `${t(lang, 'conv.unknown')} ${c.userId.slice(-4)}`;
          return `<li><a class="row" href="/dashboard/b/${h(business.id)}/c/${encodeURIComponent(c.userKey)}">
            <span class="avatar">${h(Array.from(title)[0])}</span>
            <span class="row-main">
              <span class="row-title"><bdi>${h(title)}</bdi>
                <span class="badge">${t(lang, `channel.${c.channel}`)}</span>
                ${c.eventType ? `<span class="badge accent">${h(c.eventType)}</span>` : ''}
                ${c.leadComplete ? `<span class="badge ok">${t(lang, 'conv.leadComplete')}</span>` : ''}
                ${c.pausedUntil && c.pausedUntil > now ? `<span class="badge warn">${t(lang, 'conv.paused')}</span>` : ''}
              </span>
              <span class="row-sub">${c.lastRole === 'model' ? '↩ ' : ''}${h(c.lastMessage)}</span>
            </span>
            <span class="row-time">${timeAgo(lang, c.updatedAt)}</span>
          </a></li>`;
        }).join('')}
      </ul>` : `<p class="hint">${t(lang, 'common.empty')}</p>`}
    </div>`;
  return layout({ lang, title: t(lang, 'conv.title'), body, user, business, active: 'conversations', path: `/dashboard/b/${business.id}`, persistent });
}

/**
 * محادثة واحدة: الرسايل + بيانات الطلب + التحكم في البوت + الرد
 * @param {Object} options
 * @param {import('../memory.js').Session} options.session
 */
export function conversationPage({ lang, user, business, session, flash, persistent }) {
  const tz = business.profile.timezone;
  const base = `/dashboard/b/${business.id}/c/${encodeURIComponent(session.userKey)}`;
  const paused = session.pausedUntil && session.pausedUntil > Date.now();
  const title = session.lead.name || session.lead.phone || `${t(lang, 'conv.unknown')} ${session.userId.slice(-4)}`;

  const bubbles = session.history.map((m) => {
    const kind = m.role === 'user' ? 'user' : m.by === 'human' ? 'human' : 'bot';
    return `<div class="bubble ${kind}">${h(m.text)}<small>${t(lang, `conv.from.${kind}`)} · ${formatTime(lang, m.ts, tz)}</small></div>`;
  }).join('');

  const body = `
    <h1><bdi>${h(title)}</bdi> <span class="badge">${t(lang, `channel.${session.channel}`)}</span></h1>
    ${flash ? `<div class="banner ${flash.type}">${h(flash.text)}</div>` : ''}
    <div class="grid-2">
      <div>
        <div class="card"><div class="chat" id="chat">${bubbles || `<p class="hint">${t(lang, 'common.empty')}</p>`}</div></div>
        <div class="card">
          <h2>${t(lang, 'conv.reply')}</h2>
          <form method="post" action="${base}/reply" class="stack">
            <textarea name="text" required maxlength="2000" placeholder="${h(t(lang, 'conv.replyPlaceholder'))}"></textarea>
            <div class="actions"><button type="submit">${t(lang, 'conv.send')}</button><span class="hint">${t(lang, 'conv.window')}</span></div>
          </form>
        </div>
      </div>
      <div>
        <div class="card">
          <p>${paused ? t(lang, 'conv.botPaused', { time: h(formatTime(lang, session.pausedUntil, tz)) }) : t(lang, 'conv.botActive')}</p>
          <form method="post" action="${base}/${paused ? 'resume' : 'pause'}">
            <button type="submit" class="${paused ? '' : 'secondary'}">${t(lang, paused ? 'conv.resume' : 'conv.pause')}</button>
          </form>
        </div>
        <div class="card">
          <h2>${t(lang, 'conv.leadData')}</h2>
          <dl class="lead">
            ${LEAD_KEYS.filter((key) => session.lead[key]).map((key) => `<dt>${t(lang, `lead.${key}`)}</dt><dd><bdi>${h(session.lead[key])}</bdi></dd>`).join('') || `<dd class="hint">${t(lang, 'notify.noDetails')}</dd>`}
          </dl>
          ${session.channel === 'whatsapp' ? `<p><a href="https://wa.me/${h(session.userId)}" target="_blank" rel="noopener">${t(lang, 'conv.openWhatsApp')} ↗</a></p>` : ''}
        </div>
      </div>
    </div>
    <script>const c=document.getElementById('chat');if(c)c.scrollTop=c.scrollHeight;</script>`;
  return layout({ lang, title, body, user, business, active: 'conversations', path: base, persistent });
}

/** جدول الطلبات */
export function leadsPage({ lang, user, business, leads, persistent }) {
  const body = `
    <div class="actions" style="justify-content: space-between; margin-bottom: 16px;">
      <h1 style="margin: 0;">${t(lang, 'leads.title')}</h1>
      ${leads.length ? `<a class="button" href="/dashboard/b/${h(business.id)}/leads.csv">${t(lang, 'leads.export')}</a>` : ''}
    </div>
    <div class="card">
      ${leads.length ? `<div class="table-wrap"><table>
        <thead><tr>
          <th>${t(lang, 'leads.updated')}</th><th>${t(lang, 'leads.status')}</th>
          ${['name', 'phone', 'event_type', 'event_date', 'venue', 'area', 'guests', 'budget'].map((key) => `<th>${t(lang, `lead.${key}`)}</th>`).join('')}
          <th></th>
        </tr></thead>
        <tbody>
          ${leads.map((lead) => `<tr>
            <td>${h(lead.timestamp)}</td>
            <td><span class="badge ${lead.statusKey === 'handoff' ? 'warn' : 'ok'}">${t(lang, `status.${lead.statusKey}`)}</span></td>
            ${['name', 'phone', 'event_type', 'event_date', 'venue', 'area', 'guests', 'budget'].map((key) => `<td><bdi>${h(lead[key])}</bdi></td>`).join('')}
            <td><a href="/dashboard/b/${h(business.id)}/c/${encodeURIComponent(lead.user_id)}">→</a></td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : `<p class="hint">${t(lang, 'common.empty')}</p>`}
    </div>`;
  return layout({ lang, title: t(lang, 'leads.title'), body, user, business, active: 'leads', path: `/dashboard/b/${business.id}/leads`, persistent });
}

/**
 * خانة سر (توكن / باسورد): مش بنعرض القيمة المحفوظة أبداً
 */
function secretField(lang, business, name, label, value, envName) {
  let hint = value ? t(lang, 'set.secretSaved') : t(lang, 'set.secretEmpty');
  if (!value && business.useEnvDefaults && envName) {
    hint = t(lang, 'set.secretEnv', { status: t(lang, process.env[envName] ? 'set.envSet' : 'set.envMissing') });
  }
  return `<label>${label}
    <input type="password" name="${name}" autocomplete="new-password" spellcheck="false">
    <span class="hint">${hint}</span>
  </label>`;
}

function textField(name, label, value, { hint = '', type = 'text', extra = '' } = {}) {
  return `<label>${label}
    <input type="${type}" name="${name}" value="${h(value)}" ${extra}>
    ${hint ? `<span class="hint">${hint}</span>` : ''}
  </label>`;
}

function categoryFieldset(lang, index, category = {}) {
  const prefix = `catalog[${index}]`;
  const isNew = !category.id;
  return `<fieldset>
    <legend>${isNew ? t(lang, 'set.cat.new') : h(category.title)}</legend>
    <div class="fields-2">
      ${textField(`${prefix}[id]`, t(lang, 'set.cat.id'), category.id, { extra: 'pattern="[a-z0-9_-]{1,40}" autocapitalize="none" spellcheck="false"' })}
      ${textField(`${prefix}[title]`, t(lang, 'set.cat.title'), category.title)}
      ${textField(`${prefix}[description]`, t(lang, 'set.cat.description'), category.description)}
      ${textField(`${prefix}[priceFrom]`, t(lang, 'set.cat.priceFrom'), category.priceFrom)}
    </div>
    <label>${t(lang, 'set.cat.images')}<textarea name="${prefix}[images]" spellcheck="false" dir="ltr">${h((category.images || []).join('\n'))}</textarea></label>
    ${isNew ? '' : `<label class="check"><input type="checkbox" name="${prefix}[remove]" value="1"> ${t(lang, 'set.cat.remove')}</label>`}
  </fieldset>`;
}

/**
 * صفحة الإعدادات
 * @param {Object} options
 * @param {import('../businesses.js').Business} options.business
 * @param {import('../businesses.js').CatalogCategory[]} options.catalog
 * @param {string} options.webhookUrl
 * @param {string[]} [options.errors]
 * @param {boolean} [options.saved]
 */
export function settingsPage({ lang, user, business, catalog, webhookUrl, errors = [], saved, persistent }) {
  const p = business.profile;
  const base = `/dashboard/b/${business.id}/settings`;

  const body = `
    <h1>${t(lang, 'set.title')}</h1>
    ${saved ? `<div class="banner ok">${t(lang, 'common.saved')}</div>` : ''}
    ${errors.map((error) => `<div class="banner error">${h(error)}</div>`).join('')}
    <form method="post" action="${base}" class="stack">

      <div class="card"><div class="stack">
        <h2>${t(lang, 'set.profile')}</h2>
        <div class="fields-2">
          ${textField('name', t(lang, 'set.name'), business.name, { extra: 'required maxlength="100"' })}
          <label class="check" style="align-self: end;"><input type="checkbox" name="active" value="1" ${business.active ? 'checked' : ''}> ${t(lang, 'set.active')}</label>
        </div>
        ${textField('profile[description]', t(lang, 'set.description'), p.description, { hint: t(lang, 'set.descriptionHint') })}
        <div class="fields-2">
          ${textField('profile[serviceArea]', t(lang, 'set.serviceArea'), p.serviceArea, { hint: t(lang, 'set.serviceAreaHint') })}
          ${textField('profile[defaultLanguage]', t(lang, 'set.defaultLanguage'), p.defaultLanguage, { hint: t(lang, 'set.defaultLanguageHint') })}
          ${textField('profile[currency]', t(lang, 'set.currency'), p.currency)}
          ${textField('profile[timezone]', t(lang, 'set.timezone'), p.timezone, { hint: t(lang, 'set.timezoneHint'), extra: 'dir="ltr"' })}
          <label>${t(lang, 'set.ownerLanguage')}
            <select name="profile[ownerLanguage]">
              ${Object.entries(LANGUAGES).map(([code, name]) => `<option value="${code}" ${p.ownerLanguage === code ? 'selected' : ''}>${name}</option>`).join('')}
            </select>
          </label>
          ${textField('handoffPauseHours', t(lang, 'set.handoffHours'), business.handoffPauseHours, { type: 'number', extra: 'min="1" max="168"' })}
        </div>
        <label>${t(lang, 'set.instructions')}
          <textarea name="profile[instructions]" rows="8" maxlength="8000">${h(p.instructions)}</textarea>
          <span class="hint">${t(lang, 'set.instructionsHint')}</span>
        </label>
        <label>${t(lang, 'set.faq')}
          <textarea name="profile[faq]" rows="5" maxlength="8000">${h(p.faq)}</textarea>
          <span class="hint">${t(lang, 'set.faqHint')}</span>
        </label>
      </div></div>

      <div class="card"><div class="stack">
        <h2>${t(lang, 'set.catalog')}</h2>
        <p class="hint">${t(lang, 'set.catalogHint')}</p>
        ${business.catalog === null ? `<div class="banner warn">${t(lang, 'set.catalogFromFile')}</div>` : ''}
        ${catalog.map((category, i) => categoryFieldset(lang, i, category)).join('')}
        ${categoryFieldset(lang, catalog.length)}
      </div></div>

      <div class="card"><div class="stack">
        <h2>${t(lang, 'set.channels')}</h2>
        <p class="hint">${t(lang, 'set.webhookInfo', { url: `<code>${h(webhookUrl)}</code>`, token: `<code>${h(process.env.VERIFY_TOKEN || '—')}</code>` })}</p>
        <div class="fields-2">
          ${textField('channels[messengerPageId]', t(lang, 'set.messengerPageId'), business.channels.messengerPageId, { extra: 'dir="ltr" inputmode="numeric"' })}
          ${secretField(lang, business, 'channels[messengerPageToken]', t(lang, 'set.messengerPageToken'), business.channels.messengerPageToken, 'PAGE_ACCESS_TOKEN')}
          ${textField('channels[whatsappPhoneNumberId]', t(lang, 'set.whatsappPhoneNumberId'), business.channels.whatsappPhoneNumberId, { extra: 'dir="ltr" inputmode="numeric"' })}
          ${secretField(lang, business, 'channels[whatsappToken]', t(lang, 'set.whatsappToken'), business.channels.whatsappToken, 'WHATSAPP_TOKEN')}
          ${secretField(lang, business, 'channels[appSecret]', t(lang, 'set.appSecret'), business.channels.appSecret, 'APP_SECRET')}
        </div>
      </div></div>

      <div class="card"><div class="stack">
        <h2>${t(lang, 'set.notifications')}</h2>
        <div class="fields-2">
          ${textField('notifications[telegramChatId]', t(lang, 'set.telegramChatId'), business.notifications.telegramChatId, { extra: 'dir="ltr"' })}
          ${secretField(lang, business, 'notifications[telegramBotToken]', t(lang, 'set.telegramBotToken'), business.notifications.telegramBotToken, 'TELEGRAM_BOT_TOKEN')}
          ${textField('notifications[leadsWebhookUrl]', t(lang, 'set.leadsWebhookUrl'), business.notifications.leadsWebhookUrl, { type: 'url', extra: 'dir="ltr"' })}
          ${secretField(lang, business, 'notifications[leadsWebhookSecret]', t(lang, 'set.leadsWebhookSecret'), business.notifications.leadsWebhookSecret, 'LEADS_WEBHOOK_SECRET')}
        </div>
      </div></div>

      <div class="card"><div class="stack">
        <h2>${t(lang, 'set.password')}</h2>
        <label><input type="password" name="password" autocomplete="new-password" minlength="8">
          <span class="hint">${t(lang, 'set.passwordHint', { id: h(business.id) })}</span>
        </label>
      </div></div>

      <div class="sticky-save"><button type="submit">${t(lang, 'common.save')}</button></div>
    </form>

    ${user.role === 'admin' ? `
    <div class="card" style="margin-top: 24px;">
      <h2>${t(lang, 'set.danger')}</h2>
      <form method="post" action="/dashboard/b/${h(business.id)}/delete" onsubmit="return confirm(${h(JSON.stringify(t(lang, 'set.deleteConfirm')))})">
        <button type="submit" class="danger">${t(lang, 'set.deleteBusiness')}</button>
      </form>
    </div>` : ''}`;

  return layout({ lang, title: t(lang, 'set.title'), body, user, business, active: 'settings', path: base, persistent });
}
