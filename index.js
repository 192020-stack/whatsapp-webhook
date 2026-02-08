const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// =======================
// إعدادات
// =======================
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mysecret123";
const ZAMMAD_TOKEN = process.env.ZAMMAD_TOKEN || "YOUR_ZAMMAD_AGENT_TOKEN";
const ZAMMAD_BASE_URL = process.env.ZAMMAD_BASE_URL || "http://102.203.200.112";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "YOUR_WHATSAPP_ACCESS_TOKEN";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "YOUR_PHONE_NUMBER_ID";

// =======================
// قاعدة بيانات مؤقتة لتخزين آخر رسالة لكل رقم
// =======================
const userLastMessage = new Map(); // Map<phone_number, { date: Date, ticketId: number }>

// =======================
// مساعدة: التحقق من نفس اليوم
// =======================
function isSameDay(d1, d2) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

// =======================
// صفحة اختبار السيرفر
// =======================
app.get("/", (req, res) => {
  res.send("WhatsApp Webhook is running ✅");
});

// =======================
// التحقق من Meta Webhook
// =======================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// =======================
// استقبال رسائل واتساب
// =======================
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const messageObj = change?.value?.messages?.[0];

    if (!messageObj || messageObj.type !== "text") {
      return res.sendStatus(200);
    }

    const fromNumber = messageObj.from;
    const messageText = messageObj.text.body;

    const now = new Date();
    let ticketId = null;

    // تحقق إذا عنده تذكرة اليوم
    const last = userLastMessage.get(fromNumber);
    if (last && isSameDay(new Date(last.date), now)) {
      ticketId = last.ticketId; // استخدم نفس التيكت
    }

    // إنشاء Ticket جديد إذا لم يكن موجود اليوم
    if (!ticketId) {
      const zammadResponse = await axios.post(
        `${ZAMMAD_BASE_URL}/api/v1/tickets`,
        {
          title: `WhatsApp Ticket - ${fromNumber}`,
          group: "Users",
          article: {
            body: messageText,
            type: "note",
            internal: false,
          },
          customer_id: 1, // رقم العميل في Zammad
        },
        {
          headers: {
            "Authorization": `Token token=${ZAMMAD_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      ticketId = zammadResponse.data.id;
      userLastMessage.set(fromNumber, { date: now, ticketId });
    } else {
      // إضافة رسالة جديدة على نفس التيكت
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

    // =======================
    // الرد الآلي لأول رسالة اليوم
    // =======================
    if (!last || !isSameDay(new Date(last.date), now)) {
      await axios.post(
        `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: fromNumber,
          text: {
            body: `مرحباً! شكراً لتواصلك معنا.\n🔹 مركز المعرفة: https://example.com/knowledge\n🔹 إذا أردت التواصل مع الدعم، أرسل أي رسالة وسيتم الرد عليك مباشرة.`
          },
        },
        {
          headers: {
            "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
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

// =======================
// تشغيل السيرفر
// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
