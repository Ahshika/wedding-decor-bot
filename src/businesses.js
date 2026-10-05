import crypto from 'node:crypto';
import fs from 'node:fs';
import { kvHDel, kvHGetAll, kvHSet } from './store.js';
import { DEFAULT_BUSINESS_INSTRUCTIONS } from './prompt.js';

/**
 * البيزنسات (كل محل / براند بيستخدم البوت)
 * - متخزنة في hash اسمه businesses ومتحملة في الرام للسرعة
 * - البيزنس الافتراضي (default) بيتعمل لوحده أول تشغيل، وبياخد التوكنات والإعدادات الناقصة من الـ env
 */

const STORE_KEY = 'businesses';
export const DEFAULT_BUSINESS_ID = 'default';
const LEGACY_CATALOG_FILE = process.env.CATALOG_FILE || new URL('../catalog.json', import.meta.url);

/**
 * @typedef {Object} CatalogCategory
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} priceFrom
 * @property {string[]} images - لينكات أو أسماء ملفات في public/catalog
 */

/**
 * @typedef {Object} Business
 * @property {string} id - حروف إنجليزي صغيرة وأرقام و -
 * @property {string} name
 * @property {boolean} active - لو false البوت مش بيرد على عملاء البيزنس ده
 * @property {boolean} useEnvDefaults - بياخد الإعدادات الناقصة من الـ env (للبيزنس الافتراضي بس)
 * @property {{description: string, serviceArea: string, defaultLanguage: string, currency: string, timezone: string, ownerLanguage: 'ar'|'en', instructions: string, faq: string}} profile
 * @property {CatalogCategory[]|null} catalog - null = استخدم catalog.json (للبيزنس الافتراضي بس)
 * @property {{messengerPageId: string, messengerPageToken: string, whatsappPhoneNumberId: string, whatsappToken: string, appSecret: string}} channels
 * @property {{telegramChatId: string, telegramBotToken: string, leadsWebhookUrl: string, leadsWebhookSecret: string}} notifications
 * @property {number} handoffPauseHours
 * @property {string} passwordHash - باسورد صاحب البيزنس للوحة التحكم
 * @property {number} createdAt
 */

/** @type {Map<string, Business>} */
const cache = new Map();

/**
 * بيزنس جديد بالقيم الافتراضية
 * @param {Partial<Business>} [fields]
 * @returns {Business}
 */
export function newBusiness(fields = {}) {
  return {
    id: '',
    name: '',
    active: true,
    useEnvDefaults: false,
    catalog: [],
    handoffPauseHours: 12,
    passwordHash: '',
    createdAt: Date.now(),
    ...fields,
    profile: {
      description: '',
      serviceArea: '',
      defaultLanguage: 'English',
      currency: '',
      timezone: 'UTC',
      ownerLanguage: 'en',
      instructions: '',
      faq: '',
      ...fields.profile
    },
    channels: {
      messengerPageId: '',
      messengerPageToken: '',
      whatsappPhoneNumberId: '',
      whatsappToken: '',
      appSecret: '',
      ...fields.channels
    },
    notifications: {
      telegramChatId: '',
      telegramBotToken: '',
      leadsWebhookUrl: '',
      leadsWebhookSecret: '',
      ...fields.notifications
    }
  };
}

/** البيزنس الافتراضي = البراند اللي البوت كان معمول له في الأول */
function createDefaultBusiness() {
  return newBusiness({
    id: DEFAULT_BUSINESS_ID,
    name: process.env.BUSINESS_NAME || 'Joy Decor & Events',
    useEnvDefaults: true,
    catalog: null,
    handoffPauseHours: Number(process.env.HANDOFF_PAUSE_HOURS) || 12,
    profile: {
      description: 'مصمم ديكورات كوش ومناسبات (خطوبة، كتب كتاب، حنة، أفراح، أعياد ميلاد)',
      serviceArea: 'مصر',
      defaultLanguage: 'Egyptian Arabic (العامية المصرية)',
      currency: 'EGP (جنيه مصري)',
      timezone: process.env.TIMEZONE || 'Africa/Cairo',
      ownerLanguage: 'ar',
      instructions: DEFAULT_BUSINESS_INSTRUCTIONS
    }
  });
}

/** تحميل البيزنسات من التخزين (بيتنده مرة واحدة وقت التشغيل) */
export async function loadBusinesses() {
  const saved = await kvHGetAll(STORE_KEY);
  for (const business of Object.values(saved)) cache.set(business.id, newBusiness(business));

  if (!cache.size) {
    const business = createDefaultBusiness();
    await saveBusiness(business);
    console.log(`🏪 Created default business "${business.name}". Manage it from /dashboard`);
  }
  console.log(`🏪 Businesses: ${[...cache.values()].map((b) => b.id).join(', ')}`);
}

/** @returns {Business[]} */
export function listBusinesses() {
  return [...cache.values()].sort((a, b) => a.createdAt - b.createdAt);
}

/** @returns {Business|null} */
export function getBusiness(id) {
  return cache.get(id) || null;
}

/** @param {Business} business */
export async function saveBusiness(business) {
  if (!isValidBusinessId(business.id)) throw new Error(`Invalid business id: ${business.id}`);
  await kvHSet(STORE_KEY, business.id, business);
  cache.set(business.id, business);
}

export async function deleteBusiness(id) {
  await kvHDel(STORE_KEY, id);
  cache.delete(id);
}

export function isValidBusinessId(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{1,39}$/.test(id);
}

/**
 * لو مفيش بيزنس متربط بالـ ID ده بالظبط: البيزنس الافتراضي ياخده، أو لو فيه بيزنس واحد بس من غير ID
 * @param {'messengerPageId'|'whatsappPhoneNumberId'} field
 * @param {string} value
 */
function findByChannel(field, value) {
  const all = listBusinesses();
  const exact = all.find((b) => b.channels[field] && b.channels[field] === value);
  if (exact) return exact;

  const unlinked = all.filter((b) => !b.channels[field]);
  return unlinked.find((b) => b.useEnvDefaults) || (all.length === 1 ? unlinked[0] : null) || null;
}

/** @returns {Business|null} */
export function findBusinessForMessenger(pageId) {
  return findByChannel('messengerPageId', pageId);
}

/** @returns {Business|null} */
export function findBusinessForWhatsApp(phoneNumberId) {
  return findByChannel('whatsappPhoneNumberId', phoneNumberId);
}

// ==========================================
// الإعدادات الفعلية (قيمة البيزنس، ولو فاضية والبيزنس افتراضي ناخد من الـ env)
// ==========================================

function withEnv(business, value, envValue) {
  return value || (business.useEnvDefaults ? envValue || '' : '');
}

export function messengerToken(business) {
  return withEnv(business, business.channels.messengerPageToken, process.env.PAGE_ACCESS_TOKEN);
}

export function whatsappToken(business) {
  return withEnv(business, business.channels.whatsappToken, process.env.WHATSAPP_TOKEN || process.env.PAGE_ACCESS_TOKEN);
}

export function telegramConfig(business) {
  return {
    // توكن البوت ممكن يكون واحد للمنصة كلها، كل بيزنس بيحط الـ chat ID بتاعه
    botToken: business.notifications.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: withEnv(business, business.notifications.telegramChatId, process.env.TELEGRAM_CHAT_ID)
  };
}

export function leadsWebhookConfig(business) {
  return {
    url: withEnv(business, business.notifications.leadsWebhookUrl, process.env.LEADS_WEBHOOK_URL),
    secret: withEnv(business, business.notifications.leadsWebhookSecret, process.env.LEADS_WEBHOOK_SECRET)
  };
}

/** كل الـ App Secrets المعروفة (عشان كل بيزنس ممكن يكون عامل Meta App بتاعه) */
export function allAppSecrets() {
  const secrets = new Set([process.env.APP_SECRET, ...listBusinesses().map((b) => b.channels.appSecret)]);
  secrets.delete(undefined);
  secrets.delete('');
  return [...secrets];
}

/**
 * الكتالوج الفعلي للبيزنس
 * @param {Business} business
 * @returns {CatalogCategory[]}
 */
export function businessCatalog(business) {
  if (Array.isArray(business.catalog)) return business.catalog;
  if (!business.useEnvDefaults || !fs.existsSync(LEGACY_CATALOG_FILE)) return [];

  try {
    const { categories = [] } = JSON.parse(fs.readFileSync(LEGACY_CATALOG_FILE, 'utf8'));
    return categories
      .filter((c) => c.id && c.title)
      .map((c) => ({
        id: String(c.id),
        title: String(c.title),
        description: String(c.description || ''),
        priceFrom: String(c.price_from || ''),
        images: (c.images || []).map(String)
      }));
  } catch (error) {
    console.error('❌ Could not read catalog.json:', error.message);
    return [];
  }
}

// ==========================================
// باسورد صاحب البيزنس
// ==========================================

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const given = crypto.scryptSync(password, salt, 32);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
