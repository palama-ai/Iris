/**
 * IRIS Backend - Gemini AI Service
 * Handles communication with Google Gemini for intelligent responses
 * Using @google/genai SDK (v1.0+)
 */

import { GoogleGenAI } from '@google/genai';
import { extractCommandFromText, SUPPORTED_COMMANDS_LIST } from '../utils/commandParser.js';

let genAI = null;

// IRIS System Instruction
const IRIS_SYSTEM_INSTRUCTION = `You are IRIS, an intelligent personal assistant. You're like J.A.R.V.I.S from Iron Man - smart, polite, and technical.

## Your Identity:
- Name: IRIS (Intelligent Real-time Interactive System)
- You're a sophisticated personal assistant for desktop and mobile
- You speak professionally and politely
- Keep responses SHORT (1-2 sentences max)
- Respond in the SAME language the user uses

## When to Use Commands:
Only use commands when the user explicitly requests an action.
- "How do I open browser?" → Just explain, don't execute
- "Open browser" → Execute the command

## Command Format:
When executing, respond with JSON only:
{"action": "EXECUTE", "command": "COMMAND_TYPE", "params": {...}, "reply": "Your short reply"}

## Supported Commands:
${SUPPORTED_COMMANDS_LIST}

## Examples:
User: "Open the browser"
{"action": "EXECUTE", "command": "OPEN_BROWSER", "params": {}, "reply": "Opening the browser for you."}

User: "Search for weather"
{"action": "EXECUTE", "command": "SEARCH_WEB", "params": {"query": "weather"}, "reply": "Searching now."}

User: "How are you?"
I'm doing well, thank you for asking! How can I help you?

User: "What's your name?"
I'm IRIS, your intelligent personal assistant. How may I assist you?

## Important Notes:
- Don't execute dangerous commands without confirmation
- If you don't understand, ask for clarification
- Always be helpful and polite`;

/**
 * Initialize Gemini AI client
 */
export function initGemini() {
    if (!process.env.GEMINI_API_KEY) {
        console.error('❌ GEMINI_API_KEY not set');
        return false;
    }

    try {
        genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        console.log('✅ Gemini AI initialized (@google/genai)');
        return true;
    } catch (error) {
        console.error('❌ Gemini initialization error:', error.message);
        return false;
    }
}

/**
 * Format chat history for Gemini
 */
function formatHistory(history) {
    return history.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
    }));
}

/**
 * Process a user message and get AI response
 */
export async function processMessage(userMessage, history = []) {
    if (!genAI) {
        console.log('⚠️ AI not initialized, trying to reinitialize...');
        if (!initGemini()) {
            return {
                action: null,
                reply: 'Sorry, the AI service is currently unavailable.',
                error: true
            };
        }
    }

    try {
        // Build contents array with history and current message
        const contents = [
            ...formatHistory(history),
            { role: 'user', parts: [{ text: userMessage }] }
        ];

        // Call Gemini API using @google/genai SDK
        // Try gemini-2.0-flash first, fallback to gemini-1.5-flash
        let response;
        try {
            response = await genAI.models.generateContent({
                model: 'models/gemini-2.0-flash',
                contents: contents,
                config: {
                    systemInstruction: IRIS_SYSTEM_INSTRUCTION,
                    maxOutputTokens: 500,
                    temperature: 0.7
                }
            });
        } catch (e) {
            console.log('⚠️ gemini-2.0-flash failed, trying gemini-1.5-flash-002');
            response = await genAI.models.generateContent({
                model: 'models/gemini-1.5-flash-002',
                contents: contents,
                config: {
                    systemInstruction: IRIS_SYSTEM_INSTRUCTION
                }
            });
        }

        // Extract text from response
        const responseText = response.text?.trim() ||
            response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
            'I understood your message.';

        console.log('📝 Gemini response:', responseText.substring(0, 100));

        // Try to parse as JSON command
        const parsed = parseResponse(responseText);

        // If not a valid command, try to extract [ACTION:] pattern
        if (!parsed.action) {
            const extracted = extractCommandFromText(responseText);
            if (extracted) {
                return extracted;
            }
        }

        return parsed;
    } catch (error) {
        console.error('Gemini error:', error.message || error);
        return {
            action: null,
            reply: 'Sorry, there was an error. Please try again.',
            error: true
        };
    }
}

/**
 * Parse Gemini response to extract action commands
 */
function parseResponse(responseText) {
    let jsonText = responseText;

    // Handle markdown code blocks
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
    }

    // Check if response is JSON (command)
    if (jsonText.startsWith('{') && jsonText.endsWith('}')) {
        try {
            const parsed = JSON.parse(jsonText);
            if (parsed.action === 'EXECUTE') {
                return {
                    action: parsed.action,
                    command: parsed.command || null,
                    params: parsed.params || {},
                    reply: parsed.reply || 'Done'
                };
            }
        } catch (e) {
            // Not valid JSON, treat as regular response
        }
    }

    // Regular text response
    return {
        action: null,
        command: null,
        params: {},
        reply: responseText
    };
}

/**
 * Check if message likely contains a command
 */
export function isLikelyCommand(message) {
    const commandKeywords = [
        'افتح', 'شغل', 'أغلق', 'ابحث', 'اكتب', 'احذف', 'أوقف',
        'open', 'run', 'close', 'search', 'type', 'delete', 'launch',
        'start', 'play', 'pause', 'stop', 'shutdown', 'restart', 'lock'
    ];

    const lowerMessage = message.toLowerCase();
    return commandKeywords.some(keyword => lowerMessage.includes(keyword));
}

export { SUPPORTED_COMMANDS_LIST };
