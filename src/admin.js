import crypto from 'node:crypto';
import express from 'express';
import { getSessionByKey, runInUserQueue, saveSession } from './memory.js';
import { PUBLIC_URL } from './config.js';

/**
 * لينكات التحكم اللي بتوصل لصاحب المحل في الإشعار (زي "رجّع البوت يرد على العميل ده")
 * كل لينك متوقّع بـ HMAC خاص بالعميل ده بس، فمحدش يقدر يغيّر فيه.
 */

const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.APP_SECRET;

function sign(userKey) {
  return crypto.createHmac('sha256', ADMIN_SECRET).update(`resume:${userKey}`).digest('hex');
}

function isValidSignature(userKey, sig) {
  if (!ADMIN_SECRET || typeof userKey !== 'string' || typeof sig !== 'string') return false;
  const expected = Buffer.from(sign(userKey));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/**
 * لينك "رجّع البوت" للعميل ده، أو null لو الإعدادات ناقصة
 * @param {string} userKey
 * @returns {string|null}
 */
export function buildResumeUrl(userKey) {
  if (!ADMIN_SECRET || !PUBLIC_URL) return null;
  return `${PUBLIC_URL}/admin/resume?u=${encodeURIComponent(userKey)}&sig=${sign(userKey)}`;
}

export const adminRouter = express.Router();

const page = (body) => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bot Control</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 16px;text-align:center}button{font-size:1.1rem;padding:.8em 1.6em;border:0;border-radius:10px;background:#c2185b;color:#fff;cursor:pointer}</style>
</head><body>${body}</body></html>`;

// GET بيعرض زرار بس (عشان فتح اللينك أو الـ preview ميغيرش حاجة لوحده)
adminRouter.get('/resume', (req, res) => {
  const { u, sig } = req.query;
  if (!isValidSignature(u, sig)) return res.status(403).send(page('<h2>اللينك ده مش صحيح ❌</h2>'));

  res.send(page(`
    <h2>تشغيل البوت تاني مع العميل ده؟</h2>
    <p><code>${String(u).replace(/[<>&"]/g, '')}</code></p>
    <form method="post">
      <input type="hidden" name="u" value="${String(u).replace(/"/g, '&quot;')}">
      <input type="hidden" name="sig" value="${sig}">
      <button type="submit">▶️ رجّع البوت يرد</button>
    </form>`));
});

adminRouter.post('/resume', async (req, res) => {
  const { u, sig } = req.body;
  if (!isValidSignature(u, sig)) return res.status(403).send(page('<h2>اللينك ده مش صحيح ❌</h2>'));

  // جوه طابور العميل عشان منكتبش فوق رسالة بتتعالج دلوقتي
  await runInUserQueue(u, async () => {
    const session = await getSessionByKey(u);
    if (!session) return;
    session.pausedUntil = null;
    await saveSession(session);
  });
  console.log(`▶️ Bot resumed for [${u}] by owner.`);

  res.send(page('<h2>✅ تمام! البوت هيرد على العميل ده تاني من الرسالة الجاية.</h2>'));
});
