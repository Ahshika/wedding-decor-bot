/**
 * Google Apps Script لحفظ طلبات البوت في Google Sheet
 *
 * طريقة التركيب (مرة واحدة بس):
 * 1. اعمل Google Sheet جديد.
 * 2. من القائمة: Extensions -> Apps Script.
 * 3. امسح أي كود موجود والصق الملف ده كله.
 * 4. غيّر SECRET تحت لنفس قيمة LEADS_WEBHOOK_SECRET في إعدادات السيرفر.
 * 5. (اختياري) حط إيميلك في NOTIFY_EMAIL عشان يوصلك إيميل مع كل طلب.
 * 6. اضغط Deploy -> New deployment -> اختار النوع Web app:
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 7. وافق على الصلاحيات، وانسخ الـ Web app URL وحطه في LEADS_WEBHOOK_URL.
 *
 * ملحوظة: لو عدلت الكود بعد كده لازم تعمل Deploy -> Manage deployments -> Edit -> New version.
 */

const SECRET = 'غير_دي_لكلمة_سر_طويلة';
const NOTIFY_EMAIL = ''; // مثال: 'owner@gmail.com'
const SHEET_NAME = 'Leads';

const COLUMNS = [
  ['timestamp', 'الوقت'],
  ['status', 'الحالة'],
  ['channel', 'المنصة'],
  ['name', 'الاسم'],
  ['phone', 'التليفون'],
  ['event_type', 'نوع المناسبة'],
  ['event_date', 'التاريخ'],
  ['venue', 'المكان'],
  ['area', 'المنطقة'],
  ['guests', 'عدد المعازيم'],
  ['budget', 'الميزانية'],
  ['notes', 'ملاحظات'],
  ['last_message', 'آخر رسالة'],
  ['contact_link', 'لينك التواصل'],
  ['user_id', 'معرف العميل']
];

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  if (data.secret !== SECRET) {
    return ContentService.createTextOutput('forbidden');
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS.map(([, label]) => label));
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setRightToLeft(true);
  }

  // ' في الأول عشان الشيت ميحولش رقم التليفون لرقم ويمسح الصفر أو علامة +
  const row = COLUMNS.map(([key]) => {
    const value = data[key] == null ? '' : String(data[key]);
    return /^[+0]/.test(value) ? "'" + value : value;
  });
  sheet.appendRow(row);

  if (NOTIFY_EMAIL) {
    const body = COLUMNS
      .filter(([key]) => data[key])
      .map(([key, label]) => label + ': ' + data[key])
      .join('\n');
    MailApp.sendEmail(NOTIFY_EMAIL, '🌸 ' + data.status + ' - ' + (data.event_type || 'عميل جديد'), body);
  }

  return ContentService.createTextOutput('ok');
}
