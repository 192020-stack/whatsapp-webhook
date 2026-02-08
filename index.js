import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// إعداداتك
const ZAMMAD_BASE_URL = "http://102.203.200.112";
const ZAMMAD_TOKEN = "fk6ykJgBmcI9ILMhH1dPpEaETsQiU7tzJeaX3NWjnxl9w2OXLgRE-TlNz0YyF2w8";
const WHATSAPP_TOKEN = "PUT_YOUR_WHATSAPP_TOKEN_HERE";
const WHATSAPP_PHONE_ID = "1004684596056367";

// دالة لإرسال رسالة نصية
async function sendWhatsAppMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: text },
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("WhatsApp send error:", error.response?.data || error.message);
  }
}

// دالة لإرسال زر Quick Reply
async function sendQuickReply(to, bodyText, buttonText, payloadText) {
  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: bodyText },
          action: { buttons: [{ type: "reply", reply: { id: payloadText, title: buttonText } }] },
        },
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("WhatsApp quick reply error:", error.response?.data || error.message);
  }
}

// البحث عن تيكت اليوم
async function getTodaysTicket(phone) {
  try {
    const today = new Date().toISOString().split("T")[0];
    const res = await axios.get(`${ZAMMAD_BASE_URL}/api/v1/tickets/search?query=${phone}`, {
      headers: { Authorization: `Token token=${ZAMMAD_TOKEN}` },
    });
    const tickets = res.data;
    return tickets.find((t) => t.created_at.startsWith(today));
  } catch (error) {
    console.error("Zammad get ticket error:", error.response?.data || error.message);
    return null;
  }
}

// إنشاء تيكت جديد
async function createZammadTicket(phone, message) {
  try {
    const res = await axios.post(
      `${ZAMMAD_BASE_URL}/api/v1/tickets`,
      { title: `WhatsApp Ticket - ${phone}`, group: "Users", article: { body: message, type: "note", internal: false }, customer_id: 1 },
      { headers: { Authorization: `Token token=${ZAMMAD_TOKEN}`, "Content-Type": "application/json" } }
    );
    return res.data;
  } catch (error) {
    console.error("Zammad create ticket error:", error.response?.data || error.message);
    return null;
  }
}

// إضافة رسالة لتذكرة موجودة
async function appendToZammadTicket(ticketId, message) {
  try {
    await axios.post(
      `${ZAMMAD_BASE_URL}/api/v1/tickets/${ticketId}/articles`,
      { body: message, type: "note", internal: false },
      { headers: { Authorization: `Token token=${ZAMMAD_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Zammad append ticket error:", error.response?.data || error.message);
  }
}

// =======================
// استقبال رسائل واتساب
// =======================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // نرد بسرعة لتجنب timeout

  const entry = req.body.entry?.[0];
  const change = entry?.changes?.[0];
  const messageObj = change?.value?.messages?.[0];

  if (!messageObj) return;

  const fromNumber = messageObj.from;
  const fromName = messageObj.profile?.name || fromNumber;
  const messageText = messageObj.text?.body || "";

  // إذا الرسالة من الضغط على زر Quick Reply
  const isSupportRequest = messageObj.type === "button" || messageText.includes("تواصل مع الدعم");

  let ticket = await getTodaysTicket(fromNumber);

  if (!ticket) {
    // أول رسالة اليوم → إرسال ترحيب + زر
    const welcomeBody = `مرحباً ${fromName} 👋
شكراً لتواصلك معنا.
يمكنك زيارة مركز المعرفة الخاص بنا لحل مشاكلك: 
http://102.203.200.112/#knowledge_base/1/locale/ar

إذا لم تجد الحلول، اضغط على الزر أدناه لتواصل مع الدعم.`;
    await sendQuickReply(fromNumber, welcomeBody, "تواصل مع الدعم", "support_request");

    // إنشاء تيكت جديد بعد الضغط على زر أو أي رسالة دعم
    if (isSupportRequest || messageText !== "") {
      ticket = await createZammadTicket(fromNumber, messageText);
    }
  } else {
    // يوجد تيكت اليوم → أضف الرسالة لتذكرة موجودة
    await appendToZammadTicket(ticket.id, messageText);
  }
});

// =======================
// التحقق من Webhook (Meta requirement)
// =======================
app.get("/webhook", (req, res) => {
  const verify_token = "YOUR_VERIFY_TOKEN";
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === verify_token) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// =======================
// تشغيل السيرفر
// =======================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
