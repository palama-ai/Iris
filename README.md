# IRIS Backend Server

نظام خادم الذكاء الاصطناعي للمساعد الشخصي IRIS.

## 🚀 التثبيت

```bash
cd "back end"
npm install
```

## ⚙️ الإعداد

1. انسخ ملف المتغيرات البيئية:
```bash
cp .env.example .env
```

2. قم بتعديل `.env` بإضافة مفاتيح API الخاصة بك:
```env
GEMINI_API_KEY=your_key_here
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_VOICE_ID=your_voice_id
DATABASE_URL=your_neon_connection_string
```

## 🏃 التشغيل

```bash
# تطوير (مع auto-reload)
npm run dev

# إنتاج
npm start
```

## 📡 Socket.io Events

### الانضمام للغرف
```javascript
// Desktop
socket.emit('join:desktop', { sessionId: 'optional' });

// Mobile  
socket.emit('join:mobile', { sessionId: 'optional' });
```

### إرسال رسالة
```javascript
socket.emit('message:text', { 
  text: 'افتح المتصفح',
  withVoice: true  // للحصول على رد صوتي
});
```

### استلام الردود
```javascript
socket.on('message:response', (data) => {
  console.log(data.text);    // الرد النصي
  console.log(data.action);  // EXECUTE إذا كان أمر
  console.log(data.command); // نوع الأمر
});

socket.on('command:execute', (data) => {
  // أمر للتنفيذ على Desktop
  console.log(data.command, data.params);
});
```

## 🔗 REST API

| Endpoint | Method | الوصف |
|----------|--------|-------|
| `/` | GET | Health check |
| `/api/voice/tts` | POST | تحويل نص إلى صوت |
| `/api/voice/signed-url` | GET | رابط WebSocket لـ ElevenLabs |

## 📁 البنية

```
back end/
├── config/database.js      # اتصال Neon DB
├── services/
│   ├── geminiService.js    # خدمة Gemini AI
│   └── elevenLabsService.js # خدمة الصوت
├── utils/commandParser.js  # معالجة الأوامر
├── server.js               # الخادم الرئيسي
└── .env                    # المتغيرات البيئية
```
