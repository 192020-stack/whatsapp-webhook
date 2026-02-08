import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// إعدادات Zammad
const ZAMMAD_TOKEN = process.env.ZAMMAD_TOKEN;
const ZAMMAD_BASE_URL = process.env.ZAMMAD_BASE_URL;

// قاعدة بيانات مؤقتة لتخزين Ticket لليوم الواحد (ممكن تغييره لقاعدة بيانات حقيقية)
const userTickets = {}; // { "USER_NUMBER": { ticketId, date } }

// =======================
// دالة لإرسال رسالة WhatsApp
// =======================
async function sendWhatsappMessage(to, text) {
  try {
    await axios.post("https://graph.facebook.com/v16.0/YOUR_PHONE_NUMBER_ID/messages", {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text },
        footer: { text: "إذا لم تجد حلاً، اختر 'تواصل مع الدعم'" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "contact_support", title: "تواصل مع الدعم" } }
          ]
        }
      }
    }, {
      headers: {
        "Authorization": `Bearer YOUR_WHATSAPP_TOKEN`,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("WhatsApp send error:", err.response?.data || err.message);
  }
}

// =======================
// دوال لإدارة Ticket اليومي
// =======================
function findTodayTicketForUser(userNumber) {
  const record = userTickets[userNumber];
  const today = new Date().toISOString().slice(0, 10);
  if (record && record.date === today) return record.ticketId;
  return null;
}

function saveTicketForUser(userNumber, ticketId) {
  const today = new Date().toISOString().slice(0, 10);
  userTickets[userNumber] = { ticketId, date: today };
}

// =======================
// استقبال رسائل واتساب
// =======================
app.post("/webhook", async (req, res) => {
  console.log("Incoming webhook:", JSON.stringify(req.body, null, 2));

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const messageObj = change?.value?.messages?.[0];

    if (!messageObj || messageObj.type !== "text") return res.sendStatus(200);

    const fromNumber = messageObj.from;
    const messageText = messageObj.text.body;

    // تحقق من Ticket اليومي
    let ticketId = findTodayTicketForUser(fromNumber);

    // إذا المستخدم ضغط على زر "تواصل مع الدعم"
    if (messageObj.button?.payload === "contact_support") {

      if (!ticketId) {
        // إنشاء Ticket جديد
        const zammadResponse = await axios.post(`${ZAMMAD_BASE_URL}/api/v1/tickets`, {
          title: `WhatsApp Ticket - ${fromNumber}`,
          group: "Users",
          article: {
            body: messageText,
            type: "note",
            internal: false
          },
          customer_id: 1
        }, {
          headers: {
            "Authorization": `Token token=${ZAMMAD_TOKEN}`,
            "Content-Type": "application/json"
          }
        });

        ticketId = zammadResponse.data.id;
        saveTicketForUser(fromNumber, ticketId);
      } else {
        // إضافة الرسالة إلى نفس Ticket
        await axios.post(`${ZAMMAD_BASE_URL}/api/v1/tickets/${ticketId}/articles`, {
          body: messageText,
          type: "note",
          internal: false
        }, {
          headers: {
            "Authorization": `Token token=${ZAMMAD_TOKEN}`,
            "Content-Type": "application/json"
          }
        });
      }

    } else {
      // الرسالة الأولى أو أي رسالة عادية -> أرسل الرد الترحيبي
      await sendWhatsappMessage(fromNumber,
        `أهلاً بك! يمكنك زيارة قاعدة المعرفة لمعرفة الحلول للمشاكل الشائعة:\nhttps://your-website.com/knowledge`
      );
    }

    res.sendStatus(200);

  } catch (err) {
    console.error("Error processing webhook:", err.response?.data || err.message);
    res.sendStatus(500);
  }
});

// =======================
// تشغيل السيرفر
// =======================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
