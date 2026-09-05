import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

class Statement {
  params: SQLInputValue[] = [];
  constructor(readonly db: SQLiteD1, readonly sql: string) {}
  bind(...params: SQLInputValue[]) { this.params = params; return this; }
  execute() {
    const statement = this.db.sqlite.prepare(this.sql);
    if (statement.columns().length > 0) return { results: statement.all(...this.params), meta: { changes: 0 } };
    const result = statement.run(...this.params);
    return { results: [], meta: { changes: Number(result.changes) } };
  }
  async first() { return this.execute().results[0] ?? null; }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
}

/** Execute the production SQL, including triggers/FKs and atomic D1 batches. */
export class SQLiteD1 {
  readonly sqlite = new DatabaseSync(':memory:');
  readonly batches: Statement[][] = [];
  beforeBatch?: () => Promise<void>;
  constructor() {
    this.sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  }
  get binding(): D1Database { return this as unknown as D1Database; }
  prepare(sql: string) { return new Statement(this, sql); }
  async batch(statements: Statement[]) {
    await this.beforeBatch?.();
    this.batches.push(statements);
    this.sqlite.exec('BEGIN');
    try {
      const result = statements.map(statement => statement.execute());
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}
