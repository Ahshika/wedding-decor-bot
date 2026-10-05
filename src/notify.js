import axios from 'axios';
import { leadsWebhookConfig, telegramConfig } from './businesses.js';

/**
 * إرسال الإشعارات لصاحب كل بيزنس:
 * - Telegram: إشعار فوري على الموبايل
 * - Leads webhook: حفظ الطلب في Google Sheet (عن طريق Google Apps Script) أو أي خدمة زي Make / Zapier / n8n
 */

/**
 * إرسال رسالة لصاحب البيزنس على Telegram
 * @param {import('./businesses.js').Business} business
 * @param {string} text
 */
export async function sendTelegram(business, text) {
  const { botToken, chatId } = telegramConfig(business);
  if (!botToken || !chatId) {
    console.log(`📢 [Owner notification - ${business.id}]\n${text}`);
    return;
  }

  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: text.slice(0, 4000),
      // مهم: من غير ده Telegram بيفتح اللينكات عشان يعمل preview
      link_preview_options: { is_disabled: true }
    }, { timeout: 10000 });
  } catch (error) {
    console.error(`❌ Error sending Telegram notification (${business.id}):`, error.response?.data || error.message);
  }
}

/**
 * حفظ صف في Google Sheet (أو أي webhook)
 * @param {import('./businesses.js').Business} business
 * @param {Object} row
 */
export async function postLeadRow(business, row) {
  const { url, secret } = leadsWebhookConfig(business);
  if (!url) return;

  try {
    await axios.post(url, { secret, ...row }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000
    });
    console.log(`✅ Lead row saved (${row.status}) for ${row.user_id}`);
  } catch (error) {
    console.error(`❌ Error saving lead row (${business.id}):`, error.response?.data || error.message);
  }
}
