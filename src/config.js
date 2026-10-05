/** إعدادات مشتركة بين أكتر من ملف */

// رابط السيرفر العام (Render بيحط RENDER_EXTERNAL_URL لوحده)
export const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
