import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { schema, migrations } from './schema.js';

const DB_PATH = path.resolve(process.cwd(), 'partysongs.db');

interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

interface Statement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

class DatabaseWrapper {
  private db: SqlJsDatabase;
  private dbPath: string;

  constructor(db: SqlJsDatabase, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  private save(): void {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  pragma(pragmaStr: string): void {
    this.db.run(`PRAGMA ${pragmaStr}`);
  }

  exec(sql: string): void {
    this.db.exec(sql);
    this.save();
  }

  prepare(sql: string): Statement {
    const db = this.db;
    const wrapper = this;

    return {
      run(...params: unknown[]): RunResult {
        db.run(sql, params as any[]);
        const changes = db.getRowsModified();
        const lastRowIdResult = db.exec('SELECT last_insert_rowid() as id');
        const lastInsertRowid = lastRowIdResult.length > 0
          ? Number(lastRowIdResult[0].values[0][0])
          : 0;
        wrapper.save();
        return { changes, lastInsertRowid };
      },

      get(...params: unknown[]): Record<string, unknown> | undefined {
        const stmt = db.prepare(sql);
        stmt.bind(params as any[]);
        if (!stmt.step()) {
          stmt.free();
          return undefined;
        }
        const row = stmt.getAsObject();
        stmt.free();
        return normalizeRow(row);
      },

      all(...params: unknown[]): Record<string, unknown>[] {
        const results: Record<string, unknown>[] = [];
        const stmt = db.prepare(sql);
        stmt.bind(params as any[]);
        while (stmt.step()) {
          results.push(normalizeRow(stmt.getAsObject()));
        }
        stmt.free();
        return results;
      },
    };
  }
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = value instanceof Float64Array ? Number(value[0]) : value;
  }
  return normalized;
}

let db: DatabaseWrapper | null = null;

export async function initDb(): Promise<DatabaseWrapper> {
  const SQL = await initSqlJs();
  let sqlDb: SqlJsDatabase;

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    sqlDb = new SQL.Database(buffer);
  } else {
    sqlDb = new SQL.Database();
  }

  db = new DatabaseWrapper(sqlDb, DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run each CREATE TABLE individually to avoid multi-statement issues with sql.js
  const stmts = schema.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const stmt of stmts) {
    db.exec(stmt + ';');
  }

  // Run migrations (ALTER TABLE) - ignore errors if columns already exist
  for (const migration of migrations) {
    try {
      db.exec(migration);
    } catch {
      // Column already exists, ignore
    }
  }

  return db;
}

export function getDb(): DatabaseWrapper {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}
