import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

export function openDb(dbPath?: string): DatabaseSync {
  const file =
    dbPath ?? path.join(process.cwd(), 'data', 'kanon.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS datasets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id INTEGER NOT NULL REFERENCES datasets(id),
      version_no INTEGER NOT NULL,
      fields_json TEXT NOT NULL,
      k INTEGER NOT NULL,
      constraints_json TEXT NOT NULL,
      hierarchies_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(dataset_id, version_no)
    );
    CREATE TABLE IF NOT EXISTS records (
      version_id INTEGER NOT NULL REFERENCES versions(id),
      row_id TEXT NOT NULL,
      values_json TEXT NOT NULL,
      PRIMARY KEY(version_id, row_id)
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES versions(id),
      kind TEXT NOT NULL,
      vector_json TEXT NOT NULL,
      loss INTEGER NOT NULL,
      feasible INTEGER NOT NULL,
      groups_json TEXT NOT NULL,
      mapping_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS published (
      version_id INTEGER PRIMARY KEY REFERENCES versions(id),
      vector_json TEXT NOT NULL,
      rows_json TEXT NOT NULL,
      report_id INTEGER NOT NULL REFERENCES reports(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}
