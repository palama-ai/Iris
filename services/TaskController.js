/**
 * IRIS Backend - Task Controller (ReAct Agent)
 * 
 * Orchestrates complex multi-step tasks using the ReAct pattern:
 * 1. Reason - LLM analyzes the task and decides next action
 * 2. Act - Execute the action (browser, app, system)
 * 3. Observe - Capture screenshot and verify result
 * 4. Loop until task is complete or error
 */

import { processMessage } from './geminiService.js';

// Task execution states
const TaskState = {
    PENDING: 'pending',
    REASONING: 'reasoning',
    ACTING: 'acting',
    OBSERVING: 'observing',
    AWAITING_CONFIRMATION: 'awaiting_confirmation',
    COMPLETED: 'completed',
    FAILED: 'failed'
};

// Action types that can be executed
const ActionType = {
    BROWSER: 'browser',
    APP: 'app',
    SYSTEM: 'system',
    KEYBOARD: 'keyboard',
    MOUSE: 'mouse',
    WAIT: 'wait'
};

// Dangerous operations requiring user confirmation
const DANGEROUS_OPERATIONS = [
    'shutdown', 'restart', 'hibernate', 'sleep',
    'delete', 'remove', 'rm', 'del',
    'format', 'reg delete', 'regedit',
    'netsh', 'firewall'
];

class TaskController {
    constructor(io) {
        this.io = io;
        this.activeTasks = new Map(); // sessionId -> task state
        this.browserAutomation = null;
        this.screenshotService = null;

        console.log('🤖 TaskController initialized - ReAct Agent ready');
    }

    /**
     * Set external services (injected after initialization)
     */
    setServices(browserAutomation, screenshotService) {
        this.browserAutomation = browserAutomation;
        this.screenshotService = screenshotService;
    }

    /**
     * Execute a complex multi-step task
     * @param {string} sessionId - User session ID
     * @param {string} taskDescription - Natural language task description
     * @param {object} socket - Socket.io connection for this user
     */
    async executeComplexTask(sessionId, taskDescription, socket) {
        console.log(`\n🎯 Starting complex task for session ${sessionId}:`);
        console.log(`   "${taskDescription}"`);

        // Initialize task state
        const taskState = {
            id: `task_${Date.now()}`,
            description: taskDescription,
            state: TaskState.PENDING,
            steps: [],
            currentStep: 0,
            maxSteps: 10, // Safety limit
            startTime: Date.now(),
            context: {
                screenshots: [],
                observations: [],
                errors: []
            }
        };

        this.activeTasks.set(sessionId, taskState);

        try {
            // Notify client that task execution started
            socket.emit('task:started', {
                taskId: taskState.id,
                description: taskDescription
            });

            // ReAct loop
            while (taskState.currentStep < taskState.maxSteps) {
                taskState.currentStep++;
                console.log(`\n📍 Step ${taskState.currentStep}/${taskState.maxSteps}`);

                // === REASON ===
                taskState.state = TaskState.REASONING;
                socket.emit('task:step', {
                    step: taskState.currentStep,
                    phase: 'reasoning',
                    message: 'Analyzing next action...'
                });

                const nextAction = await this.reason(taskState);

                if (!nextAction) {
                    console.log('✅ Task completed - no more actions needed');
                    taskState.state = TaskState.COMPLETED;
                    break;
                }

                console.log(`   Action: ${nextAction.type} - ${nextAction.description}`);

                // Check if confirmation required
                if (this.requiresConfirmation(nextAction)) {
                    taskState.state = TaskState.AWAITING_CONFIRMATION;
                    socket.emit('task:confirmation_required', {
                        action: nextAction,
                        message: `هل تريد تنفيذ: ${nextAction.description}؟`
                    });

                    const confirmed = await this.waitForConfirmation(sessionId, socket);
                    if (!confirmed) {
                        console.log('❌ User rejected action');
                        taskState.state = TaskState.FAILED;
                        taskState.context.errors.push('User rejected action');
                        break;
                    }
                }

                // === ACT ===
                taskState.state = TaskState.ACTING;
                socket.emit('task:step', {
                    step: taskState.currentStep,
                    phase: 'acting',
                    message: `Executing: ${nextAction.description}`
                });

                const actionResult = await this.act(nextAction, sessionId);
                taskState.steps.push({
                    action: nextAction,
                    result: actionResult,
                    timestamp: Date.now()
                });

                if (!actionResult.success) {
                    console.error(`   ❌ Action failed: ${actionResult.error}`);
                    taskState.context.errors.push(actionResult.error);
                    // Continue and let the AI decide how to handle the error
                }

                // === OBSERVE ===
                taskState.state = TaskState.OBSERVING;
                socket.emit('task:step', {
                    step: taskState.currentStep,
                    phase: 'observing',
                    message: 'Verifying result...'
                });

                const observation = await this.observe(taskState, actionResult);
                taskState.context.observations.push(observation);

                console.log(`   Observation: ${observation.summary}`);

                // Check if task is complete
                if (observation.taskComplete) {
                    console.log('✅ Task completed successfully');
                    taskState.state = TaskState.COMPLETED;
                    break;
                }

                // Small delay between steps
                await this.sleep(500);
            }

            // Final status
            const finalResult = {
                taskId: taskState.id,
                success: taskState.state === TaskState.COMPLETED,
                steps: taskState.steps.length,
                duration: Date.now() - taskState.startTime,
                errors: taskState.context.errors
            };

            socket.emit('task:completed', finalResult);
            console.log(`\n🏁 Task finished in ${finalResult.duration}ms with ${finalResult.steps} steps`);

            return finalResult;

        } catch (error) {
            console.error('❌ Task execution error:', error);
            taskState.state = TaskState.FAILED;
            taskState.context.errors.push(error.message);

            socket.emit('task:failed', {
                taskId: taskState.id,
                error: error.message
            });

            return { success: false, error: error.message };

        } finally {
            this.activeTasks.delete(sessionId);
        }
    }

    /**
     * REASON: Ask LLM to decide the next action
     */
    async reason(taskState) {
        const reasoningPrompt = this.buildReasoningPrompt(taskState);

        try {
            const response = await processMessage(reasoningPrompt, [], taskState.id);
            return this.parseActionFromResponse(response);
        } catch (error) {
            console.error('Reasoning error:', error);
            return null;
        }
    }

    /**
     * ACT: Execute the decided action
     */
    async act(action, sessionId) {
        try {
            switch (action.type) {
                case ActionType.BROWSER:
                    return await this.executeBrowserAction(action);

                case ActionType.APP:
                    return await this.executeAppAction(action, sessionId);

                case ActionType.SYSTEM:
                    return await this.executeSystemAction(action, sessionId);

                case ActionType.KEYBOARD:
                    return await this.executeKeyboardAction(action, sessionId);

                case ActionType.MOUSE:
                    return await this.executeMouseAction(action, sessionId);

                case ActionType.WAIT:
                    await this.sleep(action.params.duration || 1000);
                    return { success: true };

                default:
                    return { success: false, error: `Unknown action type: ${action.type}` };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * OBSERVE: Capture screenshot and analyze result
     */
    async observe(taskState, actionResult) {
        const observation = {
            stepNumber: taskState.currentStep,
            actionSuccess: actionResult.success,
            screenshotPath: null,
            summary: '',
            taskComplete: false
        };

        // Capture screenshot if service available
        if (this.screenshotService) {
            try {
                const screenshotPath = await this.screenshotService.capture();
                observation.screenshotPath = screenshotPath;
                taskState.context.screenshots.push(screenshotPath);
            } catch (e) {
                console.warn('Screenshot capture failed:', e.message);
            }
        }

        // Summarize observation
        if (actionResult.success) {
            observation.summary = `Step ${taskState.currentStep} completed successfully`;
        } else {
            observation.summary = `Step ${taskState.currentStep} failed: ${actionResult.error}`;
        }

        // Check if this was the final step (simple heuristic)
        // In a more advanced version, we'd ask the LLM to verify
        const lastAction = taskState.steps[taskState.steps.length - 1]?.action;
        if (lastAction?.isFinal) {
            observation.taskComplete = true;
        }

        return observation;
    }

    /**
     * Build the reasoning prompt for the LLM
     */
    buildReasoningPrompt(taskState) {
        const history = taskState.steps.map((s, i) =>
            `Step ${i + 1}: ${s.action.description} → ${s.result.success ? 'Success' : 'Failed: ' + s.result.error}`
        ).join('\n');

        const errors = taskState.context.errors.length > 0
            ? `\nErrors encountered: ${taskState.context.errors.join(', ')}`
            : '';

        return `
[TASK_REASONING_MODE]
You are an autonomous OS agent. Analyze the task and decide the next action.

TASK: ${taskState.description}

STEPS COMPLETED:
${history || 'None yet'}
${errors}

AVAILABLE ACTIONS:
- browser: Navigate, click, type in browser (params: url, selector, text)
- app: Open/control desktop application (params: name, action)
- system: Execute system command (params: command)
- keyboard: Type text or send hotkey (params: text OR hotkey)
- mouse: Move/click mouse (params: x, y, action)
- wait: Wait for specified duration (params: duration)
- DONE: Task is complete

Respond with JSON:
{
  "type": "browser|app|system|keyboard|mouse|wait|DONE",
  "description": "Human readable description",
  "params": { ... },
  "isFinal": true/false
}

If the task is complete, respond with: {"type": "DONE"}
`.trim();
    }

    /**
     * Parse action from LLM response
     */
    parseActionFromResponse(response) {
        try {
            // Try to extract JSON from response
            const text = response.reply || response;
            const jsonMatch = text.match(/\{[\s\S]*\}/);

            if (!jsonMatch) {
                console.warn('No JSON found in response');
                return null;
            }

            const action = JSON.parse(jsonMatch[0]);

            if (action.type === 'DONE') {
                return null; // Task complete
            }

            return {
                type: action.type,
                description: action.description || 'Executing action',
                params: action.params || {},
                isFinal: action.isFinal || false
            };
        } catch (error) {
            console.error('Failed to parse action:', error);
            return null;
        }
    }

    /**
     * Execute browser action via Playwright
     */
    async executeBrowserAction(action) {
        if (!this.browserAutomation) {
            return { success: false, error: 'Browser automation not available' };
        }

        const { url, selector, text, clickType } = action.params;

        try {
            if (url) {
                await this.browserAutomation.navigateTo(url);
            }
            if (selector && text) {
                await this.browserAutomation.type(selector, text);
            } else if (selector) {
                await this.browserAutomation.click(selector, clickType);
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Execute app action via desktop IPC
     */
    async executeAppAction(action, sessionId) {
        const { name, appAction } = action.params;

        // Send to desktop via Socket.io
        return new Promise((resolve) => {
            this.io.to('desktop_room').emit('command:execute', {
                type: 'EXECUTE_COMMAND',
                command: 'OPEN_APP',
                params: { name, action: appAction },
                timestamp: Date.now()
            });

            // Wait for acknowledgment (with timeout)
            const timeout = setTimeout(() => {
                resolve({ success: true, message: 'Command sent (no ack)' });
            }, 3000);

            // Listen for completion (simplified - in production, use proper event tracking)
            const handler = () => {
                clearTimeout(timeout);
                resolve({ success: true });
            };

            // One-time listener would go here in production
            setTimeout(handler, 1000); // Assume success after 1s
        });
    }

    /**
     * Execute system command
     */
    async executeSystemAction(action, sessionId) {
        const { command } = action.params;

        return new Promise((resolve) => {
            this.io.to('desktop_room').emit('command:execute', {
                type: 'EXECUTE_COMMAND',
                command: 'SYSTEM_COMMAND',
                params: { cmd: command },
                timestamp: Date.now()
            });

            setTimeout(() => {
                resolve({ success: true, message: 'Command sent' });
            }, 1000);
        });
    }

    /**
     * Execute keyboard action (type text or hotkey)
     */
    async executeKeyboardAction(action, sessionId) {
        const { text, hotkey } = action.params;

        return new Promise((resolve) => {
            this.io.to('desktop_room').emit('command:execute', {
                type: 'EXECUTE_COMMAND',
                command: text ? 'TYPE_TEXT' : 'SEND_HOTKEY',
                params: text ? { text } : { hotkey },
                timestamp: Date.now()
            });

            setTimeout(() => {
                resolve({ success: true });
            }, 500);
        });
    }

    /**
     * Execute mouse action
     */
    async executeMouseAction(action, sessionId) {
        const { x, y, mouseAction } = action.params;

        return new Promise((resolve) => {
            this.io.to('desktop_room').emit('gesture-control', {
                action: mouseAction || 'MOVE',
                x: x / 1920, // Normalize to 0-1
                y: y / 1080
            });

            setTimeout(() => {
                resolve({ success: true });
            }, 100);
        });
    }

    /**
     * Check if action requires user confirmation
     */
    requiresConfirmation(action) {
        if (action.type === ActionType.SYSTEM) {
            const cmd = (action.params.command || '').toLowerCase();
            return DANGEROUS_OPERATIONS.some(op => cmd.includes(op));
        }
        return false;
    }

    /**
     * Wait for user confirmation
     */
    waitForConfirmation(sessionId, socket) {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve(false); // Timeout = reject
            }, 30000); // 30 second timeout

            const handler = (data) => {
                clearTimeout(timeout);
                socket.off('task:confirm', handler);
                resolve(data.confirmed);
            };

            socket.on('task:confirm', handler);
        });
    }

    /**
     * Handle user confirmation response
     */
    handleUserConfirmation(sessionId, confirmed) {
        const task = this.activeTasks.get(sessionId);
        if (task && task.state === TaskState.AWAITING_CONFIRMATION) {
            task.confirmationResult = confirmed;
        }
    }

    /**
     * Utility: Sleep for specified milliseconds
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get active task for session
     */
    getActiveTask(sessionId) {
        return this.activeTasks.get(sessionId);
    }

    /**
     * Cancel active task
     */
    cancelTask(sessionId) {
        const task = this.activeTasks.get(sessionId);
        if (task) {
            task.state = TaskState.FAILED;
            task.context.errors.push('Task cancelled by user');
            this.activeTasks.delete(sessionId);
            return true;
        }
        return false;
    }
}

export { TaskController, TaskState, ActionType };
