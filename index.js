/**
 * WhatsApp (Cloud API) -> Webhook -> Zammad
 * Supports: text, image, video, audio (voice notes), document
 * + Outbound Support (Zammad -> WhatsApp)
 */

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(bodyParser.json({ limit: "25mb" })); 

// ====================================
// إعدادات Zammad و WhatsApp
// ====================================
const ZAMMAD_BASE_URL = "http://102.203.200.112"; 
const ZAMMAD_TOKEN = "fk6ykJgBmcI9ILMhH1dPpEaETsQiU7tzJeaX3NWjnxl9w2OXLgRE-TlNz0YyF2w8";
const KNOWLEDGE_LINK = "http://102.203.200.112/help/ar?preview_token=awTUB6dcksRTfDSveLu7YRcpuBoSNpthYlSKg4NHGGs30KAWLBchsPsrh6mgDFe-";
const WHATSAPP_TOKEN = "EAA4bHf77siABQt0Nqf8trAwSwv5XL6E0NA0Xp1YbWnIDvUOa47PnquWUUBDtg9I3FkQtdyZCihqiwant2kWMeN3Hhrnbi3fP2z6saoE8eGOgWPqkUjVBolfZAgVa2o7oQrLr7iLX5NMdpv1vZAttk9qyGMfPp6j0Wxl5aCxzZC4a72O2WE5Ht3QgFFWep1ThHwZDZD";
const WHATSAPP_PHONE_ID = "1004684596056367";
const GRAPH_VERSION = "v19.0"; 
const ZAMMAD_GROUP = "Users";  
const DEFAULT_CUSTOMER_ID = "1"; 
const PORT = 10000; 
const VERIFY_TOKEN = "my_verify_token"; 
const META_APP_SECRET = ""; 

// =============================
// IN-MEMORY SESSION STATE
// =============================
const users = {}; 

// =============================
// HELPERS
// =============================

function verifyMetaSignature(req) {
  if (!META_APP_SECRET) return true;
  const signature = req.headers["x-hub-signature-256"];
  if (!signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", META_APP_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

async function sendWhatsApp(payload) {
  if (!WHATSAPP_PHONE_ID) throw new Error("Missing WHATSAPP_PHONE_ID");
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_PHONE_ID}/messages`;
  await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
}

async function downloadMedia(mediaId) {
  if (!mediaId) return null;
  const meta = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
  const url = meta.data?.url;
  const mime_type = meta.data?.mime_type;
  if (!url || !mime_type) return null;
  const bin = await axios.get(url, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  const buffer = Buffer.from(bin.data);
  if (!buffer.length) return null;
  let ext = mime_type.split("/")[1] || "bin";
  if (mime_type === "audio/ogg") ext = "ogg";
  if (mime_type === "audio/mpeg") ext = "mp3";
  if (mime_type === "image/jpeg") ext = "jpg";
  return { data: buffer.toString("base64"), mime_type, ext };
}

async function createZammadTicket({ name, from }) {
  const res = await axios.post(
    `${ZAMMAD_BASE_URL}/api/v1/tickets`,
    {
      title: `WhatsApp - ${name} (${from})`,
      group: ZAMMAD_GROUP,
      customer_id: Number(DEFAULT_CUSTOMER_ID),
      article: {
        body: `تم بدء تواصل دعم عبر WhatsApp\n\nالاسم: ${name}\nالرقم: ${from}`,
        type: "note",
        internal: false,
      },
    },
    {
      headers: {
        Authorization: `Token token=${ZAMMAD_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
  return res.data?.id;
}

async function addZammadArticle(articlePayload) {
  await axios.post(`${ZAMMAD_BASE_URL}/api/v1/ticket_articles`, articlePayload, {
    headers: {
      Authorization: `Token token=${ZAMMAD_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
}

// =============================
// [جديد] استقبال الردود من ZAMMAD
// =============================
app.post("/zammad/webhook", async (req, res) => {
  try {
    const { ticket, article } = req.body;

    // تجاهل التحديثات التي ليست "مقالات" أو إذا كانت ملاحظة داخلية
    if (!article || article.internal === true) {
      return res.status(200).send("Ignored (internal or no article)");
    }

    // تجاهل الرسائل القادمة من "Customer" (حتى لا يحدث تكرار لانهائي للرسائل الواردة)
    // وتجاهل رسائل النظام
    if (article.sender === "Customer" || article.sender === "System") {
      return res.status(200).send("Ignored (customer/system message)");
    }

    // استخراج رقم الهاتف من عنوان التذكرة
    // التنسيق المستخدم في الكود هو: WhatsApp - Name (Phone)
    // سنستخدم Regex لاستخراج الرقم بين القوسين
    const title = ticket.title || "";
    const phoneMatch = title.match(/\(([^)]+)\)/); // البحث عن نص بين قوسين
    const phoneNumber = phoneMatch ? phoneMatch[1] : null;

    if (!phoneNumber) {
      console.log("Could not extract phone number from ticket title:", title);
      return res.status(200).send("No phone number found");
    }

    // تنظيف نص الرسالة من HTML (لأن Zammad يرسل HTML)
    let messageBody = article.body || "";
    // حذف وسوم HTML البسيطة لتبقى الرسالة نظيفة
    messageBody = messageBody.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();

    if (!messageBody) return res.status(200).send("Empty body");

    // إرسال الرد إلى واتساب
    await sendWhatsApp({
      messaging_product: "whatsapp",
      to: phoneNumber,
      type: "text",
      text: { body: messageBody },
    });

    console.log(`✅ Reply sent to ${phoneNumber} from Zammad`);
    return res.status(200).send("Sent");

  } catch (error) {
    console.error("Zammad Webhook Error:", error.message);
    return res.status(500).send("Error");
  }
});

// =============================
// WEBHOOK VERIFY (GET)
// =============================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// =============================
// WEBHOOK RECEIVE (POST)
// =============================
app.post("/webhook", async (req, res) => {
  try {
    if (!verifyMetaSignature(req)) return res.status(401).send("Invalid signature");

    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;
    const contacts = value?.contacts;

    if (!messages || !messages.length) return res.sendStatus(200);

    const msg = messages[0];
    const from = msg.from;
    const contact = contacts?.[0];
    const name = contact?.profile?.name || "مستخدم";

    if (!users[from]) users[from] = { greeted: false, ticketId: null, support: false };
    const user = users[from];

    let replyId = "";
    let text = "";

    if (msg.type === "interactive") {
      replyId = msg.interactive?.list_reply?.id || msg.interactive?.button_reply?.id || "";
    }
    if (msg.type === "text") text = msg.text?.body || "";

    // الرسالة الأولى
    if (!user.greeted) {
      await sendWhatsApp({
        messaging_product: "whatsapp",
        to: from,
        type: "interactive",
        interactive: {
          type: "list",
          body: {
            text: `مرحبًا ${name} 👋\n\nأهلًا بك في *رقمنة للخدمات التقنية*\nكيف نقدر نساعدك؟ اختر من الخيارات 👇`,
          },
          action: {
            button: "اختر",
            sections: [
              {
                title: "الخدمات",
                rows: [
                  { id: "knowledge", title: "📘 الأسئلة الشائعة" },
                  { id: "support", title: "🧑‍💼 الدعم الفني" },
                ],
              },
            ],
          },
        },
      });
      user.greeted = true;
      return res.sendStatus(200);
    }

    // الأسئلة الشائعة (تعديل بسيط: استخدام رابط نصي لأن cta_url يتطلب قالب أحياناً، لكن تركتها كما هي بناء لطلبك)
    if (replyId === "knowledge") {
      await sendWhatsApp({
        messaging_product: "whatsapp",
        to: from,
        type: "interactive",
        interactive: {
          type: "cta_url",
          body: { text: "📘 اضغط الزر بالأسفل للاطلاع على الأسئلة والمشاكل الشائعة" },
          action: {
            name: "cta_url",
            parameters: { display_text: "فتح الأسئلة الشائعة", url: KNOWLEDGE_LINK },
          },
        },
      });
      return res.sendStatus(200);
    }

    // الدعم الفني
    if (replyId === "support") {
      if (!user.ticketId) {
        user.ticketId = await createZammadTicket({ name, from });
        user.support = true;
      }

      await sendWhatsApp({
        messaging_product: "whatsapp",
        to: from,
        type: "text",
        text: {
          body:
            "✍️ تفضل بكتابة رسالتك أو سؤالك أو إرسال المرفقات، " +
            "وسيقوم فريقنا بالرد عليك في أقرب وقت ممكن.",
        },
      });
      return res.sendStatus(200);
    }

    // رسائل الدعم -> Zammad
    if (user.support && user.ticketId) {
      const articlePayload = { ticket_id: user.ticketId, type: "note", internal: false, body: "" };

      if (msg.type === "text") articlePayload.body = text || "(رسالة نصية فارغة)";
      else if (["image", "video", "audio", "document"].includes(msg.type)) {
        const mediaId = msg[msg.type]?.id;
        const mediaData = await downloadMedia(mediaId);

        if (mediaData?.data) {
          articlePayload.body = `📎 مرفق (${msg.type}) من المستخدم`;
          articlePayload.attachments = [
            { filename: `${msg.type}.${mediaData.ext}`, data: mediaData.data, "mime-type": mediaData.mime_type },
          ];
        } else {
          articlePayload.body = `📎 تعذّر تحميل المرفق (${msg.type}) من WhatsApp`;
        }
      } else articlePayload.body = "نوع رسالة غير مدعوم";

      await addZammadArticle(articlePayload);
      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err?.response?.data || err.message);
    return res.sendStatus(200);
  }
});

// Health check
app.get("/", (req, res) => res.send("Webhook running ✅"));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});