import SQLite from 'react-native-sqlite-storage';
import {NativeModules, Platform} from 'react-native';

SQLite.enablePromise(true);

const DB_NAME = 'offhand.db';
let db: SQLite.SQLiteDatabase | null = null;

type DatabaseOpenOptions = {
  name: string;
  location?: string;
  path?: string;
};

type AppPathsModule = {
  getDatabaseOpenOptions?: (databaseName: string) => Promise<DatabaseOpenOptions>;
};

const AppPaths = NativeModules.AppPaths as AppPathsModule | undefined;

async function getDatabaseOpenOptions(): Promise<DatabaseOpenOptions> {
  if (Platform.OS === 'macos' && AppPaths?.getDatabaseOpenOptions) {
    try {
      const options = await AppPaths.getDatabaseOpenOptions(DB_NAME);
      console.log(`[DB] opening app data database at ${options.path ?? options.name}`);
      return {
        name: options.name,
        location: options.location ?? 'Library',
        path: options.path,
      };
    } catch (e) {
      console.warn('[DB] failed to resolve app data database path, using default SQLite location:', e);
    }
  }

  return {
    name: DB_NAME,
    location: 'default',
  };
}

export async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (db) {
    return db;
  }
  db = await SQLite.openDatabase(await getDatabaseOpenOptions());

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
      prompt TEXT NOT NULL DEFAULT ''
    )
  `);

  // Migration: drop old columns, add prompt
  const dropCols = ['style', 'max_tokens', 'thinking'];
  for (const col of dropCols) {
    try {
      await db.executeSql(`ALTER TABLE text_model_config DROP COLUMN ${col}`);
    } catch {}
  }
  try {
    await db.executeSql(
      "ALTER TABLE text_model_config ADD COLUMN prompt TEXT NOT NULL DEFAULT ''",
    );
  } catch {}

  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS shortcut_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      modifier TEXT NOT NULL DEFAULT 'fn',
      key TEXT NOT NULL DEFAULT ''
    )
  `);

  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL DEFAULT ''
    )
  `);

  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_text TEXT NOT NULL,
      enhanced_text TEXT NOT NULL,
      enhance_elapsed_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  try {
    await db.executeSql('ALTER TABLE history ADD COLUMN enhance_elapsed_ms INTEGER');
  } catch {}

  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS memory_corpus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      source_path TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  try {
    await db.executeSql('ALTER TABLE memory_corpus ADD COLUMN source_path TEXT');
  } catch {}
  try {
    await db.executeSql('ALTER TABLE memory_corpus ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1');
  } catch {}
  try {
    await db.executeSql('ALTER TABLE memory_corpus ADD COLUMN updated_at TEXT');
  } catch {}
  try {
    await db.executeSql(
      "UPDATE memory_corpus SET updated_at = COALESCE(updated_at, created_at, datetime('now', 'localtime'))",
    );
  } catch {}

  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      week TEXT NOT NULL,
      month TEXT NOT NULL,
      audio_duration_sec REAL DEFAULT 0,
      original_chars INTEGER DEFAULT 0,
      enhanced_chars INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      recording_count INTEGER DEFAULT 1
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
  prompt: string;
}

export async function loadTextModelConfig(
  fallback: TextModelRow,
): Promise<TextModelRow> {
  try {
    const database = await getDB();
    const [results] = await database.executeSql(
      'SELECT provider, model, base_url, api_key, prompt FROM text_model_config WHERE id = 1',
    );
    if (results.rows.length > 0) {
      const row = results.rows.item(0);
      return {
        provider: row.provider ?? fallback.provider,
        model: row.model ?? fallback.model,
        base_url: row.base_url ?? fallback.base_url,
        api_key: row.api_key ?? fallback.api_key,
        prompt: row.prompt ?? fallback.prompt,
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
      'UPDATE text_model_config SET provider = ?, model = ?, base_url = ?, api_key = ?, prompt = ? WHERE id = 1',
      [
        cfg.provider,
        cfg.model,
        cfg.base_url,
        cfg.api_key,
        cfg.prompt,
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

// --- History ---

export interface HistoryRow {
  id: number;
  original_text: string;
  enhanced_text: string;
  enhance_elapsed_ms?: number | null;
  created_at: string;
}

export async function addHistory(entry: {
  originalText: string;
  enhancedText: string;
  enhanceElapsedMs?: number | null;
}): Promise<void> {
  try {
    const database = await getDB();
    await database.executeSql(
      'INSERT INTO history (original_text, enhanced_text, enhance_elapsed_ms) VALUES (?, ?, ?)',
      [
        entry.originalText,
        entry.enhancedText,
        entry.enhanceElapsedMs ?? null,
      ],
    );
  } catch (e) {
    console.warn('[DB] add history failed:', e);
    throw e;
  }
}

export async function loadHistoryPage(
  page: number,
  pageSize: number = 20,
): Promise<{rows: HistoryRow[]; total: number}> {
  try {
    const database = await getDB();
    const [countResult] = await database.executeSql(
      'SELECT COUNT(*) as total FROM history',
    );
    const total = countResult.rows.item(0).total ?? 0;

    const offset = (page - 1) * pageSize;
    const [results] = await database.executeSql(
      'SELECT id, original_text, enhanced_text, enhance_elapsed_ms, created_at FROM history ORDER BY id DESC LIMIT ? OFFSET ?',
      [pageSize, offset],
    );
    const rows: HistoryRow[] = [];
    for (let i = 0; i < results.rows.length; i++) {
      rows.push(results.rows.item(i) as HistoryRow);
    }
    return {rows, total};
  } catch (e) {
    console.warn('[DB] load history page failed:', e);
    return {rows: [], total: 0};
  }
}

export async function getHistoryCount(): Promise<number> {
  try {
    const database = await getDB();
    const [results] = await database.executeSql(
      'SELECT COUNT(*) as total FROM history',
    );
    return results.rows.item(0).total ?? 0;
  } catch {
    return 0;
  }
}

export async function deleteHistory(id: number): Promise<void> {
  try {
    const database = await getDB();
    await database.executeSql('DELETE FROM history WHERE id = ?', [id]);
  } catch (e) {
    console.warn('[DB] delete history failed:', e);
  }
}

export async function clearHistory(): Promise<void> {
  try {
    const database = await getDB();
    await database.executeSql('DELETE FROM history', []);
  } catch (e) {
    console.warn('[DB] clear history failed:', e);
  }
}

// --- Memory Corpus ---

export type MemoryCorpusType = 'markdown' | 'history';

export interface MemoryCorpusRow {
  id: number;
  type: MemoryCorpusType;
  title: string;
  content: string;
  source_path?: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export async function addMemoryCorpus(entry: {
  type: MemoryCorpusType;
  title: string;
  content: string;
  sourcePath?: string | null;
  enabled?: boolean;
}): Promise<void> {
  try {
    const database = await getDB();
    await database.executeSql(
      `INSERT INTO memory_corpus
        (type, title, content, source_path, enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
      [
        entry.type,
        entry.title.trim() || (entry.type === 'markdown' ? 'Markdown 语料' : '历史精选语料'),
        entry.content,
        entry.sourcePath ?? null,
        entry.enabled === false ? 0 : 1,
      ],
    );
  } catch (e) {
    console.warn('[DB] add memory corpus failed:', e);
    throw e;
  }
}

export async function loadMemoryCorpus(): Promise<MemoryCorpusRow[]> {
  try {
    const database = await getDB();
    const [results] = await database.executeSql(
      `SELECT id, type, title, content, source_path, enabled, created_at, updated_at
       FROM memory_corpus
       ORDER BY enabled DESC, updated_at DESC, id DESC`,
    );
    const rows: MemoryCorpusRow[] = [];
    for (let i = 0; i < results.rows.length; i++) {
      rows.push(results.rows.item(i) as MemoryCorpusRow);
    }
    return rows;
  } catch (e) {
    console.warn('[DB] load memory corpus failed:', e);
    return [];
  }
}

export async function loadEnabledMemoryCorpus(
  limit: number = 50,
): Promise<MemoryCorpusRow[]> {
  try {
    const database = await getDB();
    const [results] = await database.executeSql(
      `SELECT id, type, title, content, source_path, enabled, created_at, updated_at
       FROM memory_corpus
       WHERE enabled = 1
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`,
      [limit],
    );
    const rows: MemoryCorpusRow[] = [];
    for (let i = 0; i < results.rows.length; i++) {
      rows.push(results.rows.item(i) as MemoryCorpusRow);
    }
    return rows;
  } catch (e) {
    console.warn('[DB] load enabled memory corpus failed:', e);
    return [];
  }
}

export async function updateMemoryCorpus(
  id: number,
  patch: {
    title?: string;
    content?: string;
    enabled?: boolean;
  },
): Promise<void> {
  const sets: string[] = [];
  const params: Array<string | number> = [];

  if (patch.title !== undefined) {
    sets.push('title = ?');
    params.push(patch.title.trim());
  }
  if (patch.content !== undefined) {
    sets.push('content = ?');
    params.push(patch.content);
  }
  if (patch.enabled !== undefined) {
    sets.push('enabled = ?');
    params.push(patch.enabled ? 1 : 0);
  }

  if (sets.length === 0) {
    return;
  }

  sets.push("updated_at = datetime('now', 'localtime')");
  params.push(id);

  try {
    const database = await getDB();
    await database.executeSql(
      `UPDATE memory_corpus SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
  } catch (e) {
    console.warn('[DB] update memory corpus failed:', e);
    throw e;
  }
}

export async function deleteMemoryCorpus(id: number): Promise<void> {
  try {
    const database = await getDB();
    await database.executeSql('DELETE FROM memory_corpus WHERE id = ?', [id]);
  } catch (e) {
    console.warn('[DB] delete memory corpus failed:', e);
    throw e;
  }
}

// --- Stats ---

export interface StatRow {
  audio_duration_sec: number;
  original_chars: number;
  enhanced_chars: number;
  input_tokens: number;
  output_tokens: number;
  recording_count: number;
}

export interface StatsSummary {
  today: StatRow;
  thisWeek: StatRow;
  thisMonth: StatRow;
  total: StatRow;
  daily: Array<{date: string} & StatRow>;
  weekly: Array<{label: string} & StatRow>;
  monthly: Array<{label: string} & StatRow>;
}

// Helper: format local date as YYYY-MM-DD
function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function localMonth(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export async function addStat(stat: {
  audioDurationSec: number;
  originalChars: number;
  enhancedChars: number;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  try {
    const now = new Date();
    const date = localDate(now);
    const year = now.getFullYear();
    const weekNum = Math.ceil(
      ((now.getTime() - new Date(year, 0, 1).getTime()) / 86400000 + new Date(year, 0, 1).getDay() + 1) / 7,
    );
    const week = `${year}-W${String(weekNum).padStart(2, '0')}`;
    const month = date.slice(0, 7);

    const database = await getDB();
    // Upsert: if exists for this date, update; else insert
    const [existing] = await database.executeSql(
      'SELECT id FROM stats WHERE date = ?',
      [date],
    );
    if (existing.rows.length > 0) {
      await database.executeSql(
        `UPDATE stats SET
          audio_duration_sec = audio_duration_sec + ?,
          original_chars = original_chars + ?,
          enhanced_chars = enhanced_chars + ?,
          input_tokens = input_tokens + ?,
          output_tokens = output_tokens + ?,
          recording_count = recording_count + 1
        WHERE date = ?`,
        [stat.audioDurationSec, stat.originalChars, stat.enhancedChars, stat.inputTokens, stat.outputTokens, date],
      );
    } else {
      await database.executeSql(
        `INSERT INTO stats (date, week, month, audio_duration_sec, original_chars, enhanced_chars, input_tokens, output_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [date, week, month, stat.audioDurationSec, stat.originalChars, stat.enhancedChars, stat.inputTokens, stat.outputTokens],
      );
    }
  } catch (e) {
    console.warn('[DB] add stat failed:', e);
  }
}

async function queryStat(where: string, params: any[] = []): Promise<StatRow> {
  const database = await getDB();
  const [results] = await database.executeSql(
    `SELECT
       COALESCE(SUM(audio_duration_sec), 0) as audio_duration_sec,
       COALESCE(SUM(original_chars), 0) as original_chars,
       COALESCE(SUM(enhanced_chars), 0) as enhanced_chars,
       COALESCE(SUM(input_tokens), 0) as input_tokens,
       COALESCE(SUM(output_tokens), 0) as output_tokens,
       COALESCE(SUM(recording_count), 0) as recording_count
     FROM stats WHERE ${where}`,
    params,
  );
  const row = results.rows.item(0);
  return {
    audio_duration_sec: row.audio_duration_sec ?? 0,
    original_chars: row.original_chars ?? 0,
    enhanced_chars: row.enhanced_chars ?? 0,
    input_tokens: row.input_tokens ?? 0,
    output_tokens: row.output_tokens ?? 0,
    recording_count: row.recording_count ?? 0,
  };
}

export async function loadStatsSummary(): Promise<StatsSummary> {
  const now = new Date();
  const today = localDate(now);
  const month = today.slice(0, 7);
  const year = now.getFullYear();
  const weekNum = Math.ceil(
    ((now.getTime() - new Date(year, 0, 1).getTime()) / 86400000 + new Date(year, 0, 1).getDay() + 1) / 7,
  );
  const thisWeek = `${year}-W${String(weekNum).padStart(2, '0')}`;

  const [todayStats, weekStats, monthStats, totalStats, dailyStats, weeklyStats, monthlyStats] = await Promise.all([
    queryStat('date = ?', [today]),
    queryStat('week = ?', [thisWeek]),
    queryStat('month = ?', [month]),
    queryStat('1=1'),
    getDailyStats(7),
    getWeeklyStats(8),
    getMonthlyStats(6),
  ]);

  return {
    today: todayStats,
    thisWeek: weekStats,
    thisMonth: monthStats,
    total: totalStats,
    daily: dailyStats,
    weekly: weeklyStats,
    monthly: monthlyStats,
  };
}

async function getDailyStats(days: number): Promise<Array<{date: string} & StatRow>> {
  const database = await getDB();
  const result: Array<{date: string} & StatRow> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const [results] = await database.executeSql(
      `SELECT
         COALESCE(SUM(audio_duration_sec), 0) as audio_duration_sec,
         COALESCE(SUM(original_chars), 0) as original_chars,
         COALESCE(SUM(enhanced_chars), 0) as enhanced_chars,
         COALESCE(SUM(input_tokens), 0) as input_tokens,
         COALESCE(SUM(output_tokens), 0) as output_tokens,
         COALESCE(SUM(recording_count), 0) as recording_count
       FROM stats WHERE date = ?`,
      [date],
    );
    const row = results.rows.item(0);
    result.push({
      date,
      audio_duration_sec: row.audio_duration_sec ?? 0,
      original_chars: row.original_chars ?? 0,
      enhanced_chars: row.enhanced_chars ?? 0,
      input_tokens: row.input_tokens ?? 0,
      output_tokens: row.output_tokens ?? 0,
      recording_count: row.recording_count ?? 0,
    });
  }
  return result;
}

async function getWeeklyStats(weeks: number): Promise<Array<{label: string} & StatRow>> {
  const database = await getDB();
  const result: Array<{label: string} & StatRow> = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i * 7);
    const year = d.getFullYear();
    const weekNum = Math.ceil(
      ((d.getTime() - new Date(year, 0, 1).getTime()) / 86400000 + new Date(year, 0, 1).getDay() + 1) / 7,
    );
    const week = `${year}-W${String(weekNum).padStart(2, '0')}`;
    const [results] = await database.executeSql(
      `SELECT COALESCE(SUM(audio_duration_sec), 0) as audio_duration_sec,
              COALESCE(SUM(original_chars), 0) as original_chars,
              COALESCE(SUM(enhanced_chars), 0) as enhanced_chars,
              COALESCE(SUM(input_tokens), 0) as input_tokens,
              COALESCE(SUM(output_tokens), 0) as output_tokens,
              COALESCE(SUM(recording_count), 0) as recording_count
       FROM stats WHERE week = ?`,
      [week],
    );
    const row = results.rows.item(0);
    result.push({
      label: `W${weekNum}`,
      audio_duration_sec: row.audio_duration_sec ?? 0,
      original_chars: row.original_chars ?? 0,
      enhanced_chars: row.enhanced_chars ?? 0,
      input_tokens: row.input_tokens ?? 0,
      output_tokens: row.output_tokens ?? 0,
      recording_count: row.recording_count ?? 0,
    });
  }
  return result;
}

async function getMonthlyStats(months: number): Promise<Array<{label: string} & StatRow>> {
  const database = await getDB();
  const result: Array<{label: string} & StatRow> = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const month = localMonth(d);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const [results] = await database.executeSql(
      `SELECT COALESCE(SUM(audio_duration_sec), 0) as audio_duration_sec,
              COALESCE(SUM(original_chars), 0) as original_chars,
              COALESCE(SUM(enhanced_chars), 0) as enhanced_chars,
              COALESCE(SUM(input_tokens), 0) as input_tokens,
              COALESCE(SUM(output_tokens), 0) as output_tokens,
              COALESCE(SUM(recording_count), 0) as recording_count
       FROM stats WHERE month = ?`,
      [month],
    );
    const row = results.rows.item(0);
    result.push({
      label,
      audio_duration_sec: row.audio_duration_sec ?? 0,
      original_chars: row.original_chars ?? 0,
      enhanced_chars: row.enhanced_chars ?? 0,
      input_tokens: row.input_tokens ?? 0,
      output_tokens: row.output_tokens ?? 0,
      recording_count: row.recording_count ?? 0,
    });
  }
  return result;
}

