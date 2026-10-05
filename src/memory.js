import { kvGet, kvHDel, kvHGetAll, kvHSet, kvSet } from './store.js';

/**
 * جلسة كل عميل (سجل المحادثة + بيانات الطلب + حالة التحويل لموظف)
 * + فهرس المحادثات لكل بيزنس (للوحة التحكم) + منع تكرار الرسائل + طابور لكل عميل
 */

// البوت بيستخدم آخر N رسالة من آخر X ساعة كسياق
const MAX_HISTORY_MESSAGES = Number(process.env.MAX_HISTORY_MESSAGES) || 20;
const CONVERSATION_TTL_HOURS = Number(process.env.CONVERSATION_TTL_HOURS) || 24;
// المحادثة بتفضل محفوظة للوحة التحكم المدة دي
const HISTORY_RETENTION_DAYS = Number(process.env.HISTORY_RETENTION_DAYS) || 30;
const MAX_STORED_MESSAGES = 200;
const DEDUP_TTL_MS = 10 * 60 * 1000;

// messageId -> receivedAt (في الرام كفاية، لأن Meta بتعيد الإرسال خلال دقايق)
const seenMessages = new Map();
// userKey -> Promise (آخر مهمة في الطابور)
const userQueues = new Map();

/**
 * @typedef {Object} Customer
 * @property {string} userKey - `${businessId}:${fb|wa}:${userId}`
 * @property {string} businessId
 * @property {'messenger'|'whatsapp'} channel
 * @property {string} userId - PSID أو رقم الواتساب
 * @property {string} [phoneNumberId] - رقم الواتساب بتاع البيزنس (للرد من لوحة التحكم)
 */

/**
 * @typedef {Object} StoredMessage
 * @property {'user'|'model'} role
 * @property {string} text
 * @property {'bot'|'human'} [by] - رسايل البيزنس: من البوت ولا من موظف
 * @property {number} ts
 */

/**
 * @typedef {Object} Session
 * @property {string} userKey
 * @property {string} businessId
 * @property {'messenger'|'whatsapp'} channel
 * @property {string} userId
 * @property {string} [phoneNumberId]
 * @property {StoredMessage[]} history
 * @property {Object<string, string>} lead - بيانات الطلب اللي اتجمعت لحد دلوقتي
 * @property {string|null} leadSentHash - بصمة آخر نسخة من الطلب اتبعتت لصاحب المحل
 * @property {number|null} pausedUntil - البوت ساكت لحد الوقت ده (لأن موظف ماسك المحادثة)
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @param {string} businessId
 * @param {'messenger'|'whatsapp'} channel
 * @param {string} userId
 */
export function buildUserKey(businessId, channel, userId) {
  return `${businessId}:${channel === 'whatsapp' ? 'wa' : 'fb'}:${userId}`;
}

/**
 * جلب جلسة العميل (أو جلسة جديدة لو مفيش)
 * @param {Customer} customer
 * @returns {Promise<Session>}
 */
export async function getSession(customer) {
  const saved = await kvGet(`session:${customer.userKey}`);
  return {
    history: [],
    lead: {},
    leadSentHash: null,
    pausedUntil: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...saved,
    userKey: customer.userKey,
    businessId: customer.businessId,
    channel: customer.channel,
    userId: customer.userId,
    ...(customer.phoneNumberId && { phoneNumberId: customer.phoneNumberId })
  };
}

/**
 * جلب جلسة موجودة بالمفتاح بس (للوحة التحكم ولينك "رجّع البوت")
 * @param {string} userKey
 * @returns {Promise<Session|null>}
 */
export async function getSessionByKey(userKey) {
  return kvGet(`session:${userKey}`);
}

/**
 * حفظ الجلسة + تحديث فهرس محادثات البيزنس
 * @param {Session} session
 */
export async function saveSession(session) {
  session.updatedAt = Date.now();
  const ttlSeconds = Math.max(
    HISTORY_RETENTION_DAYS * 24 * 60 * 60,
    session.pausedUntil ? (session.pausedUntil - Date.now()) / 1000 : 0
  );
  await kvSet(`session:${session.userKey}`, session, ttlSeconds);

  const last = session.history.at(-1);
  await kvHSet(`convos:${session.businessId}`, session.userKey, {
    userKey: session.userKey,
    channel: session.channel,
    userId: session.userId,
    name: session.lead.name || '',
    phone: session.lead.phone || '',
    eventType: session.lead.event_type || '',
    lastMessage: last ? last.text.slice(0, 140) : '',
    lastRole: last?.role || '',
    messageCount: session.history.length,
    pausedUntil: session.pausedUntil,
    leadComplete: Boolean(session.leadSentHash),
    updatedAt: session.updatedAt
  });
}

/**
 * إضافة رسالة لسجل المحادثة (بيعدل الجلسة نفسها)
 * @param {Session} session
 * @param {'user'|'model'} role
 * @param {string} text
 * @param {'bot'|'human'} [by]
 */
export function appendMessage(session, role, text, by) {
  if (!text) return;
  session.history.push({ role, text, ...(by && { by }), ts: Date.now() });
  if (session.history.length > MAX_STORED_MESSAGES) {
    session.history = session.history.slice(-MAX_STORED_MESSAGES);
  }
}

/**
 * سجل المحادثة بصيغة Gemini: آخر N رسالة من آخر X ساعة، بيبدأ برسالة من العميل،
 * والرسايل المتتالية من نفس الطرف بتتدمج (زي رد موظف بعد رد البوت)
 * @param {Session} session
 * @returns {Array<{role: string, parts: Array<{text: string}>}>}
 */
export function geminiHistory(session) {
  const since = Date.now() - CONVERSATION_TTL_HOURS * 60 * 60 * 1000;
  let recent = session.history.filter((m) => m.ts >= since).slice(-MAX_HISTORY_MESSAGES);
  while (recent.length && recent[0].role !== 'user') recent = recent.slice(1);

  const contents = [];
  for (const message of recent) {
    const text = message.by === 'human' ? `[Team member] ${message.text}` : message.text;
    const previous = contents.at(-1);
    if (previous?.role === message.role) {
      previous.parts[0].text += `\n${text}`;
    } else {
      contents.push({ role: message.role, parts: [{ text }] });
    }
  }
  return contents;
}

/**
 * محادثات البيزنس (الأحدث الأول)، وبيمسح من الفهرس اللي انتهت مدتها
 * @param {string} businessId
 */
export async function listConversations(businessId) {
  const all = Object.values(await kvHGetAll(`convos:${businessId}`));
  const cutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const expired = all.filter((c) => c.updatedAt < cutoff);
  await Promise.all(expired.map((c) => kvHDel(`convos:${businessId}`, c.userKey)));

  return all.filter((c) => c.updatedAt >= cutoff).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * يرجع true لو الرسالة دي اتعالجت قبل كده (Meta ساعات بتبعت نفس الرسالة أكتر من مرة)
 * @param {string} messageId
 * @returns {boolean}
 */
export function isDuplicate(messageId) {
  if (!messageId) return false;
  if (seenMessages.has(messageId)) return true;
  seenMessages.set(messageId, Date.now());
  return false;
}

/**
 * تشغيل المهام الخاصة بنفس العميل واحدة ورا التانية،
 * عشان لو بعت كذا رسالة ورا بعض السجل يفضل مترتب صح.
 * @param {string} userKey
 * @param {() => Promise<void>} task
 */
export function runInUserQueue(userKey, task) {
  const previous = userQueues.get(userKey) || Promise.resolve();
  const next = previous.then(task).catch((error) => {
    console.error(`❌ Error processing message for [${userKey}]:`, error);
  });
  userQueues.set(userKey, next);
  next.finally(() => {
    if (userQueues.get(userKey) === next) userQueues.delete(userKey);
  });
  return next;
}

// تنظيف دوري لمعرفات الرسائل القديمة
setInterval(() => {
  const now = Date.now();
  for (const [id, receivedAt] of seenMessages) {
    if (now - receivedAt > DEDUP_TTL_MS) seenMessages.delete(id);
  }
}, 15 * 60 * 1000).unref();
