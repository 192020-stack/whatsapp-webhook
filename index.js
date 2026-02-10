/**
 * WhatsApp (Cloud API) <-> Zammad Integration
 * Fixes:
 * 1. Sender Identity (Customer vs Agent).
 * 2. FAQ Button (Internal Text instead of Link).
 * 3. Chat Bubble styling.
 */

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(bodyParser.json({ limit: "50mb" })); // زيادة الحد للملفات الكبيرة

// ====================================
// إعدادات السيرفر والربط
// ====================================
const ZAMMAD_BASE_URL = "http://102.203.200.112"; 
const ZAMMAD_TOKEN = "fk6ykJgBmcI9ILMhH1dPpEaETsQiU7tzJeaX3NWjnxl9w2OXLgRE-TlNz0YyF2w8";
const WHATSAPP_TOKEN = "EAA4bHf77siABQt0Nqf8trAwSwv5XL6E0NA0Xp1YbWnIDvUOa47PnquWUUBDtg9I3FkQtdyZCihqiwant2kWMeN3Hhrnbi3fP2z6saoE8eGOgWPqkUjVBolfZAgVa2o7oQrLr7iLX5NMdpv1vZAttk9qyGMfPp6j0Wxl5aCxzZC4a72O2WE5Ht3QgFFWep1ThHwZDZD";
const WHATSAPP_PHONE_ID = "1004684596056367";
const GRAPH_VERSION = "v19.0"; 
const ZAMMAD_GROUP = "Users";  
const PORT = 10000; 
const VERIFY_TOKEN = "my_verify_token"; 
const META_APP_SECRET = ""; 

// تخزين مؤقت لبيانات الجلسة
const users = {}; 

// =============================
// دوال مساعدة (Helpers)
// =============================

// التحقق من التوقيع (أمان)
function verifyMetaSignature(req) {
  if (!META_APP_SECRET) return true;
  const signature = req.headers["x-hub-signature-256"];
  if (!signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", META_APP_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// إرسال رسالة لواتساب
async function sendWhatsApp(payload) {
  try {
    await axios.post(
      `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_PHONE_ID}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("WhatsApp Send Error:", error.response?.data || error.message);
  }
}

// تحميل الوسائط (صور/صوت)
async function downloadMedia(mediaId) {
  if (!mediaId) return null;
  try {
    const meta = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    });
    const url = meta.data?.url;
    const mime_type = meta.data?.mime_type;
    
    if (!url) return null;

    const bin = await axios.get(url, {
      responseType: "arraybuffer",
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    });

    const buffer = Buffer.from(bin.data);
    let ext = mime_type.split("/")[1] || "bin";
    if (mime_type.includes("audio")) ext = "mp3"; 
    
    return { data: buffer.toString("base64"), mime_type, ext };
  } catch (e) {
    console.error("Download Media Error:", e.message);
    return null;
  }
}

// =============================
// التعامل مع هوية العميل في Zammad
// =============================
async function getOrCreateCustomer(name, phone) {
  try {
    // 1. البحث عن العميل بالهاتف
    const search = await axios.get(`${ZAMMAD_BASE_URL}/api/v1/users/search?query=phone:${phone}`, {
      headers: { Authorization: `Token token=${ZAMMAD_TOKEN}` }
    });

    if (search.data && search.data.length > 0) {
      return search.data[0]; // العميل موجود
    }

    // 2. إنشاء عميل جديد في حال عدم وجوده
    // نستخدم نطاق ".local" لتجنب مشاكل إرسال الإيميلات
    const uniqueEmail = `wa_${phone}@whatsapp.local`;

    const newUser = await axios.post(`${ZAMMAD_BASE_URL}/api/v1/users`, {
      firstname: name,
      lastname: "(WhatsApp)", // لتمييزه في النظام
      email: uniqueEmail,
      phone: phone,
      roles: ["Customer"], // مهم جداً: تحديد الدور كعميل
      active: true
    }, {
      headers: { Authorization: `Token token=${ZAMMAD_TOKEN}` }
    });

    return newUser.data;
  } catch (err) {
    console.error("Customer Error:", err.message);
    // في حالة الخطأ، نعود لافتراضي (لكن هذا نادر مع الكود الجديد)
    return { id: 1, firstname: "Default", lastname: "User" }; 
  }
}

// =============================
// Webhook استقبال الرسائل (من واتساب)
// =============================
app.post("/webhook", async (req, res) => {
  try {
    if (!verifyMetaSignature(req)) return res.sendStatus(403);

    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const messages = value?.messages;
    const contacts = value?.contacts;

    if (!messages || !messages.length) return res.sendStatus(200);

    const msg = messages[0];
    const from = msg.from;
    const name = contacts?.[0]?.profile?.name || "مستخدم";

    // تهيئة حالة المستخدم
    if (!users[from]) users[from] = { greeted: false, ticketId: null };
    const user = users[from];

    let textBody = "";
    let replyId = "";

    if (msg.type === "text") textBody = msg.text.body;
    if (msg.type === "interactive") {
      replyId = msg.interactive.list_reply?.id || msg.interactive.button_reply?.id;
    }

    // ------------------------------------------------
    // السيناريو 1: الترحيب (لأول مرة)
    // ------------------------------------------------
    if (!user.greeted) {
      await sendWhatsApp({
        messaging_product: "whatsapp",
        to: from,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: `مرحباً بك يا ${name} 👋\n\nنحن هنا لمساعدتك، يرجى اختيار الخدمة المطلوبة:` },
          action: {
            button: "القائمة الرئيسية",
            sections: [
              {
                title: "خدماتنا",
                rows: [
                  { id: "support", title: "📩 التحدث للدعم الفني" },
                  { id: "faq_list", title: "❓ الأسئلة الشائعة" } // تم التغيير لزر عادي
                ]
              }
            ]
          }
        }
      });
      user.greeted = true;
      return res.sendStatus(200);
    }

    // ------------------------------------------------
    // السيناريو 2: الأسئلة الشائعة (تم إرجاعه داخل واتساب)
    // ------------------------------------------------
    if (replyId === "faq_list") {
      // إرسال النص مباشرة بدلاً من الرابط
      await sendWhatsApp({
        messaging_product: "whatsapp",
        to: from,
        type: "text",
        text: { 
          body: `📚 *الأسئلة الشائعة:*\n\n1️⃣ *ما هي ساعات العمل؟*\n- نعمل يومياً من 9 صباحاً حتى 5 مساءً.\n\n2️⃣ *كيف يمكنني استعادة كلمة المرور؟*\n- عبر الموقع من خيار "نسيت كلمة المرور".\n\n3️⃣ *أين موقعكم؟*\n- طرابلس، ليبيا.\n\nهل تحتاج لمساعدة أخرى؟ يمكنك اختيار التحدث للدعم.` 
        }
      });
      return res.sendStatus(200);
    }

    // ------------------------------------------------
    // السيناريو 3: طلب الدعم (إنشاء تذكرة)
    // ------------------------------------------------
    if (replyId === "support") {
      // الحصول على بيانات العميل أولاً
      const customer = await getOrCreateCustomer(name, from);

      // إنشاء التذكرة باسم العميل باستخدام X-On-Behalf-Of
      const newTicket = await axios.post(`${ZAMMAD_BASE_URL}/api/v1/tickets`, {
        title: `WhatsApp - ${name} (${from})`,
        group: ZAMMAD_GROUP,
        customer_id: customer.id, // ربط التذكرة به
        article: {
          body: "بدأ العميل محادثة الدعم الفني.",
          type: "chat",
          internal: false,
          sender: "Customer", // تحديد المرسل
          from: name
        }
      }, {
        headers: { 
          Authorization: `Token token=${ZAMMAD_TOKEN}`,
          "X-On-Behalf-Of": customer.id // <--- الحل السحري: Zammad سيعتبر العميل هو الفاعل
        }
      });

      user.ticketId = newTicket.data.id; // حفظ رقم التذكرة

      await sendWhatsApp({
        messaging_product: "whatsapp",
        to: from,
        type: "text",
        text: { body: "تم تحويلك لموظف الدعم 👨‍💻.\nتفضل بكتابة رسالتك أو إرسال الصور/الملفات." }
      });
      return res.sendStatus(200);
    }

    // ------------------------------------------------
    // السيناريو 4: استلام الرسائل وإضافتها لـ Zammad
    // ------------------------------------------------
    if (user.ticketId) {
      // نتأكد من هوية العميل مرة أخرى لإضافتها في الرد
      const customer = await getOrCreateCustomer(name, from);

      const payload = {
        ticket_id: user.ticketId,
        type: "chat", // يظهر كفقاعة محادثة
        internal: false,
        sender: "Customer", // المرسل هو العميل
        from: name,
        body: ""
      };

      // معالجة نوع الرسالة
      if (msg.type === "text") {
        payload.body = textBody;
      } 
      else if (["image", "video", "audio", "document"].includes(msg.type)) {
        const mediaData = await downloadMedia(msg[msg.type]?.id);
        if (mediaData) {
          payload.body = `ملف مرفق: ${msg.type}`;
          payload.attachments = [{
            filename: `${msg.type}_file.${mediaData.ext}`,
            data: mediaData.data,
            "mime-type": mediaData.mime_type
          }];
        } else {
          payload.body = "فشل تحميل الملف المرفق.";
        }
      } else {
        payload.body = "رسالة غير مدعومة.";
      }

      // إرسال المقال إلى Zammad باسم العميل
      await axios.post(`${ZAMMAD_BASE_URL}/api/v1/ticket_articles`, payload, {
        headers: { 
          Authorization: `Token token=${ZAMMAD_TOKEN}`,
          "X-On-Behalf-Of": customer.id // <--- هذا سيجعل الرسالة تظهر باسم وصورة العميل
        }
      });
      
      return res.sendStatus(200);
    }

    return res.sendStatus(200);

  } catch (error) {
    console.error("Inbound Error:", error.message);
    res.sendStatus(200);
  }
});

// =============================
// Webhook الإرسال (من Zammad إلى واتساب)
// =============================
app.post("/zammad/webhook", async (req, res) => {
  try {
    const { ticket, article } = req.body;

    // شروط الأمان: يجب أن يكون المرسل "Agent" (أنت) وليس العميل أو النظام
    // ويجب أن تكون الرسالة عامة (ليست Internal Note)
    if (!article || article.internal === true || article.sender !== "Agent") {
      return res.status(200).send("Ignored");
    }

    // استخراج رقم الهاتف من عنوان التذكرة
    // التنسيق المتوقع للعنوان: WhatsApp - Name (PHONE)
    const phoneMatch = ticket.title.match(/\(([^)]+)\)/);
    const phoneNumber = phoneMatch ? phoneMatch[1] : null;

    if (!phoneNumber) return res.status(200).send("No Phone");

    // تنظيف نص الرسالة من أكواد HTML التي يضيفها Zammad
    let cleanMsg = article.body
      .replace(/<br\s*\/?>/gi, "\n") // تحويل سطر جديد
      .replace(/<\/?[^>]+(>|$)/g, "") // حذف باقي الوسوم
      .trim();

    if (!cleanMsg) return res.status(200).send("Empty");

    // إرسال الرد إلى واتساب العميل
    await sendWhatsApp({
      messaging_product: "whatsapp",
      to: phoneNumber,
      type: "text",
      text: { body: cleanMsg }
    });

    console.log(`✅ Reply sent to ${phoneNumber}`);
    res.status(200).send("Sent");

  } catch (error) {
    console.error("Outbound Error:", error.message);
    res.status(500).send("Error");
  }
});

// =============================
// التحقق من حالة السيرفر
// =============================
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});