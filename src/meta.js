import axios from 'axios';

/**
 * التعامل مع Meta Graph API (Messenger و WhatsApp)
 * كل دالة بتاخد التوكن بتاع البيزنس، لأن كل بيزنس ليه صفحته أو رقمه.
 */

const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || 'v23.0';
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// علامات بنحطها على رسايلنا، عشان لما ترجع في الـ echo نفرق بينها وبين رد موظف من صندوق رسايل الصفحة
export const BOT_MESSAGE_TAG = 'sent_by_ai_bot';
export const DASHBOARD_MESSAGE_TAG = 'sent_from_dashboard';

// أقصى طول للرسالة الواحدة في كل منصة
const MESSENGER_MAX_LENGTH = 2000;
const WHATSAPP_MAX_LENGTH = 4096;
const WHATSAPP_BUTTONS_BODY_MAX_LENGTH = 1024;

// أقصى حجم للصورة / الفويس اللي بنبعته لـ Gemini
const MAX_MEDIA_BYTES = (Number(process.env.MAX_MEDIA_MB) || 15) * 1024 * 1024;
// أقصى عدد صور بتتبعت على الواتساب مرة واحدة (عشان منغرقش العميل)
const WHATSAPP_MAX_CATALOG_IMAGES = 6;

const DEFAULT_MIME = { image: 'image/jpeg', audio: 'audio/mpeg', document: 'application/pdf' };

/**
 * تقسيم النص الطويل لأجزاء مناسبة لحد المنصة، مع محاولة القطع عند سطر جديد أو مسافة
 * @param {string} text
 * @param {number} maxLength
 * @returns {string[]}
 */
function splitMessage(text, maxLength) {
  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let cutAt = remaining.lastIndexOf('\n', maxLength);
    if (cutAt < maxLength / 2) cutAt = remaining.lastIndexOf(' ', maxLength);
    if (cutAt < maxLength / 2) cutAt = maxLength;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) chunks.push(remaining);

  return chunks;
}

/** قص النص لطول معين (مع مراعاة الإيموجي والحروف المركبة) */
function truncate(text, maxLength) {
  const chars = Array.from(text || '');
  return chars.length > maxLength ? chars.slice(0, maxLength - 1).join('') + '…' : chars.join('');
}

/** "audio/ogg; codecs=opus" -> "audio/ogg"، ولو النوع مش معروف نستخدم الافتراضي */
function normalizeMime(mimeType, kind) {
  const clean = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (!clean || clean === 'application/octet-stream' || !clean.includes('/')) return DEFAULT_MIME[kind];
  // فويس الماسنجر ساعات بيوصل كـ video/mp4 وهو صوت بس
  if (kind === 'audio' && clean.startsWith('video/')) return clean.replace('video/', 'audio/');
  return clean;
}

function errorMessage(error) {
  return error.response?.data?.error?.message || error.message;
}

/**
 * @typedef {Object} MediaData
 * @property {string} mimeType
 * @property {string} data - base64
 */

async function downloadBinary(url, headers = {}) {
  const response = await axios.get(url, {
    headers,
    responseType: 'arraybuffer',
    maxContentLength: MAX_MEDIA_BYTES,
    timeout: 30000
  });
  return { buffer: Buffer.from(response.data), contentType: response.headers['content-type'] };
}

/**
 * تحميل صورة أو فويس بعتهم العميل على Messenger
 * @param {string} url - لينك المرفق من الـ webhook
 * @param {'image'|'audio'|'document'} kind
 * @returns {Promise<MediaData>}
 */
export async function downloadMessengerMedia(url, kind) {
  const { buffer, contentType } = await downloadBinary(url);
  return { mimeType: normalizeMime(contentType, kind), data: buffer.toString('base64') };
}

/**
 * تحميل صورة أو فويس بعتهم العميل على WhatsApp (على خطوتين: نجيب اللينك وبعدين الملف)
 * @param {string} token
 * @param {string} mediaId
 * @param {'image'|'audio'|'document'} kind
 * @returns {Promise<MediaData>}
 */
export async function downloadWhatsAppMedia(token, mediaId, kind) {
  const headers = { 'Authorization': `Bearer ${token}` };
  const { data: info } = await axios.get(`${GRAPH_URL}/${mediaId}`, { headers, timeout: 10000 });

  if (info.file_size && info.file_size > MAX_MEDIA_BYTES) {
    throw new Error(`Media too large (${info.file_size} bytes)`);
  }

  const { buffer, contentType } = await downloadBinary(info.url, headers);
  return { mimeType: normalizeMime(info.mime_type || contentType, kind), data: buffer.toString('base64') };
}

// ==========================================
// Facebook Messenger
// ==========================================

async function postToMessenger(token, recipientId, message, tag = BOT_MESSAGE_TAG) {
  await axios.post(`${GRAPH_URL}/me/messages`, {
    recipient: { id: recipientId },
    message: { ...message, metadata: tag },
    messaging_type: 'RESPONSE'
  }, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
}

/**
 * إظهار "جاري الكتابة..." للعميل على Messenger
 * @param {string} token - Page Access Token
 * @param {string} recipientId - PSID الخاص بالعميل
 */
export async function sendFacebookTyping(token, recipientId) {
  if (!token) return;

  try {
    await axios.post(`${GRAPH_URL}/me/messages`, {
      recipient: { id: recipientId },
      sender_action: 'typing_on'
    }, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (error) {
    // مش مشكلة لو فشلت، دي حاجة تجميلية
    console.warn('⚠️ Could not send typing indicator:', errorMessage(error));
  }
}

/**
 * دالة إرسال الرسالة إلى العميل عبر Facebook Messenger Graph API
 * @param {string} token - Page Access Token
 * @param {string} recipientId - PSID الخاص بالعميل
 * @param {string} textMessage - النص المراد إرساله
 * @param {string[]} [quickReplies] - أزرار اختيارات سريعة تظهر تحت آخر رسالة
 * @param {string} [tag] - علامة الرسالة (بوت ولا لوحة التحكم)
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function sendFacebookMessage(token, recipientId, textMessage, quickReplies = [], tag = BOT_MESSAGE_TAG) {
  if (!token) {
    console.error('❌ Messenger Page Access Token is missing. Cannot send message.');
    return { ok: false, error: 'Missing Page Access Token' };
  }

  try {
    const chunks = splitMessage(textMessage, MESSENGER_MAX_LENGTH);
    for (const [index, chunk] of chunks.entries()) {
      const message = { text: chunk };
      if (index === chunks.length - 1 && quickReplies.length) {
        message.quick_replies = quickReplies.slice(0, 13).map((option) => ({
          content_type: 'text',
          title: truncate(option, 20),
          payload: `QR:${truncate(option, 900)}`
        }));
      }
      await postToMessenger(token, recipientId, message, tag);
    }
    console.log(`✅ Message successfully sent to Facebook recipient: ${recipientId}`);
    return { ok: true };
  } catch (error) {
    console.error('❌ Error sending message via Meta Graph API:', error.response?.data || error.message);
    return { ok: false, error: errorMessage(error) };
  }
}

/**
 * إرسال كروت الكتالوج كـ Carousel على Messenger
 * @param {string} token
 * @param {string} recipientId
 * @param {import('./catalog.js').CatalogCard[]} cards
 */
export async function sendFacebookCards(token, recipientId, cards) {
  if (!token || !cards.length) return;

  try {
    await postToMessenger(token, recipientId, {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          elements: cards.slice(0, 10).map((card) => ({
            title: truncate(card.title, 80),
            ...(card.subtitle && { subtitle: truncate(card.subtitle, 80) }),
            ...(card.imageUrl && { image_url: card.imageUrl }),
            buttons: [{ type: 'postback', title: truncate(`✨ ${card.title}`, 20), payload: card.payload }]
          }))
        }
      }
    });
    console.log(`✅ Catalog (${cards.length} cards) sent to Facebook recipient: ${recipientId}`);
  } catch (error) {
    console.error('❌ Error sending catalog via Messenger:', error.response?.data || error.message);
  }
}

// ==========================================
// WhatsApp Cloud API
// ==========================================

async function postToWhatsApp(token, phoneNumberId, payload) {
  await axios.post(`${GRAPH_URL}/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    ...payload
  }, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
}

/**
 * علامة "اتقرت" (الصحين الزرق) + "جاري الكتابة..." على WhatsApp
 * @param {string} token
 * @param {string} phoneNumberId
 * @param {string} messageId - ID رسالة العميل
 */
export async function sendWhatsAppTyping(token, phoneNumberId, messageId) {
  if (!token) return;

  try {
    await postToWhatsApp(token, phoneNumberId, {
      status: 'read',
      message_id: messageId,
      typing_indicator: { type: 'text' }
    });
  } catch (error) {
    // مش مشكلة لو فشلت، دي حاجة تجميلية
    console.warn('⚠️ Could not send WhatsApp typing indicator:', errorMessage(error));
  }
}

/**
 * دالة إرسال الرسالة عبر WhatsApp Cloud API
 * @param {string} token
 * @param {string} phoneNumberId - ID رقم هاتف الواتساب
 * @param {string} toPhoneNumber - رقم هاتف العميل
 * @param {string} textMessage - النص المراد إرساله
 * @param {string[]} [quickReplies] - لحد 3 أزرار تحت آخر رسالة
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function sendWhatsAppMessage(token, phoneNumberId, toPhoneNumber, textMessage, quickReplies = []) {
  if (!token) {
    console.error('❌ WhatsApp token is missing. Cannot send WhatsApp message.');
    return { ok: false, error: 'Missing WhatsApp token' };
  }

  // أزرار الواتساب: 3 بالكتير، كل زرار 20 حرف ومش متكررين
  const buttons = [...new Set(quickReplies.map((option) => truncate(option, 20)))].slice(0, 3);
  // نص الرسالة اللي فيها أزرار حده 1024 حرف، فالجزء الأخير بس هو اللي بيشيل الأزرار
  const chunks = buttons.length
    ? splitMessage(textMessage, WHATSAPP_BUTTONS_BODY_MAX_LENGTH)
    : splitMessage(textMessage, WHATSAPP_MAX_LENGTH);

  try {
    for (const [index, chunk] of chunks.entries()) {
      const isLast = index === chunks.length - 1;
      if (isLast && buttons.length) {
        await postToWhatsApp(token, phoneNumberId, {
          recipient_type: 'individual',
          to: toPhoneNumber,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: chunk },
            action: {
              buttons: buttons.map((title, i) => ({ type: 'reply', reply: { id: `QR:${i}`, title } }))
            }
          }
        });
      } else {
        await postToWhatsApp(token, phoneNumberId, {
          recipient_type: 'individual',
          to: toPhoneNumber,
          type: 'text',
          text: { body: chunk }
        });
      }
    }
    console.log(`✅ Message successfully sent to WhatsApp recipient: ${toPhoneNumber}`);
    return { ok: true };
  } catch (error) {
    console.error('❌ Error sending message via WhatsApp Cloud API:', error.response?.data || error.message);
    return { ok: false, error: errorMessage(error) };
  }
}

/**
 * إرسال صور الكتالوج على WhatsApp (صورة ورا صورة مع وصف)
 * @param {string} token
 * @param {string} phoneNumberId
 * @param {string} toPhoneNumber
 * @param {import('./catalog.js').CatalogCard[]} cards
 */
export async function sendWhatsAppCards(token, phoneNumberId, toPhoneNumber, cards) {
  const withImages = cards.filter((card) => card.imageUrl).slice(0, WHATSAPP_MAX_CATALOG_IMAGES);
  if (!token || !withImages.length) return;

  // لو كلها من نفس الفئة نكتب الوصف على أول صورة بس
  const sameCategory = withImages.every((card) => card.payload === withImages[0].payload);

  try {
    for (const [index, card] of withImages.entries()) {
      const image = { link: card.imageUrl };
      if (!sameCategory || index === 0) {
        image.caption = [`*${card.title}*`, card.subtitle].filter(Boolean).join('\n');
      }
      await postToWhatsApp(token, phoneNumberId, {
        recipient_type: 'individual',
        to: toPhoneNumber,
        type: 'image',
        image
      });
    }
    console.log(`✅ Catalog (${withImages.length} images) sent to WhatsApp recipient: ${toPhoneNumber}`);
  } catch (error) {
    console.error('❌ Error sending catalog via WhatsApp:', error.response?.data || error.message);
  }
}
