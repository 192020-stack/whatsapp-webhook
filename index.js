const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// =======================
// إعدادات
// =======================
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mysecret123";

// Zammad
const ZAMMAD_BASE_URL = "http://102.203.200.112";
const ZAMMAD_TOKEN =
  "fk6ykJgBmcI9ILMhH1dPpEaETsQiU7tzJeaX3NWjnxl9w2OXLgRE-TlNz0YyF2w8";

// =======================
// فحص أن السيرفر شغال
// =======================
app.get("/", (req, res) => {
  res.send("WhatsApp Webhook is running ✅");
});

// =======================
// Webhook Verification (Meta)
// =======================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully ✅");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// =======================
// استقبال رسائل واتساب
// =======================
app.post("/webhook", async (req, res) => {
  console.log("Incoming webhook:", JSON.stringify(req.body, null, 2));

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const messageObj = change?.value?.messages?.[0];

    if (!messageObj || messageObj.type !== "text") {
      return res.sendStatus(200);
    }

    const messageText = messageObj.text.body;
    const fromNumber = messageObj.from;

    // =======================
    // إنشاء Ticket في Zammad
    // =======================
    const zammadResponse = await axios.post(
      `${ZAMMAD_BASE_URL}/api/v1/tickets`,
      {
        title: `WhatsApp Ticket - ${fromNumber}`,
        group: "Users", // غيرها لو عندك Group باسم مختلف
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

    console.log("Ticket created successfully ✅", zammadResponse.data.id);
    res.sendStatus(200);
  } catch (error) {
    console.error("Zammad error:", {
      status: error.response?.status,
      data: error.response?.data,
    });

    res.sendStatus(500);
  }
});

// =======================
// تشغيل السيرفر
// =======================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
