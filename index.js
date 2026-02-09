import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ====================================
// الإعدادات
// ====================================
const ZAMMAD_BASE_URL = "http://102.203.200.112";
const ZAMMAD_TOKEN = "PUT_ZAMMAD_TOKEN";
const KNOWLEDGE_LINK = "http://102.203.200.112/help/ar";

const WHATSAPP_TOKEN = "PUT_WHATSAPP_TOKEN";
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
    users[from] = {
      greeted: false,
      ticketId: null,
      support: false
    };
  }

  const user = users[from];
  let replyId = "";
  let text = "";

  if (msg.type === "interactive") {
    replyId = msg.interactive.list_reply?.id;
  }
  if (msg.type === "text") {
    text = msg.text.body;
  }

  // ====================================
  // الرسالة الأولى (خيارين فقط)
  // ====================================
  if (!user.greeted) {
    await sendWhatsApp({
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text:
            `مرحبًا ${name} 👋\n\n` +
            `كيف نقدر نساعدك؟ اختر من الخيارات 👇`
        },
        action: {
          button: "اختر",
          sections: [
            {
              title: "الخدمات",
              rows: [
                {
                  id: "knowledge",
                  title: "📘 فتح قاعدة المعرفة"
                },
                {
                  id: "support",
                  title: "🧑‍💼 تواصل مع الدعم"
                }
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
  // اختيار قاعدة المعرفة
  // ====================================
  if (replyId === "knowledge") {
    await sendWhatsApp({
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: {
          text: "📘 اضغط الزر بالأسفل لفتح قاعدة المعرفة مباشرة"
        },
        action: {
          name: "cta_url",
          parameters: {
            display_text: "فتح قاعدة المعرفة",
            url: KNOWLEDGE_LINK
          }
        }
      }
    });
    return;
  }

  // ====================================
  // اختيار الدعم
  // ====================================
  if (replyId === "support") {
    if (!user.ticketId) {
      const zammad = await axios.post(
        `${ZAMMAD_BASE_URL}/api/v1/tickets`,
        {
          title: `WhatsApp - ${name}`,
          group: "Users",
          customer_id: 1,
          article: {
            body: "بدء محادثة دعم من WhatsApp",
            type: "note",
            internal: false
          }
        },
        {
          headers: {
            Authorization: `Token token=${ZAMMAD_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );

      user.ticketId = zammad.data.id;
      user.support = true;
    }

    await sendWhatsApp({
      messaging_product: "whatsapp",
      to: from,
      text: {
        body: "✅ تم فتح تذكرة دعم، تفضل اكتب رسالتك."
      }
    });
    return;
  }

  // ====================================
  // رسائل الدعم → Zammad
  // ====================================
  if (user.support && user.ticketId && text) {
    await axios.post(
      `${ZAMMAD_BASE_URL}/api/v1/ticket_articles`,
      {
        ticket_id: user.ticketId,
        body: text,
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
  }
});

// ====================================
app.get("/", (req, res) => {
  res.send("Webhook running ✅");
});

app.listen(10000, () => {
  console.log("Server running on port 10000");
});
