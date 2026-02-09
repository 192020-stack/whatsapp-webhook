import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const ZAMMAD_BASE_URL = "http://102.203.200.112"; 
const ZAMMAD_TOKEN = "fk6ykJgBmcI9ILMhH1dPpEaETsQiU7tzJeaX3NWjnxl9w2OXLgRE-TlNz0YyF2w8";
const KNOWLEDGE_LINK = "http://102.203.200.112/help/ar?preview_token=awTUB6dcksRTfDSveLu7YRcpuBoSNpthYlSKg4NHGGs30KAWLBchsPsrh6mgDFe-";
const WHATSAPP_TOKEN = "EAA4bHf77siABQt0Nqf8trAwSwv5XL6E0NA0Xp1YbWnIDvUOa47PnquWUUBDtg9I3FkQtdyZCihqiwant2kWMeN3Hhrnbi3fP2z6saoE8eGOgWPqkUjVBolfZAgVa2o7oQrLr7iLX5NMdpv1vZAttk9qyGMfPp6j0Wxl5aCxzZC4a72O2WE5Ht3QgFFWep1ThHwZDZD";
const WHATSAPP_PHONE_ID = "1004684596056367";


async function downloadMedia(mediaId) {
  try {
    const metaRes = await axios.get(
      `https://graph.facebook.com/v17.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
    console.log("Media metadata from WhatsApp:", metaRes.data);
    return metaRes.data; // يحتوي على url و mime_type
  } catch (err) {
    console.error("Error downloading media:", err.message);
    return null;
  }
}

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return;

  console.log("========== New Message ==========");
  console.log("From:", msg.from);
  console.log("Message type:", msg.type);

  if (msg.type === "text") {
    console.log("Text body:", msg.text.body);
  }

  if (msg.type === "image" || msg.type === "video" || msg.type === "audio" || msg.type === "document") {
    const mediaId = msg[msg.type].id;
    console.log(`Media ID: ${mediaId}`);
    const mediaInfo = await downloadMedia(mediaId);
    if (mediaInfo) {
      console.log("MIME type:", mediaInfo.mime_type);
      console.log("Download URL:", mediaInfo.url);
    }
  }
});

app.get("/", (req, res) => {
  res.send("Webhook running ✅");
});

app.listen(10000, () => {
  console.log("Server running on port 10000");
});
