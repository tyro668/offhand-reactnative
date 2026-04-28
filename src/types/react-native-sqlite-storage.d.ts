declare module 'react-native-sqlite-storage' {
  function enablePromise(enable: boolean): void;

  interface ResultSet {
    rows: {
      length: number;
      item(idx: number): Record<string, any>;
      raw(): any[];
    };
  }

  interface SQLiteDatabase {
    executeSql(
      sql: string,
      params?: any[],
    ): Promise<[ResultSet]>;
  }

  function openDatabase(
    params: {name: string; location?: string},
  ): Promise<SQLiteDatabase>;
}
