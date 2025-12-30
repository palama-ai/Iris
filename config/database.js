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
