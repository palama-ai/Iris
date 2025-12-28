/**
 * IRIS Backend - AI Service with Groq
 * Uses Groq API for fast, free AI responses
 */

import { extractCommandFromText, SUPPORTED_COMMANDS_LIST } from '../utils/commandParser.js';

// Groq API - Fast & Free
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// IRIS System Instruction
const IRIS_SYSTEM = `You are IRIS, an intelligent personal assistant like J.A.R.V.I.S from Iron Man.

## Identity:
- Name: IRIS (Intelligent Real-time Interactive System)
- Professional, polite, sometimes call user "sir"
- Keep responses SHORT (1-2 sentences max)
- Respond in user's language

## Commands:
When user requests action, respond with JSON:
{"action": "EXECUTE", "command": "TYPE", "params": {...}, "reply": "short reply"}

Commands: ${SUPPORTED_COMMANDS_LIST}

## Examples:
"Open browser" → {"action": "EXECUTE", "command": "OPEN_BROWSER", "params": {}, "reply": "Opening browser, sir."}
"How are you?" → I'm functioning perfectly, sir. How can I assist you?
"What's your name?" → I'm IRIS, your personal AI assistant.

Be helpful, professional, and concise.`;

let apiKey = null;

/**
 * Initialize AI Service
 */
export function initGemini() {
    // Check for Groq API Key first, then Gemini
    if (process.env.GROQ_API_KEY) {
        apiKey = process.env.GROQ_API_KEY;
        console.log('✅ AI initialized (Groq API)');
        return true;
    }
    if (process.env.GEMINI_API_KEY) {
        apiKey = process.env.GEMINI_API_KEY;
        console.log('✅ AI initialized (Gemini API - fallback)');
        return true;
    }
    console.error('❌ No API key set (GROQ_API_KEY or GEMINI_API_KEY)');
    return false;
}

/**
 * Process message with Groq API
 */
export async function processMessage(userMessage, history = []) {
    if (!apiKey && !initGemini()) {
        return { action: null, reply: 'AI service unavailable.', error: true };
    }

    // Check if using Groq or Gemini
    const isGroq = process.env.GROQ_API_KEY ? true : false;

    try {
        let responseText;

        if (isGroq) {
            // Groq API (OpenAI compatible)
            const messages = [
                { role: 'system', content: IRIS_SYSTEM },
                ...history.map(h => ({ role: h.role, content: h.content })),
                { role: 'user', content: userMessage }
            ];

            const response = await fetch(GROQ_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: messages,
                    max_tokens: 300,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                const err = await response.text();
                console.error('Groq error:', err);
                throw new Error(`Groq API error: ${response.status}`);
            }

            const data = await response.json();
            responseText = data.choices?.[0]?.message?.content?.trim() || 'I understood.';
        } else {
            // Gemini API fallback
            const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
            const contents = [
                { role: 'user', parts: [{ text: `System: ${IRIS_SYSTEM}` }] },
                { role: 'model', parts: [{ text: 'Understood. I am IRIS.' }] },
                ...history.map(h => ({
                    role: h.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: h.content }]
                })),
                { role: 'user', parts: [{ text: userMessage }] }
            ];

            const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents })
            });

            if (!response.ok) {
                throw new Error(`Gemini error: ${response.status}`);
            }

            const data = await response.json();
            responseText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'I understood.';
        }

        console.log('📝 AI response:', responseText.substring(0, 80));
        return parseResponse(responseText);

    } catch (error) {
        console.error('AI error:', error.message);
        return { action: null, reply: 'Sorry, an error occurred. Please try again.', error: true };
    }
}

/**
 * Parse response for commands
 */
function parseResponse(text) {
    let jsonText = text;
    const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeMatch) jsonText = codeMatch[1].trim();

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

    // Check for extracted command
    const extracted = extractCommandFromText(text);
    if (extracted) return extracted;

    return { action: null, command: null, params: {}, reply: text };
}

export function isLikelyCommand(message) {
    const keywords = ['افتح', 'شغل', 'أغلق', 'ابحث', 'open', 'run', 'close', 'search', 'launch', 'start', 'play'];
    return keywords.some(k => message.toLowerCase().includes(k));
}

export { SUPPORTED_COMMANDS_LIST };
