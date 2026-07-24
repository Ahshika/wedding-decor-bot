# 🌸 بوت ديكورات المناسبات بالذكاء الاصطناعي (Wedding & Event Decor AI Bot)

مشروع متكامل لسيرفر **Express.js (Node.js)** يعمل كـ **Webhook** للربط المباشر بين منصات التواصل الاجتماعي (**Facebook Messenger** و **WhatsApp Cloud API**) مع **Google Gemini API** مجاناً.

تم تخصيص البوت لـ **"محل / براند ديكورات كوش ومناسبات في مصر"** للتحدث بالعامية المصرية الودودة والمحترفة وجمع تفاصيل المناسبة (النوع، المكان، والتاريخ) من العملاء وتوفير تجربة خدمة عملاء مبهجة وممتازة.

---

## 🛠️ التكنولوجيات المستخدمة
- **Node.js (ES Modules)**
- **Express.js** (إطار عمل السيرفر والـ Webhook)
- **@google/genai** (المكتبة الرسمية الأحدث للتعامل مع Google Gemini API)
- **Axios** (لاستهداف Meta Graph API وإرسال الردود للعملاء)
- **dotenv** (لإدارة متغيرات البيئة)

---

## 📁 هيكل المشروع

```text
wedding-decor-bot/
├── index.js           # كود السيرفر الرئيسي ومعالج Webhook و Gemini
├── package.json       # التبعيات والـ Scripts
├── .env.example       # نموذج متغيرات البيئة
└── README.md          # الدليل الشامل للاستخدام والرفع
```

---

## 🚀 التشغيل المحلي (Local Development)

### 1. تثبيت الحزم:
افتح موجه الأوامر (Terminal) داخل مجلد المشروع وقم بتشغيل:
```bash
npm install
```

### 2. إعداد ملف المتغيرات البيئية:
قم بإنشاء ملف باسم `.env` بجانب `.env.example` وضع فيه قيم المتغيرات الخاصة بك:
```env
PORT=3000
VERIFY_TOKEN=my_wedding_bot_verify_token_2026
PAGE_ACCESS_TOKEN=ضع_هنا_رمز_وصول_الصفحة_من_فيسبوك
GEMINI_API_KEY=ضع_هنا_مفتاح_جيميني_من_google_ai_studio
```

### 3. تشغيل السيرفر:
```bash
# وضع التطوير
npm run dev

# أو التشغيل العادي
npm start
```

---

## 📖 الدليل الشامل للرفع المجاني على Render.com والربط بـ Meta & GitHub

### الخطوة 1: الرفع على GitHub
1. قم بإنشاء المستودع (Repository) الجديد على حسابك في GitHub وسِمه مثلاً `wedding-decor-bot`.
2. افتح مجلد المشروع في الـ Terminal وقم بتنفيذ الأوامر التالية:
   ```bash
   git init
   git add .
   git commit -m "Initial commit - Wedding Decor AI Bot Webhook"
   git branch -M main
   git remote add origin https://github.com/USERNAME/wedding-decor-bot.git
   git push -u origin main
   ```
   *(استبدل USERNAME باسم حسابك على GitHub)*

---

### الخطوة 2: إنشاء السيرفر مجاناً على Render.com
1. سجل الدخول إلى موقع [Render.com](https://render.com/).
2. اضغط على زر **New +** واختر **Web Service**.
3. قم ببيت ربط حسابك في GitHub واختر المستودع `wedding-decor-bot`.
4. املأ البيانات كالتالي:
   - **Name**: `wedding-decor-bot` (أو أي اسم تفضله).
   - **Environment**: `Node`.
   - **Region**: اختر الأقرب (مثلاً Frankfurt).
   - **Branch**: `main`.
   - **Build Command**: `npm install`.
   - **Start Command**: `npm start`.
   - **Instance Type**: `Free`.
5. انزل إلى قسم **Environment Variables** واضغط **Add Environment Variable** لإضافة التاليات:
   - `VERIFY_TOKEN`: نفس الـ Token الذي ستضعه في Meta (مثال: `my_wedding_bot_verify_token_2026`).
   - `PAGE_ACCESS_TOKEN`: Token صفحة فيسبوك أو الواتساب.
   - `GEMINI_API_KEY`: المفتاح المجاني الذي جلبته من [Google AI Studio](https://aistudio.google.com/).
6. اضغط على **Create Web Service**.
7. بعد انتهاء الـ Build، ستحصل على رابط السيرفر المباشر على Render مثل:
   `https://wedding-decor-bot.onrender.com`

---

### الخطوة 3: الحصول على GEMINI_API_KEY مجاناً
1. أدخل على [Google AI Studio](https://aistudio.google.com/).
2. سجل بحساب Google الخاص بك واضغط على **Get API key**.
3. اضغط على **Create API key** وانسخ المفتاح وضعه في متغيرات البيئة `GEMINI_API_KEY`.

---

### الخطوة 4: ضبط الـ Webhook في Meta for Developers

#### أ. بالنسبة لـ Facebook Messenger:
1. ادخل على حسابك في [Meta for Developers](https://developers.facebook.com/).
2. أنشئ تطبيقاً جديداً (App) من نوع **Business** أو اختر تطبيقك الحالي.
3. أضف منتج **Messenger** بالتطبيق.
4. اذهب إلى **Messenger Settings -> Webhooks** واضغط **Add Callback URL**:
   - **Callback URL**: ضع رابط سيرفر Render مضافاً إليه `/webhook`
     (مثال: `https://wedding-decor-bot.onrender.com/webhook`).
   - **Verify Token**: ضع نفس النص الموجود في متغير البيئة `VERIFY_TOKEN`.
5. اضغط **Verify and Save**. (إذا كانت البيانات صحيحة، سيرد السيرفر بـ 200 OK وينجح التفعيل في التو واللحظة!).
6. في قسم **Webhooks Subscriptions** الخاص بالصفحة، قم باشتراك الأحداث: `messages` و `messaging_postbacks`.
7. قم بتوليد **Page Access Token** لصفحتك وانسخه وضعه في متغير البيئة `PAGE_ACCESS_TOKEN` على Render.com.

#### ب. بالنسبة لـ WhatsApp Cloud API:
1. داخل تطبيق Meta Developers، أضف منتج **WhatsApp**.
2. اذهب إلى **WhatsApp -> Configuration**.
3. في قسم **Webhook**:
   - **Callback URL**: `https://wedding-decor-bot.onrender.com/webhook`
   - **Verify Token**: نفس قيمة `VERIFY_TOKEN`.
4. اضغط **Verify and Save**.
5. اشترك في حدث `messages`.

---

## 🎯 كيفية عمل البوت واختباره
- بمجرد قيام أي عميل بإرسال رسالة لصفحة الفيس بوك أو الواتساب (مثل: "السلام عليكم، عاور أعرف أسعار الكوشة عندكم؟"):
1. تتلقى Meta الرسالة وترسل طلب `POST /webhook` لسيرفر Render.
2. يستلم سيرفرك الرسالة ويمررها إلى Google Gemini API مع الـ System Prompt بالعامية المصرية.
3. يقوم Gemini بالرد بأسلوب ودود يسأل العميل عن نوع المناسبة ومكانها وتاريخها.
4. يرسل السيرفر الرد فوراً إلى شات العميل عبر Graph API!

---

## 📝 ترخيص المشروع
هذا المشروع مرخص تحت ISC License - ومتاح للاستخدام المباشر والتطوير والتعديل.
