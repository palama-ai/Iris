/**
 * IRIS Backend - Groq TTS Voice Service (Fixed)
 */

const GROQ_TTS_URL = 'https://api.groq.com/openai/v1/audio/speech';

let apiKey = null;
let voiceId = null;

// الأصوات المدعومة رسمياً من Groq حالياً
const GROQ_VOICES = [
    'austin', 'troy', 'daniel', 'hannah', 'diana', 'autumn'
];

/**
 * Initialize Groq TTS service
 */
export function initElevenLabs() { // أبقينا الاسم للتوافق مع بقية النظام
    apiKey = process.env.GROQ_API_KEY;
    
    // ✅ تصحيح 1: التأكد من أن الصوت الافتراضي مدعوم من القائمة الجديدة
    const envVoice = process.env.GROQ_TTS_VOICE;
    voiceId = GROQ_VOICES.includes(envVoice) ? envVoice : 'austin'; 

    if (!apiKey) {
        console.warn('⚠️ GROQ_API_KEY not set. Voice synthesis disabled.');
        return false;
    }

    console.log(`✅ Groq TTS service initialized (Voice: ${voiceId})`);
    return true;
}

// ... (getSignedUrl كما هي)

export async function textToSpeechStream(text, onChunk, onComplete, onError) {
    if (!apiKey) {
        onError?.(new Error('Groq TTS not configured'));
        return;
    }

    try {
        console.log(`🔊 Groq TTS: Converting "${text.substring(0, 50)}..." to speech`);

        const response = await fetch(GROQ_TTS_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                // ✅ تصحيح 2: استخدام الموديل القياسي لتجنب "Terms Acceptance"
                model: 'tts-1', 
                input: text,
                voice: voiceId, // تأكد أنه من القائمة [austin, troy, etc.]
                response_format: 'wav'
            })
        });

        if (!response.ok) {
            const errJson = await response.json(); // تغيير لـ JSON لقراءة رسالة الخطأ بوضوح
            console.error('❌ Groq TTS error:', response.status, errJson);
            
            // محاولة التعافي التلقائي إذا كان الخطأ بسبب اسم الصوت
            if (response.status === 400 && voiceId !== 'austin') {
                console.warn('🔄 Retrying with fallback voice: austin');
                voiceId = 'austin';
                return textToSpeechStream(text, onChunk, onComplete, onError);
            }

            onError?.(new Error(`Groq TTS error: ${response.status}`));
            return;
        }

        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = Buffer.from(arrayBuffer);
        const audioBase64 = audioBuffer.toString('base64');

        onChunk?.({
            audio: audioBase64,
            index: 0,
            isFinal: true
        });

        onComplete?.();
    } catch (error) {
        console.error('❌ Groq TTS error:', error.message);
        onError?.(error);
    }
}

// ... (بقية الدوال مع التأكد من تغيير الموديل لـ 'tts-1')
