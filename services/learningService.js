/**
 * IRIS Learning Service
 * Handles all NeonDB interactions for the Intelligence Engine
 * Provides memory, learning, and pattern analysis capabilities
 */

import { neon } from '@neondatabase/serverless';

// Database connection
let sql = null;

function getDb() {
    if (!sql) {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            console.warn('⚠️ DATABASE_URL not set - Learning features disabled');
            return null;
        }
        sql = neon(connectionString);
    }
    return sql;
}

/**
 * Query past experiences for a specific site and task
 * Used by reasoning engine before executing any action
 */
async function queryPastExperiences(site, taskType) {
    const db = getPool();
    if (!db) return getDefaultExperience();

    try {
        // Get success rate
        const statsResult = await db.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'success') as successes,
                AVG(execution_time_ms) as avg_time
            FROM automation_logs
            WHERE site = $1 AND task_type = $2
            AND created_at > NOW() - INTERVAL '30 days'
        `, [site, taskType]);

        // Get cached coordinates
        const cacheResult = await db.query(`
            SELECT element_name, last_coordinates, confidence, success_count
            FROM element_cache
            WHERE site = $1 AND confidence > 0.5
            ORDER BY success_count DESC
        `, [site]);

        // Get common errors
        const errorsResult = await db.query(`
            SELECT error_type, occurrence_count, suggested_fix
            FROM failure_patterns
            WHERE site = $1 AND (task_type = $2 OR task_type IS NULL)
            ORDER BY occurrence_count DESC
            LIMIT 5
        `, [site, taskType]);

        // Get last successful approach
        const lastSuccessResult = await db.query(`
            SELECT solution_applied, coordinates_used, selectors_used
            FROM automation_logs
            WHERE site = $1 AND task_type = $2 AND status = 'success'
            ORDER BY created_at DESC
            LIMIT 1
        `, [site, taskType]);

        const stats = statsResult.rows[0] || { total: 0, successes: 0, avg_time: 0 };
        const successRate = stats.total > 0 ? (stats.successes / stats.total) * 100 : 0;

        return {
            hasHistory: stats.total > 0,
            successRate: Math.round(successRate),
            totalAttempts: parseInt(stats.total),
            avgExecutionTime: Math.round(stats.avg_time || 0),
            cachedElements: cacheResult.rows.reduce((acc, row) => {
                acc[row.element_name] = {
                    coordinates: row.last_coordinates,
                    confidence: parseFloat(row.confidence),
                    successCount: row.success_count
                };
                return acc;
            }, {}),
            commonErrors: errorsResult.rows.map(row => ({
                type: row.error_type,
                count: row.occurrence_count,
                suggestedFix: row.suggested_fix
            })),
            lastSuccessfulApproach: lastSuccessResult.rows[0] || null
        };
    } catch (error) {
        console.error('❌ Learning query failed:', error.message);
        return getDefaultExperience();
    }
}

/**
 * Log task result for future learning
 */
async function logTaskResult(taskData) {
    const db = getPool();
    if (!db) return false;

    const {
        taskType,
        site,
        status,
        errorMessage = null,
        errorCode = null,
        coordinatesUsed = null,
        selectorsUsed = null,
        solutionApplied = null,
        executionTimeMs = null,
        screenshotSizeKb = null,
        visionApiUsed = true,
        thinkingLog = []
    } = taskData;

    try {
        await db.query(`
            INSERT INTO automation_logs 
            (task_type, site, status, error_message, error_code, 
             coordinates_used, selectors_used, solution_applied,
             execution_time_ms, screenshot_size_kb, vision_api_used, thinking_log)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
            taskType, site, status, errorMessage, errorCode,
            coordinatesUsed ? JSON.stringify(coordinatesUsed) : null,
            selectorsUsed,
            solutionApplied,
            executionTimeMs,
            screenshotSizeKb,
            visionApiUsed,
            thinkingLog
        ]);

        // If failed, log failure pattern
        if (status === 'failed' && errorCode) {
            await db.query(`SELECT log_failure_pattern($1, $2, $3, $4)`,
                [site, taskType, errorCode, errorMessage]);
        }

        console.log(`📚 Logged ${status} result for ${taskType} on ${site}`);
        return true;
    } catch (error) {
        console.error('❌ Failed to log task result:', error.message);
        return false;
    }
}

/**
 * Update element cache after successful interaction
 */
async function updateElementCache(site, elementName, coordinates, options = {}) {
    const db = getPool();
    if (!db) return false;

    const {
        pageUrl = null,
        elementType = null,
        selector = null,
        viewportSize = null
    } = options;

    try {
        await db.query(`
            INSERT INTO element_cache 
            (site, page_url, element_name, element_type, selector, 
             last_coordinates, viewport_size, success_count, last_success)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 1, NOW())
            ON CONFLICT (site, element_name) DO UPDATE SET
                last_coordinates = EXCLUDED.last_coordinates,
                viewport_size = EXCLUDED.viewport_size,
                success_count = element_cache.success_count + 1,
                confidence = LEAST(1.0, element_cache.confidence + 0.05),
                last_success = NOW(),
                updated_at = NOW()
        `, [site, pageUrl, elementName, elementType, selector,
            JSON.stringify(coordinates), viewportSize ? JSON.stringify(viewportSize) : null]);

        console.log(`🎯 Cached ${elementName} at (${coordinates.x}, ${coordinates.y}) for ${site}`);
        return true;
    } catch (error) {
        console.error('❌ Failed to update element cache:', error.message);
        return false;
    }
}

/**
 * Mark cached element as failed (reduce confidence)
 */
async function markCacheMiss(site, elementName) {
    const db = getPool();
    if (!db) return;

    try {
        await db.query(`
            UPDATE element_cache SET
                fail_count = fail_count + 1,
                confidence = GREATEST(0, confidence - 0.2),
                last_failure = NOW(),
                updated_at = NOW()
            WHERE site = $1 AND element_name = $2
        `, [site, elementName]);
    } catch (error) {
        console.error('❌ Failed to mark cache miss:', error.message);
    }
}

/**
 * Get cached coordinates for an element
 */
async function getCachedCoordinates(site, elementName) {
    const db = getPool();
    if (!db) return null;

    try {
        const result = await db.query(`
            SELECT last_coordinates, confidence, success_count
            FROM element_cache
            WHERE site = $1 AND element_name = $2 AND confidence > 0.3
        `, [site, elementName]);

        if (result.rows.length > 0) {
            const row = result.rows[0];
            return {
                coordinates: row.last_coordinates,
                confidence: parseFloat(row.confidence),
                successCount: row.success_count
            };
        }
        return null;
    } catch (error) {
        console.error('❌ Failed to get cached coordinates:', error.message);
        return null;
    }
}

/**
 * Get failure patterns for analysis
 */
async function getFailurePatterns(site = null, limit = 10) {
    const db = getPool();
    if (!db) return [];

    try {
        let query = `
            SELECT site, task_type, error_type, error_message_pattern,
                   occurrence_count, last_occurrence, suggested_fix, auto_adjustments
            FROM failure_patterns
            ${site ? 'WHERE site = $1' : ''}
            ORDER BY occurrence_count DESC
            LIMIT ${limit}
        `;

        const result = await db.query(query, site ? [site] : []);
        return result.rows;
    } catch (error) {
        console.error('❌ Failed to get failure patterns:', error.message);
        return [];
    }
}

/**
 * Generate weekly analysis report
 */
async function generateWeeklyReport() {
    const db = getPool();
    if (!db) return { error: 'Database not available' };

    try {
        // Total stats
        const totalStats = await db.query(`
            SELECT 
                COUNT(*) as total_tasks,
                COUNT(*) FILTER (WHERE status = 'success') as successes,
                COUNT(*) FILTER (WHERE status = 'failed') as failures,
                COUNT(DISTINCT site) as sites_used
            FROM automation_logs
            WHERE created_at > NOW() - INTERVAL '7 days'
        `);

        // Top failures
        const topFailures = await db.query(`
            SELECT site, error_type, occurrence_count, suggested_fix
            FROM failure_patterns
            WHERE last_occurrence > NOW() - INTERVAL '7 days'
            ORDER BY occurrence_count DESC
            LIMIT 5
        `);

        // Site performance
        const sitePerformance = await db.query(`
            SELECT site, 
                   COUNT(*) as attempts,
                   ROUND(AVG(CASE WHEN status = 'success' THEN 100 ELSE 0 END)) as success_rate
            FROM automation_logs
            WHERE created_at > NOW() - INTERVAL '7 days'
            GROUP BY site
            ORDER BY attempts DESC
        `);

        const stats = totalStats.rows[0];
        const successRate = stats.total_tasks > 0
            ? Math.round((stats.successes / stats.total_tasks) * 100)
            : 0;

        return {
            period: 'Last 7 days',
            summary: {
                totalTasks: parseInt(stats.total_tasks),
                successes: parseInt(stats.successes),
                failures: parseInt(stats.failures),
                successRate: successRate,
                sitesUsed: parseInt(stats.sites_used)
            },
            topIssues: topFailures.rows.map(row => ({
                site: row.site,
                issue: row.error_type,
                count: row.occurrence_count,
                suggestion: row.suggested_fix || 'No suggestion yet'
            })),
            sitePerformance: sitePerformance.rows,
            recommendations: generateRecommendations(topFailures.rows)
        };
    } catch (error) {
        console.error('❌ Failed to generate report:', error.message);
        return { error: error.message };
    }
}

/**
 * Generate recommendations based on failure patterns
 */
function generateRecommendations(failures) {
    const recommendations = [];

    for (const failure of failures) {
        if (failure.error_type.includes('timeout')) {
            recommendations.push({
                issue: `Timeout errors on ${failure.site}`,
                action: 'Increase page load timeout from 10s to 15s',
                code: 'await page.waitForTimeout(15000)'
            });
        }
        if (failure.error_type.includes('413') || failure.error_type.includes('large')) {
            recommendations.push({
                issue: `Large screenshot errors on ${failure.site}`,
                action: 'Reduce screenshot quality to 25%',
                code: 'quality: 25'
            });
        }
        if (failure.error_type.includes('selector')) {
            recommendations.push({
                issue: `Selector failures on ${failure.site}`,
                action: 'Use vision-first approach instead of selectors',
                code: 'Use captureAndAnalyze() before trying selectors'
            });
        }
    }

    return recommendations;
}

function getDefaultExperience() {
    return {
        hasHistory: false,
        successRate: 0,
        totalAttempts: 0,
        avgExecutionTime: 0,
        cachedElements: {},
        commonErrors: [],
        lastSuccessfulApproach: null
    };
}

export {
    queryPastExperiences,
    logTaskResult,
    updateElementCache,
    markCacheMiss,
    getCachedCoordinates,
    getFailurePatterns,
    generateWeeklyReport
};
