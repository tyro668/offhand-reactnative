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
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    )
  `);

  return db;
}

export async function loadConfig<T>(key: string, fallback: T): Promise<T> {
  try {
    const database = await getDB();
    const [results] = await database.executeSql(
      'SELECT value FROM config WHERE key = ?',
      [key],
    );
    if (results.rows.length > 0) {
      return JSON.parse(results.rows.item(0).value) as T;
    }
  } catch (e) {
    console.warn(`[DB] load ${key} failed:`, e);
  }
  return fallback;
}

export async function saveConfig(key: string, value: unknown): Promise<void> {
  try {
    const database = await getDB();
    await database.executeSql(
      'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
      [key, JSON.stringify(value)],
    );
  } catch (e) {
    console.warn(`[DB] save ${key} failed:`, e);
  }
}
