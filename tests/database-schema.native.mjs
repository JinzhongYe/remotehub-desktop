// npm run build && ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron tests/database-schema.native.mjs
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SqliteAdapter } from '../dist-electron/main/services/database/sqlite.js'

async function check() {
  const db = new Database(':memory:')
  const adapter = new SqliteAdapter(db, 'SQLite native regression')
  try {
    db.exec(`
      CREATE TABLE parents (a TEXT, b INTEGER, PRIMARY KEY (a, b)) WITHOUT ROWID;
      CREATE TABLE cells (id INTEGER PRIMARY KEY, a TEXT, b INTEGER CHECK (b > 0), FOREIGN KEY (a, b) REFERENCES parents(a, b) ON UPDATE CASCADE ON DELETE SET NULL);
      CREATE UNIQUE INDEX idx_cells ON cells (lower(a), b DESC) WHERE b > 1;
      CREATE TRIGGER cells_insert AFTER INSERT ON cells BEGIN SELECT 1; END;
      CREATE VIEW cell_view AS SELECT id, a FROM cells;
      CREATE TABLE no_indexes (value TEXT);
      ATTACH ':memory:' AS "aux""{{table}}";
      CREATE TABLE "aux""{{table}}".cells (other TEXT);
      CREATE INDEX "aux""{{table}}".idx_other ON cells (other);
    `)
    const indexes = await adapter.listTableDetails('main', 'cells', 'indexes')
    assert.equal(indexes.rows.length, 2)
    assert.deepEqual(indexes.rows[0].slice(0, 7), ['idx_cells', 1, 'c', 1, 1, '<expression>', 0])
    assert.equal(indexes.rows[1][6], 1)
    assert.match(indexes.rows[0][8], /lower\(a\)/)
    const attached = await adapter.listTableDetails('aux"{{table}}', 'cells', 'indexes')
    assert.equal(attached.rows[0][0], 'idx_other')
    assert.equal(attached.rows[0][5], 'other')
    const foreignKeys = await adapter.listTableDetails('main', 'cells', 'foreignKeys')
    assert.deepEqual(foreignKeys.rows, [[0, 1, 'a', 'parents', 'a', 'CASCADE', 'SET NULL', 'NONE'], [0, 2, 'b', 'parents', 'b', 'CASCADE', 'SET NULL', 'NONE']])
    const checks = await adapter.listTableDetails('main', 'cells', 'checks')
    assert.equal(checks.notice, 'sqliteCheckDefinitions')
    assert.match(checks.rows[0][1], /CHECK \(b > 0\)/)
    const triggers = await adapter.listTableDetails('main', 'cells', 'triggers')
    assert.equal(triggers.rows[0][0], 'cells_insert')
    assert.match(triggers.rows[0][1], /AFTER INSERT/)
    const advanced = await adapter.listTableDetails('main', 'cell_view', 'advanced')
    assert.equal(advanced.rows[0][1], 'view')
    assert.match(advanced.rows[0][2], /CREATE VIEW/)
    assert.deepEqual((await adapter.listTableDetails('main', 'no_indexes', 'indexes')).rows, [])
    assert.equal(db.prepare('SELECT COUNT(*) FROM cells').pluck().get(), 0)
    console.log('Passed: native SQLite indexes, composite foreign keys, CHECK SQL, triggers, views and attached-schema isolation')
  } finally { adapter.close() }
}
check().catch((error) => { console.error(error); process.exitCode = 1 })
