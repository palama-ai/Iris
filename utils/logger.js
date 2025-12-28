/**
 * IRIS Backend - Logger Utility
 * Simple file-based logging for commands
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Log file path
const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'commands.log');

/**
 * Ensure log directory exists
 */
function ensureLogDir() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
}

/**
 * Format date for logging
 * @returns {string} Formatted date string
 */
function formatDate() {
    const now = new Date();
    return now.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Log a command execution
 * @param {string} command - Command type
 * @param {Object} params - Command parameters
 * @param {string} source - Source device (desktop/mobile)
 * @param {string} sessionId - Session identifier
 */
export function logCommand(command, params, source, sessionId) {
    ensureLogDir();

    const logEntry = {
        timestamp: formatDate(),
        command: command,
        params: params,
        source: source,
        sessionId: sessionId
    };

    const logLine = `[${logEntry.timestamp}] [${source.toUpperCase()}] ${command} | Session: ${sessionId} | Params: ${JSON.stringify(params)}\n`;

    try {
        fs.appendFileSync(LOG_FILE, logLine);
    } catch (error) {
        console.error('Failed to write to log file:', error.message);
    }
}

/**
 * Log server events
 * @param {string} event - Event type
 * @param {string} message - Event message
 */
export function logEvent(event, message) {
    ensureLogDir();

    const logLine = `[${formatDate()}] [${event}] ${message}\n`;

    try {
        fs.appendFileSync(LOG_FILE, logLine);
    } catch (error) {
        console.error('Failed to write to log file:', error.message);
    }
}

/**
 * Get recent log entries
 * @param {number} lines - Number of lines to retrieve
 * @returns {Array} Recent log entries
 */
export function getRecentLogs(lines = 50) {
    try {
        if (!fs.existsSync(LOG_FILE)) {
            return [];
        }

        const content = fs.readFileSync(LOG_FILE, 'utf-8');
        const allLines = content.trim().split('\n');
        return allLines.slice(-lines);
    } catch (error) {
        console.error('Failed to read log file:', error.message);
        return [];
    }
}
