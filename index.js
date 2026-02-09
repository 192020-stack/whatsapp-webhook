import express from "express";
import axios from "axios";
import sharp from "sharp"; // npm install sharp

const app = express();
app.use(express.json());

// ====================================
// إعدادات Zammad و WhatsApp
// ====================================
const ZAMMAD_BASE_URL = "http://102.203.200.112"; 
const ZAMMAD_TOKEN = "fk6ykJgBmcI9ILMhH1dPpEaETsQiU7tzJeaX3NWjnxl9w2OXLgRE-TlNz0YyF2w8";
const KNOWLEDGE_LINK = "http://102.203.200.112/help/ar?preview_token=awTUB6dcksRTfDSveLu7YRcpuBoSNpthYlSKg4NHGGs30KAWLBchsPsrh6mgDFe-";
const WHATSAPP_TOKEN = "EAA4bHf77siABQt0Nqf8trAwSwv5XL6E0NA0Xp1YbWnIDvUOa47PnquWUUBDtg9I3FkQtdyZCihqiwant2kWMeN3Hhrnbi3fP2z6saoE8eGOgWPqkUjVBolfZAgVa2o7oQrLr7iLX5NMdpv1vZAttk9qyGMfPp6j0Wxl5aCxzZC4a72O2WE5Ht3QgFFWep1ThHwZDZD";
const WHATSAPP_PHONE_ID = "1004684596056367";

// ====================================
const users = {};

// ====================================
async function sendWhatsApp(payload) {
  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (e) {
    console.error("WhatsApp Error:", e.response?.data || e.message);
  }
}

// ====================================
// تحميل ميديا من WhatsApp
// ====================================
async function downloadMedia(mediaId) {
  try {
    const metaRes = await axios.get(
      `https://graph.facebook.com/v17.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );

    const url = metaRes.data.url;
    const mime_type = metaRes.data.mime_type;

    const mediaRes = await axios.get(url, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
      responseType: "arraybuffer"
    });

    const data = Buffer.from(mediaRes.data, "binary").toString("base64");
    return { data, mime_type };
  } catch (err) {
    console.error("Media download error:", err.message);
    return null;
  }
}

// ====================================
// Webhook
// ====================================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const contact = req.body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0];
  if (!msg) return;

  const from = msg.from;
  const name = contact?.profile?.name || "مستخدم";

  if (!users[from]) {
    users[from] = { greeted: false, ticketId: null, support: false };
  }

  const user = users[from];
  let replyId = "";
  let text = "";

  if (msg.type === "interactive") replyId = msg.interactive.list_reply?.id;
  if (msg.type === "text") text = msg.text.body;

  // ====================================
  // الرسالة الأولى
  // ====================================
  if (!user.greeted) {
    await sendWhatsApp({
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: `مرحبًا ${name} 👋\n\nأهلًا بك في *رقمنة للخدمات التقنية*\nكيف نقدر نساعدك؟ اختر من الخيارات 👇`
        },
        action: {
          button: "اختر",
          sections: [
            {
              title: "الخدمات",
              rows: [
                { id: "knowledge", title: "📘 الأسئلة الشائعة" },
                { id: "support", title: "🧑‍💼 الدعم الفني" }
              ]
            }
          ]
        }
      }
    });
    user.greeted = true;
    return;
  }

  // ====================================
  // الأسئلة والمشاكل الشائعة
  // ====================================
  if (replyId === "knowledge") {
    await sendWhatsApp({
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text: "📘 اضغط الزر بالأسفل للاطلاع على الأسئلة والمشاكل الشائعة" },
        action: { name: "cta_url", parameters: { display_text: "فتح الأسئلة الشائعة", url: KNOWLEDGE_LINK } }
      }
    });
    return;
  }

  // ====================================
  // الدعم الفني
  // ====================================
  if (replyId === "support") {
    if (!user.ticketId) {
      const zammad = await axios.post(
        `${ZAMMAD_BASE_URL}/api/v1/tickets`,
        {
          title: `WhatsApp - ${name} (${from})`,
          group: "Users",
          customer_id: 1,
          article: { body: `تم بدء تواصل دعم عبر WhatsApp\n\nالاسم: ${name}\nالرقم: ${from}`, type: "note", internal: false }
        },
        { headers: { Authorization: `Token token=${ZAMMAD_TOKEN}`, "Content-Type": "application/json" } }
      );
      user.ticketId = zammad.data.id;
      user.support = true;
    }

    await sendWhatsApp({
      messaging_product: "whatsapp",
      to: from,
      text: {
        body:
          "✍️ تفضل بكتابة رسالتك أو سؤالك أو طلب المساعدة، " +
          "وسيقوم فريقنا بالرد عليك في أقرب وقت ممكن."
      }
    });
    return;
  }

  // ====================================
  // رسائل الدعم → Zammad (Text + Media)
  // ====================================
  if (user.support && user.ticketId) {
    let articlePayload = { ticket_id: user.ticketId, body: text || "رسالة من المستخدم", type: "note", internal: false };

    // ====================================
    // معالجة الميديا
    // ====================================
    if (msg.type === "image" || msg.type === "video" || msg.type === "audio" || msg.type === "document") {
      try {
        const mediaId = msg[msg.type].id;
        const mediaData = await downloadMedia(mediaId);

        if (mediaData) {
          let { data, mime_type } = mediaData;

          // تحويل WebP إلى JPEG إذا كان لازم
          if (mime_type === "image/webp") {
            const buffer = Buffer.from(data, "base64");
            const jpegBuffer = await sharp(buffer).jpeg().toBuffer();
            data = jpegBuffer.toString("base64");
            mime_type = "image/jpeg";
          }

          const extension = mime_type.split("/")[1] || "bin";
          const fileName = `file.${extension}`;

          articlePayload.body = `📎 ${msg.type} من المستخدم`;
          articlePayload.attachments = [
            {
              data,
              mime_type,
              name: fileName
            }
          ];
        } else {
          articlePayload.body = `📎 ${msg.type} غير متاحة للتحميل`;
        }
      } catch (err) {
        console.error("Media processing error:", err.message);
      }
    }

    try {
      await axios.post(
        `${ZAMMAD_BASE_URL}/api/v1/ticket_articles`,
        articlePayload,
        { headers: { Authorization: `Token token=${ZAMMAD_TOKEN}`, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("Zammad Error:", err.response?.data || err.message);
    }
  }
});

// ====================================
app.get("/", (req, res) => {
  res.send("Webhook running ✅");
});

app.listen(10000, () => {
  console.log("Server running on port 10000");
});
