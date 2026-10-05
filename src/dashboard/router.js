import express from 'express';
import {
  businessCatalog, deleteBusiness, getBusiness, hashPassword, isValidBusinessId,
  listBusinesses, messengerToken, newBusiness, saveBusiness, whatsappToken
} from '../businesses.js';
import { appendMessage, getSessionByKey, listConversations, runInUserQueue, saveSession } from '../memory.js';
import { listLeads } from '../leads.js';
import { DASHBOARD_MESSAGE_TAG, sendFacebookMessage, sendWhatsAppMessage } from '../meta.js';
import { isPersistent } from '../store.js';
import { PUBLIC_URL } from '../config.js';
import { normalizeLang, t } from '../i18n.js';
import {
  canAccessBusiness, currentLang, currentUser, dashboardEnabled, endSession,
  sameOriginOnly, setLang, startSession, tryLogin
} from './auth.js';
import {
  businessesPage, conversationPage, conversationsPage, leadsPage, loginPage, messagePage, settingsPage
} from './views.js';

/**
 * لوحة التحكم: /dashboard
 */

export const dashboardRouter = express.Router();
dashboardRouter.use(sameOriginOnly);
// متتحفظش في الكاش، فيها بيانات عملاء
dashboardRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Frame-Options', 'DENY');
  next();
});

const MAX_TEXT = 8000;

function clean(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** تحديث قيمة سرية: فاضي = سيبها، "-" = امسحها */
function updateSecret(oldValue, input) {
  const value = clean(input, 1000);
  if (!value) return oldValue;
  if (value === '-') return '';
  return value;
}

function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

// ==========================================
// تسجيل الدخول واللغة
// ==========================================

function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.redirect('/dashboard/login');
  req.user = user;
  next();
}

/** بيتأكد إن البيزنس موجود ومسموح للمستخدم يفتحه */
function loadBusiness(req, res, next) {
  const business = getBusiness(req.params.businessId);
  const lang = currentLang(req, business);
  if (!business) return res.status(404).send(messagePage(lang, t(lang, 'common.notFound'), req.user));
  if (!canAccessBusiness(req.user, business.id)) return res.status(403).send(messagePage(lang, t(lang, 'common.forbidden'), req.user));
  req.business = business;
  req.lang = lang;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    const lang = currentLang(req);
    return res.status(403).send(messagePage(lang, t(lang, 'common.forbidden'), req.user));
  }
  next();
}

dashboardRouter.get('/login', (req, res) => {
  if (currentUser(req)) return res.redirect('/dashboard');
  res.send(loginPage({ lang: currentLang(req), disabled: !dashboardEnabled }));
});

dashboardRouter.post('/login', (req, res) => {
  const lang = currentLang(req);
  const result = tryLogin(req, clean(req.body.businessId, 40), req.body.password);

  if (result === 'rate_limited') return res.status(429).send(loginPage({ lang, error: t(lang, 'login.tooMany') }));
  if (!result) return res.status(401).send(loginPage({ lang, error: t(lang, 'login.failed') }));

  startSession(req, res, result);
  res.redirect(result.role === 'admin' ? '/dashboard' : `/dashboard/b/${result.businessId}`);
});

dashboardRouter.post('/logout', (req, res) => {
  endSession(req, res);
  res.redirect('/dashboard/login');
});

dashboardRouter.get('/lang/:lang', (req, res) => {
  setLang(req, res, normalizeLang(req.params.lang));
  const next = String(req.query.next || '');
  // نرجع لصفحات لوحة التحكم بس (منع الـ open redirect)
  res.redirect(/^\/dashboard(\/[\w\-/%:.]*)?$/.test(next) ? next : '/dashboard');
});

// ==========================================
// البيزنسات (للأدمن)
// ==========================================

async function renderBusinesses(req, res, error) {
  const lang = currentLang(req);
  const rows = await Promise.all(listBusinesses().map(async (business) => {
    const [conversations, leads] = await Promise.all([listConversations(business.id), listLeads(business.id)]);
    return { business, conversations: conversations.length, leads: leads.length };
  }));
  res.status(error ? 400 : 200).send(businessesPage({ lang, user: req.user, rows, error, persistent: isPersistent }));
}

dashboardRouter.get('/', requireUser, async (req, res) => {
  if (req.user.role !== 'admin') return res.redirect(`/dashboard/b/${req.user.businessId}`);
  await renderBusinesses(req, res);
});

dashboardRouter.post('/businesses', requireUser, requireAdmin, async (req, res) => {
  const lang = currentLang(req);
  const id = clean(req.body.id, 40).toLowerCase();
  const name = clean(req.body.name, 100);

  if (!isValidBusinessId(id)) return renderBusinesses(req, res, t(lang, 'biz.invalidId'));
  if (getBusiness(id)) return renderBusinesses(req, res, t(lang, 'biz.exists'));

  await saveBusiness(newBusiness({
    id,
    name: name || id,
    profile: { ownerLanguage: lang, defaultLanguage: lang === 'ar' ? 'Arabic' : 'English' }
  }));
  console.log(`🏪 Business "${id}" created from the dashboard.`);
  res.redirect(`/dashboard/b/${id}/settings`);
});

// ==========================================
// المحادثات
// ==========================================

dashboardRouter.get('/b/:businessId', requireUser, loadBusiness, async (req, res) => {
  const conversations = await listConversations(req.business.id);
  res.send(conversationsPage({ lang: req.lang, user: req.user, business: req.business, conversations, persistent: isPersistent }));
});

/** بيجيب الجلسة ويتأكد إنها تبع البيزنس ده */
async function loadSession(req, res, next) {
  const session = await getSessionByKey(req.params.userKey);
  if (!session || session.businessId !== req.business.id) {
    return res.status(404).send(messagePage(req.lang, t(req.lang, 'common.notFound'), req.user));
  }
  req.session = session;
  next();
}

const conversationBase = (req) => `/dashboard/b/${req.business.id}/c/${encodeURIComponent(req.params.userKey)}`;

dashboardRouter.get('/b/:businessId/c/:userKey', requireUser, loadBusiness, loadSession, (req, res) => {
  const flashKey = req.query.flash;
  const flash = flashKey === 'sent'
    ? { type: 'ok', text: t(req.lang, 'conv.sent') }
    : flashKey === 'failed'
      ? { type: 'error', text: t(req.lang, 'conv.sendFailed', { error: clean(req.query.error, 300) }) }
      : null;
  res.send(conversationPage({ lang: req.lang, user: req.user, business: req.business, session: req.session, flash, persistent: isPersistent }));
});

dashboardRouter.post('/b/:businessId/c/:userKey/pause', requireUser, loadBusiness, loadSession, async (req, res) => {
  await runInUserQueue(req.session.userKey, async () => {
    const session = await getSessionByKey(req.session.userKey);
    if (!session) return;
    session.pausedUntil = Date.now() + req.business.handoffPauseHours * 60 * 60 * 1000;
    await saveSession(session);
  });
  res.redirect(conversationBase(req));
});

dashboardRouter.post('/b/:businessId/c/:userKey/resume', requireUser, loadBusiness, loadSession, async (req, res) => {
  await runInUserQueue(req.session.userKey, async () => {
    const session = await getSessionByKey(req.session.userKey);
    if (!session) return;
    session.pausedUntil = null;
    await saveSession(session);
  });
  res.redirect(conversationBase(req));
});

/** رد من لوحة التحكم: بيتبعت للعميل، يتسجل في المحادثة، والبوت يقف */
dashboardRouter.post('/b/:businessId/c/:userKey/reply', requireUser, loadBusiness, loadSession, async (req, res) => {
  const text = clean(req.body.text, 2000);
  if (!text) return res.redirect(conversationBase(req));

  const { business } = req;
  let result;

  await runInUserQueue(req.session.userKey, async () => {
    const session = await getSessionByKey(req.session.userKey);
    result = session.channel === 'whatsapp'
      ? await sendWhatsAppMessage(whatsappToken(business), session.phoneNumberId, session.userId, text)
      : await sendFacebookMessage(messengerToken(business), session.userId, text, [], DASHBOARD_MESSAGE_TAG);

    if (result.ok) {
      appendMessage(session, 'model', text, 'human');
      session.pausedUntil = Date.now() + business.handoffPauseHours * 60 * 60 * 1000;
      await saveSession(session);
    }
  });

  res.redirect(result?.ok
    ? `${conversationBase(req)}?flash=sent`
    : `${conversationBase(req)}?flash=failed&error=${encodeURIComponent(result?.error || 'Unknown error')}`);
});

// ==========================================
// الطلبات
// ==========================================

dashboardRouter.get('/b/:businessId/leads', requireUser, loadBusiness, async (req, res) => {
  const leads = await listLeads(req.business.id);
  res.send(leadsPage({ lang: req.lang, user: req.user, business: req.business, leads, persistent: isPersistent }));
});

const CSV_COLUMNS = ['timestamp', 'status', 'channel', 'name', 'phone', 'event_type', 'event_date', 'venue', 'area', 'guests', 'budget', 'notes', 'contact_link', 'last_message'];

function csvCell(value) {
  let text = String(value ?? '');
  // منع تنفيذ المعادلات لو الملف اتفتح في Excel
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

dashboardRouter.get('/b/:businessId/leads.csv', requireUser, loadBusiness, async (req, res) => {
  const leads = await listLeads(req.business.id);
  const header = CSV_COLUMNS.map((column) => {
    if (column === 'timestamp') return t(req.lang, 'leads.updated');
    if (column === 'status') return t(req.lang, 'leads.status');
    if (column === 'channel') return t(req.lang, 'leads.channel');
    return ['contact_link', 'last_message'].includes(column) ? column : t(req.lang, `lead.${column}`);
  });
  const lines = [header, ...leads.map((lead) => CSV_COLUMNS.map((column) => lead[column]))]
    .map((row) => row.map(csvCell).join(','));

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="leads-${req.business.id}.csv"`);
  // BOM عشان Excel يقرا العربي صح
  res.send('﻿' + lines.join('\r\n'));
});

// ==========================================
// الإعدادات
// ==========================================

function renderSettings(req, res, { business = req.business, catalog, errors = [], saved = false } = {}) {
  res.status(errors.length ? 400 : 200).send(settingsPage({
    lang: req.lang,
    user: req.user,
    business,
    catalog: catalog || businessCatalog(business),
    webhookUrl: `${PUBLIC_URL || `${req.protocol}://${req.get('host')}`}/webhook`,
    errors,
    saved,
    persistent: isPersistent
  }));
}

dashboardRouter.get('/b/:businessId/settings', requireUser, loadBusiness, (req, res) => {
  renderSettings(req, res, { saved: req.query.saved === '1' });
});

/** قراءة الكتالوج من الفورم */
function parseCatalog(lang, input, errors) {
  const rows = Array.isArray(input) ? input : Object.values(input || {});
  const catalog = [];
  const seen = new Set();

  for (const row of rows) {
    if (!row || row.remove) continue;
    const category = {
      id: clean(row.id, 40).toLowerCase(),
      title: clean(row.title, 100),
      description: clean(row.description, 300),
      priceFrom: clean(row.priceFrom, 60),
      images: clean(row.images, 5000).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 10)
    };

    // فئة جديدة فاضية = مش محتاجها
    if (!category.id && !category.title && !category.images.length) continue;

    if (!/^[a-z0-9_-]{1,40}$/.test(category.id) || seen.has(category.id) || category.id === 'all') {
      errors.push(t(lang, 'set.invalidCatalogId', { id: category.id || category.title }));
      continue;
    }
    seen.add(category.id);
    catalog.push({ ...category, title: category.title || category.id });
  }
  return catalog;
}

dashboardRouter.post('/b/:businessId/settings', requireUser, loadBusiness, async (req, res) => {
  const { body, lang } = req;
  const old = req.business;
  const errors = [];

  const timezone = clean(body.profile?.timezone, 60) || old.profile.timezone;
  const leadsWebhookUrl = clean(body.notifications?.leadsWebhookUrl, 500);
  const hours = Number(body.handoffPauseHours);

  const business = {
    ...old,
    name: clean(body.name, 100) || old.name,
    active: body.active === '1',
    handoffPauseHours: Number.isFinite(hours) ? Math.min(168, Math.max(1, Math.round(hours))) : old.handoffPauseHours,
    profile: {
      ...old.profile,
      description: clean(body.profile?.description, 1000),
      serviceArea: clean(body.profile?.serviceArea, 300),
      defaultLanguage: clean(body.profile?.defaultLanguage, 100),
      currency: clean(body.profile?.currency, 60),
      timezone: isValidTimeZone(timezone) ? timezone : old.profile.timezone,
      ownerLanguage: normalizeLang(clean(body.profile?.ownerLanguage, 5)),
      instructions: clean(body.profile?.instructions, MAX_TEXT),
      faq: clean(body.profile?.faq, MAX_TEXT)
    },
    catalog: parseCatalog(lang, body.catalog, errors),
    channels: {
      ...old.channels,
      messengerPageId: clean(body.channels?.messengerPageId, 40).replace(/\D/g, ''),
      whatsappPhoneNumberId: clean(body.channels?.whatsappPhoneNumberId, 40).replace(/\D/g, ''),
      messengerPageToken: updateSecret(old.channels.messengerPageToken, body.channels?.messengerPageToken),
      whatsappToken: updateSecret(old.channels.whatsappToken, body.channels?.whatsappToken),
      appSecret: updateSecret(old.channels.appSecret, body.channels?.appSecret)
    },
    notifications: {
      ...old.notifications,
      telegramChatId: clean(body.notifications?.telegramChatId, 40),
      telegramBotToken: updateSecret(old.notifications.telegramBotToken, body.notifications?.telegramBotToken),
      leadsWebhookUrl: /^https:\/\//i.test(leadsWebhookUrl) ? leadsWebhookUrl : '',
      leadsWebhookSecret: updateSecret(old.notifications.leadsWebhookSecret, body.notifications?.leadsWebhookSecret)
    }
  };

  const password = typeof body.password === 'string' ? body.password : '';
  if (password) {
    if (password.length < 8) errors.push(t(lang, 'set.passwordShort'));
    else business.passwordHash = hashPassword(password);
  }

  if (errors.length) return renderSettings(req, res, { business, catalog: business.catalog, errors });

  await saveBusiness(business);
  console.log(`⚙️ Settings of "${business.id}" updated from the dashboard.`);
  res.redirect(`/dashboard/b/${business.id}/settings?saved=1`);
});

dashboardRouter.post('/b/:businessId/delete', requireUser, requireAdmin, loadBusiness, async (req, res) => {
  await deleteBusiness(req.business.id);
  console.log(`🗑️ Business "${req.business.id}" deleted from the dashboard.`);
  res.redirect('/dashboard');
});
