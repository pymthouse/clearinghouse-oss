import postgres, { type Sql } from "postgres";

let sqlSingleton: Sql | null = null;

export function getClearinghouseSql(databaseUrl: string): Sql {
  if (!sqlSingleton) {
    sqlSingleton = postgres(databaseUrl, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
    });
  }
  return sqlSingleton;
}
