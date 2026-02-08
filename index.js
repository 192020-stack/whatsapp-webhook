const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// إعدادات Zammad
const ZAMMAD_BASE_URL = process.env.ZAMMAD_BASE_URL || "http://102.203.200.112";
const ZAMMAD_TOKEN = process.env.ZAMMAD_TOKEN || "fk6ykJgBmcI9ILMhH1dPpEaETsQiU7tzJeaX3NWjnxl9w2OXLgRE-TlNz0YyF2w8";

// صفحة اختبار السيرفر
app.get("/", (req, res) => {
  res.send("WhatsApp Webhook is running ✅");
});

// التحقق من Meta (Webhook verification)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mysecret123";
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
  console.log("Incoming webhook:", JSON.stringify(req.body, null, 2));

  try {
    const entryObj = req.body.entry?.[0];
    const changeObj = entryObj?.changes?.[0];
    const messageData = changeObj?.value?.messages?.[0];
    const contactData = changeObj?.value?.contacts?.[0];

    if (!messageData || messageData.type !== "text") {
      return res.sendStatus(200); // رسالة غير نصية نتجاهلها
    }

    const messageText = messageData.text.body;
    const fromNumber = messageData.from;
    const fromName = contactData?.profile?.name || "Unknown";

    // =======================
    // إنشاء Ticket في Zammad
    // =======================
    const zammadResponse = await axios.post(
      `${ZAMMAD_BASE_URL}/api/v1/tickets`,
      {
        title: `WhatsApp Ticket - ${fromName} (${fromNumber})`,
        group: "Users", // غيرها إذا عندك مجموعة مختلفة
        article: {
          body: messageText,
          type: "note",
          internal: false,
        },
        customer_id: 1, // مهم: Agent token يحتاج customer_id
      },
      {
        headers: {
          "Authorization": `Token token=${ZAMMAD_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Ticket created successfully:", zammadResponse.data);
    res.sendStatus(200);

  } catch (error) {
    console.error("Zammad error:", error.response?.status, error.response?.data || error.message);
    res.sendStatus(500);
  }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
