const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(bodyParser.json());

const ZAMMAD_BASE_URL = "http://102.203.200.112"; // ضع رابط Zammad الخاص بك
const ZAMMAD_TOKEN = "fk6ykJgBmcI9ILMhH1dPpEaETsQiU7tzJeaX3NWjnxl9w2OXLgRE-TlNz0YyF2w8";
const WHATSAPP_TOKEN = "YOUR_WHATSAPP_TOKEN";
const PHONE_NUMBER_ID = "1004684596056367";

// ملف تخزين تذاكر اليوم
const TICKETS_FILE = "./tickets.json";

// قراءة بيانات التذاكر المخزنة
function readTickets() {
  if (!fs.existsSync(TICKETS_FILE)) return {};
  return JSON.parse(fs.readFileSync(TICKETS_FILE));
}

// تحديث بيانات التذاكر
function saveTickets(data) {
  fs.writeFileSync(TICKETS_FILE, JSON.stringify(data, null, 2));
}

// صفحة اختبار
app.get("/", (req, res) => {
  res.send("WhatsApp Webhook running ✅");
});

// استقبال رسائل واتساب
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const messageObj = change?.value?.messages?.[0];
    const fromNumber = messageObj?.from;
    const messageText = messageObj?.text?.body;
    const fromName = change?.value?.contacts?.[0]?.profile?.name || "";

    if (!messageObj || messageObj.type !== "text") return res.sendStatus(200);

    const tickets = readTickets();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    let ticketId;

    if (tickets[fromNumber] && tickets[fromNumber].date === today) {
      // نفس اليوم، استخدم نفس التيكت
      ticketId = tickets[fromNumber].ticket_id;
    } else {
      // إنشاء تيكت جديد
      const zammadResponse = await axios.post(
        `${ZAMMAD_BASE_URL}/api/v1/tickets`,
        {
          title: `WhatsApp Ticket - ${fromName} (${fromNumber})`,
          group: "Users",
          article: {
            body: messageText,
            type: "note",
            internal: false,
          },
          customer_id: 1, 
        },
        {
          headers: {
            "Authorization": `Token token=${ZAMMAD_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      ticketId = zammadResponse.data.id;
      tickets[fromNumber] = { ticket_id: ticketId, date: today };
      saveTickets(tickets);

      // إرسال رسالة ترحيبية أول مرة
      const welcomeMessage = `
مرحبًا ${fromName} 👋
شكرًا لتواصلك معنا. يمكنك الاطلاع على مركز المعرفة هنا: https://knowledge.example.com
إذا رغبت بالتواصل مع الدعم مباشرة اضغط على "تواصل مع الدعم"
`;
      await axios.post(
        `https://graph.facebook.com/v16.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: fromNumber,
          text: { body: welcomeMessage },
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // إضافة رسالة جديدة للتيكت (حتى لو لم تكن أول رسالة)
    if (ticketId) {
      await axios.post(
        `${ZAMMAD_BASE_URL}/api/v1/tickets/${ticketId}/articles`,
        {
          body: messageText,
          type: "note",
          internal: false,
        },
        {
          headers: {
            "Authorization": `Token token=${ZAMMAD_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Error processing webhook:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
