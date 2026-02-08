import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ================== الإعدادات ==================
const ZAMMAD_BASE_URL = "http://102.203.200.112";
const ZAMMAD_TOKEN = "fk6ykJgBmcI9ILMhH1dPpEaETsQiU7tzJeaX3NWjnxl9w2OXLgRE-TlNz0YyF2w8";
const KNOWLEDGE_LINK = "http://102.203.200.112/help/ar";
const WHATSAPP_TOKEN = "YOUR_WHATSAPP_TOKEN";
const WHATSAPP_PHONE_ID = "1004684596056367";

const users = {};

// ================== إرسال ==================
async function sendWhatsApp(payload) {
  await axios.post(
    `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
    payload,
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
}

// ================== Webhook ==================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const contact = req.body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0];
  if (!msg) return;

  const from = msg.from;
  const name = contact?.profile?.name || "مستخدم";

  if (!users[from]) users[from] = { greeted: false, ticketId: null };
  const user = users[from];

  // ===== الترحيب =====
  if (!user.greeted) {
    const text = `مرحبًا ${name} 👋\n\nاختر ما يناسبك 👇`;

    // زر قاعدة المعرفة (يفتح مباشرة)
    await sendWhatsApp({
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text },
        action: {
          name: "cta_url",
          parameters: {
            display_text: "📘 قاعدة المعرفة",
            url: KNOWLEDGE_LINK
          }
        }
      }
    });

    // زر الدعم
    await sendWhatsApp({
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "تبي تتواصل مع الدعم؟" },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: "support", title: "🧑‍💼 تواصل مع الدعم" }
            }
          ]
        }
      }
    });

    user.greeted = true;
    return;
  }
});

app.listen(10000, () => console.log("Server running"));
