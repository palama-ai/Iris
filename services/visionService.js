/**
 * IRIS Vision Service
 * Analyzes screenshots using AI vision models to detect UI elements
 */

// Gemini Vision API endpoint
const GEMINI_VISION_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

/**
 * Analyze a screenshot to find UI elements
 * @param {string} imageBase64 - Base64 encoded image
 * @param {string} task - What to look for (e.g., "Find the Post button")
 * @returns {Promise<{elements: Array, action: string, coordinates: {x, y}}>}
 */
export async function analyzeScreenshot(imageBase64, task) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.error('❌ GEMINI_API_KEY not set for vision analysis');
        return { error: 'Vision API not configured' };
    }

    console.log('🔍 Analyzing screenshot for:', task);

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

    try {
        const response = await fetch(`${GEMINI_VISION_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: prompt },
                        {
                            inline_data: {
                                mime_type: 'image/png',
                                data: imageBase64
                            }
                        }
                    ]
                }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 500
                }
            })
        });

        if (!response.ok) {
            const err = await response.text();
            console.error('❌ Gemini Vision error:', err);
            return { error: `Vision API error: ${response.status}` };
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        console.log('📝 Vision response:', text.substring(0, 200));

        // Parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const result = JSON.parse(jsonMatch[0]);
                console.log('✅ Vision analysis:', result);
                return result;
            } catch (e) {
                console.error('❌ Failed to parse vision response:', e.message);
                return { error: 'Failed to parse vision response', raw: text };
            }
        }

        return { error: 'No valid JSON in response', raw: text };

    } catch (error) {
        console.error('❌ Vision analysis failed:', error.message);
        return { error: error.message };
    }
}

/**
 * Analyze screenshot to find multiple elements
 * @param {string} imageBase64 - Base64 encoded image
 * @returns {Promise<Array>} List of detected UI elements
 */
export async function detectAllElements(imageBase64) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return { error: 'Vision API not configured' };
    }

    const prompt = `Analyze this screenshot and list ALL interactive UI elements you can see.

For each element, provide:
- type: button, input, link, dropdown, checkbox, etc.
- text: visible text on the element
- coordinates: approximate {x, y} center position in pixels
- purpose: what this element likely does

Respond in JSON format:
{
    "elements": [
        {"type": "button", "text": "Post", "coordinates": {"x": 450, "y": 320}, "purpose": "Submit post"},
        ...
    ],
    "pageType": "linkedin feed" | "login page" | etc.
}`;

    try {
        const response = await fetch(`${GEMINI_VISION_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: prompt },
                        {
                            inline_data: {
                                mime_type: 'image/png',
                                data: imageBase64
                            }
                        }
                    ]
                }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 2000
                }
            })
        });

        if (!response.ok) {
            return { error: `Vision API error: ${response.status}` };
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }

        return { error: 'No valid JSON', raw: text };

    } catch (error) {
        return { error: error.message };
    }
}

/**
 * Check if vision is configured
 */
export function isVisionConfigured() {
    return !!process.env.GEMINI_API_KEY;
}
