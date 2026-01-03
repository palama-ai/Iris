/**
 * IRIS Backend Server
 * Main entry point - Express + Socket.io server with Gemini AI and ElevenLabs integration
 * Features: AUTH_TOKEN authentication, desktop connection verification, streaming audio
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

// Services
import { initGemini, processMessage, scheduleTask as aiScheduleTask } from './services/geminiService.js';
import {
    initElevenLabs,
    textToSpeechSimple,
    textToSpeechStream,
    getSignedUrl,
    isConfigured as isElevenLabsConfigured
} from './services/elevenLabsService.js';
import { initScheduler, scheduleTask, getPendingTasksCount } from './services/schedulerService.js';
import { TaskController } from './services/TaskController.js';
import { getBrowserAutomation } from './services/BrowserAutomation.js';
import { getScreenshotService } from './services/ScreenshotService.js';
import { initDatabase, setupTables, getOrCreateSession, saveMessage, getHistory, clearHistory } from './config/database.js';
import { validateCommand, createDesktopPayload, parseNaturalCommand } from './utils/commandParser.js';
import { logCommand, logEvent, getRecentLogs } from './utils/logger.js';
import appsRouter from './routes/apps.js';
import { searchApp } from './config/database.js';

// Configuration
const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

// Task Controller instance (initialized in startServer)
let taskController = null;

// Express app setup
const app = express();
app.use(cors());
app.use(express.json());

// HTTP server for Socket.io
const httpServer = createServer(app);

// Socket.io setup with authentication middleware
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// ============================================
// Socket Authentication Middleware
// ============================================

io.use((socket, next) => {
    // If AUTH_TOKEN is not set, allow all connections (development mode)
    if (!AUTH_TOKEN) {
        console.warn('⚠️  AUTH_TOKEN not set. Running in development mode (no auth).');
        return next();
    }

    // Check token in handshake auth or query
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    if (!token) {
        console.log(`🚫 Connection rejected: No token provided (${socket.id})`);
        return next(new Error('Authentication required'));
    }

    if (token !== AUTH_TOKEN) {
        console.log(`🚫 Connection rejected: Invalid token (${socket.id})`);
        return next(new Error('Invalid authentication token'));
    }

    next();
});

// ============================================
// Connection Tracking
// ============================================

// Track connected devices for verification
const connectedDevices = {
    desktop: new Set(),
    mobile: new Set()
};

/**
 * Check if desktop is connected
 * @returns {boolean}
 */
function isDesktopConnected() {
    return connectedDevices.desktop.size > 0;
}

/**
 * Send voice message for desktop not connected
 * @param {Socket} socket - Socket to send to
 */
async function sendDesktopNotConnectedMessage(socket) {
    const message = 'سيدي، نظام الكمبيوتر غير متصل حالياً. لا يمكنني تنفيذ هذا الأمر.';

    socket.emit('message:response', {
        text: message,
        action: null,
        command: null,
        error: 'DESKTOP_NOT_CONNECTED',
        timestamp: Date.now()
    });

    // Send voice response if configured
    if (isElevenLabsConfigured()) {
        streamVoiceToSocket(socket, message);
    }
}

/**
 * Stream voice response to socket using chunks
 * @param {Socket} socket - Socket to stream to
 * @param {string} text - Text to convert to speech
 */
function streamVoiceToSocket(socket, text) {
    textToSpeechStream(
        text,
        // onChunk - send each chunk immediately
        (chunk) => {
            socket.emit('voice:chunk', {
                audio: chunk.audio,
                index: chunk.index,
                isFinal: chunk.isFinal,
                format: 'mp3'
            });
        },
        // onComplete
        () => {
            socket.emit('voice:complete', { success: true });
        },
        // onError
        (error) => {
            console.error('Voice streaming error:', error.message);
            socket.emit('voice:error', { error: error.message });
        }
    );
}

// ============================================
// REST API Routes
// ============================================

// Health check
app.get('/', (req, res) => {
    res.json({
        name: 'IRIS Backend Server',
        version: '1.1.0',
        status: 'running',
        connections: {
            desktop: connectedDevices.desktop.size,
            mobile: connectedDevices.mobile.size
        },
        services: {
            gemini: !!process.env.GEMINI_API_KEY,
            elevenLabs: isElevenLabsConfigured(),
            database: !!process.env.DATABASE_URL,
            auth: !!AUTH_TOKEN
        }
    });
});

// Apps API - Sync installed apps
app.use('/api/apps', appsRouter);

// Status endpoint - detailed server status
app.get('/status', (req, res) => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    res.json({
        server: {
            name: 'IRIS Backend Server',
            version: '1.2.0',
            status: 'online',
            uptime: `${hours}h ${minutes}m ${seconds}s`,
            uptimeSeconds: Math.floor(uptime)
        },
        connections: {
            desktop_agent: {
                connected: isDesktopConnected(),
                count: connectedDevices.desktop.size,
                socketIds: Array.from(connectedDevices.desktop)
            },
            mobile: {
                connected: connectedDevices.mobile.size > 0,
                count: connectedDevices.mobile.size,
                socketIds: Array.from(connectedDevices.mobile)
            }
        },
        services: {
            gemini: {
                configured: !!process.env.GEMINI_API_KEY,
                status: !!process.env.GEMINI_API_KEY ? 'ready' : 'not_configured'
            },
            elevenLabs: {
                configured: isElevenLabsConfigured(),
                status: isElevenLabsConfigured() ? 'ready' : 'not_configured'
            },
            database: {
                configured: !!process.env.DATABASE_URL,
                status: !!process.env.DATABASE_URL ? 'connected' : 'not_configured'
            }
        },
        security: {
            authEnabled: !!AUTH_TOKEN
        },
        recentLogs: getRecentLogs(10)
    });
});

// Get ElevenLabs signed URL for client
app.get('/api/voice/signed-url', async (req, res) => {
    const result = await getSignedUrl();
    if (result.error) {
        return res.status(500).json({ error: result.error });
    }
    res.json(result);
});

// Text-to-Speech endpoint
app.post('/api/voice/tts', async (req, res) => {
    const { text } = req.body;

    if (!text) {
        return res.status(400).json({ error: 'Text is required' });
    }

    try {
        const audioBuffer = await textToSpeechSimple(text);
        res.set({
            'Content-Type': 'audio/mpeg',
            'Content-Length': audioBuffer.length
        });
        res.send(audioBuffer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// AI Content Generation endpoint - for browser automation
app.post('/api/generate', async (req, res) => {
    const { prompt, maxTokens = 500 } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
    }

    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!groqKey && !geminiKey) {
        return res.status(500).json({ error: 'No AI API key configured' });
    }

    try {
        let content;

        if (groqKey) {
            // Use Groq API
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${groqKey}`
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: 'You are a helpful assistant that generates social media content. Keep it professional and engaging.' },
                        { role: 'user', content: prompt }
                    ],
                    max_tokens: maxTokens,
                    temperature: 0.8
                })
            });

            if (!response.ok) {
                const err = await response.text();
                console.error('Groq generate error:', err);
                throw new Error(`Groq API error: ${response.status}`);
            }

            const data = await response.json();
            content = data.choices?.[0]?.message?.content?.trim() || '';
        } else {
            // Fallback to Gemini
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${geminiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }]
                })
            });

            if (!response.ok) throw new Error(`Gemini error: ${response.status}`);
            const data = await response.json();
            content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        }

        console.log('✅ AI generated content:', content.substring(0, 80) + '...');
        res.json({ text: content });

    } catch (error) {
        console.error('Generate error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Vision Analysis endpoint - for screenshot-based automation (using Groq Llama Vision)
app.post('/api/vision/analyze', async (req, res) => {
    const { image, task } = req.body;

    if (!image || !task) {
        return res.status(400).json({ error: 'Image and task are required' });
    }

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
        return res.status(500).json({ error: 'GROQ_API_KEY not configured for vision' });
    }

    console.log('🔍 Vision analysis request:', task);

    const prompt = `You are a UI automation assistant. Analyze this screenshot and help complete this task: "${task}"

Your job is to:
1. Identify the UI element needed to complete the task
2. Provide its approximate pixel coordinates (x, y from top-left)
3. Describe what action to take

Respond in JSON format ONLY:
{
    "found": true/false,
    "element": "description of the element",
    "action": "click" | "type" | "scroll",
    "coordinates": {"x": number, "y": number},
    "confidence": 0.0-1.0,
    "nextStep": "what to do after this action"
}

If you can't find the element, set found=false and explain in element field.
Be precise with coordinates - estimate the CENTER of the clickable element.`;

    // Validate image size (Groq has limits)
    const imageSizeKB = Math.round(image.length / 1024);
    console.log('📏 Image size:', imageSizeKB, 'KB');

    if (imageSizeKB < 5) {
        console.error('❌ Image too small - likely a blank/empty screenshot');
        return res.status(400).json({
            error: 'Image too small - browser may be on a blank page',
            sizeKB: imageSizeKB
        });
    }

    if (imageSizeKB > 500) {
        console.warn('⚠️ Image is large, may fail. Size:', imageSizeKB, 'KB');
    }

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${groqKey}`
            },
            body: JSON.stringify({
                model: 'meta-llama/llama-4-maverick-17b-128e-instruct',
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:image/jpeg;base64,${image}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 500,
                temperature: 0.1
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('❌ Groq Vision error status:', response.status);
            console.error('❌ Groq Vision error body:', errText);

            // Parse error for more details
            try {
                const errJson = JSON.parse(errText);
                return res.status(response.status).json({
                    error: `Vision API error: ${response.status}`,
                    details: errJson.error?.message || errText
                });
            } catch (e) {
                return res.status(response.status).json({
                    error: `Vision API error: ${response.status}`,
                    details: errText
                });
            }
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';

        console.log('📝 Vision response:', text.substring(0, 200));

        // Parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            console.log('✅ Vision analysis:', result);
            return res.json(result);
        }

        res.json({ found: false, error: 'Could not parse vision response', raw: text });

    } catch (error) {
        console.error('❌ Vision error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// Socket.io Connection Handling
// ============================================

io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    let sessionId = null;
    let deviceType = null;

    // ----------------------------------------
    // Room Management
    // ----------------------------------------

    // Desktop client joins
    socket.on('join:desktop', async (data) => {
        sessionId = data?.sessionId || uuidv4();
        deviceType = 'desktop';

        socket.join('desktop_room');
        connectedDevices.desktop.add(socket.id);
        await getOrCreateSession(sessionId, deviceType);

        console.log(`🖥️  Desktop joined: ${sessionId} (Total: ${connectedDevices.desktop.size})`);
        socket.emit('joined', {
            room: 'desktop_room',
            sessionId,
            message: 'مرحباً! أنا IRIS، مساعدك الشخصي الذكي. نظام الكمبيوتر متصل وجاهز.'
        });

        // Notify mobile clients that desktop is now connected
        io.to('mobile_room').emit('desktop:status', { connected: true });
    });

    // Mobile client joins
    socket.on('join:mobile', async (data) => {
        sessionId = data?.sessionId || uuidv4();
        deviceType = 'mobile';

        socket.join('mobile_room');
        connectedDevices.mobile.add(socket.id);
        await getOrCreateSession(sessionId, deviceType);

        console.log(`📱 Mobile joined: ${sessionId} (Total: ${connectedDevices.mobile.size})`);
        socket.emit('joined', {
            room: 'mobile_room',
            sessionId,
            desktopConnected: isDesktopConnected(),
            message: 'مرحباً سيدي! أنا IRIS. كيف يمكنني مساعدتك اليوم؟'
        });
    });

    // ----------------------------------------
    // Message Handling
    // ----------------------------------------

    // Text message from client
    socket.on('message:text', async (data) => {
        const { text, withVoice = false, streamVoice = true } = data;

        if (!text || !sessionId) {
            socket.emit('error', { message: 'Invalid message or session' });
            return;
        }

        console.log(`💬 Message from ${deviceType}: ${text}`);

        try {
            // Get conversation history from database (last 10 messages)
            const history = await getHistory(sessionId, 10);

            // Process with AI (passing sessionId for memory features)
            let response = await processMessage(text, history, sessionId);

            // Fallback to natural language parsing if no command detected
            if (!response.action && !response.error) {
                const naturalCommand = parseNaturalCommand(text);
                if (naturalCommand) {
                    response = naturalCommand;
                }
            }

            // Save messages to history
            await saveMessage(sessionId, 'user', text);
            await saveMessage(sessionId, 'assistant', response.reply);

            // Check if this is a command to execute
            if (response.action === 'EXECUTE') {
                const validation = validateCommand(response);

                if (validation.valid) {
                    // CHECK: Is desktop connected?
                    if (!isDesktopConnected()) {
                        console.log('⚠️  Command requested but desktop not connected');
                        await sendDesktopNotConnectedMessage(socket);
                        return;
                    }

                    // Special handling for OPEN_APP - check DB if path is missing
                    if (response.command === 'OPEN_APP' && response.params.name && !response.params.path) {
                        console.log(`🔍 Looking up app path for: "${response.params.name}"`);
                        const dbApp = await searchApp(response.params.name);
                        if (dbApp) {
                            console.log(`✅ Found app in DB: ${dbApp.name} -> ${dbApp.path}`);
                            response.params.path = dbApp.path; // Inject path into params
                            response.params.fromDb = true;
                        } else {
                            console.log(`⚠️ App not found in DB: ${response.params.name}`);
                        }
                    }

                    // Send command to desktop room
                    const payload = createDesktopPayload(response);
                    io.to('desktop_room').emit('command:execute', payload);
                    console.log(`⚡ Command sent to desktop: ${response.command}`);

                    // Log command to file
                    logCommand(response.command, response.params, deviceType, sessionId);
                } else {
                    console.warn(`⚠️  Invalid command: ${validation.error}`);
                }
            }

            // Handle SCHEDULE action - schedule a reminder
            if (response.action === 'SCHEDULE') {
                const taskData = scheduleTask(sessionId, response.time, response.task);
                if (taskData) {
                    console.log(`📅 Reminder scheduled: "${response.task}"`);
                } else {
                    console.warn('⚠️ Failed to schedule task');
                }
            }

            // Handle COMPLEX_TASK action - send to desktop for LOCAL execution
            if (response.action === 'COMPLEX_TASK') {
                console.log(`🤖 Complex task detected: ${response.description}`);

                // Check if desktop is connected
                if (!isDesktopConnected()) {
                    console.log('⚠️  Complex task requested but desktop not connected');
                    await sendDesktopNotConnectedMessage(socket);
                    return;
                }

                // Send COMPLEX_TASK command to desktop for local Playwright execution
                const complexPayload = {
                    type: 'EXECUTE_COMMAND',
                    command: 'COMPLEX_TASK',
                    params: {
                        description: response.description,
                        tool: response.tool || 'browser'
                    },
                    timestamp: Date.now()
                };

                io.to('desktop_room').emit('command:execute', complexPayload);
                console.log(`📤 Complex task sent to desktop: ${response.description}`);
            }

            // Send response back to client
            socket.emit('message:response', {
                text: response.reply,
                action: response.action,
                command: response.command,
                timestamp: Date.now()
            });

            // Generate voice response if requested
            if (isElevenLabsConfigured() && withVoice) {
                if (streamVoice) {
                    // Use streaming for lower latency
                    streamVoiceToSocket(socket, response.reply);
                } else {
                    // Use simple TTS (full audio at once)
                    try {
                        const audioBuffer = await textToSpeechSimple(response.reply);
                        socket.emit('voice:response', {
                            audio: audioBuffer.toString('base64'),
                            format: 'mp3'
                        });
                    } catch (voiceError) {
                        console.error('Voice synthesis error:', voiceError.message);
                    }
                }
            }

        } catch (error) {
            console.error('Message processing error:', error);
            socket.emit('error', { message: 'Error processing message' });
        }
    });

    // Voice message (audio data)
    socket.on('message:voice', async (data) => {
        socket.emit('voice:processing', { status: 'received' });
        console.log(`🎤 Voice message received from ${deviceType}`);
        // TODO: Implement Speech-to-Text when available
    });

    // ----------------------------------------
    // History Management
    // ----------------------------------------

    socket.on('history:get', async () => {
        if (!sessionId) return;
        const history = await getHistory(sessionId, 50);
        socket.emit('history:data', { messages: history });
    });

    socket.on('history:clear', async () => {
        if (!sessionId) return;
        await clearHistory(sessionId);
        socket.emit('history:cleared', { success: true });
    });

    // ----------------------------------------
    // Command Acknowledgment
    // ----------------------------------------

    socket.on('command:complete', (data) => {
        console.log(`✅ Command completed: ${data.command}`);
        io.to('mobile_room').emit('command:status', {
            status: 'completed',
            command: data.command,
            result: data.result
        });
    });

    socket.on('command:failed', (data) => {
        console.log(`❌ Command failed: ${data.command} - ${data.error}`);
        io.to('mobile_room').emit('command:status', {
            status: 'failed',
            command: data.command,
            error: data.error
        });
    });

    // ----------------------------------------
    // Complex Task Automation (ReAct Agent)
    // ----------------------------------------

    socket.on('task:execute', async (data) => {
        const { description, withVoice = true } = data;

        if (!description || !sessionId) {
            socket.emit('error', { message: 'Invalid task or session' });
            return;
        }

        console.log(`🤖 Complex task request from ${deviceType}: ${description}`);

        // Check if desktop is connected for desktop tasks
        if (!isDesktopConnected()) {
            console.log('⚠️  Complex task requested but desktop not connected');
            await sendDesktopNotConnectedMessage(socket);
            return;
        }

        try {
            const result = await taskController.executeComplexTask(sessionId, description, socket);

            // Send voice response if requested
            if (isElevenLabsConfigured() && withVoice && result.success) {
                const message = 'تم تنفيذ المهمة بنجاح سيدي.';
                streamVoiceToSocket(socket, message);
            }
        } catch (error) {
            console.error('Task execution error:', error);
            socket.emit('task:failed', { error: error.message });
        }
    });

    socket.on('task:confirm', (data) => {
        if (taskController) {
            taskController.handleUserConfirmation(sessionId, data.confirmed);
        }
    });

    socket.on('task:cancel', () => {
        if (taskController && sessionId) {
            const cancelled = taskController.cancelTask(sessionId);
            socket.emit('task:cancelled', { success: cancelled });
        }
    });

    // ----------------------------------------
    // Disconnection
    // ----------------------------------------

    socket.on('disconnect', () => {
        console.log(`🔌 Client disconnected: ${socket.id} (${deviceType || 'unknown'})`);

        // Remove from tracking
        if (deviceType === 'desktop') {
            connectedDevices.desktop.delete(socket.id);
            console.log(`🖥️  Desktop connections: ${connectedDevices.desktop.size}`);

            // Notify mobile if no more desktops connected
            if (!isDesktopConnected()) {
                io.to('mobile_room').emit('desktop:status', { connected: false });
            }
        } else if (deviceType === 'mobile') {
            connectedDevices.mobile.delete(socket.id);
            console.log(`📱 Mobile connections: ${connectedDevices.mobile.size}`);
        }
    });
});

// ============================================
// Server Initialization
// ============================================

async function startServer() {
    console.log('\n🚀 Starting IRIS Backend Server...\n');

    // Security status
    if (AUTH_TOKEN) {
        console.log('🔐 Authentication: ENABLED');
    } else {
        console.warn('⚠️  Authentication: DISABLED (set AUTH_TOKEN in .env)');
    }

    // Initialize services
    initGemini();
    initElevenLabs();

    // Initialize database
    if (initDatabase()) {
        await setupTables();
    }

    // Initialize task scheduler
    initScheduler(io);

    // Initialize Task Controller (ReAct Agent)
    taskController = new TaskController(io);
    try {
        const browserAutomation = getBrowserAutomation();
        const screenshotService = getScreenshotService();
        taskController.setServices(browserAutomation, screenshotService);
        console.log('🤖 Task Controller: Ready');
    } catch (e) {
        console.warn('⚠️  Task Controller initialized without browser automation:', e.message);
    }

    // Start listening
    httpServer.listen(PORT, () => {
        console.log(`\n✨ IRIS Server running on port ${PORT}`);
        console.log(`   → REST API: http://localhost:${PORT}`);
        console.log(`   → Socket.io: ws://localhost:${PORT}`);
        console.log('\n📡 Waiting for connections...\n');
    });
}

startServer().catch(console.error);
