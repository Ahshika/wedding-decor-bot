// لازم يكون أول import عشان المتغيرات تتحمل قبل باقي الملفات
import 'dotenv/config';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { getGeminiResponse } from './src/gemini.js';
import {
  BOT_MESSAGE_TAG, DASHBOARD_MESSAGE_TAG,
  sendFacebookCards, sendFacebookMessage, sendFacebookTyping,
  sendWhatsAppCards, sendWhatsAppMessage, sendWhatsAppTyping
} from './src/meta.js';
import {
  appendMessage, buildUserKey, geminiHistory, getSession, isDuplicate, runInUserQueue, saveSession
} from './src/memory.js';
import { mergeLead, processHandoff, processLead } from './src/leads.js';
import { ATTACHMENT_LABELS, describeIncoming, parseMessengerEvent, parseWhatsAppMessage } from './src/incoming.js';
import { getCatalogCards } from './src/catalog.js';
import {
  allAppSecrets, findBusinessForMessenger, findBusinessForWhatsApp, loadBusinesses, messengerToken, whatsappToken
} from './src/businesses.js';
import { adminRouter } from './src/admin.js';
import { dashboardRouter } from './src/dashboard/router.js';

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
// لو موظف رد على العميل بنفسه من صندوق رسايل الصفحة، البوت يسكت مع العميل ده
const PAUSE_ON_HUMAN_REPLY = process.env.PAUSE_ON_HUMAN_REPLY !== 'false';

await loadBusinesses();

const app = express();
// Render وأي استضافة شبهها بتحط السيرفر ورا proxy (عشان req.ip و req.secure يبقوا صح)
app.set('trust proxy', 1);

// بنحتفظ بالـ body الخام عشان نتحقق من توقيع Meta
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

if (!allAppSecrets().length) {
  console.warn('⚠️ APP_SECRET is not set. Webhook signature verification is DISABLED (fine for local testing only).');
}

/**
 * التحقق إن الطلب جاي فعلاً من Meta عن طريق توقيع X-Hub-Signature-256
 * (بنجرب الـ App Secret العام + بتاع كل بيزنس عامل Meta App خاص بيه)
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function isValidMetaSignature(req) {
  const secrets = allAppSecrets();
  if (!secrets.length) return true;

  const signature = req.get('x-hub-signature-256');
  if (!signature || !req.rawBody) return false;
  const signatureBuf = Buffer.from(signature);

  return secrets.some((secret) => {
    const expectedBuf = Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex'));
    return signatureBuf.length === expectedBuf.length && crypto.timingSafeEqual(signatureBuf, expectedBuf);
  });
}

/**
 * @typedef {Object} Platform - دوال الإرسال الخاصة بكل منصة
 * @property {(reply: string, quickReplies: string[]) => Promise<unknown>} sendReply
 * @property {(cards: import('./src/catalog.js').CatalogCard[]) => Promise<void>} sendCards
 * @property {() => Promise<void>} sendTyping - إظهار "جاري الكتابة..."
 */

/**
 * تحميل الصور والفويس. لو حاجة فشلت بنبلغ الموديل بدل ما نوقف الرد
 * @param {import('./src/incoming.js').IncomingMessage} incoming
 */
async function loadAttachments(incoming) {
  const media = [];
  const notes = [];
  for (const attachment of incoming.attachments) {
    try {
      media.push(await attachment.load());
    } catch (error) {
      console.error(`❌ Could not download ${attachment.kind}:`, error.response?.data?.error?.message || error.message);
      notes.push(`[Customer sent a ${ATTACHMENT_LABELS[attachment.kind]} but we could not open it. Apologize kindly and ask them to resend it or type what they need]`);
    }
  }
  return { media, notes };
}

/** نص رسالة العميل اللي بيتحفظ في السجل (وصف الصورة / تفريغ الفويس بدل الملف نفسه) */
function historyText(incoming, notes, mediaCount, mediaSummary) {
  const mediaLabel = incoming.attachments.length
    ? `[${incoming.attachments.map((a) => ATTACHMENT_LABELS[a.kind]).join(', ')}${mediaCount && mediaSummary ? `: ${mediaSummary}` : ''}]`
    : '';
  return [...notes, mediaLabel, incoming.text].filter(Boolean).join(' ');
}

/**
 * معالجة رسالة واحدة من أي منصة: جلب الجلسة، توليد الرد، إرساله، وتحديث بيانات الطلب
 * @param {import('./src/businesses.js').Business} business
 * @param {import('./src/memory.js').Customer} customer - بيانات العميل والمنصة
 * @param {import('./src/incoming.js').IncomingMessage} incoming - رسالة العميل
 * @param {Platform} platform
 */
async function handleIncoming(business, customer, incoming, platform) {
  const session = await getSession(customer);

  // موظف ماسك المحادثة: البوت مايردش، بس بنسجل الرسالة عشان تظهر في لوحة التحكم
  if (session.pausedUntil && Date.now() < session.pausedUntil) {
    console.log(`⏸️ Bot is paused for [${customer.userKey}] (a human is handling it). Skipping reply.`);
    appendMessage(session, 'user', historyText(incoming, incoming.notes, 0, null));
    await saveSession(session);
    return;
  }
  session.pausedUntil = null;

  await platform.sendTyping();

  // في الواتساب رقم العميل معروف من الأول
  if (customer.channel === 'whatsapp' && !session.lead.phone) {
    session.lead.phone = `+${customer.userId}`;
  }

  const { media, notes: loadNotes } = await loadAttachments(incoming);
  const notes = [...incoming.notes, ...loadNotes];

  const result = await getGeminiResponse(business, geminiHistory(session), { text: incoming.text, notes, media }, customer.channel);

  // الصور الأول، وبعدين الرد (عشان الأزرار تفضل ظاهرة تحت آخر رسالة)
  if (result.showCatalog) {
    await platform.sendCards(getCatalogCards(business, result.showCatalog));
  }
  await platform.sendReply(result.reply, result.quickReplies);

  const userText = historyText(incoming, notes, media.length, result.mediaSummary);
  appendMessage(session, 'user', userText);

  // الرد الاحتياطي (وقت الأخطاء) مش بيتحفظ عشان ميلخبطش سياق المحادثة
  if (result.ok) {
    appendMessage(session, 'model', result.reply, 'bot');
    session.lead = mergeLead(session.lead, result.lead);

    if (result.wantsHuman) {
      console.log(`🙋 Customer [${customer.userKey}] asked for a human. Pausing bot for ${business.handoffPauseHours}h.`);
      await processHandoff(business, session, userText);
    } else {
      await processLead(business, session, userText);
    }
  }

  await saveSession(session);
}

/**
 * موظف رد على العميل بنفسه من صندوق رسايل الصفحة: نسجل رده ونوقف البوت مع العميل ده لفترة
 * @param {import('./src/businesses.js').Business} business
 * @param {import('./src/memory.js').Customer} customer
 * @param {string} text
 */
async function recordHumanReply(business, customer, text) {
  const session = await getSession(customer);
  appendMessage(session, 'model', text, 'human');
  if (PAUSE_ON_HUMAN_REPLY) {
    session.pausedUntil = Date.now() + business.handoffPauseHours * 60 * 60 * 1000;
    console.log(`⏸️ A human replied to [${customer.userKey}] from the Page inbox. Bot paused for ${business.handoffPauseHours}h.`);
  }
  await saveSession(session);
}

// ==========================================
// 1. Webhook Verification Endpoint (GET)
// ==========================================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verified successfully by Meta!');
      return res.status(200).send(challenge);
    } else {
      console.warn('⚠️ Webhook verification failed. Tokens do not match.');
      return res.sendStatus(403);
    }
  }

  return res.status(400).send('Missing hub.mode or hub.verify_token');
});

// ==========================================
// 2. Webhook Event Handler Endpoint (POST)
// ==========================================
app.post('/webhook', (req, res) => {
  if (!isValidMetaSignature(req)) {
    console.warn('⚠️ Rejected webhook request with invalid signature.');
    return res.sendStatus(401);
  }

  const body = req.body;

  // رد سريع بحالة 200 OK لمنع إعادة إرسال المحاولة من Meta
  res.status(200).send('EVENT_RECEIVED');

  try {
    // ----------------------------------------------------
    // أ: التعامل مع رسائل Facebook Messenger
    // ----------------------------------------------------
    if (body.object === 'page') {
      for (const entry of body.entry || []) {
        const business = findBusinessForMessenger(entry.id);
        if (!business || !business.active) {
          console.warn(`⚠️ No active business for Facebook Page [${entry.id}]. Ignoring.`);
          continue;
        }
        const token = messengerToken(business);

        for (const webhookEvent of entry.messaging || []) {
          const senderId = webhookEvent.sender?.id;
          const message = webhookEvent.message;

          // echo = رسالة اتبعتت من الصفحة نفسها. لو مش من البوت ولا من لوحة التحكم يبقى موظف رد بإيده
          if (message?.is_echo) {
            const customerId = webhookEvent.recipient?.id;
            if (isDuplicate(message.mid)) continue;
            if (customerId && ![BOT_MESSAGE_TAG, DASHBOARD_MESSAGE_TAG].includes(message.metadata)) {
              const customer = { userKey: buildUserKey(business.id, 'messenger', customerId), businessId: business.id, channel: 'messenger', userId: customerId };
              runInUserQueue(customer.userKey, () => recordHumanReply(business, customer, message.text || '[📎]'));
            }
            continue;
          }

          const incoming = parseMessengerEvent(webhookEvent, business);
          if (!senderId || !incoming || isDuplicate(incoming.id)) continue;

          console.log(`📩 [${business.id}] Facebook message from [${senderId}]: ${describeIncoming(incoming)}`);

          const customer = { userKey: buildUserKey(business.id, 'messenger', senderId), businessId: business.id, channel: 'messenger', userId: senderId };
          runInUserQueue(customer.userKey, () =>
            handleIncoming(business, customer, incoming, {
              sendReply: (reply, quickReplies) => sendFacebookMessage(token, senderId, reply, quickReplies),
              sendCards: (cards) => sendFacebookCards(token, senderId, cards),
              sendTyping: () => sendFacebookTyping(token, senderId)
            })
          );
        }
      }
    }

    // ----------------------------------------------------
    // ب: التعامل مع رسائل WhatsApp Cloud API
    // ----------------------------------------------------
    else if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;
          const phoneNumberId = value?.metadata?.phone_number_id;
          if (!phoneNumberId || !value.messages?.length) continue;

          const business = findBusinessForWhatsApp(phoneNumberId);
          if (!business || !business.active) {
            console.warn(`⚠️ No active business for WhatsApp number [${phoneNumberId}]. Ignoring.`);
            continue;
          }
          const token = whatsappToken(business);

          for (const message of value.messages) {
            const fromNumber = message.from;
            const incoming = parseWhatsAppMessage(message, token);
            if (!fromNumber || !incoming || isDuplicate(incoming.id)) continue;

            console.log(`📩 [${business.id}] WhatsApp message from [${fromNumber}]: ${describeIncoming(incoming)}`);

            const customer = {
              userKey: buildUserKey(business.id, 'whatsapp', fromNumber),
              businessId: business.id,
              channel: 'whatsapp',
              userId: fromNumber,
              phoneNumberId
            };
            runInUserQueue(customer.userKey, () =>
              handleIncoming(business, customer, incoming, {
                sendReply: (reply, quickReplies) => sendWhatsAppMessage(token, phoneNumberId, fromNumber, reply, quickReplies),
                sendCards: (cards) => sendWhatsAppCards(token, phoneNumberId, fromNumber, cards),
                sendTyping: () => sendWhatsAppTyping(token, phoneNumberId, message.id)
              })
            );
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Critical error handling webhook event:', error);
  }
});

// صور الكتالوج اللي في public/catalog
app.use('/catalog', express.static(fileURLToPath(new URL('./public/catalog', import.meta.url))));

// لينكات التحكم اللي بتوصل لصاحب البيزنس في الإشعار (رجّع البوت يرد)
app.use('/admin', adminRouter);

// لوحة التحكم
app.use('/dashboard', dashboardRouter);

// الصفحة الرئيسية لتأكيد عمل السيرفر
app.get('/', (req, res) => {
  res.send('🌸 Wedding Decor & Event AI Webhook Server is active and running! <a href="/dashboard">Dashboard</a>');
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`🚀 Webhook Server is running on port ${PORT}`);
  console.log(`🔗 Local Webhook Verification URL: http://localhost:${PORT}/webhook`);
  console.log(`🖥️ Dashboard: http://localhost:${PORT}/dashboard`);
});
