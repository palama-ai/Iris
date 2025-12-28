/**
 * IRIS Task Scheduler Service
 * Checks for scheduled tasks and triggers reminders
 */

import { io } from '../server.js';

// Store scheduled tasks
const scheduledTasks = new Map(); // taskId -> { sessionId, time, task, executed }

let checkInterval = null;

/**
 * Initialize the scheduler
 */
export function initScheduler(ioInstance) {
    console.log('⏰ Task scheduler initialized');

    // Check for due tasks every 10 seconds
    checkInterval = setInterval(() => {
        checkDueTasks(ioInstance);
    }, 10000);

    return true;
}

/**
 * Stop the scheduler
 */
export function stopScheduler() {
    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
    }
}

/**
 * Schedule a new task
 */
export function scheduleTask(sessionId, timeStr, task) {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    // Parse time - support multiple formats
    let scheduledTime;

    // Try ISO format first
    if (timeStr.includes('T')) {
        scheduledTime = new Date(timeStr);
    } else {
        // Try to parse natural time like "5pm", "17:00", etc.
        scheduledTime = parseNaturalTime(timeStr);
    }

    if (!scheduledTime || isNaN(scheduledTime.getTime())) {
        console.log('⚠️ Could not parse time:', timeStr);
        return null;
    }

    const taskData = {
        id: taskId,
        sessionId,
        task,
        scheduledTime: scheduledTime.toISOString(),
        executed: false,
        createdAt: new Date().toISOString()
    };

    scheduledTasks.set(taskId, taskData);
    console.log(`📅 Task scheduled: "${task}" at ${scheduledTime.toLocaleTimeString()}`);

    return taskData;
}

/**
 * Parse natural time strings
 */
function parseNaturalTime(timeStr) {
    const now = new Date();
    const lowerTime = timeStr.toLowerCase().trim();

    // Match patterns like "5pm", "5:30pm", "17:00"
    const timeMatch = lowerTime.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);

    if (timeMatch) {
        let hours = parseInt(timeMatch[1]);
        const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
        const period = timeMatch[3]?.toLowerCase();

        if (period === 'pm' && hours !== 12) hours += 12;
        if (period === 'am' && hours === 12) hours = 0;

        const scheduled = new Date(now);
        scheduled.setHours(hours, minutes, 0, 0);

        // If time has passed today, schedule for tomorrow
        if (scheduled <= now) {
            scheduled.setDate(scheduled.getDate() + 1);
        }

        return scheduled;
    }

    // Try "in X minutes"
    const inMinutesMatch = lowerTime.match(/in\s+(\d+)\s*(min|minute|m)/i);
    if (inMinutesMatch) {
        const minutes = parseInt(inMinutesMatch[1]);
        return new Date(now.getTime() + minutes * 60000);
    }

    // Try "in X hours"
    const inHoursMatch = lowerTime.match(/in\s+(\d+)\s*(hour|h)/i);
    if (inHoursMatch) {
        const hours = parseInt(inHoursMatch[1]);
        return new Date(now.getTime() + hours * 3600000);
    }

    return null;
}

/**
 * Check for tasks that are due
 */
function checkDueTasks(ioInstance) {
    const now = new Date();

    for (const [taskId, taskData] of scheduledTasks) {
        if (taskData.executed) continue;

        const scheduledTime = new Date(taskData.scheduledTime);

        // Check if task is due (within 30 seconds window)
        if (now >= scheduledTime && (now - scheduledTime) < 30000) {
            console.log(`🔔 Reminder due: ${taskData.task}`);
            executeReminder(ioInstance, taskData);
            taskData.executed = true;
        }

        // Clean up old executed tasks (after 1 hour)
        if (taskData.executed && (now - new Date(taskData.scheduledTime)) > 3600000) {
            scheduledTasks.delete(taskId);
        }
    }
}

/**
 * Execute a reminder - send notification to user
 */
function executeReminder(ioInstance, taskData) {
    const reminderMessage = `Sir, you asked me to remind you: ${taskData.task}`;

    // Send to desktop room
    if (ioInstance) {
        ioInstance.to('desktop_room').emit('reminder:trigger', {
            task: taskData.task,
            message: reminderMessage,
            scheduledTime: taskData.scheduledTime,
            timestamp: Date.now()
        });

        // Also send as a voice-enabled message
        ioInstance.to('desktop_room').emit('message:response', {
            text: reminderMessage,
            action: 'REMINDER',
            speakNow: true,
            timestamp: Date.now()
        });
    }

    console.log(`✅ Reminder sent: ${taskData.task}`);
}

/**
 * Get all tasks for a session
 */
export function getSessionTasks(sessionId) {
    const tasks = [];
    for (const [_, taskData] of scheduledTasks) {
        if (taskData.sessionId === sessionId) {
            tasks.push(taskData);
        }
    }
    return tasks;
}

/**
 * Get pending tasks count
 */
export function getPendingTasksCount() {
    let count = 0;
    for (const [_, taskData] of scheduledTasks) {
        if (!taskData.executed) count++;
    }
    return count;
}

export default {
    initScheduler,
    stopScheduler,
    scheduleTask,
    getSessionTasks,
    getPendingTasksCount
};
