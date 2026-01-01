/**
 * IRIS Backend - Neon Database Configuration
 * Handles PostgreSQL connection and chat history management
 */

import { neon } from '@neondatabase/serverless';

let sql = null;

/**
 * Initialize database connection
 */
export function initDatabase() {
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️  DATABASE_URL not set. Chat history will not be persisted.');
    return false;
  }

  sql = neon(process.env.DATABASE_URL);
  console.log('✅ Database connection initialized');
  return true;
}

/**
 * Create required tables if they don't exist
 */
export async function setupTables() {
  if (!sql) return false;

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        device_type TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_messages_session 
      ON chat_messages(session_id, created_at DESC)
    `;

    console.log('✅ Database tables ready');
    await setupAppsTable(); // Initialize apps table
    await setupPreferencesTable(); // Initialize preferences table
    await setupScheduledTasksTable(); // Initialize scheduled tasks table
    return true;
  } catch (error) {
    console.error('❌ Database setup error:', error.message);
    return false;
  }
}

/**
 * Create installed_apps table
 */
export async function setupAppsTable() {
  if (!sql) return false;
  try {
    await sql`
            CREATE TABLE IF NOT EXISTS installed_apps (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                keywords TEXT[],
                device_type TEXT DEFAULT 'desktop',
                last_seen TIMESTAMP DEFAULT NOW(),
                UNIQUE(name, path)
            )
        `;
    // Index for fast fuzzy search on names
    await sql`
            CREATE INDEX IF NOT EXISTS idx_apps_name ON installed_apps(name)
        `;
    console.log('✅ Apps table ready');
    return true;
  } catch (error) {
    console.error('❌ Apps table setup error:', error.message);
    return false;
  }
}

/**
 * Create or get a chat session
 * @param {string} sessionId - Unique session identifier
 * @param {string} deviceType - 'desktop' or 'mobile'
 */
export async function getOrCreateSession(sessionId, deviceType) {
  if (!sql) return null;

  try {
    const existing = await sql`
      SELECT * FROM chat_sessions WHERE id = ${sessionId}
    `;

    if (existing.length > 0) {
      await sql`
        UPDATE chat_sessions 
        SET updated_at = NOW() 
        WHERE id = ${sessionId}
      `;
      return existing[0];
    }

    await sql`
      INSERT INTO chat_sessions (id, device_type) 
      VALUES (${sessionId}, ${deviceType})
    `;

    return { id: sessionId, device_type: deviceType };
  } catch (error) {
    console.error('Session error:', error.message);
    return null;
  }
}

/**
 * Save a message to chat history
 * @param {string} sessionId - Session identifier
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - Message content
 */
export async function saveMessage(sessionId, role, content) {
  if (!sql) return false;

  try {
    await sql`
      INSERT INTO chat_messages (session_id, role, content)
      VALUES (${sessionId}, ${role}, ${content})
    `;
    return true;
  } catch (error) {
    console.error('Save message error:', error.message);
    return false;
  }
}

/**
 * Get chat history for a session
 * @param {string} sessionId - Session identifier
 * @param {number} limit - Maximum messages to retrieve (default: 20)
 * @returns {Array} Array of messages [{role, content}]
 */
export async function getHistory(sessionId, limit = 20) {
  if (!sql) return [];

  try {
    const messages = await sql`
      SELECT role, content 
      FROM chat_messages 
      WHERE session_id = ${sessionId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    // Return in chronological order
    return messages.reverse();
  } catch (error) {
    console.error('Get history error:', error.message);
    return [];
  }
}

/**
 * Clear chat history for a session
 * @param {string} sessionId - Session identifier
 */
export async function clearHistory(sessionId) {
  if (!sql) return false;

  try {
    await sql`
      DELETE FROM chat_messages WHERE session_id = ${sessionId}
    `;
    return true;
  } catch (error) {
    console.error('Clear history error:', error.message);
    return false;
  }
}

/**
 * Save or update an installed app
 */
export async function saveApp(name, path, keywords = []) {
  if (!sql) return false;
  try {
    // Upsert app
    await sql`
            INSERT INTO installed_apps (name, path, keywords, last_seen)
            VALUES (${name}, ${path}, ${keywords}, NOW())
            ON CONFLICT (name, path) 
            DO UPDATE SET last_seen = NOW(), keywords = ${keywords}
        `;
    return true;
  } catch (error) {
    console.error('Save app error:', error.message);
    return false;
  }
}

/**
 * Search for an app by fuzzy name
 */
export async function searchApp(query) {
  if (!sql) return null;
  try {
    // Simple case-insensitive search
    const results = await sql`
            SELECT * FROM installed_apps 
            WHERE name ILIKE ${'%' + query + '%'}
            ORDER BY LENGTH(name) ASC
            LIMIT 1
        `;
    return results.length > 0 ? results[0] : null;
  } catch (error) {
    console.error('Search app error:', error.message);
    return null;
  }
}

// ============================================
// User Memory System (Persistent Preferences)
// ============================================

/**
 * Setup user preferences table
 */
export async function setupPreferencesTable() {
  if (!sql) return false;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(session_id, key)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_prefs_session ON user_preferences(session_id)
    `;
    console.log('✅ User preferences table ready');
    return true;
  } catch (error) {
    console.error('❌ Preferences table setup error:', error.message);
    return false;
  }
}

/**
 * Setup scheduled tasks table
 */
export async function setupScheduledTasksTable() {
  if (!sql) return false;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        task_description TEXT NOT NULL,
        scheduled_time TIMESTAMP NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        executed_at TIMESTAMP
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_tasks_session ON scheduled_tasks(session_id, status)
    `;
    console.log('✅ Scheduled tasks table ready');
    return true;
  } catch (error) {
    console.error('❌ Scheduled tasks table setup error:', error.message);
    return false;
  }
}

/**
 * Save or update a user preference
 * @param {string} sessionId - Session identifier
 * @param {string} key - Preference key (e.g., 'name', 'favorite_color')
 * @param {string} value - Preference value
 * @param {string} category - Category (e.g., 'personal', 'settings')
 */
export async function saveUserPreference(sessionId, key, value, category = 'general') {
  if (!sql) {
    console.warn('⚠️ Database not available, preference not saved');
    return false;
  }
  try {
    await sql`
      INSERT INTO user_preferences (session_id, key, value, category, updated_at)
      VALUES (${sessionId}, ${key}, ${value}, ${category}, NOW())
      ON CONFLICT (session_id, key)
      DO UPDATE SET value = ${value}, category = ${category}, updated_at = NOW()
    `;
    console.log(`💾 Preference saved: ${key} = ${value}`);
    return true;
  } catch (error) {
    console.error('Save preference error:', error.message);
    return false;
  }
}

/**
 * Get all preferences for a session
 * @param {string} sessionId - Session identifier
 * @returns {Array} Array of preferences [{key, value, category}]
 */
export async function getUserPreferences(sessionId) {
  if (!sql) return [];
  try {
    const prefs = await sql`
      SELECT key, value, category FROM user_preferences
      WHERE session_id = ${sessionId}
      ORDER BY updated_at DESC
    `;
    return prefs;
  } catch (error) {
    console.error('Get preferences error:', error.message);
    return [];
  }
}

/**
 * Get a specific preference value
 * @param {string} sessionId - Session identifier
 * @param {string} key - Preference key
 * @returns {string|null} The preference value or null
 */
export async function getPreferenceValue(sessionId, key) {
  if (!sql) return null;
  try {
    const result = await sql`
      SELECT value FROM user_preferences
      WHERE session_id = ${sessionId} AND key = ${key}
      LIMIT 1
    `;
    return result.length > 0 ? result[0].value : null;
  } catch (error) {
    console.error('Get preference value error:', error.message);
    return null;
  }
}

/**
 * Delete a user preference
 * @param {string} sessionId - Session identifier
 * @param {string} key - Preference key to delete
 */
export async function deleteUserPreference(sessionId, key) {
  if (!sql) return false;
  try {
    await sql`
      DELETE FROM user_preferences
      WHERE session_id = ${sessionId} AND key = ${key}
    `;
    return true;
  } catch (error) {
    console.error('Delete preference error:', error.message);
    return false;
  }
}

// ============================================
// Scheduled Tasks System
// ============================================

/**
 * Save a scheduled task/reminder
 * @param {string} sessionId - Session identifier
 * @param {string} scheduledTime - ISO datetime string
 * @param {string} taskDescription - Task description
 */
export async function saveScheduledTask(sessionId, scheduledTime, taskDescription) {
  if (!sql) {
    console.warn('⚠️ Database not available, task not saved');
    return null;
  }
  try {
    const result = await sql`
      INSERT INTO scheduled_tasks (session_id, scheduled_time, task_description)
      VALUES (${sessionId}, ${scheduledTime}, ${taskDescription})
      RETURNING id
    `;
    console.log(`📅 Task scheduled: "${taskDescription}" at ${scheduledTime}`);
    return result[0]?.id;
  } catch (error) {
    console.error('Save scheduled task error:', error.message);
    return null;
  }
}

/**
 * Get pending tasks for a session
 * @param {string} sessionId - Session identifier (optional, gets all if null)
 * @returns {Array} Array of pending tasks
 */
export async function getPendingTasks(sessionId = null) {
  if (!sql) return [];
  try {
    if (sessionId) {
      return await sql`
        SELECT * FROM scheduled_tasks
        WHERE session_id = ${sessionId} AND status = 'pending'
        ORDER BY scheduled_time ASC
      `;
    } else {
      return await sql`
        SELECT * FROM scheduled_tasks
        WHERE status = 'pending'
        ORDER BY scheduled_time ASC
      `;
    }
  } catch (error) {
    console.error('Get pending tasks error:', error.message);
    return [];
  }
}

/**
 * Get tasks that are due (scheduled time has passed)
 * @returns {Array} Array of due tasks
 */
export async function getDueTasks() {
  if (!sql) return [];
  try {
    return await sql`
      SELECT * FROM scheduled_tasks
      WHERE status = 'pending' AND scheduled_time <= NOW()
      ORDER BY scheduled_time ASC
    `;
  } catch (error) {
    console.error('Get due tasks error:', error.message);
    return [];
  }
}

/**
 * Mark a task as completed
 * @param {number} taskId - Task ID
 */
export async function markTaskCompleted(taskId) {
  if (!sql) return false;
  try {
    await sql`
      UPDATE scheduled_tasks
      SET status = 'completed', executed_at = NOW()
      WHERE id = ${taskId}
    `;
    return true;
  } catch (error) {
    console.error('Mark task completed error:', error.message);
    return false;
  }
}

/**
 * Cancel a scheduled task
 * @param {number} taskId - Task ID
 */
export async function cancelScheduledTask(taskId) {
  if (!sql) return false;
  try {
    await sql`
      UPDATE scheduled_tasks
      SET status = 'cancelled'
      WHERE id = ${taskId}
    `;
    return true;
  } catch (error) {
    console.error('Cancel task error:', error.message);
    return false;
  }
}
