import crypto from 'node:crypto';
import { LEAD_FIELDS } from './gemini.js';
import { postLeadRow, sendTelegram } from './notify.js';
import { buildResumeUrl } from './admin.js';
import { kvHGetAll, kvHSet } from './store.js';
import { PUBLIC_URL } from './config.js';
import { t } from './i18n.js';

const FIELD_ICONS = {
  name: '👤', phone: '📞', event_type: '💍', venue: '🏛️', area: '📍',
  event_date: '📅', guests: '👥', budget: '💰', notes: '📝'
};

/**
 * دمج البيانات الجديدة مع القديمة (القيمة الجديدة بتكسب لو مش فاضية)
 * @param {Object} oldLead
 * @param {Object} newLead
 */
export function mergeLead(oldLead, newLead) {
  const merged = { ...oldLead };
  for (const key of Object.keys(LEAD_FIELDS)) {
    const value = typeof newLead?.[key] === 'string' ? newLead[key].trim() : '';
    if (value && value.toLowerCase() !== 'null') merged[key] = value;
  }
  return merged;
}

/** الطلب مكتمل لما نعرف: المناسبة + التاريخ + المكان + رقم للتواصل */
export function isLeadComplete(lead) {
  return Boolean(lead.event_type && lead.event_date && (lead.area || lead.venue) && lead.phone);
}

/** بصمة للطلب عشان نعرف لو اتغير بعد ما اتبعت */
function leadHash(lead) {
  const stable = Object.keys(LEAD_FIELDS).map((key) => lead[key] || '').join('|');
  return crypto.createHash('sha1').update(stable).digest('hex');
}

/** @param {import('./memory.js').Session} session */
export function contactLink(session) {
  return session.channel === 'whatsapp' ? `https://wa.me/${session.userId}` : null;
}

export function conversationUrl(session) {
  return PUBLIC_URL
    ? `${PUBLIC_URL}/dashboard/b/${session.businessId}/c/${encodeURIComponent(session.userKey)}`
    : null;
}

function formatLead(lang, lead) {
  return Object.keys(LEAD_FIELDS)
    .filter((key) => lead[key])
    .map((key) => `${FIELD_ICONS[key]} ${t(lang, `lead.${key}`)}: ${lead[key]}`)
    .join('\n') || t(lang, 'notify.noDetails');
}

function nowLocal(timeZone) {
  const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, ...options }).format(new Date()).replace(',', '');
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', ...options }).format(new Date()).replace(',', '');
  }
}

/**
 * حفظ الطلب في لوحة التحكم + صف في الشيت
 * @param {import('./businesses.js').Business} business
 * @param {import('./memory.js').Session} session
 * @param {'newLead'|'updated'|'handoff'} status
 * @param {string} lastMessage
 */
async function recordLead(business, session, status, lastMessage) {
  const lang = business.profile.ownerLanguage;
  const row = {
    timestamp: nowLocal(business.profile.timezone),
    status: t(lang, `status.${status}`),
    channel: t(lang, `channel.${session.channel}`),
    user_id: session.userKey,
    contact_link: contactLink(session) || '',
    ...Object.fromEntries(Object.keys(LEAD_FIELDS).map((key) => [key, session.lead[key] || ''])),
    last_message: lastMessage
  };

  await Promise.all([
    kvHSet(`leads:${business.id}`, session.userKey, { ...row, statusKey: status, updatedAt: Date.now() }),
    postLeadRow(business, row)
  ]);
}

/**
 * الطلبات المحفوظة للبيزنس (الأحدث الأول)
 * @param {string} businessId
 */
export async function listLeads(businessId) {
  const all = Object.values(await kvHGetAll(`leads:${businessId}`));
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * يتنده بعد كل رد: لو الطلب اكتمل (أو اتعدل بعد ما اتبعت) يتبعت لصاحب البيزنس ويتحفظ
 * بيعدل session.leadSentHash
 * @param {import('./businesses.js').Business} business
 * @param {import('./memory.js').Session} session
 * @param {string} lastMessage
 */
export async function processLead(business, session, lastMessage) {
  const { lead } = session;
  if (!isLeadComplete(lead)) return;

  const hash = leadHash(lead);
  if (hash === session.leadSentHash) return;

  const isUpdate = Boolean(session.leadSentHash);
  session.leadSentHash = hash;

  const lang = business.profile.ownerLanguage;
  const link = contactLink(session);
  const dashboardLink = conversationUrl(session);

  await Promise.all([
    sendTelegram(business, [
      t(lang, isUpdate ? 'notify.updatedLead' : 'notify.newLead'),
      t(lang, 'notify.channel', { channel: t(lang, `channel.${session.channel}`) }),
      '',
      formatLead(lang, lead),
      '',
      t(lang, 'notify.lastMessage', { text: lastMessage.slice(0, 300) }),
      link ? `\n${t(lang, 'notify.contact', { link })}` : '',
      dashboardLink ? t(lang, 'notify.open', { link: dashboardLink }) : ''
    ].join('\n')),
    recordLead(business, session, isUpdate ? 'updated' : 'newLead', lastMessage)
  ]);
}

/**
 * العميل طلب يكلم موظف: نوقف البوت معاه ونبلغ صاحب البيزنس
 * بيعدل session.pausedUntil
 * @param {import('./businesses.js').Business} business
 * @param {import('./memory.js').Session} session
 * @param {string} lastMessage
 */
export async function processHandoff(business, session, lastMessage) {
  const hours = business.handoffPauseHours;
  session.pausedUntil = Date.now() + hours * 60 * 60 * 1000;

  const lang = business.profile.ownerLanguage;
  const link = contactLink(session);
  const dashboardLink = conversationUrl(session);
  const resumeUrl = buildResumeUrl(session.userKey);

  await Promise.all([
    sendTelegram(business, [
      t(lang, 'notify.handoff'),
      t(lang, 'notify.channel', { channel: t(lang, `channel.${session.channel}`) }),
      '',
      formatLead(lang, session.lead),
      '',
      t(lang, 'notify.lastMessage', { text: lastMessage.slice(0, 300) }),
      '',
      link ? t(lang, 'notify.contact', { link }) : t(lang, 'notify.contactInbox'),
      dashboardLink ? t(lang, 'notify.open', { link: dashboardLink }) : '',
      '',
      t(lang, 'notify.paused', { hours }),
      resumeUrl ? t(lang, 'notify.resume', { link: resumeUrl }) : ''
    ].join('\n')),
    recordLead(business, session, 'handoff', lastMessage)
  ]);
}
