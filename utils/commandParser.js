/**
 * IRIS Backend - Command Parser Utility
 * Handles parsing and validation of command structures
 */

// Supported command types and their configurations
export const COMMAND_TYPES = {
    OPEN_BROWSER: {
        name: 'OPEN_BROWSER',
        description: 'Open web browser',
        requiredParams: [],
        optionalParams: ['url'],
        aliases: ['browser', 'chrome', 'firefox', 'edge', 'المتصفح']
    },
    OPEN_APP: {
        name: 'OPEN_APP',
        description: 'Open an application',
        requiredParams: ['name'],
        optionalParams: [],
        aliases: ['app', 'application', 'تطبيق', 'برنامج']
    },
    OPEN_FILE: {
        name: 'OPEN_FILE',
        description: 'Open a file',
        requiredParams: ['path'],
        optionalParams: [],
        aliases: ['file', 'ملف']
    },
    SYSTEM_COMMAND: {
        name: 'SYSTEM_COMMAND',
        description: 'Execute system command',
        requiredParams: ['cmd'],
        optionalParams: [],
        aliases: ['cmd', 'command', 'أمر']
    },
    SEARCH_WEB: {
        name: 'SEARCH_WEB',
        description: 'Search the web',
        requiredParams: ['query'],
        optionalParams: ['engine'],
        aliases: ['search', 'google', 'بحث', 'ابحث']
    },
    SHUTDOWN_SYSTEM: {
        name: 'SHUTDOWN_SYSTEM',
        description: 'Shutdown or restart the computer',
        requiredParams: [],
        optionalParams: ['mode'], // 'shutdown', 'restart', 'sleep'
        aliases: ['shutdown', 'restart', 'إيقاف', 'إغلاق']
    },
    TYPE_TEXT: {
        name: 'TYPE_TEXT',
        description: 'Type text on keyboard',
        requiredParams: ['text'],
        optionalParams: [],
        aliases: ['type', 'write', 'اكتب', 'كتابة']
    },
    OPEN_SPOTIFY: {
        name: 'OPEN_SPOTIFY',
        description: 'Open Spotify application',
        requiredParams: [],
        optionalParams: [],
        aliases: ['spotify', 'سبوتيفاي']
    },
    PLAY_MUSIC: {
        name: 'PLAY_MUSIC',
        description: 'Play music or media',
        requiredParams: [],
        optionalParams: ['track', 'playlist'],
        aliases: ['play', 'شغل', 'موسيقى']
    },
    PAUSE_MUSIC: {
        name: 'PAUSE_MUSIC',
        description: 'Pause current music or media',
        requiredParams: [],
        optionalParams: [],
        aliases: ['pause', 'stop', 'إيقاف مؤقت', 'أوقف']
    },
    VOLUME_CONTROL: {
        name: 'VOLUME_CONTROL',
        description: 'Control system volume',
        requiredParams: ['level'], // 0-100 or 'mute', 'unmute'
        optionalParams: [],
        aliases: ['volume', 'صوت', 'مستوى الصوت']
    },
    LOCK_SCREEN: {
        name: 'LOCK_SCREEN',
        description: 'Lock the computer screen',
        requiredParams: [],
        optionalParams: [],
        aliases: ['lock', 'قفل', 'قفل الشاشة']
    },
    GESTURE_CONTROL: {
        name: 'GESTURE_CONTROL',
        description: 'Enable or disable hand gesture control',
        requiredParams: [], // AI may send enable:true/false or action:enable/disable
        optionalParams: ['enable', 'action'],
        aliases: ['gesture', 'hand control', 'hand tracking', 'إيماءات', 'تحكم باليد']
    }
};

// List of supported commands for Gemini System Instruction
export const SUPPORTED_COMMANDS_LIST = Object.entries(COMMAND_TYPES)
    .map(([key, val]) => `- ${key}: ${val.description}`)
    .join('\n');

/**
 * Extract command from [ACTION: X, target: Y] pattern
 * @param {string} text - Text possibly containing action pattern
 * @returns {Object|null} Extracted command or null
 */
export function extractCommandFromText(text) {
    // Pattern: [ACTION: COMMAND_TYPE, target: value] or [ACTION: COMMAND_TYPE, param: value]
    const actionPattern = /\[ACTION:\s*(\w+)(?:,\s*(\w+):\s*([^\]]+))?\]/gi;
    const match = actionPattern.exec(text);

    if (!match) return null;

    const commandType = match[1].toUpperCase();
    const paramKey = match[2] || 'target';
    const paramValue = match[3]?.trim();

    // Verify command type exists
    if (!COMMAND_TYPES[commandType]) return null;

    const params = {};
    if (paramValue) {
        // Map common param names to expected param names
        const paramMapping = {
            target: getMainParamName(commandType),
            name: 'name',
            url: 'url',
            query: 'query',
            text: 'text',
            path: 'path',
            cmd: 'cmd',
            level: 'level',
            mode: 'mode'
        };

        const mappedKey = paramMapping[paramKey.toLowerCase()] || paramKey;
        params[mappedKey] = paramValue;
    }

    // Clean reply text by removing the action pattern
    const cleanReply = text.replace(actionPattern, '').trim();

    return {
        action: 'EXECUTE',
        command: commandType,
        params: params,
        reply: cleanReply || `جاري تنفيذ الأمر: ${commandType}`,
        timestamp: Date.now()
    };
}

/**
 * Get the main parameter name for a command type
 * @param {string} commandType - Command type
 * @returns {string} Main parameter name
 */
function getMainParamName(commandType) {
    const mainParams = {
        OPEN_BROWSER: 'url',
        OPEN_APP: 'name',
        OPEN_FILE: 'path',
        SYSTEM_COMMAND: 'cmd',
        SEARCH_WEB: 'query',
        TYPE_TEXT: 'text',
        VOLUME_CONTROL: 'level',
        SHUTDOWN_SYSTEM: 'mode',
        PLAY_MUSIC: 'track'
    };
    return mainParams[commandType] || 'target';
}

/**
 * Validate a command structure
 * @param {Object} command - Command object from Gemini
 * @returns {Object} Validation result {valid: boolean, error?: string}
 */
export function validateCommand(command) {
    if (!command || !command.action) {
        return { valid: false, error: 'Missing action' };
    }

    if (command.action !== 'EXECUTE') {
        return { valid: false, error: 'Invalid action type' };
    }

    if (!command.command) {
        return { valid: false, error: 'Missing command type' };
    }

    const commandType = COMMAND_TYPES[command.command];
    if (!commandType) {
        return { valid: false, error: `Unknown command: ${command.command}` };
    }

    // Check required parameters
    const params = command.params || {};

    // Normalize: AI sometimes sends 'app' instead of 'name' for OPEN_APP
    if (command.command === 'OPEN_APP' && params.app && !params.name) {
        params.name = params.app;
    }

    for (const required of commandType.requiredParams) {
        if (!params[required]) {
            return {
                valid: false,
                error: `Missing required parameter: ${required}`
            };
        }
    }

    return { valid: true };
}

/**
 * Create a standardized command object
 * @param {string} type - Command type
 * @param {Object} params - Command parameters
 * @param {string} reply - Response message
 * @returns {Object} Standardized command
 */
export function createCommand(type, params = {}, reply = '') {
    return {
        action: 'EXECUTE',
        command: type,
        params: params,
        reply: reply,
        timestamp: Date.now()
    };
}

/**
 * Create a desktop execution payload
 * @param {Object} command - Validated command object
 * @returns {Object} Payload for desktop client
 */
export function createDesktopPayload(command) {
    return {
        type: 'EXECUTE_COMMAND',
        command: command.command,
        params: command.params,
        timestamp: Date.now()
    };
}

/**
 * Parse natural language for common command patterns
 * This is a fallback if Gemini doesn't return proper JSON
 * @param {string} text - User input text
 * @returns {Object|null} Detected command or null
 */
export function parseNaturalCommand(text) {
    const lowerText = text.toLowerCase();

    // Browser patterns
    if (/افتح (المتصفح|المستعرض|الانترنت)|open (browser|chrome|firefox|edge)/i.test(text)) {
        const urlMatch = text.match(/(?:https?:\/\/)?[\w.-]+\.[a-z]{2,}/i);
        return createCommand('OPEN_BROWSER', { url: urlMatch ? urlMatch[0] : '' }, 'جاري فتح المتصفح');
    }

    // Spotify patterns
    if (/افتح (سبوتيفاي|spotify)|open spotify|شغل (سبوتيفاي|spotify)/i.test(text)) {
        return createCommand('OPEN_SPOTIFY', {}, 'جاري فتح Spotify');
    }

    // Play music patterns
    if (/شغل (موسيقى|الموسيقى|أغنية)|play (music|song)/i.test(text)) {
        const trackMatch = text.match(/(?:شغل|play)\s+(?:أغنية|song|موسيقى|music)?\s*(.+)/i);
        const track = trackMatch ? trackMatch[1].trim() : '';
        return createCommand('PLAY_MUSIC', { track }, 'جاري تشغيل الموسيقى');
    }

    // Pause patterns
    if (/أوقف|إيقاف مؤقت|pause|stop music/i.test(text)) {
        return createCommand('PAUSE_MUSIC', {}, 'تم إيقاف الموسيقى');
    }

    // Search patterns
    if (/ابحث عن|search for|google/i.test(text)) {
        const query = text.replace(/ابحث عن|search for|google/i, '').trim();
        if (query) {
            return createCommand('SEARCH_WEB', { query }, `جاري البحث عن: ${query}`);
        }
    }

    // Type text patterns
    if (/اكتب|type|كتابة/i.test(text)) {
        const textMatch = text.match(/(?:اكتب|type|كتابة)\s+(.+)/i);
        if (textMatch) {
            return createCommand('TYPE_TEXT', { text: textMatch[1].trim() }, 'جاري الكتابة');
        }
    }

    // Shutdown patterns
    if (/أغلق الكمبيوتر|shutdown|إيقاف النظام/i.test(text)) {
        return createCommand('SHUTDOWN_SYSTEM', { mode: 'shutdown' }, 'جاري إيقاف تشغيل الكمبيوتر');
    }

    // Restart patterns
    if (/أعد التشغيل|restart|إعادة تشغيل/i.test(text)) {
        return createCommand('SHUTDOWN_SYSTEM', { mode: 'restart' }, 'جاري إعادة تشغيل الكمبيوتر');
    }

    // Lock screen patterns
    if (/اقفل الشاشة|lock screen|قفل/i.test(text)) {
        return createCommand('LOCK_SCREEN', {}, 'جاري قفل الشاشة');
    }

    // Volume patterns
    if (/ارفع الصوت|volume up|زد الصوت/i.test(text)) {
        return createCommand('VOLUME_CONTROL', { level: 'up' }, 'تم رفع الصوت');
    }
    if (/اخفض الصوت|volume down|خفض الصوت/i.test(text)) {
        return createCommand('VOLUME_CONTROL', { level: 'down' }, 'تم خفض الصوت');
    }
    if (/اكتم الصوت|mute|صامت/i.test(text)) {
        return createCommand('VOLUME_CONTROL', { level: 'mute' }, 'تم كتم الصوت');
    }

    // App patterns - generic "open X" at the end to catch anything
    if (/افتح (برنامج|تطبيق)|open (app|application|program)/i.test(text)) {
        const appMatch = text.match(/(?:افتح (?:برنامج|تطبيق)|open (?:app|application|program))\s+(.+)/i);
        if (appMatch) {
            return createCommand('OPEN_APP', { name: appMatch[1].trim() }, `جاري فتح ${appMatch[1]}`);
        }
    }

    // Generic "open X" pattern - catches "open notepad", "open chrome", etc.
    const openMatch = text.match(/^(?:open|افتح)\s+(.+)/i);
    if (openMatch) {
        const appName = openMatch[1].trim();
        // Check if it's a URL
        if (appName.includes('.') && !appName.includes(' ')) {
            return createCommand('OPEN_BROWSER', { url: appName }, `Opening ${appName}`);
        }
        return createCommand('OPEN_APP', { name: appName }, `Opening ${appName}`);
    }

    return null;
}
