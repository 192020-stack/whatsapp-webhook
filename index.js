import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ====================================
// إعدادات Zammad و WhatsApp
// ====================================
const ZAMMAD_BASE_URL = "http://102.203.200.112"; // رابط Zammad
const ZAMMAD_TOKEN = "fk6ykJgBmcI9ILMhH1dPpEaETsQiU7tzJeaX3NWjnxl9w2OXLgRE-TlNz0YyF2w8"; // Token Agent
const KNOWLEDGE_LINK = "http://102.203.200.112/#knowledge_base/1/locale/ar";
const WHATSAPP_TOKEN = "EAA4bHf77siABQt0Nqf8trAwSwv5XL6E0NA0Xp1YbWnIDvUOa47PnquWUUBDtg9I3FkQtdyZCihqiwant2kWMeN3Hhrnbi3fP2z6saoE8eGOgWPqkUjVBolfZAgVa2o7oQrLr7iLX5NMdpv1vZAttk9qyGMfPp6j0Wxl5aCxzZC4a72O2WE5Ht3QgFFWep1ThHwZDZD";
const WHATSAPP_PHONE_ID = "1004684596056367";

// ====================================
// قاعدة بيانات مؤقتة لتخزين آخر تذكرة لكل رقم
// ====================================
const userTickets = {}; // { "phoneNumber": { ticketId, date, contactedSupport } }

// ====================================
// دالة لإرسال رسالة WhatsApp
// ====================================
async function sendWhatsAppMessage(to, message, buttons = null) {
  try {
    let payload;

    if (buttons) {
      payload = {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: message },
          action: {
            buttons: buttons.map((b) => {
              if (b.type === "reply") return { type: "reply", reply: b.reply };
              if (b.type === "url") return { type: "url", url: b.url, title: b.title };
            }),
          },
        },
      };
    } else {
      payload = {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
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
        article: {
          body: message,
          type: "note",
          internal: false,
        },
        customer_id: 1,
      },
      {
        headers: {
          Authorization: `Token token=${ZAMMAD_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data.id; // id التذكرة
  } catch (error) {
    console.error("Zammad create ticket error:", error.response?.data || error.message);
    return null;
  }
}

// ====================================
// دالة لإضافة رسالة لمقال موجود في التذكرة
// ====================================
async function appendToZammadTicket(ticketId, message) {
  try {
    await axios.post(
      `${ZAMMAD_BASE_URL}/api/v1/ticket_articles`,
      {
        ticket_id: ticketId,
        body: message,
        type: "note",
        internal: false,
      },
      {
        headers: {
          Authorization: `Token token=${ZAMMAD_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
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
  res.sendStatus(200); // نرد بسرعة

  const entry = req.body.entry?.[0];
  const change = entry?.changes?.[0];
  const messageObj = change?.value?.messages?.[0];

  if (!messageObj || messageObj.type !== "text") return;

  const messageText = messageObj.text.body;
  const fromNumber = messageObj.from;
  const contactName = change?.value?.contacts?.[0]?.profile?.name || "مستخدم";

  const today = new Date().toISOString().split("T")[0];
  let ticketId;

  // تحقق من وجود تذكرة اليوم
  if (userTickets[fromNumber]?.date === today && userTickets[fromNumber]?.contactedSupport) {
    ticketId = userTickets[fromNumber].ticketId;
    await appendToZammadTicket(ticketId, messageText);
  } else {
    // أول رسالة اليوم أو لم يتم التواصل مع الدعم بعد
    const welcomeMessage = `مرحبًا ${contactName} 👋\n\nيمكنك تصفح حلولنا هنا أو الضغط على زر التواصل مع الدعم إذا لم تجد إجابة لسؤالك.`;
    const welcomeButtons = [
      { type: "url", url: KNOWLEDGE_LINK, title: "زيارة المعرفة" },
      { type: "reply", reply: { id: "contact_support", title: "تواصل مع الدعم" } },
    ];
    await sendWhatsAppMessage(fromNumber, welcomeMessage, welcomeButtons);

    // تحقق من الضغط على زر التواصل مع الدعم
    const isSupport = messageText === "تواصل مع الدعم" || messageObj.button?.payload === "contact_support";

    if (isSupport) {
      ticketId = await createZammadTicket(fromNumber, messageText);
      userTickets[fromNumber] = { ticketId, date: today, contactedSupport: true };
    }
  }
});

app.listen(10000, () => console.log("Server running on port 10000"));
