/**
 * IRIS Backend - Apps Routes
 * Handles syncing and searching installed applications
 */

import express from 'express';
import { saveApp, searchApp } from '../config/database.js';

const router = express.Router();

// Sync installed apps from desktop client
router.post('/sync', async (req, res) => {
    const { apps } = req.body; // Expect array of { name, path }

    if (!Array.isArray(apps)) {
        return res.status(400).json({ error: 'Invalid apps list' });
    }

    console.log(`📥 Syncing ${apps.length} apps...`);
    let count = 0;

    for (const app of apps) {
        if (app.name && app.path) {
            // Generate simple keywords (lowercase name parts)
            const keywords = app.name.toLowerCase().split(/\s+/).filter(w => w.length > 2);
            const success = await saveApp(app.name, app.path, keywords);
            if (success) count++;
        }
    }

    console.log(`✅ Synced ${count} apps`);
    res.json({ success: true, count });
});

// Search for an app
router.get('/search', async (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Query required' });

    const app = await searchApp(q);
    if (app) {
        res.json({ success: true, app });
    } else {
        res.status(404).json({ success: false, error: 'App not found' });
    }
});

export default router;
