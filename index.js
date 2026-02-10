/**
 * WhatsApp (Cloud API) -> Webhook -> Zammad
 * Supports: text, image, video, audio (voice notes), document
 * + Outbound Support (Zammad -> WhatsApp)
 * [تعديل]: إرسال النص كمرفق (Caption) مع الصور لضمان وصول الرسالة كاملة
 */

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");
const FormData = require("form-data");

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

async function uploadMediaToWhatsApp(buffer, fileName, mimeType) {
  const form = new FormData();
  form.append('file', buffer, { filename: fileName, contentType: mimeType });
  form.append('messaging_product', 'whatsapp');

  const res = await axios.post(
    `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_PHONE_ID}/media`,
    form,
    {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      },
    }
  );
  return res.data.id;
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
  return { data: buffer.toString("base64"), mime_type, ext };
}

async function getOrCreateCustomer(name, phone) {
  try {
    const search = await axios.get(`${ZAMMAD_BASE_URL}/api/v1/users/search?query=phone:${phone}`, {
      headers: { Authorization: `Token token=${ZAMMAD_TOKEN}` }
    });
    if (search.data && search.data.length > 0) return search.data[0].id;
    const newUser = await axios.post(`${ZAMMAD_BASE_URL}/api/v1/users`, {
      firstname: name, lastname: "(WhatsApp)", phone: phone, roles: ["Customer"]
    }, {
      headers: { Authorization: `Token token=${ZAMMAD_TOKEN}` }
    });
    return newUser.data.id;
  } catch (err) {
    console.error("Error creating/finding customer:", err.message);
    return Number(DEFAULT_CUSTOMER_ID); 
  }
}

async function createZammadTicket({ name, from }) {
  const customerId = await getOrCreateCustomer(name, from);
  const res = await axios.post(`${ZAMMAD_BASE_URL}/api/v1/tickets`, {
    title: `WhatsApp - ${name} (${from})`,
    group: ZAMMAD_GROUP,
    customer_id: customerId, 
    article: {
      body: `تم بدء تواصل دعم عبر WhatsApp\n\nالاسم: ${name}\nالرقم: ${from}`,
      type: "chat", internal: false, sender: "Customer", from: name 
    },
  }, { headers: { Authorization: `Token token=${ZAMMAD_TOKEN}` } });
  return res.data?.id;
}

async function addZammadArticle(articlePayload) {
  articlePayload.type = "chat";
  articlePayload.sender = "Customer";
  await axios.post(`${ZAMMAD_BASE_URL}/api/v1/ticket_articles`, articlePayload, {
    headers: { Authorization: `Token token=${ZAMMAD_TOKEN}`, "Content-Type": "application/json" }
  });
}

// ============================================================
// استقبال الردود من ZAMMAD (Outbound) - النسخة المعدلة لدمج المرفق مع النص
// ============================================================
app.post("/zammad/webhook", async (req, res) => {
  try {
    const { ticket, article } = req.body;

    if (!article || article.internal === true) return res.status(200).send("Ignored");
    if (article.sender === "Customer" || article.sender === "System") return res.status(200).send("Ignored");

    const phoneMatch = (ticket.title || "").match(/\(([^)]+)\)/);
    const phoneNumber = phoneMatch ? phoneMatch[1] : null;
    if (!phoneNumber) return res.status(200).send("No phone found");

    // تجهيز النص وتنظيفه
    let messageBody = (article.body || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();

    // 1. التعامل مع المرفقات
    if (article.attachments && article.attachments.length > 0) {
      for (const att of article.attachments) {
        try {
          const response = await axios.get(
            `${ZAMMAD_BASE_URL}/api/v1/ticket_attachment_download/${ticket.id}/${article.id}/${att.id}`,
            { headers: { Authorization: `Token token=${ZAMMAD_TOKEN}` }, responseType: 'arraybuffer' }
          );

          const mediaId = await uploadMediaToWhatsApp(Buffer.from(response.data), att.filename, att.content_type);

          let type = "document";
          if (att.content_type.includes("image")) type = "image";
          else if (att.content_type.includes("video")) type = "video";

          // إرسال المرفق مع النص كـ Caption
          await sendWhatsApp({
            messaging_product: "whatsapp",
            to: phoneNumber,
            type: type,
            [type]: { 
              id: mediaId,
              caption: messageBody // هنا يتم دمج النص مع المرفق
            }
          });

          // تصفير النص بعد أول مرفق لمنع تكراره إذا كانت هناك مرفقات متعددة
          messageBody = ""; 
        } catch (mediaErr) {
          console.error("❌ Media Send Error:", mediaErr.message);
        }
      }
    }

    // 2. إذا تبقى نص (في حال عدم وجود مرفقات)، نرسله كرسالة نصية عادية
    if (messageBody) {
      await sendWhatsApp({
        messaging_product: "whatsapp",
        to: phoneNumber,
        type: "text",
        text: { body: messageBody },
      });
    }

    console.log(`✅ Reply processed for ${phoneNumber}`);
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
  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// =============================
// WEBHOOK RECEIVE (POST)
// =============================
app.post("/webhook", async (req, res) => {
  try {
    if (!verifyMetaSignature(req)) return res.status(401).send("Invalid signature");

    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const messages = value?.messages;
    if (!messages || !messages.length) return res.sendStatus(200);

    const msg = messages[0];
    const from = msg.from;
    const name = value?.contacts?.[0]?.profile?.name || "مستخدم";

    if (!users[from]) users[from] = { greeted: false, ticketId: null, support: false };
    const user = users[from];

    let replyId = msg.type === "interactive" ? (msg.interactive?.list_reply?.id || msg.interactive?.button_reply?.id) : "";
    let text = msg.type === "text" ? msg.text?.body : "";

    if (!user.greeted) {
      await sendWhatsApp({
        messaging_product: "whatsapp", to: from, type: "interactive",
        interactive: {
          type: "list",
          body: { text: `مرحبًا ${name} 👋\n\nأهلًا بك في *رقمنة للخدمات التقنية*\nكيف نقدر نساعدك؟ اختر من الخيارات 👇` },
          action: { button: "اختر", sections: [{ title: "الخدمات", rows: [{ id: "knowledge", title: "📘 الأسئلة الشائعة" }, { id: "support", title: "🧑‍💼 الدعم الفني" }] }] }
        }
      });
      user.greeted = true;
      return res.sendStatus(200);
    }

    if (replyId === "knowledge") {
      await sendWhatsApp({
        messaging_product: "whatsapp", to: from, type: "interactive",
        interactive: { type: "cta_url", body: { text: "📘 الأسئلة الشائعة" }, action: { name: "cta_url", parameters: { display_text: "فتح الأسئلة الشائعة", url: KNOWLEDGE_LINK } } }
      });
    } else if (replyId === "support") {
      if (!user.ticketId) {
        user.ticketId = await createZammadTicket({ name, from });
        user.support = true;
      }
      await sendWhatsApp({ messaging_product: "whatsapp", to: from, type: "text", text: { body: "✍️ تفضل بكتابة رسالتك وسنقوم بالرد عليك." } });
    } else if (user.support && user.ticketId) {
      const articlePayload = { ticket_id: user.ticketId, body: "" };
      if (msg.type === "text") articlePayload.body = text || "(رسالة نصية فارغة)";
      else if (["image", "video", "audio", "document"].includes(msg.type)) {
        const mediaData = await downloadMedia(msg[msg.type]?.id);
        if (mediaData?.data) {
          articlePayload.body = msg[msg.type]?.caption || `📎 مرفق (${msg.type})`;
          articlePayload.attachments = [{ filename: `${msg.type}.${mediaData.ext}`, data: mediaData.data, "mime-type": mediaData.mime_type }];
        }
      }
      await addZammadArticle(articlePayload);
    }
    return res.sendStatus(200);
  } catch (err) {
    return res.sendStatus(200);
  }
});

// Health check & Server Start
app.get("/", (req, res) => res.send("Webhook running ✅"));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));