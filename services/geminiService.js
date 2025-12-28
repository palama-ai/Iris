/**
 * IRIS Backend - AI Service with Groq
 * Features: Time/Date Awareness, Memory, Task Scheduling
 */

import { extractCommandFromText, SUPPORTED_COMMANDS_LIST } from '../utils/commandParser.js';

// Groq API
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Get current date/time info
function getTimeContext() {
    const now = new Date();
    const options = {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true, timeZoneName: 'short'
    };
    const timeStr = now.toLocaleString('en-US', options);
    const hour = now.getHours();

    let greeting = 'Hello';
    if (hour < 12) greeting = 'Good morning';
    else if (hour < 17) greeting = 'Good afternoon';
    else if (hour < 21) greeting = 'Good evening';
    else greeting = 'Good night';

    return { timeStr, greeting, timestamp: now.toISOString() };
}

// Build system prompt with time context
function buildSystemPrompt(userPreferences = []) {
    const { timeStr, greeting } = getTimeContext();

    let preferencesContext = '';
    if (userPreferences.length > 0) {
        preferencesContext = `\n\n## User Preferences (from memory):\n${userPreferences.map(p => `- ${p.key}: ${p.value}`).join('\n')}`;
    }

    return `You are IRIS, an intelligent personal assistant like J.A.R.V.I.S from Iron Man.

## Current Time:
${timeStr}
Appropriate greeting: "${greeting}, sir"

## Identity:
- Name: IRIS (Intelligent Real-time Interactive System)
- Professional, polite, call user "sir"
- Keep responses SHORT (1-2 sentences max)
- Respond in the same language as the user
${preferencesContext}

## Special Commands:

### For time questions:
When asked about time/date, use the current time above.

### For remembering preferences:
When user says "remember that I like X" or "my favorite X is Y", respond with:
{"action": "REMEMBER", "key": "category", "value": "preference", "reply": "I'll remember that, sir."}

### For scheduling:
When user says "remind me at X to do Y" or "schedule X for Y", respond with:
{"action": "SCHEDULE", "time": "ISO datetime", "task": "description", "reply": "Scheduled, sir."}

### For action commands:
{"action": "EXECUTE", "command": "TYPE", "params": {...}, "reply": "short reply"}

Available commands: ${SUPPORTED_COMMANDS_LIST}

## Examples:
"What time is it?" → It's currently [time from context above], sir.
"Remember I like jazz" → {"action": "REMEMBER", "key": "music", "value": "jazz", "reply": "I'll remember you like jazz, sir."}
"Remind me at 5pm to call mom" → {"action": "SCHEDULE", "time": "2024-12-28T17:00:00", "task": "call mom", "reply": "I'll remind you at 5 PM, sir."}
"Open browser" → {"action": "EXECUTE", "command": "OPEN_BROWSER", "params": {}, "reply": "Opening browser, sir."}
"How are you?" → I'm functioning perfectly, ${greeting.toLowerCase().includes('good') ? greeting.toLowerCase() : 'sir'}. How can I assist you?`;
}

let apiKey = null;

// In-memory storage for preferences and tasks (can be moved to database later)
const userMemory = new Map(); // sessionId -> { preferences: [], scheduledTasks: [] }

export function initGemini() {
    if (process.env.GROQ_API_KEY) {
        apiKey = process.env.GROQ_API_KEY;
        console.log('✅ AI initialized (Groq API) with Time/Memory features');
        return true;
    }
    if (process.env.GEMINI_API_KEY) {
        apiKey = process.env.GEMINI_API_KEY;
        console.log('✅ AI initialized (Gemini fallback)');
        return true;
    }
    console.error('❌ No API key set');
    return false;
}

// Get or create user memory
function getUserMemory(sessionId) {
    if (!userMemory.has(sessionId)) {
        userMemory.set(sessionId, { preferences: [], scheduledTasks: [] });
    }
    return userMemory.get(sessionId);
}

// Save preference
export function savePreference(sessionId, key, value) {
    const mem = getUserMemory(sessionId);
    const existing = mem.preferences.findIndex(p => p.key === key);
    if (existing >= 0) {
        mem.preferences[existing].value = value;
    } else {
        mem.preferences.push({ key, value, savedAt: new Date().toISOString() });
    }
    console.log(`💾 Saved preference for ${sessionId}: ${key} = ${value}`);
}

// Schedule task
export function scheduleTask(sessionId, time, task) {
    const mem = getUserMemory(sessionId);
    mem.scheduledTasks.push({
        time,
        task,
        status: 'pending',
        createdAt: new Date().toISOString()
    });
    console.log(`📅 Scheduled task for ${sessionId}: ${task} at ${time}`);
}

// Process message
export async function processMessage(userMessage, history = [], sessionId = 'default') {
    if (!apiKey && !initGemini()) {
        return { action: null, reply: 'AI service unavailable.', error: true };
    }

    const isGroq = !!process.env.GROQ_API_KEY;
    const mem = getUserMemory(sessionId);
    const systemPrompt = buildSystemPrompt(mem.preferences);

    try {
        let responseText;

        if (isGroq) {
            const messages = [
                { role: 'system', content: systemPrompt },
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
                    messages,
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
            // Gemini fallback
            const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
            const contents = [
                { role: 'user', parts: [{ text: `System: ${systemPrompt}` }] },
                { role: 'model', parts: [{ text: 'Understood.' }] },
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

            if (!response.ok) throw new Error(`Gemini error: ${response.status}`);
            const data = await response.json();
            responseText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'I understood.';
        }

        console.log('📝 AI:', responseText.substring(0, 80));
        return parseResponse(responseText, sessionId);

    } catch (error) {
        console.error('AI error:', error.message);
        return { action: null, reply: 'Sorry, an error occurred.', error: true };
    }
}

// Parse response and handle special actions
function parseResponse(text, sessionId) {
    console.log('📝 Parsing AI response:', text.substring(0, 100));

    // Find JSON by looking for balanced braces
    let jsonStr = null;
    const startIdx = text.indexOf('{');
    if (startIdx !== -1) {
        let depth = 0;
        let endIdx = -1;
        for (let i = startIdx; i < text.length; i++) {
            if (text[i] === '{') depth++;
            if (text[i] === '}') depth--;
            if (depth === 0) {
                endIdx = i;
                break;
            }
        }
        if (endIdx > startIdx) {
            jsonStr = text.substring(startIdx, endIdx + 1);
        }
    }

    if (jsonStr) {
        try {
            const parsed = JSON.parse(jsonStr);
            console.log('✅ Parsed JSON:', parsed);

            if (parsed.action === 'REMEMBER') {
                savePreference(sessionId, parsed.key, parsed.value);
                return { action: 'REMEMBER', reply: parsed.reply || 'I will remember that, sir.' };
            }

            if (parsed.action === 'SCHEDULE') {
                scheduleTask(sessionId, parsed.time, parsed.task);
                return { action: 'SCHEDULE', reply: parsed.reply || 'Task scheduled, sir.' };
            }

            if (parsed.action === 'EXECUTE') {
                return {
                    action: parsed.action,
                    command: parsed.command || null,
                    params: parsed.params || {},
                    reply: parsed.reply || 'Done, sir.'
                };
            }
        } catch (e) {
            console.log('⚠️ JSON parse error:', e.message);
        }
    }

    const extracted = extractCommandFromText(text);
    if (extracted) return extracted;

    // Remove any JSON-like text from reply
    const cleanText = text.replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
    return { action: null, command: null, params: {}, reply: cleanText || text };
}

export function isLikelyCommand(message) {
    const keywords = ['افتح', 'شغل', 'أغلق', 'ابحث', 'open', 'run', 'close', 'search', 'launch', 'start', 'play', 'remember', 'remind', 'schedule'];
    return keywords.some(k => message.toLowerCase().includes(k));
}

export { SUPPORTED_COMMANDS_LIST };
