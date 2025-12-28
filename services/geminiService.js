/**
 * IRIS Backend - Gemini AI Service
 * Uses direct REST API for maximum compatibility
 */

import { extractCommandFromText, SUPPORTED_COMMANDS_LIST } from '../utils/commandParser.js';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

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

User: "How are you?"
I'm doing well, thank you for asking! How can I help you?

User: "What's your name?"
I'm IRIS, your intelligent personal assistant. How may I assist you?

## Important Notes:
- Don't execute dangerous commands without confirmation
- If you don't understand, ask for clarification
- Always be helpful and polite`;

let apiKey = null;

/**
 * Initialize Gemini AI
 */
export function initGemini() {
    if (!process.env.GEMINI_API_KEY) {
        console.error('❌ GEMINI_API_KEY not set');
        return false;
    }
    apiKey = process.env.GEMINI_API_KEY;
    console.log('✅ Gemini AI initialized (REST API)');
    return true;
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
 * Process a user message and get AI response using REST API
 */
export async function processMessage(userMessage, history = []) {
    if (!apiKey) {
        if (!initGemini()) {
            return {
                action: null,
                reply: 'Sorry, the AI service is currently unavailable.',
                error: true
            };
        }
    }

    try {
        // Build contents array
        const contents = [
            // Add system instruction as first user message
            { role: 'user', parts: [{ text: `System: ${IRIS_SYSTEM_INSTRUCTION}` }] },
            { role: 'model', parts: [{ text: 'Understood. I am IRIS, ready to assist.' }] },
            ...formatHistory(history),
            { role: 'user', parts: [{ text: userMessage }] }
        ];

        // Call Gemini REST API
        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: contents,
                generationConfig: {
                    maxOutputTokens: 500,
                    temperature: 0.7
                }
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('Gemini API error:', error);
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'I understood.';

        console.log('📝 Gemini response:', responseText.substring(0, 100));

        // Parse response
        const parsed = parseResponse(responseText);

        if (!parsed.action) {
            const extracted = extractCommandFromText(responseText);
            if (extracted) return extracted;
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

    // Check if response is JSON
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
        } catch (e) { }
    }

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
    return commandKeywords.some(k => message.toLowerCase().includes(k));
}

export { SUPPORTED_COMMANDS_LIST };
