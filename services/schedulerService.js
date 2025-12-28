/**
 * IRIS Task Scheduler Service
 * Checks for scheduled tasks and triggers reminders
 */

// Store scheduled tasks
const scheduledTasks = new Map();

let checkInterval = null;
let ioInstance = null;

/**
 * Initialize the scheduler
 */
export function initScheduler(io) {
    ioInstance = io;
    console.log('⏰ Task scheduler initialized');

    // Check for due tasks every 10 seconds
    checkInterval = setInterval(() => {
        checkDueTasks();
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

    if (timeStr && timeStr.includes('T')) {
        scheduledTime = new Date(timeStr);
    } else {
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
    if (!timeStr) return null;

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
function checkDueTasks() {
    if (!ioInstance) return;

    const now = new Date();

    for (const [taskId, taskData] of scheduledTasks) {
        if (taskData.executed) continue;

        const scheduledTime = new Date(taskData.scheduledTime);

        // Check if task is due (within 30 second window)
        if (now >= scheduledTime && (now - scheduledTime) < 30000) {
            console.log(`🔔 Reminder due: ${taskData.task}`);
            executeReminder(taskData);
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
function executeReminder(taskData) {
    const reminderMessage = `Sir, you asked me to remind you: ${taskData.task}`;

    if (ioInstance) {
        ioInstance.to('desktop_room').emit('reminder:trigger', {
            task: taskData.task,
            message: reminderMessage,
            scheduledTime: taskData.scheduledTime,
            timestamp: Date.now()
        });

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
 * Get pending tasks count
 */
export function getPendingTasksCount() {
    let count = 0;
    for (const [_, taskData] of scheduledTasks) {
        if (!taskData.executed) count++;
    }
    return count;
}
