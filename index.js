import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

// Load environment variables from .env file
dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Initialize Google Gemini Client
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

/**
 * System Prompt المخصص لبراند ديكورات كوش ومناسبات في مصر
 * يتحدث بالعامية المصرية الودودة والاحترافية، ويستفسر عن التفاصيل الأساسية للمناسبة.
 */
const SYSTEM_PROMPT = `
أنت مساعد ذكي ومحترف لمصمم ديكورات كوش ومناسبات في مصر (براند: "Joy Decor & Events").
هدفك الرئيسي هو استقبال العملاء بأسلوب مبهج، راقي، ومحترف بالعامية المصرية السلسة والودودة، ومساعدتهم في تحديد تفاصيل ديكور المناسبة الخاصة بهم.

المبادئ والشخصية:
1. التحدث دائماً بالعامية المصرية الودودة والمحترمة (مثل: "أهلاً بحضرتك يا فندم"، "ألف مبروك مقدماً"، "ربنا يتمملكم على خير"، "منورنا يا فندم").
2. الردود يجب أن تكون مختصرة، مبهجة، ومناسبة لرسائل المحادثات المباشرة (شات الفيس بوك والواتساب). تجنب النصوص الطويلة المعقدة.
3. هدفك في المحادثة هو الحصول على التفاصيل التالية بلباقة وبدون إلحاح:
   - نوع المناسبة (كوشة خطوبة، قراية فاتحة، كتب كتاب، حنة، زفاف/فرح، الخ).
   - مكان المناسبة (في البيت، الروف، قاعة، حديقة/أوت دور) والمنطقة/المحافظة في مصر (مثلاً: التجمع، المعادي، مدينة نصر، الشيخ زايد، الجيزة... الخ).
   - تاريخ المناسبة (لتأكيد التفرغ والتحضير المناسب).
4. لا تطلب كل البيانات مرة واحدة في رسالة ضخمة! اسأل عن نقطة أو نقطتين في كل رد حتى تظل المحادثة طبيعية وسلسة.
5. إذا سأل العميل عن الأسعار أو الكاتالوج، وضح له بلباقة أن أسعار الكوش والتصميمات بتعتمد على المكان وتفاصيل الورد والإضاءة والمساحة المطلوب تغطيتها، وطلب منه التفاصيل (نوع المناسبة، المكان، والتاريخ) حتى يحدد له فريق التصميم أفضل باكدج وسعر مناسب له تماماً.
6. اظهر الاهتمام بفرحة العميل دائماً وعبر عن الحماس لمساعدته في جعل يومه مميزاً.
`;

/**
 * دالة استدعاء Google Gemini API للحصول على الرد المناسب
 * @param {string} userMessage - نص رسالة العميل
 * @returns {Promise<string>} - رد الذكاء الاصطناعي
 */
async function getGeminiResponse(userMessage) {
  if (!ai) {
    console.error('❌ GEMINI_API_KEY is not defined in environment variables.');
    return 'أهلاً بك يا فندم! معلش فيه مشكلة تقنية بسيطة في النظام، وهيرد عليك أحد ممثلي خدمة العملاء في أقرب وقت.';
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [{ text: userMessage }]
        }
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.7,
      }
    });

    const replyText = response.text?.trim();
    return replyText || 'أهلاً بك يا فندم! نورتنا، كيف يمكنني مساعدتك في ديكور المناسبة؟';
  } catch (error) {
    console.error('❌ Error calling Google Gemini API:', error.message || error);
    return 'أهلاً بك يا فندم! ألف مبروك المناسبة، يسعدنا جداً مساعدتك! ممكن تشاركنا بنوع المناسبة ومكانها؟';
  }
}

/**
 * دالة إرسال الرسالة إلى العميل عبر Facebook Messenger Graph API
 * @param {string} recipientId - PSID الخاص بالعميل
 * @param {string} textMessage - النص المراد إرساله
 */
async function sendFacebookMessage(recipientId, textMessage) {
  if (!PAGE_ACCESS_TOKEN) {
    console.error('❌ PAGE_ACCESS_TOKEN is missing. Cannot send message to Facebook Messenger.');
    return;
  }

  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;

  const payload = {
    recipient: { id: recipientId },
    message: { text: textMessage },
    messaging_type: 'RESPONSE'
  };

  try {
    await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`✅ Message successfully sent to Facebook recipient: ${recipientId}`);
  } catch (error) {
    console.error('❌ Error sending message via Meta Graph API:', error.response?.data || error.message);
  }
}

/**
 * دالة إرسال الرسالة عبر WhatsApp Cloud API (في حال استخدام الواتساب)
 * @param {string} phoneNumberId - ID رقم هاتف الواتساب
 * @param {string} toPhoneNumber - رقم هاتف العميل
 * @param {string} textMessage - النص المراد إرساله
 */
async function sendWhatsAppMessage(phoneNumberId, toPhoneNumber, textMessage) {
  if (!PAGE_ACCESS_TOKEN) {
    console.error('❌ PAGE_ACCESS_TOKEN is missing. Cannot send WhatsApp message.');
    return;
  }

  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toPhoneNumber,
    type: 'text',
    text: { body: textMessage }
  };

  try {
    await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${PAGE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`✅ Message successfully sent to WhatsApp recipient: ${toPhoneNumber}`);
  } catch (error) {
    console.error('❌ Error sending message via WhatsApp Cloud API:', error.response?.data || error.message);
  }
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
app.post('/webhook', async (req, res) => {
  const body = req.body;

  // رد سريع بحالة 200 OK لمنع إعادة إرسال المحاولة من Meta
  res.status(200).send('EVENT_RECEIVED');

  try {
    // ----------------------------------------------------
    // أ: التعامل مع رسائل Facebook Messenger
    // ----------------------------------------------------
    if (body.object === 'page') {
      for (const entry of body.entry || []) {
        const webhookEvent = entry.messaging?.[0];
        if (!webhookEvent) continue;

        const senderId = webhookEvent.sender?.id;
        const messageText = webhookEvent.message?.text;

        // الاستجابة فقط للرسائل النصية التي تحتوي على محتوى ومن غير أخطاء
        if (senderId && messageText && !webhookEvent.message?.is_echo) {
          console.log(`📩 Received Facebook message from [${senderId}]: "${messageText}"`);

          // توليد الرد باستخدام Gemini API
          const aiReply = await getGeminiResponse(messageText);

          // إرسال الرد المباشر للعميل
          await sendFacebookMessage(senderId, aiReply);
        }
      }
    }

    // ----------------------------------------------------
    // ب: التعامل مع رسائل WhatsApp Cloud API
    // ----------------------------------------------------
    else if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry || []) {
        const changes = entry.changes?.[0]?.value;
        const message = changes?.messages?.[0];

        if (message && message.type === 'text') {
          const fromNumber = message.from;
          const messageText = message.text?.body;
          const phoneNumberId = changes.metadata?.phone_number_id;

          if (fromNumber && messageText && phoneNumberId) {
            console.log(`📩 Received WhatsApp message from [${fromNumber}]: "${messageText}"`);

            // توليد الرد باستخدام Gemini API
            const aiReply = await getGeminiResponse(messageText);

            // إرسال الرد عبر WhatsApp
            await sendWhatsAppMessage(phoneNumberId, fromNumber, aiReply);
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Critical error handling webhook event:', error);
  }
});

// الصفحة الرئيسية لتأكيد عمل السيرفر
app.get('/', (req, res) => {
  res.send('🌸 Wedding Decor & Event AI Webhook Server is active and running!');
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`🚀 Webhook Server is running on port ${PORT}`);
  console.log(`🔗 Local Webhook Verification URL: http://localhost:${PORT}/webhook`);
});
