const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

// صفحة اختبار
app.get("/", (req, res) => {
  res.send("WhatsApp Webhook is running ✅");
});

// 🔐 التحقق من Meta (مهم)
const VERIFY_TOKEN = "my_verify_token";

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// 📩 استقبال رسائل واتساب
app.post("/webhook", (req, res) => {
  console.log("Incoming message:");
  console.log(JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// تشغيل السيرفر
app.listen(3000, () => {
  console.log("Server running on port 3000");
});
