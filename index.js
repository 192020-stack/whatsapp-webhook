// index.js
const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

// صفحة اختبار للتأكد أن السيرفر شغال
app.get("/", (req, res) => {
  res.send("WhatsApp Webhook is running ✅");
});

// 🔐 التحقق من Meta (Webhook verification)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mysecret123"; // تأكد أن نفس القيمة في Render

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

// 📩 استقبال رسائل WhatsApp
app.post("/webhook", (req, res) => {
  console.log("Incoming message:");
  console.log(JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});
//
// تشغيل السيرفر على PORT من البيئة أو 3000 محليًا
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
