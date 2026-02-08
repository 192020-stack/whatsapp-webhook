import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

// ===============================
// إعدادات Zammad
// ===============================
const ZAMMAD_BASE_URL = 'http://102.203.200.112';
const ZAMMAD_TOKEN =
  'alnNgMod5eZzSlzlsRH2EpeIToanaof3LmcfMPTFMuk6ILXa_jd6RaVWWc1n7S1P';

// ===============================
// Webhook endpoint
// ===============================
app.post('/webhook', async (req, res) => {
  try {
    console.log('Incoming webhook:', JSON.stringify(req.body, null, 2));

    // مثال نص الرسالة (عدّل حسب WhatsApp payload لاحقًا)
    const messageText =
      req.body?.message || 'عندي مشكلة في الكمبيوتر';

    // إنشاء Ticket في Zammad
    const response = await axios.post(
      `${ZAMMAD_BASE_URL}/api/v1/tickets`,
      {
        title: 'WhatsApp Ticket',
        group_id: 1, // تأكد أن group_id موجود
        article: {
          body: messageText,
          type: 'note'
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          // ✅ الصيغة الصحيحة فقط
          'Authorization': `Token token=${ZAMMAD_TOKEN}`
        }
      }
    );

    console.log('Zammad response:', response.data);

    res.status(200).json({
      success: true,
      ticket_id: response.data.id
    });
  } catch (error) {
    console.error('Zammad error:', {
      status: error.response?.status,
      data: error.response?.data
    });

    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// ===============================
// Health check
// ===============================
app.get('/', (req, res) => {
  res.send('WhatsApp → Zammad webhook is running ✅');
});

// ===============================
// تشغيل السيرفر (Render compatible)
// ===============================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
