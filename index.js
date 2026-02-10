/**
 * WhatsApp (Cloud API) <-> Zammad (Bilateral)
 * * Fixes:
 * 1. Identity Separation (Customer vs Agent).
 * 2. Real-time Outbound Replies (Zammad -> WhatsApp).
 * 3. Correct Chat Bubble Rendering.
 */

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(bodyParser.json({ limit: "25mb" })); 

// ====================================
// إعدادات النظام (تم الحفاظ على بياناتك)
// ====================================
const ZAMMAD_BASE_URL = "http://102.203.200.112"; 
const ZAMMAD_TOKEN = "fk6ykJgBmcI9ILMhH1dPpEaETsQiU7tzJeaX3NWjnxl9w2OXLgRE-TlNz0YyF2w8";
const KNOWLEDGE_LINK = "http://102.203.200.112/help/ar?preview_token=awTUB6dcksRTfDSveLu7YRcpuBoSNpthYlSKg4NHGGs30KAWLBchsPsrh6mgDFe-";
const WHATSAPP_TOKEN = "EAA4bHf77siABQt0Nqf8trAwSwv5XL6E0NA0Xp1YbWnIDvUOa47PnquWUUBDtg9I3FkQtdyZCihqiwant2kWMeN3Hhrnbi3fP2z6saoE8eGOgWPqkUjVBolfZAgVa2o7oQrLr7iLX5NMdpv1vZAttk9qyGMfPp6j0Wxl5aCxzZC4a72O2WE5Ht3QgFFWep1ThHwZDZD";
const WHATSAPP_PHONE_ID = "1004684596056367";
const GRAPH_VERSION = "v19.0"; 
const ZAMMAD_GROUP = "Users";  
const PORT = 10000; 
const VERIFY_TOKEN = "my_verify_token"; 
const META_APP_SECRET = ""; 

// تخزين مؤقت للجلسات
const users = {}; 

// =============================
// دوال مساعدة (HELPERS)
// =============================

// التحقق من توقيع ميتا (أمان)
function verifyMetaSignature(req) {
  if (!META_APP_SECRET) return true;
  const signature = req.headers["x-hub-signature-256"];
  if (!signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", META_APP_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// إرسال رسالة إلى واتساب
async function sendWhatsApp(payload) {
  if (!WHATSAPP_PHONE_ID) throw new Error("Missing WHATSAPP_PHONE_ID");
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_PHONE_ID}/messages`;
  
  try {
    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("WhatsApp Send Error:", error.response ? error.response.data : error.message);
  }
}

// تحميل الميديا من واتساب
async function downloadMedia(mediaId) {
  if (!mediaId) return null;
  try {
    const meta = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    });
    const url = meta.data?.url;
    const mime_type = meta.data?.mime_type;
    
    if (!url || !mime_type) return null;

    const bin = await axios.get(url, {
      responseType: "arraybuffer",
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    });

    const buffer = Buffer.from(bin.data);
    let ext = mime_type.split("/")[1] || "bin";
    if (mime_type.includes("audio")) ext = "mp3"; 
    if (mime_type.includes("image")) ext = "jpg";

    return { data: buffer.toString("base64"), mime_type, ext };
  } catch (e) {
    console.error("Download Media Error:", e.message);
    return null;
  }
}

// =============================
// [جديد] إدارة هوية العميل في Zammad
// =============================
async function getOrCreateCustomer(name, phone) {
  try {
    // 1. البحث عن المستخدم برقم الهاتف
    const search = await axios.get(`${ZAMMAD_BASE_URL}/api/v1/users/search?query=phone:${phone}`, {
      headers: { Authorization: `Token token=${ZAMMAD_TOKEN}` }
    });

    if (search.data && search.data.length > 0) {
      // العميل موجود، نرجع الـ ID الخاص به
      return search.data[0].id;
    }

    // 2. العميل غير موجود، نقوم بإنشائه
    // نستخدم ايميل وهمي لتفادي تضارب البيانات ولضمان إنشاء حساب "عميل" مستقل
    const fakeEmail = `${phone}@whatsapp.local`; 
    
    const newUser = await axios.post(`${ZAMMAD_BASE_URL}/api/v1/users`, {
      firstname: name,
      lastname: "(WhatsApp)", // تمييز الاسم
      email: fakeEmail,
      phone: phone,
      roles: ["Customer"], // مهم جداً: تحديد الدور كعميل
      active: true
    }, {
      headers: { Authorization: `Token token=${ZAMMAD_TOKEN}` }
    });

    console.log(`User created for ${phone}: ID ${newUser.data.id}`);
    return newUser.data.id;

  } catch (err) {
    console.error("Error in Customer Identity Logic:", err.response?.data || err.message);
    // في أسوأ الأحوال، نعود للمستخدم رقم 1 (لكن هذا نادراً ما سيحدث الآن)
    return 1;
  }
}

// =============================
// دوال التذاكر (محدثة)
// =============================

async function createZammadTicket({ name, from }) {
  // نحصل على ID العميل الحقيقي
  const customerId = await getOrCreateCustomer(name, from);

  const res = await axios.post(
    `${ZAMMAD_BASE_URL}/api/v1/tickets`,
    {
      title: `WhatsApp - ${name} (${from})`,
      group: ZAMMAD_GROUP,
      customer_id: customerId, // ربط التذكرة بالعميل الصحيح
      article: {
        body: `بداية محادثة جديدة من ${name}\nالرقم: ${from}`,
        type: "chat", // يظهر كشات
        internal: false,
        sender: "Customer", // تحديد أن المرسل هو العميل
        from: name,
        to: "Support Team"
      },
    },
    {
      headers: { Authorization: `Token token=${ZAMMAD_TOKEN}` }
    }
  );
  return res.data?.id;
}

async function addZammadArticle(articlePayload) {
  // تثبيت نوع الرسالة كـ chat ومن العميل
  articlePayload.type = "chat";
  articlePayload.sender = "Customer";

  await axios.post(`${ZAMMAD_BASE_URL}/api/v1/ticket_articles`, articlePayload, {
    headers: { Authorization: `Token token=${ZAMMAD_TOKEN}` },
  });
}

// =============================
// [Outbound] استقبال الردود من Zammad وإرسالها للواتساب
// =============================
app.post("/zammad/webhook", async (req, res) => {
  try {
    const { ticket, article } = req.body;

    // 1. فلترة: نريد فقط المقالات الجديدة، العامة، التي كتبها "Agent"
    if (!article || article.internal === true) return res.send("Ignored (Internal)");
    if (article.sender !== "Agent") return res.send("Ignored (Not Agent)");
    if (article.type === "note") return res.send("Ignored (Note)");

    // 2. استخراج رقم الهاتف من عنوان التذكرة
    // العنوان المتوقع: WhatsApp - Name (123456789)
    const title = ticket.title || "";
    const phoneMatch = title.match(/\(([^)]+)\)/);
    const phoneNumber = phoneMatch ? phoneMatch[1] : null;

    if (!phoneNumber) {
      console.log("No phone number found in ticket title:", title);
      return res.send("No phone");
    }

    // 3. تنظيف النص (Zammad يرسل HTML)
    let body = article.body || "";
    // تحويل <br> و <div> إلى أسطر جديدة
    body = body.replace(/<br\s*\/?>/gi, "\n").replace(/<\/div>/gi, "\n").replace(/<div>/gi, "");
    // حذف أي وسوم متبقية
    body = body.replace(/<[^>]+>/g, "").trim();

    if (!body) return res.send("Empty body");

    // 4. الإرسال للعميل
    await sendWhatsApp({
      messaging_product: "whatsapp",
      to: phoneNumber,
      type: "text",
      text: { body: body },
    });

    console.log(`✅ Agent Reply Sent to ${phoneNumber}`);
    return res.status(200).send("Sent");

  } catch (error) {
    console.error("Zammad Outbound Error:", error.message);
    return res.status(500).send("Error");
  }
});

// =============================
// تحقق Webhook (Meta)
// =============================
app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === VERIFY_TOKEN
  ) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

// =============================
// استقبال رسائل الواتساب (Inbound)
// =============================
app.post("/webhook", async (req, res) => {
  try {
    if (!verifyMetaSignature(req)) return res.sendStatus(403);

    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;
    const contacts = value?.contacts;

    if (!messages || !messages.length) return res.sendStatus(200);

    const msg = messages[0];
    const from = msg.from;
    const name = contacts?.[0]?.profile?.name || "مستخدم واتساب";

    // تهيئة حالة المستخدم
    if (!users[from]) users[from] = { greeted: false, ticketId: null, support: false };
    const user = users[from];

    // استخراج محتوى الرسالة
    let text = "";
    let replyId = "";
    if (msg.type === "text") text = msg.text.body;
    if (msg.type === "interactive") {
      replyId = msg.interactive.list_reply?.id || msg.interactive.button_reply?.id;
    }

    // 1. رسالة الترحيب (للمرة الأولى)
    if (!user.greeted) {
      await sendWhatsApp({
        messaging_product: "whatsapp",
        to: from,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: `أهلاً بك يا ${name} في خدمة العملاء 👋\nكيف يمكننا مساعدتك اليوم؟` },
          action: {
            button: "القائمة",
            sections: [
              {
                title: "اختر الخدمة",
                rows: [
                  { id: "support", title: "تحدث مع الدعم 🧑‍💻" },
                  { id: "knowledge", title: "الأسئلة الشائعة 📘" }
                ]
              }
            ]
          }
        }
      });
      user.greeted = true;
      return res.sendStatus(200);
    }

    // 2. معالجة خيار "الأسئلة الشائعة"
    if (replyId === "knowledge") {
      await sendWhatsApp({
        messaging_product: "whatsapp",
        to: from,
        type: "text",
        text: { body: `يمكنك زيارة مركز المساعدة عبر الرابط التالي:\n${KNOWLEDGE_LINK}` }
      });
      return res.sendStatus(200);
    }

    // 3. معالجة خيار "الدعم الفني" (فتح تذكرة)
    if (replyId === "support") {
      if (!user.ticketId) {
        // إنشاء تذكرة جديدة
        user.ticketId = await createZammadTicket({ name, from });
        user.support = true;
      }
      await sendWhatsApp({
        messaging_product: "whatsapp",
        to: from,
        type: "text",
        text: { body: "تم فتح تذكرة دعم لك ✅\nتفضل بكتابة مشكلتك الآن، وسيرد عليك أحد الموظفين قريباً." }
      });
      return res.sendStatus(200);
    }

    // 4. استقبال رسائل المحادثة وإرسالها للتذكرة
    if (user.support && user.ticketId) {
      const payload = { 
        ticket_id: user.ticketId, 
        internal: false,
        from: name 
      };

      if (msg.type === "text") {
        payload.body = text;
      } 
      else if (["image", "video", "audio", "document"].includes(msg.type)) {
        const mediaId = msg[msg.type].id;
        const media = await downloadMedia(mediaId);
        if (media) {
          payload.body = `مرفق جديد: ${msg.type}`;
          payload.attachments = [{ 
            filename: `${msg.type}_${Date.now()}.${media.ext}`, 
            data: media.data, 
            "mime-type": media.mime_type 
          }];
        } else {
          payload.body = "مرفق (فشل التحميل)";
        }
      } else {
        payload.body = "رسالة من نوع غير مدعوم";
      }

      await addZammadArticle(payload);
      return res.sendStatus(200);
    }

    return res.sendStatus(200);

  } catch (e) {
    console.error("Webhook Error:", e.message);
    res.sendStatus(200);
  }
});

// تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Zammad Webhook URL: http://YOUR_IP:${PORT}/zammad/webhook`);
});