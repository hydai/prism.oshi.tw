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

/** The longest LIKE or GLOB pattern, in UTF-8 bytes, that D1 takes. SQLite's own default is 50,000. */
export const D1_LIKE_PATTERN_LIMIT = 50;

/** Execute the production SQL, including triggers/FKs and atomic D1 batches. */
export class SQLiteD1 {
  readonly sqlite = new DatabaseSync(':memory:');
  readonly batches: Statement[][] = [];
  beforeBatch?: () => Promise<void>;
  /** Runs once a batch has committed. A throw here is a D1 call that rejects although its batch landed. */
  afterBatch?: () => Promise<void>;
  /** Runs each schema file in the order given; with none, the admin worker's schema.sql. */
  constructor(...schemas: URL[]) {
    const files = schemas.length > 0 ? schemas : [new URL('../schema.sql', import.meta.url)];
    for (const schema of files) this.sqlite.exec(readFileSync(schema, 'utf8'));
  }
  get binding(): D1Database { return this as unknown as D1Database; }
  /**
   * Make LIKE refuse a pattern over D1's limit with D1's own error, `LIKE or GLOB pattern too complex`. Plain SQLite
   * allows 50,000 bytes, so a query that D1 rejects passes in these suites; this is opt-in because no other suite has
   * run against the limit. Matching stays SQLite's: the like() installed here checks the pattern's bytes, then hands
   * the call to the built-in like() of a second connection, so `%`, `_`, ASCII-only case folding and ESCAPE read as
   * ever. (The native `db.limits.likePatternLength` is missing from Node 22 and 24.)
   */
  enforceD1LikeLimit() {
    const builtin = new DatabaseSync(':memory:');
    const plain = builtin.prepare('SELECT like(?, ?) AS matched');
    const escaped = builtin.prepare('SELECT like(?, ?, ?) AS matched');
    const refuseLong = (pattern: unknown) => {
      if (typeof pattern === 'string' && Buffer.byteLength(pattern) > D1_LIKE_PATTERN_LIMIT) {
        throw new Error('LIKE or GLOB pattern too complex');
      }
    };
    // `value LIKE pattern` calls like(pattern, value), and with ESCAPE like(pattern, value, escape): replace both.
    this.sqlite.function('like', { deterministic: true }, (pattern, value) => {
      refuseLong(pattern);
      return plain.get(pattern, value)!.matched;
    });
    this.sqlite.function('like', { deterministic: true }, (pattern, value, escape) => {
      refuseLong(pattern);
      return escaped.get(pattern, value, escape)!.matched;
    });
  }
  prepare(sql: string) { return new Statement(this, sql); }
  async batch(statements: Statement[]) {
    await this.beforeBatch?.();
    this.batches.push(statements);
    this.sqlite.exec('BEGIN');
    let result: ReturnType<Statement['execute']>[];
    try {
      result = statements.map(statement => statement.execute());
      this.sqlite.exec('COMMIT');
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
    await this.afterBatch?.();
    return result;
  }
}
