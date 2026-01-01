/**
 * IRIS Backend - Browser Automation Service
 * 
 * Uses Playwright for complex browser automation tasks.
 * Supports navigation, clicking, typing, and screenshot capture.
 * 
 * NOTE: Playwright is optional - falls back gracefully if not installed
 */

let chromium = null;
try {
    const playwright = await import('playwright');
    chromium = playwright.chromium;
    console.log('✅ Playwright loaded successfully');
} catch (e) {
    console.warn('⚠️ Playwright not available - browser automation disabled');
    console.warn('   Install with: npm install playwright && npx playwright install chromium');
}
import path from 'path';
import os from 'os';

// Configuration
const BROWSER_CONFIG = {
    headless: false,  // Show browser for user visibility
    slowMo: 100,      // Add delay between actions for reliability
    timeout: 30000,   // 30 second timeout for operations
    userDataDir: path.join(os.homedir(), '.iris', 'browser-profile')
};

class BrowserAutomation {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
        this.isInitialized = false;
    }

    /**
     * Initialize browser with persistent profile
     */
    async initialize() {
        // Check if Playwright is available
        if (!chromium) {
            throw new Error('Playwright not available - browser automation disabled');
        }

        if (this.isInitialized) {
            console.log('🌐 Browser already initialized');
            return;
        }

        try {
            console.log('🌐 Launching browser with persistent profile...');

            // Launch with persistent context for maintaining login sessions
            this.context = await chromium.launchPersistentContext(
                BROWSER_CONFIG.userDataDir,
                {
                    headless: BROWSER_CONFIG.headless,
                    slowMo: BROWSER_CONFIG.slowMo,
                    viewport: { width: 1280, height: 720 },
                    locale: 'ar-SA',
                    timezoneId: 'Asia/Riyadh'
                }
            );

            // Get the first page or create new one
            const pages = this.context.pages();
            this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

            this.isInitialized = true;
            console.log('✅ Browser initialized successfully');

        } catch (error) {
            console.error('❌ Failed to initialize browser:', error.message);
            throw error;
        }
    }

    /**
     * Navigate to URL
     * @param {string} url - URL to navigate to
     */
    async navigateTo(url) {
        await this.ensureInitialized();

        // Add protocol if missing
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        console.log(`🔗 Navigating to: ${url}`);
        await this.page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: BROWSER_CONFIG.timeout
        });

        // Wait for page to stabilize
        await this.page.waitForLoadState('load');
        console.log('✅ Navigation complete');
    }

    /**
     * Click an element
     * @param {string} selector - CSS selector or text
     * @param {string} clickType - 'single' or 'double'
     */
    async click(selector, clickType = 'single') {
        await this.ensureInitialized();

        console.log(`👆 Clicking: ${selector}`);

        try {
            // Try CSS selector first
            const element = await this.page.$(selector);

            if (element) {
                if (clickType === 'double') {
                    await element.dblclick();
                } else {
                    await element.click();
                }
            } else {
                // Try text-based selection
                await this.page.click(`text="${selector}"`, { timeout: 5000 });
            }

            console.log('✅ Click successful');
        } catch (error) {
            console.error(`❌ Click failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Type text into an element
     * @param {string} selector - CSS selector
     * @param {string} text - Text to type
     */
    async type(selector, text) {
        await this.ensureInitialized();

        console.log(`⌨️ Typing into: ${selector}`);

        try {
            await this.page.fill(selector, text);
            console.log('✅ Typing complete');
        } catch (error) {
            // Try click and type approach
            try {
                await this.page.click(selector);
                await this.page.keyboard.type(text, { delay: 50 });
                console.log('✅ Typing complete (keyboard fallback)');
            } catch (e) {
                console.error(`❌ Typing failed: ${e.message}`);
                throw e;
            }
        }
    }

    /**
     * Press keyboard key
     * @param {string} key - Key to press (e.g., 'Enter', 'Tab', 'Escape')
     */
    async pressKey(key) {
        await this.ensureInitialized();
        console.log(`⌨️ Pressing key: ${key}`);
        await this.page.keyboard.press(key);
    }

    /**
     * Capture screenshot
     * @param {string} outputPath - Path to save screenshot (optional)
     * @returns {string} Path to saved screenshot
     */
    async screenshot(outputPath = null) {
        await this.ensureInitialized();

        const screenshotPath = outputPath || path.join(
            os.tmpdir(),
            `iris-browser-${Date.now()}.png`
        );

        console.log(`📸 Capturing screenshot: ${screenshotPath}`);
        await this.page.screenshot({ path: screenshotPath, fullPage: false });

        return screenshotPath;
    }

    /**
     * Wait for element to appear
     * @param {string} selector - CSS selector
     * @param {number} timeout - Timeout in ms
     */
    async waitForElement(selector, timeout = 10000) {
        await this.ensureInitialized();
        console.log(`⏳ Waiting for: ${selector}`);
        await this.page.waitForSelector(selector, { timeout });
    }

    /**
     * Get page title
     * @returns {string} Current page title
     */
    async getTitle() {
        await this.ensureInitialized();
        return await this.page.title();
    }

    /**
     * Get current URL
     * @returns {string} Current URL
     */
    async getUrl() {
        await this.ensureInitialized();
        return this.page.url();
    }

    /**
     * Scroll the page
     * @param {string} direction - 'up' or 'down'
     * @param {number} amount - Scroll amount in pixels
     */
    async scroll(direction = 'down', amount = 500) {
        await this.ensureInitialized();
        const scrollAmount = direction === 'up' ? -amount : amount;
        await this.page.evaluate((y) => window.scrollBy(0, y), scrollAmount);
    }

    /**
     * LinkedIn: Post content
     * @param {string} postText - Text content to post
     */
    async postToLinkedIn(postText) {
        console.log('📝 Starting LinkedIn post workflow...');

        try {
            // Navigate to LinkedIn
            await this.navigateTo('https://www.linkedin.com/feed/');

            // Wait for page to load
            await this.page.waitForLoadState('networkidle');

            // Check if logged in
            const isLoggedIn = await this.page.$('[data-control-name="share"]') !== null ||
                await this.page.$('.share-box-feed-entry__trigger') !== null;

            if (!isLoggedIn) {
                console.log('⚠️ Not logged into LinkedIn - please log in manually');
                return {
                    success: false,
                    error: 'Not logged into LinkedIn',
                    requiresLogin: true
                };
            }

            // Click "Start a post" button
            const startPostSelectors = [
                '.share-box-feed-entry__trigger',
                '[data-control-name="share"]',
                'button:has-text("Start a post")',
                'button:has-text("ابدأ منشور")'
            ];

            let clicked = false;
            for (const selector of startPostSelectors) {
                try {
                    await this.page.click(selector, { timeout: 3000 });
                    clicked = true;
                    break;
                } catch (e) {
                    continue;
                }
            }

            if (!clicked) {
                throw new Error('Could not find "Start a post" button');
            }

            // Wait for post modal
            await this.page.waitForTimeout(1000);

            // Type post content
            const editorSelectors = [
                '.ql-editor',
                '[data-test-ql-editor-contenteditable]',
                '[contenteditable="true"]'
            ];

            for (const selector of editorSelectors) {
                try {
                    await this.page.click(selector, { timeout: 2000 });
                    await this.page.keyboard.type(postText, { delay: 30 });
                    break;
                } catch (e) {
                    continue;
                }
            }

            console.log('✅ Post content entered');

            // Note: We stop here and let user click "Post" manually for safety
            // In full automation, you would click the post button

            return {
                success: true,
                message: 'Post content entered. Please review and click Post.',
                requiresManualConfirm: true
            };

        } catch (error) {
            console.error('❌ LinkedIn post failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Search Google
     * @param {string} query - Search query
     */
    async searchGoogle(query) {
        await this.navigateTo(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
        return { success: true };
    }

    /**
     * Ensure browser is initialized
     */
    async ensureInitialized() {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    /**
     * Close browser
     */
    async close() {
        if (this.context) {
            console.log('🔴 Closing browser...');
            await this.context.close();
            this.browser = null;
            this.context = null;
            this.page = null;
            this.isInitialized = false;
        }
    }
}

// Singleton instance
let browserInstance = null;

/**
 * Get or create browser automation instance
 * Returns null if Playwright is not available
 * @returns {BrowserAutomation|null}
 */
export function getBrowserAutomation() {
    if (!chromium) {
        return null; // Playwright not available
    }
    if (!browserInstance) {
        browserInstance = new BrowserAutomation();
    }
    return browserInstance;
}

export { BrowserAutomation };
export default BrowserAutomation;
