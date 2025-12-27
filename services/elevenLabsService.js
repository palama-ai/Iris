/**
 * IRIS Backend - ElevenLabs Voice Service
 * Handles text-to-speech conversion using ElevenLabs API with streaming support
 */

import WebSocket from 'ws';

let apiKey = null;
let voiceId = null;
let agentId = null;

// ElevenLabs WebSocket endpoints
const ELEVENLABS_WS_URL = 'wss://api.elevenlabs.io/v1/text-to-speech';
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

/**
 * Initialize ElevenLabs service
 */
export function initElevenLabs() {
    apiKey = process.env.ELEVENLABS_API_KEY;
    voiceId = process.env.ELEVENLABS_VOICE_ID;
    agentId = process.env.ELEVENLABS_AGENT_ID;

    if (!apiKey) {
        console.warn('⚠️  ELEVENLABS_API_KEY not set. Voice synthesis disabled.');
        return false;
    }

    if (!voiceId) {
        console.warn('⚠️  ELEVENLABS_VOICE_ID not set. Using default voice.');
        voiceId = '21m00Tcm4TlvDq8ikWAM'; // Rachel - default voice
    }

    console.log('✅ ElevenLabs service initialized');
    return true;
}

/**
 * Get a signed URL for client-side WebSocket connection
 * @returns {Object} Signed URL and configuration
 */
export async function getSignedUrl() {
    if (!apiKey || !agentId) {
        return { error: 'ElevenLabs not configured' };
    }

    try {
        const response = await fetch(
            `${ELEVENLABS_API_URL}/convai/conversation/get_signed_url?agent_id=${agentId}`,
            {
                method: 'GET',
                headers: {
                    'xi-api-key': apiKey
                }
            }
        );

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        return {
            signedUrl: data.signed_url,
            agentId: agentId
        };
    } catch (error) {
        console.error('ElevenLabs signed URL error:', error.message);
        return { error: error.message };
    }
}

/**
 * Convert text to speech with real-time streaming via callback
 * Each audio chunk is sent immediately to reduce latency
 * @param {string} text - Text to convert
 * @param {Function} onChunk - Callback for each audio chunk (base64 string)
 * @param {Function} onComplete - Callback when streaming is complete
 * @param {Function} onError - Callback for errors
 * @returns {Function} Cancel function to abort streaming
 */
export function textToSpeechStream(text, onChunk, onComplete, onError) {
    if (!apiKey) {
        onError?.(new Error('ElevenLabs not configured'));
        return () => { };
    }

    const wsUrl = `${ELEVENLABS_WS_URL}/${voiceId}/stream-input?model_id=eleven_multilingual_v2&xi-api-key=${apiKey}`;
    const ws = new WebSocket(wsUrl);
    let isCancelled = false;
    let chunkIndex = 0;

    ws.on('open', () => {
        if (isCancelled) {
            ws.close();
            return;
        }

        // Send initial configuration
        ws.send(JSON.stringify({
            text: ' ',
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.8,
                style: 0.0,
                use_speaker_boost: true
            },
            generation_config: {
                chunk_length_schedule: [120, 160, 250, 290]
            }
        }));

        // Send the actual text
        ws.send(JSON.stringify({
            text: text,
            try_trigger_generation: true
        }));

        // Signal end of input
        ws.send(JSON.stringify({
            text: ''
        }));
    });

    ws.on('message', (data) => {
        if (isCancelled) return;

        try {
            const message = JSON.parse(data.toString());

            if (message.audio) {
                // Send chunk immediately to client
                onChunk?.({
                    audio: message.audio, // Already base64
                    index: chunkIndex++,
                    isFinal: false
                });
            }

            if (message.isFinal) {
                onChunk?.({
                    audio: null,
                    index: chunkIndex,
                    isFinal: true
                });
                ws.close();
            }
        } catch (e) {
            // Binary audio data - convert to base64
            if (Buffer.isBuffer(data)) {
                onChunk?.({
                    audio: data.toString('base64'),
                    index: chunkIndex++,
                    isFinal: false
                });
            }
        }
    });

    ws.on('close', () => {
        if (!isCancelled) {
            onComplete?.();
        }
    });

    ws.on('error', (error) => {
        if (!isCancelled) {
            onError?.(error);
        }
    });

    // Timeout after 30 seconds
    const timeout = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
            onError?.(new Error('TTS timeout'));
        }
    }, 30000);

    // Return cancel function
    return () => {
        isCancelled = true;
        clearTimeout(timeout);
        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    };
}

/**
 * Convert text to speech using WebSocket streaming (Promise-based)
 * @param {string} text - Text to convert
 * @returns {Promise<Buffer>} Audio buffer
 */
export function textToSpeech(text) {
    return new Promise((resolve, reject) => {
        if (!apiKey) {
            reject(new Error('ElevenLabs not configured'));
            return;
        }

        const wsUrl = `${ELEVENLABS_WS_URL}/${voiceId}/stream-input?model_id=eleven_multilingual_v2&xi-api-key=${apiKey}`;
        const ws = new WebSocket(wsUrl);

        const audioChunks = [];

        ws.on('open', () => {
            ws.send(JSON.stringify({
                text: ' ',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.8,
                    style: 0.0,
                    use_speaker_boost: true
                },
                generation_config: {
                    chunk_length_schedule: [120, 160, 250, 290]
                }
            }));

            ws.send(JSON.stringify({
                text: text,
                try_trigger_generation: true
            }));

            ws.send(JSON.stringify({
                text: ''
            }));
        });

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());

                if (message.audio) {
                    const audioBuffer = Buffer.from(message.audio, 'base64');
                    audioChunks.push(audioBuffer);
                }

                if (message.isFinal) {
                    ws.close();
                }
            } catch (e) {
                audioChunks.push(data);
            }
        });

        ws.on('close', () => {
            if (audioChunks.length > 0) {
                resolve(Buffer.concat(audioChunks));
            } else {
                reject(new Error('No audio generated'));
            }
        });

        ws.on('error', (error) => {
            reject(error);
        });

        setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
                reject(new Error('TTS timeout'));
            }
        }, 30000);
    });
}

/**
 * Convert text to speech using REST API (simpler, non-streaming)
 * @param {string} text - Text to convert
 * @returns {Promise<Buffer>} Audio buffer
 */
export async function textToSpeechSimple(text) {
    if (!apiKey) {
        throw new Error('ElevenLabs not configured');
    }

    try {
        const response = await fetch(
            `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`,
            {
                method: 'POST',
                headers: {
                    'Accept': 'audio/mpeg',
                    'Content-Type': 'application/json',
                    'xi-api-key': apiKey
                },
                body: JSON.stringify({
                    text: text,
                    model_id: 'eleven_multilingual_v2',
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.8,
                        style: 0.0,
                        use_speaker_boost: true
                    }
                })
            }
        );

        if (!response.ok) {
            throw new Error(`TTS API error: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } catch (error) {
        console.error('TTS error:', error.message);
        throw error;
    }
}

/**
 * Check if ElevenLabs is properly configured
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
    if (!apiKey) {
        return [];
    }

    try {
        const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
            headers: { 'xi-api-key': apiKey }
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        return data.voices || [];
    } catch (error) {
        console.error('Get voices error:', error.message);
        return [];
    }
}
