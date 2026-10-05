import { GoogleGenAI, Type } from '@google/genai';
import { buildSystemPrompt } from './prompt.js';
import { catalogIds, catalogPrompt } from './catalog.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Initialize Google Gemini Client
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

const FALLBACK_REPLY = 'أهلاً بحضرتك! معلش فيه مشكلة تقنية بسيطة، ممكن تبعت رسالتك تاني كمان شوية؟ 🌸\n\nHello! Sorry, we had a small technical issue. Could you please send your message again in a moment?';

/** حقول الطلب اللي Gemini بيستخرجها من المحادثة (الأسماء المعروضة في i18n.js) */
export const LEAD_FIELDS = {
  name: 'Customer name',
  phone: 'Phone number',
  event_type: 'Event type (engagement, wedding, henna, birthday...)',
  venue: 'Venue type (home, rooftop, hall, garden...)',
  area: 'Area / city',
  event_date: 'Event date',
  guests: 'Number of guests',
  budget: 'Budget',
  notes: 'Special details or requests (colors, style, flowers...)'
};

/** شكل الرد المطلوب من Gemini (بيختلف حسب كتالوج كل بيزنس) */
function responseSchema(business) {
  const ids = catalogIds(business);

  return {
    type: Type.OBJECT,
    properties: {
      lead: {
        type: Type.OBJECT,
        properties: Object.fromEntries(
          Object.entries(LEAD_FIELDS).map(([key, description]) => [key, { type: Type.STRING, nullable: true, description }])
        ),
        required: Object.keys(LEAD_FIELDS)
      },
      wants_human: { type: Type.BOOLEAN },
      media_summary: {
        type: Type.STRING,
        nullable: true,
        description: 'Photo sent: short description. Voice note sent: transcript. Otherwise null'
      },
      ...(ids.length && {
        show_catalog: {
          type: Type.STRING,
          nullable: true,
          format: 'enum',
          enum: [...ids, 'all'],
          description: 'Catalog category id to show its photos, "all" to show every category, or null'
        }
      }),
      quick_replies: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: '0 to 3 very short options (max 20 characters) shown as buttons'
      },
      reply: { type: Type.STRING }
    },
    required: ['lead', 'wants_human', 'media_summary', 'quick_replies', 'reply'],
    propertyOrdering: ['lead', 'wants_human', 'media_summary', 'show_catalog', 'quick_replies', 'reply']
  };
}

/**
 * معلومات بتتغير مع كل رسالة: تاريخ النهارده والمنصة
 * @param {import('./businesses.js').Business} business
 * @param {'messenger'|'whatsapp'} channel
 */
function buildContext(business, channel) {
  const timeZone = business.profile.timezone || 'UTC';
  let today;
  try {
    today = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  } catch {
    today = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  }
  const part = (type) => today.find((p) => p.type === type)?.value;

  let context = `\n\nCONTEXT:\n- Today is ${part('year')}-${part('month')}-${part('day')} (${part('weekday')}).`;
  if (channel === 'whatsapp') {
    context += '\n- The customer is chatting on WhatsApp, so we already know their phone number. Do not ask for it.';
  }
  return context;
}

/**
 * @typedef {Object} IncomingTurn
 * @property {string} text - نص رسالة العميل (ممكن يكون فاضي لو بعت صورة أو فويس بس)
 * @property {string[]} notes - ملاحظات للموديل عن الرسالة (مثلاً: العميل بعت فويس، أو داس على زرار)
 * @property {import('./meta.js').MediaData[]} media - الصور والفويس
 */

/**
 * @typedef {Object} GeminiResult
 * @property {string} reply
 * @property {Object} lead
 * @property {boolean} wantsHuman
 * @property {string|null} mediaSummary - وصف الصورة / تفريغ الفويس
 * @property {string|null} showCatalog - id فئة أو all
 * @property {string[]} quickReplies
 * @property {boolean} ok - false لو ده رد احتياطي بسبب خطأ
 */

function buildUserParts(turn) {
  const parts = [];
  if (turn.notes.length) parts.push({ text: turn.notes.join('\n') });
  for (const media of turn.media) {
    parts.push({ inlineData: { mimeType: media.mimeType, data: media.data } });
  }
  if (turn.text) parts.push({ text: turn.text });
  return parts;
}

function parseResult(raw, validCatalog) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // لو الرد مش JSON لأي سبب، نبعته للعميل زي ما هو بدل ما نضيعه
    console.warn('⚠️ Gemini returned non-JSON output, using it as plain reply.');
    return { reply: raw, lead: {}, wantsHuman: false, mediaSummary: null, showCatalog: null, quickReplies: [], ok: true };
  }

  const reply = parsed.reply?.trim();
  if (!reply) return null;

  return {
    reply,
    lead: parsed.lead || {},
    wantsHuman: parsed.wants_human === true,
    mediaSummary: parsed.media_summary?.trim() || null,
    showCatalog: validCatalog.includes(parsed.show_catalog) ? parsed.show_catalog : null,
    quickReplies: Array.isArray(parsed.quick_replies)
      ? parsed.quick_replies.filter((option) => typeof option === 'string' && option.trim()).map((option) => option.trim()).slice(0, 3)
      : [],
    ok: true
  };
}

/**
 * دالة استدعاء Google Gemini API للحصول على الرد + بيانات الطلب
 * @param {import('./businesses.js').Business} business
 * @param {Array} history - الرسائل السابقة في المحادثة (بصيغة Gemini)
 * @param {IncomingTurn} turn - رسالة العميل الحالية
 * @param {'messenger'|'whatsapp'} channel - المنصة
 * @returns {Promise<GeminiResult>}
 */
export async function getGeminiResponse(business, history, turn, channel) {
  const fallback = { reply: FALLBACK_REPLY, lead: {}, wantsHuman: false, mediaSummary: null, showCatalog: null, quickReplies: [], ok: false };

  if (!ai) {
    console.error('❌ GEMINI_API_KEY is not defined in environment variables.');
    return fallback;
  }

  // لو آخر رسالة في السجل من العميل (بعت وهو البوت متوقف)، ندمج الرسالة الجديدة معاها
  const contents = [...history];
  const last = contents.at(-1);
  if (last?.role === 'user') {
    contents[contents.length - 1] = { role: 'user', parts: [...last.parts, ...buildUserParts(turn)] };
  } else {
    contents.push({ role: 'user', parts: buildUserParts(turn) });
  }

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: buildSystemPrompt(business, catalogPrompt(business)) + buildContext(business, channel),
        temperature: 0.7,
        responseMimeType: 'application/json',
        responseSchema: responseSchema(business)
      }
    });

    const raw = response.text?.trim();
    return (raw && parseResult(raw, [...catalogIds(business), 'all'])) || fallback;
  } catch (error) {
    console.error('❌ Error calling Google Gemini API:', error.message || error);

    // لو المشكلة في الملف نفسه (نوع مش مدعوم مثلاً)، نحاول تاني من غيره
    if (turn.media.length) {
      console.warn('↩️ Retrying Gemini without the media attachment.');
      return getGeminiResponse(business, history, {
        text: turn.text,
        notes: [...turn.notes, '(The customer sent a file we could not open. Apologize kindly and ask them to type what they need or send another photo.)'],
        media: []
      }, channel);
    }
    return fallback;
  }
}
