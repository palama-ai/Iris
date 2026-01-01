/**
 * IRIS Backend - AI Service with Groq
 * Features: Time/Date Awareness, PERSISTENT Memory, Task Scheduling
 */

import { extractCommandFromText, SUPPORTED_COMMANDS_LIST } from '../utils/commandParser.js';
import {
    saveUserPreference,
    getUserPreferences,
    saveScheduledTask
} from '../config/database.js';

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

// Build system prompt with time context and preferences from database
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
When user says "remember that I like X" or "my favorite X is Y" or "my name is X", respond with:
{"action": "REMEMBER", "key": "category", "value": "preference", "reply": "I'll remember that, sir."}

Examples of what to remember:
- "my name is Ahmed" → {"action": "REMEMBER", "key": "name", "value": "Ahmed", "reply": "Nice to meet you, Ahmed. I'll remember your name, sir."}
- "remember I like jazz" → {"action": "REMEMBER", "key": "favorite_music", "value": "jazz", "reply": "I'll remember you like jazz, sir."}
- "my favorite color is blue" → {"action": "REMEMBER", "key": "favorite_color", "value": "blue", "reply": "I'll remember that blue is your favorite color, sir."}

### For recall questions:
When user asks about stored preferences like "what's my name?", use the User Preferences section above to answer.

### For scheduling:
When user says "remind me at X to do Y" or "schedule X for Y", respond with:
{"action": "SCHEDULE", "time": "ISO datetime", "task": "description", "reply": "Scheduled, sir."}

### For COMPLEX multi-step tasks (IMPORTANT!):
When user requests a task that requires BROWSER AUTOMATION like posting on social media, filling forms, or multi-step workflows, ALWAYS respond with:
{"action": "COMPLEX_TASK", "description": "exact task description", "tool": "browser", "reply": "I'll handle that for you, sir."}

MUST use COMPLEX_TASK for:
- "post on LinkedIn" - this is NOT just opening URL, it requires typing and clicking
- "post on Twitter/X" - social media automation
- "create a file in VS Code" - application automation
- "send email" - multi-step browser workflow
- "search and download" - multi-step browser workflow
- Any task with "post", "publish", "create", "send", "upload", "share"

DO NOT use EXECUTE with OPEN_BROWSER for these tasks! They require automation.

### For SIMPLE action commands (just opening apps/URLs):
{"action": "EXECUTE", "command": "TYPE", "params": {...}, "reply": "short reply"}

Available commands: ${SUPPORTED_COMMANDS_LIST}

## Examples:
"What time is it?" → It's currently [time from context above], sir.
"my name is Ahmed" → {"action": "REMEMBER", "key": "name", "value": "Ahmed", "reply": "Nice to meet you, Ahmed. I'll remember your name, sir."}
"Remember I like jazz" → {"action": "REMEMBER", "key": "favorite_music", "value": "jazz", "reply": "I'll remember you like jazz, sir."}
"Remind me at 5pm to call mom" → {"action": "SCHEDULE", "time": "2024-12-28T17:00:00", "task": "call mom", "reply": "I'll remind you at 5 PM, sir."}
"Open browser" → {"action": "EXECUTE", "command": "OPEN_BROWSER", "params": {}, "reply": "Opening browser, sir."}
"Open LinkedIn" → {"action": "EXECUTE", "command": "OPEN_BROWSER", "params": {"url": "https://linkedin.com"}, "reply": "Opening LinkedIn, sir."}
"Post 'Hello World' on LinkedIn" → {"action": "COMPLEX_TASK", "description": "Post 'Hello World' on LinkedIn", "tool": "browser", "reply": "I'll post that to LinkedIn for you, sir."}
"انشر على لينكد ان" → {"action": "COMPLEX_TASK", "description": "Post on LinkedIn", "tool": "browser", "reply": "I'll post to LinkedIn for you, sir."}
"Create new file in VS Code" → {"action": "COMPLEX_TASK", "description": "Create new file in VS Code", "tool": "app", "reply": "Creating a new file in VS Code, sir."}
"How are you?" → I'm functioning perfectly, ${greeting.toLowerCase().includes('good') ? greeting.toLowerCase() : 'sir'}. How can I assist you?`;
}

let apiKey = null;

export function initGemini() {
    if (process.env.GROQ_API_KEY) {
        apiKey = process.env.GROQ_API_KEY;
        console.log('✅ AI initialized (Groq API) with PERSISTENT Memory features');
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

// Save preference to DATABASE (persistent)
export async function savePreference(sessionId, key, value) {
    const saved = await saveUserPreference(sessionId, key, value);
    if (saved) {
        console.log(`💾 Preference SAVED TO DATABASE: ${key} = ${value}`);
    }
    return saved;
}

// Schedule task in DATABASE (persistent)
export async function scheduleTask(sessionId, time, task) {
    const taskId = await saveScheduledTask(sessionId, time, task);
    if (taskId) {
        console.log(`📅 Task SAVED TO DATABASE: "${task}" at ${time}`);
    }
    return taskId;
}


// Process message
export async function processMessage(userMessage, history = [], sessionId = 'default') {
    if (!apiKey && !initGemini()) {
        return { action: null, reply: 'AI service unavailable.', error: true };
    }

    const isGroq = !!process.env.GROQ_API_KEY;

    // Load preferences from DATABASE (persistent memory!)
    const userPreferences = await getUserPreferences(sessionId);
    const systemPrompt = buildSystemPrompt(userPreferences);

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
        return await parseResponse(responseText, sessionId);

    } catch (error) {
        console.error('AI error:', error.message);
        return { action: null, reply: 'Sorry, an error occurred.', error: true };
    }
}

// Parse response and handle special actions
async function parseResponse(text, sessionId) {
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
                // Save to DATABASE (persistent!)
                await savePreference(sessionId, parsed.key, parsed.value);
                return { action: 'REMEMBER', reply: parsed.reply || 'I will remember that, sir.' };
            }

            if (parsed.action === 'SCHEDULE') {
                // Save to DATABASE (persistent!)
                await scheduleTask(sessionId, parsed.time, parsed.task);
                return { action: 'SCHEDULE', reply: parsed.reply || 'Task scheduled, sir.', time: parsed.time, task: parsed.task };
            }

            if (parsed.action === 'EXECUTE') {
                return {
                    action: parsed.action,
                    command: parsed.command || null,
                    params: parsed.params || {},
                    reply: parsed.reply || 'Done, sir.'
                };
            }

            if (parsed.action === 'COMPLEX_TASK') {
                return {
                    action: 'COMPLEX_TASK',
                    description: parsed.description || 'Execute complex task',
                    tool: parsed.tool || 'system',
                    reply: parsed.reply || 'I\'ll handle that for you, sir.'
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
