/**
 * IRIS Backend - Gemini AI Service
 * Handles communication with Google Gemini 1.5 Flash for intelligent responses
 */

import { GoogleGenAI } from '@google/genai';
import { extractCommandFromText, SUPPORTED_COMMANDS_LIST } from '../utils/commandParser.js';

let genAI = null;
let model = null;

// IRIS System Instruction - defines the AI personality and behavior
const IRIS_SYSTEM_INSTRUCTION = `أنت IRIS، المساعد الشخصي الذكي لسيدك. أنت مثل J.A.R.V.I.S من Iron Man - ذكي، لبق، وتقني.

## هويتك:
- اسمك IRIS (Intelligent Real-time Interactive System)
- أنت مساعد شخصي متطور يعمل على جهاز الكمبيوتر والهاتف
- تتحدث بأسلوب محترف ولطيف، تنادي المستخدم "سيدي" أحياناً
- ردودك قصيرة ومختصرة (جملة أو جملتين كحد أقصى)
- تتحدث بنفس لغة المستخدم (عربي أو إنجليزي)

## متى تستخدم الأوامر:
استخدم الأوامر فقط عندما يطلب المستخدم صراحةً تنفيذ إجراء على النظام.
- إذا سأل "كيف أفتح المتصفح؟" → أجب بالشرح فقط، لا تنفذ
- إذا قال "افتح المتصفح" → نفذ الأمر

## صيغة الأوامر:
عند التنفيذ، رد بـ JSON فقط:
{"action": "EXECUTE", "command": "COMMAND_TYPE", "params": {...}, "reply": "ردك القصير"}

## الأوامر المدعومة:
${SUPPORTED_COMMANDS_LIST}

## أمثلة:
المستخدم: "افتح المتصفح"
{"action": "EXECUTE", "command": "OPEN_BROWSER", "params": {}, "reply": "حاضر سيدي، جاري فتح المتصفح"}

المستخدم: "شغل Spotify"
{"action": "EXECUTE", "command": "OPEN_SPOTIFY", "params": {}, "reply": "جاري تشغيل Spotify"}

المستخدم: "ابحث عن الطقس"
{"action": "EXECUTE", "command": "SEARCH_WEB", "params": {"query": "الطقس"}, "reply": "جاري البحث سيدي"}

المستخدم: "كيف حالك؟"
أنا بخير سيدي، شكراً لسؤالك! كيف يمكنني مساعدتك؟

المستخدم: "ما هو الوقت؟"
للأسف لا أستطيع الوصول للوقت الحالي، لكن يمكنني فتح الساعة لك إذا أردت.

## ملاحظات مهمة:
- لا تنفذ أوامر خطيرة (مثل حذف ملفات النظام) بدون تأكيد
- إذا لم تفهم الطلب، اطلب التوضيح
- كن دائماً مفيداً ومهذباً`;

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
        console.log('✅ Gemini AI initialized');
        return true;
    } catch (error) {
        console.error('❌ Gemini initialization error:', error.message);
        return false;
    }
}

/**
 * Format chat history for Gemini
 * @param {Array} history - Array of {role, content} messages
 * @returns {Array} Formatted history for Gemini
 */
function formatHistory(history) {
    return history.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
    }));
}

/**
 * Process a user message and get AI response
 * @param {string} userMessage - The user's input
 * @param {Array} history - Previous conversation history (from DB)
 * @returns {Object} Response with action, command, params, and reply
 */
export async function processMessage(userMessage, history = []) {
    if (!genAI) {
        return {
            action: null,
            reply: 'عذراً سيدي، خدمة الذكاء الاصطناعي غير متاحة حالياً.',
            error: true
        };
    }

    try {
        // Use generateContent with system instruction and history
        const contents = [
            ...formatHistory(history),
            { role: 'user', parts: [{ text: userMessage }] }
        ];

        const response = await genAI.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: contents,
            config: {
                systemInstruction: IRIS_SYSTEM_INSTRUCTION
            }
        });

        const responseText = response.text.trim();

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
            reply: 'عذراً سيدي، حدث خطأ في معالجة رسالتك. حاول مرة أخرى.',
            error: true
        };
    }
}

/**
 * Parse Gemini response to extract action commands
 * @param {string} responseText - Raw response from Gemini
 * @returns {Object} Parsed response
 */
function parseResponse(responseText) {
    // Try to extract JSON from response (may be wrapped in markdown code block)
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
                    reply: parsed.reply || 'تم'
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
 * Analyze message to detect if it contains a command
 * @param {string} message - User message
 * @returns {boolean} True if message likely contains a command
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

/**
 * Export supported commands for documentation
 */
export { SUPPORTED_COMMANDS_LIST };
