/**
 * IRIS Backend - Groq TTS Voice Service
 * Handles text-to-speech conversion using Groq API (replacing ElevenLabs)
 */

const GROQ_TTS_URL = 'https://api.groq.com/openai/v1/audio/speech';

let apiKey = null;
let voiceId = null;

// Available Groq TTS voices
const GROQ_VOICES = [
  'austin', 'troy', 'daniel', 'hannah', 'diana', 'autumn'
];

/**
 * Initialize Groq TTS service
 */
export function initElevenLabs() {
    apiKey = process.env.GROQ_API_KEY;
    voiceId = process.env.GROQ_TTS_VOICE || 'diana'; // Default voice

    if (!apiKey) {
        console.warn('⚠️  GROQ_API_KEY not set. Voice synthesis disabled.');
        return false;
    }

    console.log(`✅ Groq TTS service initialized (Voice: ${voiceId})`);
    return true;
}

/**
 * Get a signed URL (not used for Groq, kept for compatibility)
 */
export async function getSignedUrl() {
    return { error: 'Signed URLs not supported with Groq TTS' };
}

/**
 * Convert text to speech with streaming via callback
 * @param {string} text - Text to convert
 * @param {Function} onChunk - Callback for audio chunk
 * @param {Function} onComplete - Callback when complete
 * @param {Function} onError - Callback for errors
 */
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
                model: 'canopylabs/orpheus-v1-english',
                input: text,
                voice: voiceId,
                response_format: 'wav'
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('❌ Groq TTS error:', response.status, errText);
            onError?.(new Error(`Groq TTS error: ${response.status}`));
            return;
        }

        // Get audio as buffer
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = Buffer.from(arrayBuffer);
        const audioBase64 = audioBuffer.toString('base64');

        console.log(`✅ Groq TTS: Generated ${Math.round(audioBuffer.length / 1024)}KB audio`);

        // Send as single chunk
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

/**
 * Convert text to speech (simple, returns buffer)
 * @param {string} text - Text to convert
 * @returns {Promise<Buffer>} Audio buffer
 */
export async function textToSpeechSimple(text) {
    if (!apiKey) {
        throw new Error('Groq TTS not configured');
    }

    try {
        const response = await fetch(GROQ_TTS_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'canopylabs/orpheus-v1-english',
                input: text,
                voice: voiceId,
                response_format: 'wav'
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Groq TTS error: ${response.status} - ${errText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } catch (error) {
        console.error('TTS error:', error.message);
        throw error;
    }
}

/**
 * Convert text to speech (Promise-based, alias for textToSpeechSimple)
 */
export async function textToSpeech(text) {
    return textToSpeechSimple(text);
}

/**
 * Check if Groq TTS is properly configured
 * @returns {boolean}
 */
export function isConfigured() {
    return !!apiKey;
}

/**
 * Get available voices
 * @returns {Promise<Array>} List of available voices
 */
export async function getVoices() {
    // Return static list of Groq TTS voices
    return GROQ_VOICES.map(voice => ({
        voice_id: voice,
        name: voice.replace('-PlayAI', ''),
        preview_url: null
    }));
}
