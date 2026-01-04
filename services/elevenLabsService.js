/**
 * IRIS Backend - ElevenLabs Voice Service
 * Handles text-to-speech conversion using official ElevenLabs SDK
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

let client = null;
let voiceId = null;

/**
 * Initialize ElevenLabs service
 */
export function initElevenLabs() {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    voiceId = process.env.ELEVENLABS_VOICE_ID;

    if (!apiKey) {
        console.warn('⚠️  ELEVENLABS_API_KEY not set. Voice synthesis disabled.');
        return false;
    }

    if (!voiceId) {
        console.warn('⚠️  ELEVENLABS_VOICE_ID not set. Using default voice.');
        voiceId = '21m00Tcm4TlvDq8ikWAM'; // Rachel - default voice
    }

    client = new ElevenLabsClient({ apiKey });
    console.log('✅ ElevenLabs service initialized (Official SDK)');
    return true;
}

/**
 * Get a signed URL for client-side WebSocket connection
 * @returns {Object} Signed URL and configuration
 */
export async function getSignedUrl() {
    const agentId = process.env.ELEVENLABS_AGENT_ID;
    if (!client || !agentId) {
        return { error: 'ElevenLabs not configured' };
    }

    try {
        const response = await client.convai.conversation.getSignedUrl({ agentId });
        return {
            signedUrl: response.signedUrl,
            agentId: agentId
        };
    } catch (error) {
        console.error('ElevenLabs signed URL error:', error.message);
        return { error: error.message };
    }
}

/**
 * Convert text to speech with streaming via callback
 * @param {string} text - Text to convert
 * @param {Function} onChunk - Callback for each audio chunk
 * @param {Function} onComplete - Callback when streaming is complete
 * @param {Function} onError - Callback for errors
 */
export async function textToSpeechStream(text, onChunk, onComplete, onError) {
    if (!client) {
        onError?.(new Error('ElevenLabs not configured'));
        return;
    }

    try {
        // Use streaming API
        const audioStream = await client.textToSpeech.stream(voiceId, {
            text: text,
            modelId: 'eleven_multilingual_v2',
            voiceSettings: {
                stability: 0.5,
                similarityBoost: 0.8,
                style: 0.0,
                useSpeakerBoost: true
            }
        });

        let chunkIndex = 0;
        const chunks = [];

        // Collect chunks from async iterator
        for await (const chunk of audioStream) {
            chunks.push(chunk);
            onChunk?.({
                audio: Buffer.from(chunk).toString('base64'),
                index: chunkIndex++,
                isFinal: false
            });
        }

        // Signal final chunk
        onChunk?.({
            audio: null,
            index: chunkIndex,
            isFinal: true
        });

        onComplete?.();
    } catch (error) {
        console.error('TTS streaming error:', error.message);
        onError?.(error);
    }
}

/**
 * Convert text to speech (simple, non-streaming)
 * @param {string} text - Text to convert
 * @returns {Promise<Buffer>} Audio buffer
 */
export async function textToSpeechSimple(text) {
    if (!client) {
        throw new Error('ElevenLabs not configured');
    }

    try {
        const audioStream = await client.textToSpeech.convert(voiceId, {
            text: text,
            modelId: 'eleven_multilingual_v2',
            voiceSettings: {
                stability: 0.5,
                similarityBoost: 0.8,
                style: 0.0,
                useSpeakerBoost: true
            }
        });

        // Collect all chunks into a buffer
        const chunks = [];
        for await (const chunk of audioStream) {
            chunks.push(chunk);
        }

        return Buffer.concat(chunks);
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
    return !!client;
}

/**
 * Get available voices
 * @returns {Promise<Array>} List of available voices
 */
export async function getVoices() {
    if (!client) {
        return [];
    }

    try {
        const response = await client.voices.getAll();
        return response.voices || [];
    } catch (error) {
        console.error('Get voices error:', error.message);
        return [];
    }
}
