import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

const DB_NAME = 'offhand.db';
let db: SQLite.SQLiteDatabase | null = null;

export async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (db) {
    return db;
  }
  db = await SQLite.openDatabase({
    name: DB_NAME,
    location: 'default',
  });

  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS asr_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      engine TEXT NOT NULL DEFAULT 'sensevoice',
      model TEXT NOT NULL DEFAULT 'senseVoiceSmall',
      language TEXT NOT NULL DEFAULT 'auto',
      sample_rate TEXT NOT NULL DEFAULT '16k'
    )
  `);

  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS text_model_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
      style TEXT NOT NULL DEFAULT 'casual',
      max_tokens TEXT NOT NULL DEFAULT '1024',
      thinking INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Migration: add thinking column if not exists
  try {
    await db.executeSql(
      'ALTER TABLE text_model_config ADD COLUMN thinking INTEGER NOT NULL DEFAULT 0',
    );
  } catch (_) {
    // Column already exists
  }

  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS shortcut_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      modifier TEXT NOT NULL DEFAULT '',
      key TEXT NOT NULL DEFAULT ''
    )
  `);

  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY NOT NULL,
      setting_value TEXT NOT NULL
    )
  `);

  // Ensure default rows exist
  await db.executeSql(
    'INSERT OR IGNORE INTO asr_config (id) VALUES (1)',
  );
  await db.executeSql(
    'INSERT OR IGNORE INTO text_model_config (id) VALUES (1)',
  );
  await db.executeSql(
    'INSERT OR IGNORE INTO shortcut_config (id) VALUES (1)',
  );

  return db;
}

// --- ASR Config ---

export interface ASRRow {
  engine: string;
  model: string;
  language: string;
  sample_rate: string;
}

export async function loadASRConfig(fallback: ASRRow): Promise<ASRRow> {
  try {
    const database = await getDB();
    const [results] = await database.executeSql(
      'SELECT engine, model, language, sample_rate FROM asr_config WHERE id = 1',
    );
    if (results.rows.length > 0) {
      const row = results.rows.item(0);
      return {
        engine: row.engine ?? fallback.engine,
        model: row.model ?? fallback.model,
        language: row.language ?? fallback.language,
        sample_rate: row.sample_rate ?? fallback.sample_rate,
      };
    }
  } catch (e) {
    console.warn('[DB] load asr_config failed:', e);
  }
  return fallback;
}

export async function saveASRConfig(cfg: ASRRow): Promise<void> {
  try {
    const database = await getDB();
    await database.executeSql(
      'UPDATE asr_config SET engine = ?, model = ?, language = ?, sample_rate = ? WHERE id = 1',
      [cfg.engine, cfg.model, cfg.language, cfg.sample_rate],
    );
  } catch (e) {
    console.warn('[DB] save asr_config failed:', e);
  }
}

// --- Text Model Config ---

export interface TextModelRow {
  provider: string;
  model: string;
  base_url: string;
  api_key: string;
  style: string;
  max_tokens: string;
  thinking: number;
}

export async function loadTextModelConfig(
  fallback: TextModelRow,
): Promise<TextModelRow> {
  try {
    const database = await getDB();
    const [results] = await database.executeSql(
      'SELECT provider, model, base_url, api_key, style, max_tokens, thinking FROM text_model_config WHERE id = 1',
    );
    if (results.rows.length > 0) {
      const row = results.rows.item(0);
      return {
        provider: row.provider ?? fallback.provider,
        model: row.model ?? fallback.model,
        base_url: row.base_url ?? fallback.base_url,
        api_key: row.api_key ?? fallback.api_key,
        style: row.style ?? fallback.style,
        max_tokens: row.max_tokens ?? fallback.max_tokens,
        thinking: row.thinking ?? fallback.thinking,
      };
    }
  } catch (e) {
    console.warn('[DB] load text_model_config failed:', e);
  }
  return fallback;
}

export async function saveTextModelConfig(cfg: TextModelRow): Promise<void> {
  try {
    const database = await getDB();
    await database.executeSql(
      'UPDATE text_model_config SET provider = ?, model = ?, base_url = ?, api_key = ?, style = ?, max_tokens = ?, thinking = ? WHERE id = 1',
      [
        cfg.provider,
        cfg.model,
        cfg.base_url,
        cfg.api_key,
        cfg.style,
        cfg.max_tokens,
        cfg.thinking,
      ],
    );
  } catch (e) {
    console.warn('[DB] save text_model_config failed:', e);
  }
}

// --- Shortcut Config ---

export interface ShortcutRow {
  modifier: string;
  key: string;
}

export async function loadShortcutConfig(
  fallback: ShortcutRow,
): Promise<ShortcutRow> {
  try {
    const database = await getDB();
    const [results] = await database.executeSql(
      'SELECT modifier, key FROM shortcut_config WHERE id = 1',
    );
    if (results.rows.length > 0) {
      const row = results.rows.item(0);
      return {
        modifier: row.modifier ?? fallback.modifier,
        key: row.key ?? fallback.key,
      };
    }
  } catch (e) {
    console.warn('[DB] load shortcut_config failed:', e);
  }
  return fallback;
}

export async function saveShortcutConfig(cfg: ShortcutRow): Promise<void> {
  try {
    const database = await getDB();
    await database.executeSql(
      'UPDATE shortcut_config SET modifier = ?, key = ? WHERE id = 1',
      [cfg.modifier, cfg.key],
    );
  } catch (e) {
    console.warn('[DB] save shortcut_config failed:', e);
  }
}

// --- App Settings (key-value for simple values) ---

export async function loadSetting(
  key: string,
  fallback: string,
): Promise<string> {
  try {
    const database = await getDB();
    const [results] = await database.executeSql(
      'SELECT setting_value FROM app_settings WHERE setting_key = ?',
      [key],
    );
    if (results.rows.length > 0) {
      return results.rows.item(0).setting_value ?? fallback;
    }
  } catch (e) {
    console.warn(`[DB] load setting ${key} failed:`, e);
  }
  return fallback;
}

export async function saveSetting(
  key: string,
  value: string,
): Promise<void> {
  try {
    const database = await getDB();
    await database.executeSql(
      'INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES (?, ?)',
      [key, value],
    );
  } catch (e) {
    console.warn(`[DB] save setting ${key} failed:`, e);
  }
}
