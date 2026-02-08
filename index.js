import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ====================================
// إعدادات Zammad و WhatsApp
// ====================================
const ZAMMAD_BASE_URL = "http://102.203.200.112"; 
const ZAMMAD_TOKEN = "fk6ykJgBmcI9ILMhH1dPpEaETsQiU7tzJeaX3NWjnxl9w2OXLgRE-TlNz0YyF2w8"; 
const KNOWLEDGE_LINK = "http://102.203.200.112/#knowledge_base/1/locale/ar";
const WHATSAPP_TOKEN = "EAA4bHf77siABQt0Nqf8trAwSwv5XL6E0NA0Xp1YbWnIDvUOa47PnquWUUBDtg9I3FkQtdyZCihqiwant2kWMeN3Hhrnbi3fP2z6saoE8eGOgWPqkUjVBolfZAgVa2o7oQrLr7iLX5NMdpv1vZAttk9qyGMfPp6j0Wxl5aCxzZC4a72O2WE5Ht3QgFFWep1ThHwZDZD";
const WHATSAPP_PHONE_ID = "1004684596056367";

// ====================================
// قاعدة بيانات مؤقتة لكل مستخدم
// ====================================
const userTickets = {}; 

// ====================================
// دالة لإرسال رسالة WhatsApp
// ====================================
async function sendWhatsAppMessage(to, message, buttons = null) {
  try {
    const payload = { messaging_product: "whatsapp", to, type: "text", text: { body: message } };

    if (buttons) {
      payload.type = "interactive";
      payload.interactive = {
        type: "button",
        body: { text: message },
        action: { buttons },
      };
    }

    await axios.post(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("WhatsApp send error:", error.response?.data || error.message);
  }
}

// ====================================
// استقبال رسائل WhatsApp
// ====================================
app.post("/webhook", async (req, res) => {
  console.log("Incoming webhook:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);

  const entry = req.body.entry?.[0];
  const change = entry?.changes?.[0];
  const messageObj = change?.value?.messages?.[0];
  const contactObj = change?.value?.contacts?.[0];

  if (!messageObj) return;

  const fromNumber = messageObj.from;
  const fromName = contactObj?.profile?.name || "مستخدم";

  // تهيئة بيانات المستخدم
  if (!userTickets[fromNumber]) {
    userTickets[fromNumber] = { ticketId: null, supportActivated: false, greeted: false };
  }
  const userData = userTickets[fromNumber];

  // قراءة نص الرسالة
  let messageText = "";
  if (messageObj.type === "text") messageText = messageObj.text.body;
  else if (messageObj.type === "interactive" && messageObj.interactive.type === "button_reply") {
    messageText = messageObj.interactive.button_reply.title;
  } else return;

  // ====================================
  // إرسال رسالة الترحيب مرة واحدة مع رابط Knowledge Base أزرق
  // ====================================
  if (!userData.greeted) {
 const welcomeMessage = `مرحبًا ${fromName} 👋\n\nيمكنك تصفح حلولنا عبر Knowledge Base بالضغط على الزر أدناه أو التواصل مع الدعم إذا لم تجد إجابة لسؤالك.`;

  const buttons = [
    {
      type: "url",
      url: { id: "knowledge_base", title: "📘 تصفح المعرفة", url: KNOWLEDGE_LINK }
    },
    {
      type: "reply",
      reply: { id: "contact_support", title: "تواصل مع الدعم" }
    }
  ];

  await sendWhatsAppMessage(fromNumber, welcomeMessage, buttons);
  userData.greeted = true;
    return;
  }

  // ====================================
  // ضغط زر "تواصل مع الدعم"
  // ====================================
  if (messageText === "تواصل مع الدعم") {
    if (!userData.ticketId) {
      try {
        const zammadResponse = await axios.post(
          `${ZAMMAD_BASE_URL}/api/v1/tickets`,
          {
            title: `WhatsApp Ticket - ${fromName} (${fromNumber})`,
            group: "Users",
            article: { body: "بدء تواصل الدعم", type: "note", internal: false },
            customer_id: 1,
          },
          { headers: { Authorization: `Token token=${ZAMMAD_TOKEN}`, "Content-Type": "application/json" } }
        );
        userData.ticketId = zammadResponse.data.id;
        userData.supportActivated = true;
        console.log("Ticket created:", zammadResponse.data);
      } catch (err) {
        console.error("Zammad ticket error:", err.response?.data || err.message);
      }
    } else {
      userData.supportActivated = true;
    }
    return;
  }

  // ====================================
  // أي رسالة بعد تفعيل الدعم تتحول لتذكرة
  // ====================================
  if (userData.supportActivated && userData.ticketId) {
    try {
      await axios.post(
        `${ZAMMAD_BASE_URL}/api/v1/ticket_articles`,
        { ticket_id: userData.ticketId, body: messageText, type: "note", internal: false },
        { headers: { Authorization: `Token token=${ZAMMAD_TOKEN}`, "Content-Type": "application/json" } }
      );
      console.log(`Message appended to ticket ${userData.ticketId}`);
    } catch (err) {
      console.error("Zammad append error:", err.response?.data || err.message);
    }
    return;
  }
});

// ====================================
// اختبار السيرفر
// ====================================
app.get("/", (req, res) => {
  res.send("WhatsApp Webhook is running ✅");
});

// ====================================
// تشغيل السيرفر
// ====================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
