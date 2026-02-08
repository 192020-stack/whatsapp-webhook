const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// صفحة اختبار للتأكد أن السيرفر شغال
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

// استقبال رسائل واتساب
app.post("/webhook", async (req, res) => {
  console.log("Incoming message:");
  console.log(JSON.stringify(req.body, null, 2));

  // استخراج نص الرسالة من البنية
  const message = req.body.entry[0].changes[0].value.messages[0].text.body;

  try {
    // إرسال إلى زامات باستخدام التوكن
    await axios.post('http://102.203.200.112/api/v1/tickets', {
      title: 'WhatsApp Ticket',
      article: {
        body: message,
        type: 'note'
      }
    }, {
      headers: {
        'Authorization': `Bearer alnNgMod5eZzSlzlsRH2EpeIToanaof3LmcfMPTFMuk6ILXa_jd6RaVWWc1n7S1P`,
        'Content-Type': 'application/json'
      }
    });

    res.sendStatus(200);
  } catch (error) {
    console.error('Error sending to Zammad:', error);
    res.sendStatus(500);
  }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
