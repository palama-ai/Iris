/**
 * IRIS Backend - Security Guard
 * 
 * Centralized security rules for dangerous operations.
 * Prevents destructive actions without explicit user confirmation.
 */

// Dangerous command patterns (regex)
const DANGEROUS_COMMAND_PATTERNS = [
    // File deletion
    /rm\s+(-rf|-r|-f)?\s*/i,
    /del\s+(\/s|\/q|\/f)?\s*/i,
    /rmdir\s+/i,
    /remove-item\s+/i,

    // System changes
    /format\s+/i,
    /diskpart/i,
    /reg\s+(delete|add)/i,
    /regedit/i,

    // Network/Firewall
    /netsh\s+(firewall|advfirewall)/i,
    /net\s+(user|localgroup|stop|start)/i,

    // Process termination
    /taskkill\s+\/f/i,
    /kill\s+-9/i,

    // System power
    /shutdown/i,
    /restart-computer/i,
    /stop-computer/i
];

// Command types that always require confirmation
const COMMANDS_REQUIRING_CONFIRMATION = [
    'SHUTDOWN_SYSTEM',
    'SYSTEM_COMMAND',    // All raw system commands need review
    'file-operation:delete',
    'FORMAT_DISK',
    'RESTART_SYSTEM'
];

// Whitelisted safe patterns (explicitly allowed)
const SAFE_PATTERNS = [
    /^start\s+\w+$/i,    // Simple start commands
    /^code\s+[\w.\/\\]+$/i,  // Opening VS Code
    /^dir\s+/i,          // Directory listing
    /^ls\s+/i,
    /^echo\s+/i,
    /^type\s+/i,         // File display
    /^cat\s+/i
];

/**
 * Check if a command is dangerous
 * @param {string} command - Raw command string
 * @returns {Object} { dangerous: boolean, reason: string }
 */
export function isDangerous(command) {
    if (!command || typeof command !== 'string') {
        return { dangerous: false, reason: null };
    }

    const lowerCmd = command.toLowerCase().trim();

    // Check if explicitly safe
    for (const pattern of SAFE_PATTERNS) {
        if (pattern.test(lowerCmd)) {
            return { dangerous: false, reason: null };
        }
    }

    // Check for dangerous patterns
    for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
        if (pattern.test(command)) {
            return {
                dangerous: true,
                reason: `Command matches dangerous pattern: ${pattern.toString()}`
            };
        }
    }

    return { dangerous: false, reason: null };
}

/**
 * Check if an action requires user confirmation
 * @param {Object} action - Action object with type and params
 * @returns {Object} { required: boolean, reason: string }
 */
export function requiresConfirmation(action) {
    if (!action || !action.type) {
        return { required: false, reason: null };
    }

    // Check command type
    if (COMMANDS_REQUIRING_CONFIRMATION.includes(action.type)) {
        return {
            required: true,
            reason: `Action type '${action.type}' requires confirmation`
        };
    }

    // Check if action contains dangerous command
    if (action.params?.cmd || action.params?.command) {
        const cmd = action.params.cmd || action.params.command;
        const dangerCheck = isDangerous(cmd);
        if (dangerCheck.dangerous) {
            return {
                required: true,
                reason: dangerCheck.reason
            };
        }
    }

    // File operations on system paths
    if (action.type === 'file-operation') {
        const path = action.params?.path || '';
        if (isSystemPath(path)) {
            return {
                required: true,
                reason: 'File operation on system path'
            };
        }
    }

    return { required: false, reason: null };
}

/**
 * Check if path is a protected system path
 * @param {string} filePath - File path to check
 * @returns {boolean}
 */
function isSystemPath(filePath) {
    if (!filePath) return false;

    const lowerPath = filePath.toLowerCase().replace(/\\/g, '/');

    const protectedPaths = [
        'c:/windows',
        'c:/program files',
        'c:/program files (x86)',
        'c:/users/default',
        '/etc',
        '/usr',
        '/bin',
        '/sbin',
        '/boot',
        '/var/log'
    ];

    return protectedPaths.some(p => lowerPath.startsWith(p));
}

/**
 * Sanitize a command by removing potentially dangerous parts
 * Note: This is a best-effort sanitization, not a security guarantee
 * @param {string} command - Raw command
 * @returns {string} Sanitized command
 */
export function sanitizeCommand(command) {
    if (!command) return '';

    // Remove command chaining that could be malicious
    let sanitized = command
        .replace(/;/g, '')           // Remove semicolons
        .replace(/\|\|/g, '')        // Remove OR chains
        .replace(/&&/g, '')          // Remove AND chains
        .replace(/`/g, '')           // Remove backticks
        .replace(/\$\(/g, '')        // Remove command substitution
        .replace(/>/g, '')           // Remove redirects
        .replace(/</g, '')           // Remove input redirects
        .trim();

    return sanitized;
}

/**
 * Validate a task before execution
 * @param {Object} task - Task object
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateTask(task) {
    const errors = [];

    if (!task) {
        errors.push('Task is null or undefined');
        return { valid: false, errors };
    }

    if (!task.description) {
        errors.push('Task description is required');
    }

    if (task.description && task.description.length > 1000) {
        errors.push('Task description is too long (max 1000 characters)');
    }

    // Check for obviously malicious content
    const maliciousPatterns = [
        /\bexploit\b/i,
        /\bhack\b/i,
        /\bmalware\b/i,
        /\bransomware\b/i,
        /\bkeylog/i,
        /password\s*steal/i
    ];

    for (const pattern of maliciousPatterns) {
        if (pattern.test(task.description)) {
            errors.push('Task contains potentially malicious intent');
            break;
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Log security event
 * @param {string} event - Event type
 * @param {Object} details - Event details
 */
export function logSecurityEvent(event, details) {
    const timestamp = new Date().toISOString();
    console.log(`🔒 [SECURITY ${timestamp}] ${event}:`, JSON.stringify(details, null, 2));
}

export default {
    isDangerous,
    requiresConfirmation,
    sanitizeCommand,
    validateTask,
    logSecurityEvent,
    DANGEROUS_COMMAND_PATTERNS,
    COMMANDS_REQUIRING_CONFIRMATION
};
