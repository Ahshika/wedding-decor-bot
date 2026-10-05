import fs from 'node:fs';
import { PUBLIC_URL } from './config.js';
import { businessCatalog } from './businesses.js';

/**
 * الكتالوج: فئات شغل كل بيزنس وصورها (بتتعدل من لوحة التحكم)
 * الصور ممكن تكون لينكات https، أو ملفات في public/catalog بتتعرض من السيرفر نفسه.
 */

const LOCAL_IMAGES_DIR = new URL('../public/catalog/', import.meta.url);
// عشان التحذير عن نفس الصورة يظهر مرة واحدة بس في الـ logs
const warned = new Set();

function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

/**
 * @typedef {Object} CatalogCard
 * @property {string} title
 * @property {string} subtitle
 * @property {string|null} imageUrl
 * @property {string} payload - بيرجع لنا لما العميل يدوس على الكارت
 */

/**
 * لينك الصورة الكامل، أو null لو مش هينفع يتبعت
 * @param {string} image
 * @returns {string|null}
 */
export function resolveImage(image) {
  if (/^https?:\/\//i.test(image)) return image;

  // نمنع أي مسار بيطلع بره فولدر الكتالوج
  if (image.includes('..') || !fs.existsSync(new URL(image, LOCAL_IMAGES_DIR))) {
    warnOnce(`⚠️ Catalog image not found: public/catalog/${image}`);
    return null;
  }
  if (!PUBLIC_URL) {
    warnOnce(`⚠️ PUBLIC_URL is not set, so local catalog image "${image}" cannot be sent.`);
    return null;
  }
  return `${PUBLIC_URL}/catalog/${image.split('/').map(encodeURIComponent).join('/')}`;
}

/** فئات الكتالوج مع لينكات الصور الجاهزة */
function resolvedCatalog(business) {
  return businessCatalog(business).map((category) => ({
    ...category,
    images: category.images.map(resolveImage).filter(Boolean)
  }));
}

/** @returns {string[]} */
export function catalogIds(business) {
  return businessCatalog(business).map((category) => category.id);
}

/**
 * وصف الكتالوج اللي بيتضاف للـ System Prompt
 * @returns {string}
 */
export function catalogPrompt(business) {
  const catalog = resolvedCatalog(business);
  if (!catalog.length) return '';

  const lines = catalog.map((category) => [
    `- ${category.id}: ${category.title}`,
    category.description && ` — ${category.description}`,
    category.priceFrom && ` (prices start from ${category.priceFrom})`,
    category.images.length ? ` [${category.images.length} photos]` : ' [no photos]'
  ].filter(Boolean).join(''));

  return `CATALOG (available services):\n${lines.join('\n')}`;
}

/**
 * الكروت اللي هتتبعت للعميل
 * @param {import('./businesses.js').Business} business
 * @param {string} selection - id فئة معينة (كل صورها)، أو 'all' (أول صورة من كل فئة)
 * @returns {CatalogCard[]}
 */
export function getCatalogCards(business, selection) {
  const catalog = resolvedCatalog(business);

  if (selection === 'all') {
    return catalog.map((category) => ({
      title: category.title,
      subtitle: category.description,
      imageUrl: category.images[0] || null,
      payload: `CATALOG:${category.id}`
    }));
  }

  const category = catalog.find((c) => c.id === selection);
  if (!category) return [];

  return category.images.map((imageUrl) => ({
    title: category.title,
    subtitle: category.description,
    imageUrl,
    payload: `CATALOG:${category.id}`
  }));
}

/**
 * اسم الفئة من الـ payload (لما العميل يدوس على كارت)
 * @param {import('./businesses.js').Business} business
 * @param {string} payload
 * @returns {string|null}
 */
export function categoryTitleFromPayload(business, payload) {
  const id = payload?.startsWith('CATALOG:') ? payload.slice('CATALOG:'.length) : null;
  return businessCatalog(business).find((c) => c.id === id)?.title || null;
}
