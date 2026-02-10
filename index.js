/**
 * WhatsApp (Cloud API) -> Webhook -> Zammad
 * Supports: text, image, video, audio (voice notes), document
 * + Outbound Support (Zammad -> WhatsApp)
 * + Auto Customer Creation & Chat Type Support
 * [Full Complete Code - النسخة النهائية الشاملة والمصلحة]
 */

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");
const FormData = require("form-data");
const path = require("path"); // لإستخراج امتداد الملف وتحديد النوع

const app = express();
// زيادة حجم الطلب لاستيعاب الصور والمرفقات المرفوعة
app.use(bodyParser.json({ limit: "50mb" })); 

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

// دالة لتخمين نوع الملف بناءً على الامتداد لحل مشكلة الخطأ 400 في واتساب
function getMimeType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.3gp': 'video/3gpp',
    '.mpeg': 'audio/mpeg',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg; codecs=opus',
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain'
  };
  return map[ext] || 'application/octet-stream';
}

function verifyMetaSignature(req) {
  if (!META_APP_SECRET) return true;
  const signature = req.headers["x-hub-signature-256"];
  if (!signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", META_APP_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// دالة رفع الميديا لواتساب مع تحديد نوع المحتوى بدقة
async function uploadMediaToWhatsApp(buffer, fileName) {
  const mimeType = getMimeType(fileName);
  console.log(`🚀 [Media Upload] Starting upload: ${fileName} as ${mimeType}`);
  const form = new FormData();
  form.append('file', buffer, { filename: fileName, contentType: mimeType });
  form.append('messaging_product', 'whatsapp');

  try {
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
    console.log(`✅ [Media Upload] ID: ${res.data.id}`);
    return res.data.id;
  } catch (error) {
    console.error(`❌ [Media Upload] Error:`, error.response?.data || error.message);
    throw error;
  }
}

async function sendWhatsApp(payload) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_PHONE_ID}/messages`;
  try {
    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
    console.log(`✅ [WhatsApp Send] Message sent successfully`);
  } catch (error) {
    console.error(`❌ [WhatsApp Send] Error:`, error.response?.data || error.message);
  }
}

async function downloadMedia(mediaId) {
  console.log(`📥 [Media Download] ID: ${mediaId}`);
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
    if (mime_type === "audio/ogg") ext = "ogg";
    if (mime_type === "audio/mpeg") ext = "mp3";
    if (mime_type === "image/jpeg") ext = "jpg";
    
    return { data: buffer.toString("base64"), mime_type, ext };
  } catch (err) {
    console.error(`❌ [Media Download] Error:`, err.message);
    return null;
  }
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
    return Number(DEFAULT_CUSTOMER_ID); 
  }
}

async function createZammadTicket({ name, from }) {
  const customerId = await getOrCreateCustomer(name, from);
  const res = await axios.post(
    `${ZAMMAD_BASE_URL}/api/v1/tickets`,
    {
      title: `WhatsApp - ${name} (${from})`,
      group: ZAMMAD_GROUP,
      customer_id: customerId, 
      article: {
        body: `تم بدء تواصل دعم عبر WhatsApp\n\nالاسم: ${name}\nالرقم: ${from}`,
        type: "chat", internal: false, sender: "Customer", from: name 
      },
    },
    { headers: { Authorization: `Token token=${ZAMMAD_TOKEN}`, "Content-Type": "application/json" } }
  );
  return res.data?.id;
}

async function addZammadArticle(articlePayload) {
  articlePayload.type = "chat";
  articlePayload.sender = "Customer";
  try {
    await axios.post(`${ZAMMAD_BASE_URL}/api/v1/ticket_articles`, articlePayload, {
      headers: { Authorization: `Token token=${ZAMMAD_TOKEN}`, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("❌ [Zammad Add Article] Error:", err.message);
  }
}

// ============================================================
// [النسخة النهائية] - دعم الصور، الفيديو، والصوت (Zammad -> WhatsApp)
// ============================================================
app.post("/zammad/webhook", async (req, res) => {
  console.log("📨 [Webhook Zammad] Event received");
  try {
    const { ticket, article } = req.body;

    if (!article || article.internal || article.sender === "Customer" || article.sender === "System") {
      return res.sendStatus(200);
    }

    const phoneMatch = (ticket.title || "").match(/\(([^)]+)\)/);
    const phoneNumber = phoneMatch ? phoneMatch[1] : null;
    if (!phoneNumber) return res.status(200).send("No phone found");

    let messageBody = (article.body || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();

    if (article.attachments && article.attachments.length > 0) {
      console.log(`📎 Found ${article.attachments.length} attachments.`);
      
      for (const att of article.attachments) {
        try {
          // استخدام المسار البديل الناجح
          const successUrl = `${ZAMMAD_BASE_URL}/api/v1/attachments/${att.id}?ticket_id=${ticket.id}&article_id=${article.id}`;
          console.log(`☁️ Downloading attachment: ${att.filename}`);

          const response = await axios.get(successUrl, {
            headers: { "Authorization": `Token token=${ZAMMAD_TOKEN}` },
            responseType: 'arraybuffer'
          });

          // رفع الميديا مع تحديد النوع الصحيح
          const mediaId = await uploadMediaToWhatsApp(Buffer.from(response.data), att.filename);
          const mimeType = getMimeType(att.filename);

          let mediaType = "document";
          if (mimeType.includes("image")) mediaType = "image";
          else if (mimeType.includes("video")) mediaType = "video";
          else if (mimeType.includes("audio")) mediaType = "audio";

          const payload = {
            messaging_product: "whatsapp",
            to: phoneNumber,
            type: mediaType,
            [mediaType]: { id: mediaId }
          };

          // إضافة Caption للصور والفيديو فقط
          if ((mediaType === "image" || mediaType === "video") && messageBody) {
            payload[mediaType].caption = messageBody;
            messageBody = ""; 
          }

          await sendWhatsApp(payload);
          console.log(`✅ [Success] ${mediaType} sent to WhatsApp.`);
          
        } catch (err) {
          console.error(`❌ Error processing attachment ${att.id}:`, err.message);
        }
      }
    } 

    // إرسال ما تبقى من النص كرسالة منفصلة
    if (messageBody) {
      await sendWhatsApp({
        messaging_product: "whatsapp",
        to: phoneNumber,
        type: "text",
        text: { body: messageBody },
      });
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("❌ [Global Outbound Error]:", error.message);
    return res.sendStatus(500);
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
// WEBHOOK RECEIVE (POST) - استقبال من الواتساب
// =============================
app.post("/webhook", async (req, res) => {
  try {
    if (!verifyMetaSignature(req)) return res.status(401).send("Invalid signature");

    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const messages = value?.messages;
    const contacts = value?.contacts;

    if (!messages || !messages.length) return res.sendStatus(200);

    const msg = messages[0];
    const from = msg.from;
    const name = contacts?.[0]?.profile?.name || "مستخدم";

    if (!users[from]) users[from] = { greeted: false, ticketId: null, support: false };
    const user = users[from];

    let replyId = "";
    let text = "";

    if (msg.type === "interactive") {
      replyId = msg.interactive?.list_reply?.id || msg.interactive?.button_reply?.id || "";
    }
    if (msg.type === "text") text = msg.text?.body || "";

    if (!user.greeted) {
      await sendWhatsApp({
        messaging_product: "whatsapp", to: from, type: "interactive",
        interactive: {
          type: "list",
          body: { text: `مرحبًا ${name} 👋\n\nأهلًا بك في *رقمنة للخدمات التقنية*\nكيف نقدر نساعدك؟ اختر من الخيارات 👇` },
          action: {
            button: "اختر",
            sections: [{
              title: "الخدمات",
              rows: [{ id: "knowledge", title: "📘 الأسئلة الشائعة" }, { id: "support", title: "🧑‍💼 الدعم الفني" }]
            }]
          }
        }
      });
      user.greeted = true;
      return res.sendStatus(200);
    }

    if (replyId === "knowledge") {
      await sendWhatsApp({
        messaging_product: "whatsapp", to: from, type: "interactive",
        interactive: {
          type: "cta_url",
          body: { text: "📘 اضغط الزر بالأسفل للاطلاع على الأسئلة الشائعة" },
          action: { name: "cta_url", parameters: { display_text: "فتح الأسئلة", url: KNOWLEDGE_LINK } }
        }
      });
      return res.sendStatus(200);
    }

    if (replyId === "support") {
      if (!user.ticketId) {
        user.ticketId = await createZammadTicket({ name, from });
        user.support = true;
      }
      await sendWhatsApp({
        messaging_product: "whatsapp", to: from, type: "text",
        text: { body: "✍️ تفضل بكتابة رسالتك وسنقوم بالرد عليك في أقرب وقت." }
      });
      return res.sendStatus(200);
    }

    if (user.support && user.ticketId) {
      const articlePayload = { ticket_id: user.ticketId, from: name, body: "" };

      if (msg.type === "text") {
        articlePayload.body = text || "(رسالة نصية)";
      } else if (["image", "video", "audio", "document"].includes(msg.type)) {
        const mediaData = await downloadMedia(msg[msg.type]?.id);
        if (mediaData?.data) {
          articlePayload.body = msg[msg.type]?.caption || `📎 مرفق (${msg.type})`;
          articlePayload.attachments = [{
            filename: `${msg.type}.${mediaData.ext}`,
            data: mediaData.data,
            "mime-type": mediaData.mime_type
          }];
        }
      }
      await addZammadArticle(articlePayload);
    }
    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook Receive Error:", err.message);
    return res.sendStatus(200);
  }
});

app.get("/", (req, res) => res.send("Webhook running ✅"));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});