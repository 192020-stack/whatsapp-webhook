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
// قاعدة بيانات مؤقتة لتخزين آخر تذكرة لكل رقم
// ====================================
const userTickets = {}; // { "phoneNumber": { ticketId, date, welcomed: true/false } }

// ====================================
// دالة لإرسال رسالة WhatsApp
// ====================================
async function sendWhatsAppMessage(to, message, buttons = null) {
  try {
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message },
    };

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
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("WhatsApp send error:", error.response?.data || error.message);
  }
}

// ====================================
// دالة لإنشاء تذكرة جديدة في Zammad
// ====================================
async function createZammadTicket(phoneNumber, message) {
  try {
    const response = await axios.post(
      `${ZAMMAD_BASE_URL}/api/v1/tickets`,
      {
        title: `WhatsApp Ticket - ${phoneNumber}`,
        group: "Users",
        article: { body: message, type: "note", internal: false },
        customer_id: 1,
      },
      { headers: { Authorization: `Token token=${ZAMMAD_TOKEN}`, "Content-Type": "application/json" } }
    );
    return response.data.id;
  } catch (error) {
    console.error("Zammad create ticket error:", error.response?.data || error.message);
    return null;
  }
}

// ====================================
// دالة لإضافة رسالة لتذكرة موجودة
// ====================================
async function appendToZammadTicket(ticketId, message) {
  try {
    await axios.post(
      `${ZAMMAD_BASE_URL}/api/v1/ticket_articles`,
      { ticket_id: ticketId, body: message, type: "note", internal: false },
      { headers: { Authorization: `Token token=${ZAMMAD_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Zammad append ticket error:", error.response?.data || error.message);
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

  if (!messageObj || !["text", "button_reply"].includes(messageObj.type)) return;

  const fromNumber = messageObj.from;
  const contactName = change?.value?.contacts?.[0]?.profile?.name || "مستخدم";

  let messageText = "";
  if (messageObj.type === "text") {
    messageText = messageObj.text.body;
  } else if (messageObj.type === "interactive" && messageObj.interactive.type === "button_reply") {
    messageText = messageObj.interactive.button_reply.title;
  }

  const today = new Date().toISOString().split("T")[0];
  if (!userTickets[fromNumber]) userTickets[fromNumber] = { ticketId: null, date: today, welcomed: false };
  let ticketData = userTickets[fromNumber];

  // ====================================
  // إرسال رسالة ترحيب مرة واحدة فقط يوميًا
  // ====================================
  if (!ticketData.welcomed) {
    const welcomeMessage = `مرحبًا ${contactName} 👋\n\nيمكنك تصفح حلولنا هنا: ${KNOWLEDGE_LINK}\nأو الضغط على زر "تواصل مع الدعم" إذا لم تجد إجابة لسؤالك.`;
    const buttons = [{ type: "reply", reply: { id: "contact_support", title: "تواصل مع الدعم" } }];
    await sendWhatsAppMessage(fromNumber, welcomeMessage, buttons);
    ticketData.welcomed = true;
  }

  // ====================================
  // إذا المستخدم ضغط زر "تواصل مع الدعم"
  // ====================================
  if (messageText === "تواصل مع الدعم") {
    if (!ticketData.ticketId) {
      ticketData.ticketId = await createZammadTicket(fromNumber, messageText);
    } else {
      await appendToZammadTicket(ticketData.ticketId, messageText);
    }
    return;
  }

  // ====================================
  // أي رسالة أخرى بعد إنشاء التذكرة
  // ====================================
  if (ticketData.ticketId) {
    await appendToZammadTicket(ticketData.ticketId, messageText);
  }
});

app.listen(10000, () => console.log("Server running on port 10000"));
