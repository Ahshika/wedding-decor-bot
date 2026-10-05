import { downloadMessengerMedia, downloadWhatsAppMedia } from './meta.js';
import { categoryTitleFromPayload } from './catalog.js';

/**
 * تحويل رسايل كل منصة (نص، صورة، فويس، زرار، لوكيشن...) لشكل موحد
 * الملاحظات (notes) بالإنجليزي لأنها موجهة للموديل، وبتظهر كمان في سجل المحادثة في لوحة التحكم.
 */

/**
 * @typedef {Object} Attachment
 * @property {'image'|'audio'|'document'} kind
 * @property {() => Promise<import('./meta.js').MediaData>} load - تحميل الملف (بيتنفذ جوه الطابور)
 */

/**
 * @typedef {Object} IncomingMessage
 * @property {string} id - ID الرسالة (لمنع التكرار)
 * @property {string} text - نص العميل (أو عنوان الزرار اللي داس عليه)
 * @property {string[]} notes - ملاحظات للموديل بتتسجل في السجل كمان
 * @property {Attachment[]} attachments
 */

export const ATTACHMENT_LABELS = { image: '📷 Photo', audio: '🎤 Voice note', document: '📄 File' };

const NOTE_VIDEO = '[Customer sent a video. We cannot watch videos: kindly ask them to send a photo or describe what they want]';
const NOTE_UNSUPPORTED = '[Customer sent something unsupported (contact card, file...). Reply kindly and ask them to type what they need]';

/** وصف قصير للرسالة في الـ logs */
export function describeIncoming(incoming) {
  const extras = incoming.attachments.map((a) => ATTACHMENT_LABELS[a.kind]);
  return [incoming.text && `"${incoming.text}"`, ...extras, ...incoming.notes].filter(Boolean).join(' + ');
}

function isEmpty(incoming) {
  return !incoming.text && !incoming.notes.length && !incoming.attachments.length;
}

/**
 * Messenger: رسالة عادية أو ضغطة على زرار (postback)
 * @param {Object} event - عنصر من entry.messaging
 * @param {import('./businesses.js').Business} business
 * @returns {IncomingMessage|null}
 */
export function parseMessengerEvent(event, business) {
  // ضغطة على زرار كارت أو زرار "ابدأ"
  if (event.postback) {
    const { payload, title, mid } = event.postback;
    const incoming = { id: mid || `${event.sender?.id}:${event.timestamp}:${payload}`, text: '', notes: [], attachments: [] };

    if (payload === 'GET_STARTED') {
      incoming.notes.push('[Customer just opened the chat and tapped "Get Started". Welcome them]');
    } else {
      const categoryTitle = categoryTitleFromPayload(business, payload);
      incoming.text = categoryTitle || title || '';
      if (categoryTitle) incoming.notes.push('[Customer tapped this category in the catalog]');
    }
    return isEmpty(incoming) ? null : incoming;
  }

  const message = event.message;
  if (!message) return null;

  const incoming = { id: message.mid, text: message.text || '', notes: [], attachments: [] };

  for (const attachment of message.attachments || []) {
    const url = attachment.payload?.url;

    if (attachment.payload?.sticker_id) {
      // زرار اللايك 👍 بيوصل كستيكر
      if (!incoming.text) incoming.text = '👍';
    } else if (['image', 'audio', 'file'].includes(attachment.type) && url) {
      const kind = attachment.type === 'file' ? 'document' : attachment.type;
      incoming.attachments.push({ kind, load: () => downloadMessengerMedia(url, kind) });
    } else if (attachment.type === 'video') {
      incoming.notes.push(NOTE_VIDEO);
    } else if (attachment.type === 'fallback' && (attachment.title || url)) {
      // لينك شيره العميل
      incoming.notes.push(`[Customer shared a link: ${[attachment.title, url].filter(Boolean).join(' - ')}]`);
    } else {
      incoming.notes.push(NOTE_UNSUPPORTED);
    }
  }

  return isEmpty(incoming) ? null : incoming;
}

/**
 * WhatsApp: كل أنواع الرسايل
 * @param {Object} message - عنصر من value.messages
 * @param {string} token - توكن الواتساب بتاع البيزنس (لتحميل الصور والفويس)
 * @returns {IncomingMessage|null}
 */
export function parseWhatsAppMessage(message, token) {
  const incoming = { id: message.id, text: '', notes: [], attachments: [] };

  const media = (kind, mediaId) => ({ kind, load: () => downloadWhatsAppMedia(token, mediaId, kind) });

  switch (message.type) {
    case 'text':
      incoming.text = message.text?.body || '';
      break;
    case 'image':
      incoming.text = message.image?.caption || '';
      incoming.attachments.push(media('image', message.image.id));
      break;
    case 'sticker':
      incoming.notes.push('[Customer sent a sticker]');
      incoming.attachments.push(media('image', message.sticker.id));
      break;
    case 'audio':
      incoming.attachments.push(media('audio', message.audio.id));
      break;
    case 'document':
      incoming.text = message.document?.caption || '';
      incoming.attachments.push(media('document', message.document.id));
      break;
    case 'video':
      incoming.text = message.video?.caption || '';
      incoming.notes.push(NOTE_VIDEO);
      break;
    case 'location': {
      const { name, address, latitude, longitude } = message.location || {};
      const place = [name, address].filter(Boolean).join(' - ');
      incoming.notes.push(`[📍 Customer shared a location: ${place || 'unnamed'} (${latitude}, ${longitude}). If it is the event venue, use it as venue/area]`);
      break;
    }
    case 'interactive':
      // ضغطة على زرار أو اختيار من قايمة
      incoming.text = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '';
      break;
    case 'button':
      incoming.text = message.button?.text || '';
      break;
    case 'reaction':
      // إيموجي على رسالة، مش محتاج رد
      return null;
    default:
      incoming.notes.push(NOTE_UNSUPPORTED);
  }

  return isEmpty(incoming) ? null : incoming;
}
