/**
 * IRIS Backend - Gemini AI Service
 * Handles communication with Google Gemini for intelligent responses
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { extractCommandFromText, SUPPORTED_COMMANDS_LIST } from '../utils/commandParser.js';

let genAI = null;
let model = null;

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
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        model = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash-exp',
            systemInstruction: IRIS_SYSTEM_INSTRUCTION
        });
        console.log('✅ Gemini AI initialized (gemini-2.0-flash-exp)');
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
    if (!model) {
        console.log('⚠️ Model not initialized, trying to reinitialize...');
        if (!initGemini()) {
            return {
                action: null,
                reply: 'Sorry, the AI service is currently unavailable.',
                error: true
            };
        }
    }

    try {
        // Start chat with history
        const chat = model.startChat({
            history: formatHistory(history)
        });

        // Send message
        const result = await chat.sendMessage(userMessage);
        const responseText = result.response.text().trim();

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
        console.error('Gemini error:', error.message);
        return {
            action: null,
            reply: 'Sorry, there was an error processing your message. Please try again.',
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
