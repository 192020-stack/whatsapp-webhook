import express from "express";
import axios from "axios";

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
// قاعدة بيانات مؤقتة
// ====================================
const userTickets = {};

// ====================================
// إرسال رسالة WhatsApp
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
  } catch (error) {
    console.error("WhatsApp send error:", error.response?.data || error.message);
  }
}

// ====================================
// Webhook
// ====================================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const entry = req.body.entry?.[0];
  const change = entry?.changes?.[0];
  const messageObj = change?.value?.messages?.[0];
  const contactObj = change?.value?.contacts?.[0];
  if (!messageObj) return;

  const fromNumber = messageObj.from;
  const fromName = contactObj?.profile?.name || "مستخدم";

  if (!userTickets[fromNumber]) {
    userTickets[fromNumber] = {
      ticketId: null,
      supportActivated: false,
      greeted: false
    };
  }

  const userData = userTickets[fromNumber];

  let messageText = "";
  let buttonId = "";

  if (messageObj.type === "text") {
    messageText = messageObj.text.body;
  } else if (
    messageObj.type === "interactive" &&
    messageObj.interactive.type === "button_reply"
  ) {
    buttonId = messageObj.interactive.button_reply.id;
  }

  // ====================================
  // رسالة الترحيب (زر Knowledge يفتح الرابط مباشرة + زر Support reply)
  // ====================================
  if (!userData.greeted) {
    const text =
      `مرحبًا ${fromName} 👋\n\n` +
      `كيف نقدر نساعدك؟ اختر أحد الخيارات 👇`;

    await sendWhatsApp({
      messaging_product: "whatsapp",
      to: fromNumber,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text },
        action: {
          buttons: [
            {
              type: "url",
              url: KNOWLEDGE_LINK,
              title: "📘 قاعدة المعرفة"
            },
            {
              type: "reply",
              reply: {
                id: "support",
                title: "🧑‍💼 تواصل مع الدعم"
              }
            }
          ]
        }
      }
    });

    userData.greeted = true;
    return;
  }

  // ====================================
  // زر تواصل مع الدعم
  // ====================================
  if (buttonId === "support") {
    if (!userData.ticketId) {
      try {
        const zammadResponse = await axios.post(
          `${ZAMMAD_BASE_URL}/api/v1/tickets`,
          {
            title: `WhatsApp Ticket - ${fromName} (${fromNumber})`,
            group: "Users",
            article: {
              body: "بدء تواصل الدعم",
              type: "note",
              internal: false
            },
            customer_id: 1
          },
          {
            headers: {
              Authorization: `Token token=${ZAMMAD_TOKEN}`,
              "Content-Type": "application/json"
            }
          }
        );

        userData.ticketId = zammadResponse.data.id;
        userData.supportActivated = true;
      } catch (err) {
        console.error("Zammad ticket error:", err.response?.data || err.message);
      }
    } else {
      userData.supportActivated = true;
    }
    return;
  }

  // ====================================
  // رسائل الدعم → Zammad
  // ====================================
  if (userData.supportActivated && userData.ticketId && messageText) {
    try {
      await axios.post(
        `${ZAMMAD_BASE_URL}/api/v1/ticket_articles`,
        {
          ticket_id: userData.ticketId,
          body: messageText,
          type: "note",
          internal: false
        },
        {
          headers: {
            Authorization: `Token token=${ZAMMAD_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );
    } catch (err) {
      console.error("Zammad append error:", err.response?.data || err.message);
    }
  }
});

// ====================================
app.get("/", (req, res) => {
  res.send("WhatsApp Webhook is running ✅");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
