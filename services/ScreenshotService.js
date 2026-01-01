/**
 * IRIS Backend - Screenshot Service
 * 
 * Captures screenshots for the feedback loop.
 * Uses PowerShell on Windows for screen capture.
 */

import { exec } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Screenshot output directory
const SCREENSHOT_DIR = path.join(os.tmpdir(), 'iris-screenshots');

class ScreenshotService {
    constructor() {
        // Ensure screenshot directory exists
        if (!fs.existsSync(SCREENSHOT_DIR)) {
            fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
        }
        console.log('📸 ScreenshotService initialized');
        console.log(`   Screenshot directory: ${SCREENSHOT_DIR}`);
    }

    /**
     * Capture full screen screenshot
     * @param {string} filename - Optional filename
     * @returns {Promise<string>} Path to saved screenshot
     */
    async capture(filename = null) {
        const outputPath = path.join(
            SCREENSHOT_DIR,
            filename || `screenshot_${Date.now()}.png`
        );

        return new Promise((resolve, reject) => {
            // PowerShell command to capture screen
            const psCommand = `
                Add-Type -AssemblyName System.Windows.Forms
                Add-Type -AssemblyName System.Drawing
                
                $screen = [System.Windows.Forms.Screen]::PrimaryScreen
                $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
                $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
                $bitmap.Save('${outputPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
                $graphics.Dispose()
                $bitmap.Dispose()
            `.replace(/\n/g, '; ');

            exec(`powershell -NoProfile -Command "${psCommand}"`, { windowsHide: true }, (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ Screenshot capture failed:', error.message);
                    reject(error);
                } else {
                    console.log(`📸 Screenshot saved: ${outputPath}`);
                    resolve(outputPath);
                }
            });
        });
    }

    /**
     * Capture screenshot of a specific region
     * @param {Object} region - { x, y, width, height }
     * @param {string} filename - Optional filename
     * @returns {Promise<string>} Path to saved screenshot
     */
    async captureRegion(region, filename = null) {
        const outputPath = path.join(
            SCREENSHOT_DIR,
            filename || `region_${Date.now()}.png`
        );

        const { x, y, width, height } = region;

        return new Promise((resolve, reject) => {
            const psCommand = `
                Add-Type -AssemblyName System.Windows.Forms
                Add-Type -AssemblyName System.Drawing
                
                $bitmap = New-Object System.Drawing.Bitmap(${width}, ${height})
                $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                $graphics.CopyFromScreen(${x}, ${y}, 0, 0, [System.Drawing.Size]::new(${width}, ${height}))
                $bitmap.Save('${outputPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
                $graphics.Dispose()
                $bitmap.Dispose()
            `.replace(/\n/g, '; ');

            exec(`powershell -NoProfile -Command "${psCommand}"`, { windowsHide: true }, (error) => {
                if (error) {
                    console.error('❌ Region screenshot failed:', error.message);
                    reject(error);
                } else {
                    console.log(`📸 Region screenshot saved: ${outputPath}`);
                    resolve(outputPath);
                }
            });
        });
    }

    /**
     * Get screenshot as base64
     * @returns {Promise<string>} Base64 encoded image
     */
    async captureAsBase64() {
        const screenshotPath = await this.capture();

        return new Promise((resolve, reject) => {
            fs.readFile(screenshotPath, (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(data.toString('base64'));
                }
            });
        });
    }

    /**
     * Clean up old screenshots
     * @param {number} maxAgeMs - Maximum age in milliseconds (default 1 hour)
     */
    async cleanup(maxAgeMs = 3600000) {
        const now = Date.now();

        try {
            const files = fs.readdirSync(SCREENSHOT_DIR);

            for (const file of files) {
                const filePath = path.join(SCREENSHOT_DIR, file);
                const stats = fs.statSync(filePath);

                if (now - stats.mtimeMs > maxAgeMs) {
                    fs.unlinkSync(filePath);
                    console.log(`🗑️ Deleted old screenshot: ${file}`);
                }
            }
        } catch (error) {
            console.error('Cleanup error:', error.message);
        }
    }

    /**
     * Get the screenshot directory path
     * @returns {string}
     */
    getDirectory() {
        return SCREENSHOT_DIR;
    }
}

// Singleton instance
let screenshotInstance = null;

/**
 * Get or create screenshot service instance
 * @returns {ScreenshotService}
 */
export function getScreenshotService() {
    if (!screenshotInstance) {
        screenshotInstance = new ScreenshotService();
    }
    return screenshotInstance;
}

export { ScreenshotService };
export default ScreenshotService;
