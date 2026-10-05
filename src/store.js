import axios from 'axios';

/**
 * تخزين بسيط (key/value + hash) مع مدة صلاحية اختيارية
 * - لو UPSTASH_REDIS_REST_URL و UPSTASH_REDIS_REST_TOKEN موجودين: بيستخدم Upstash Redis (مجاني ومش بيتمسح مع الـ restart)
 * - غير كده: بيخزن في الرام (بيتمسح لو السيرفر عمل restart)
 */

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
export const isPersistent = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

console.log(isPersistent
  ? '🗄️ Storage: Upstash Redis (persistent)'
  : '🗄️ Storage: in-memory (data is lost on restart). Set UPSTASH_REDIS_REST_URL/TOKEN to persist.');

// key -> { value: JSON string, expiresAt }
const memoryStore = new Map();
// key -> Map(field -> JSON string)
const memoryHashes = new Map();

/**
 * تنفيذ أمر على Upstash Redis عن طريق REST API
 * @param {Array<string|number>} command - مثلاً ['GET', 'key']
 */
async function redis(command) {
  const { data } = await axios.post(UPSTASH_URL, command, {
    headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}` },
    timeout: 5000
  });
  return data.result;
}

/**
 * @param {string} key
 * @returns {Promise<any|null>}
 */
export async function kvGet(key) {
  if (isPersistent) {
    const raw = await redis(['GET', key]);
    return raw ? JSON.parse(raw) : null;
  }

  const item = memoryStore.get(key);
  if (!item) return null;
  if (item.expiresAt && Date.now() > item.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  // نسخة جديدة عشان التعديل عليها ميأثرش على المخزن قبل الحفظ
  return JSON.parse(item.value);
}

/**
 * @param {string} key
 * @param {any} value - لازم يكون قابل للتحويل لـ JSON
 * @param {number} [ttlSeconds] - مدة الصلاحية بالثواني (من غيرها بيفضل محفوظ)
 */
export async function kvSet(key, value, ttlSeconds) {
  if (isPersistent) {
    const command = ['SET', key, JSON.stringify(value)];
    if (ttlSeconds) command.push('EX', Math.ceil(ttlSeconds));
    await redis(command);
    return;
  }

  memoryStore.set(key, {
    value: JSON.stringify(value),
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null
  });
}

/** @param {string} key */
export async function kvDel(key) {
  if (isPersistent) {
    await redis(['DEL', key]);
    return;
  }
  memoryStore.delete(key);
  memoryHashes.delete(key);
}

/**
 * حفظ عنصر جوه hash (كل عنصر بيتحفظ لوحده، فمفيش تعارض لو اتنين بيكتبوا في نفس الوقت)
 * @param {string} key
 * @param {string} field
 * @param {any} value
 */
export async function kvHSet(key, field, value) {
  if (isPersistent) {
    await redis(['HSET', key, field, JSON.stringify(value)]);
    return;
  }
  if (!memoryHashes.has(key)) memoryHashes.set(key, new Map());
  memoryHashes.get(key).set(field, JSON.stringify(value));
}

/**
 * @param {string} key
 * @param {string} field
 * @returns {Promise<any|null>}
 */
export async function kvHGet(key, field) {
  if (isPersistent) {
    const raw = await redis(['HGET', key, field]);
    return raw ? JSON.parse(raw) : null;
  }
  const raw = memoryHashes.get(key)?.get(field);
  return raw ? JSON.parse(raw) : null;
}

/**
 * @param {string} key
 * @returns {Promise<Object<string, any>>} - field -> value
 */
export async function kvHGetAll(key) {
  const result = {};

  if (isPersistent) {
    // Upstash بيرجعها كـ [field1, value1, field2, value2, ...]
    const flat = (await redis(['HGETALL', key])) || [];
    for (let i = 0; i < flat.length; i += 2) result[flat[i]] = JSON.parse(flat[i + 1]);
    return result;
  }

  for (const [field, raw] of memoryHashes.get(key) || []) result[field] = JSON.parse(raw);
  return result;
}

/**
 * @param {string} key
 * @param {string} field
 */
export async function kvHDel(key, field) {
  if (isPersistent) {
    await redis(['HDEL', key, field]);
    return;
  }
  memoryHashes.get(key)?.delete(field);
}

// تنظيف دوري للمفاتيح المنتهية في وضع الرام
setInterval(() => {
  const now = Date.now();
  for (const [key, item] of memoryStore) {
    if (item.expiresAt && now > item.expiresAt) memoryStore.delete(key);
  }
}, 15 * 60 * 1000).unref();
