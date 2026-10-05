import crypto from 'node:crypto';
import { getBusiness, verifyPassword } from '../businesses.js';
import { normalizeLang } from '../i18n.js';

/**
 * تسجيل الدخول للوحة التحكم
 * - الأدمن (صاحب المنصة): بالباسورد اللي في ADMIN_PASSWORD، وبيشوف كل البيزنسات
 * - صاحب البيزنس: بكود البيزنس + الباسورد اللي الأدمن حطهوله، وبيشوف بيزنسه بس
 * الجلسة في cookie متوقّعة بـ HMAC، ومن غير أي مكتبات إضافية.
 */

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
export const dashboardEnabled = ADMIN_PASSWORD.length > 0;

if (!dashboardEnabled) {
  console.warn('⚠️ ADMIN_PASSWORD is not set. The dashboard (/dashboard) is disabled.');
} else if (ADMIN_PASSWORD.length < 10) {
  console.warn('⚠️ ADMIN_PASSWORD is short. Use at least 10 characters.');
}

const COOKIE_NAME = 'dsid';
const LANG_COOKIE = 'dlang';
const SESSION_DAYS = 7;
const SECRET = crypto.createHash('sha256')
  .update(`dashboard:${process.env.DASHBOARD_SECRET || ''}:${ADMIN_PASSWORD}:${process.env.APP_SECRET || ''}`)
  .digest();

// محاولات الدخول الغلط لكل IP
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();

/**
 * @typedef {Object} DashboardUser
 * @property {'admin'|'business'} role
 * @property {string} [businessId]
 */

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/** جزء من بصمة الباسورد، عشان لو الباسورد اتغير الجلسات القديمة تبطل */
function passwordVersion(user) {
  const source = user.role === 'admin' ? ADMIN_PASSWORD : getBusiness(user.businessId)?.passwordHash || '';
  return sign(`pv:${source}`).slice(0, 12);
}

export function parseCookies(req) {
  const cookies = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function setCookie(req, res, name, value, maxAgeSeconds) {
  const secure = req.secure ? '; Secure' : '';
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/dashboard; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`);
}

/**
 * @param {import('express').Request} req
 * @returns {DashboardUser|null}
 */
export function currentUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!dashboardEnabled || !token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() > data.exp) return null;
    const user = { role: data.role, businessId: data.businessId };
    if (user.role === 'business' && !getBusiness(user.businessId)) return null;
    if (data.pv !== passwordVersion(user)) return null;
    return user;
  } catch {
    return null;
  }
}

/**
 * محاولة تسجيل الدخول
 * @returns {DashboardUser|null|'rate_limited'}
 */
export function tryLogin(req, businessId, password) {
  const ip = req.ip || 'unknown';
  const record = attempts.get(ip);
  if (record && Date.now() < record.resetAt && record.count >= MAX_ATTEMPTS) return 'rate_limited';

  let user = null;
  if (dashboardEnabled && typeof password === 'string' && password) {
    if (!businessId) {
      if (safeEqual(sign(`pw:${password}`), sign(`pw:${ADMIN_PASSWORD}`))) user = { role: 'admin' };
    } else {
      const business = getBusiness(String(businessId).trim().toLowerCase());
      if (business && verifyPassword(password, business.passwordHash)) user = { role: 'business', businessId: business.id };
    }
  }

  if (!user) {
    const fresh = !record || Date.now() > record.resetAt;
    attempts.set(ip, { count: fresh ? 1 : record.count + 1, resetAt: fresh ? Date.now() + ATTEMPT_WINDOW_MS : record.resetAt });
    console.warn(`⚠️ Failed dashboard login from ${ip}`);
    return null;
  }

  attempts.delete(ip);
  return user;
}

export function startSession(req, res, user) {
  const payload = Buffer.from(JSON.stringify({
    role: user.role,
    businessId: user.businessId,
    pv: passwordVersion(user),
    exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  })).toString('base64url');
  setCookie(req, res, COOKIE_NAME, `${payload}.${sign(payload)}`, SESSION_DAYS * 24 * 60 * 60);
}

export function endSession(req, res) {
  setCookie(req, res, COOKIE_NAME, '', 0);
}

/** لغة لوحة التحكم: اللي اختارها، أو لغة البيزنس، أو لغة المتصفح */
export function currentLang(req, business) {
  const chosen = parseCookies(req)[LANG_COOKIE];
  if (chosen) return normalizeLang(chosen);
  if (business) return normalizeLang(business.profile.ownerLanguage);
  return /^ar\b/i.test(req.get('accept-language') || '') ? 'ar' : 'en';
}

export function setLang(req, res, lang) {
  setCookie(req, res, LANG_COOKIE, normalizeLang(lang), 365 * 24 * 60 * 60);
}

/** @param {DashboardUser} user */
export function canAccessBusiness(user, businessId) {
  return user.role === 'admin' || user.businessId === businessId;
}

/**
 * حماية من CSRF: أي POST لازم يكون جاي من نفس الموقع
 * (مع SameSite=Lax على الـ cookie ده كفاية)
 */
export function sameOriginOnly(req, res, next) {
  if (req.method !== 'POST') return next();

  const source = req.get('origin') || req.get('referer');
  try {
    if (source && new URL(source).host === req.get('host')) return next();
  } catch {
    // لينك مش صحيح، هيترفض تحت
  }
  console.warn(`⚠️ Blocked cross-site dashboard POST from ${source || 'unknown origin'}`);
  return res.status(403).send('Forbidden');
}
