const sqlite3 = require("sqlite3").verbose();

const dbPath =
  process.env.NODE_ENV === "production"
    ? "/data/reserve.db"
    : "reserve.db";

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kana TEXT NOT NULL,
      grade TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      guardian_name TEXT,
      note TEXT,
      password TEXT NOT NULL
    )
  `);

  db.run(`
  CREATE TABLE IF NOT EXISTS training_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    body TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS personal_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    event_name TEXT NOT NULL,
    record_display TEXT NOT NULL,
    record_number REAL NOT NULL,
    record_type TEXT NOT NULL,
    meet_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(id)
  )
`);

  db.run(`
    CREATE TABLE IF NOT EXISTS menus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (menu_id) REFERENCES menus(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER,
      plan TEXT NOT NULL,
      slot_id INTEGER,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      parent_name TEXT NOT NULL,
      child_name TEXT NOT NULL,
      child_kana TEXT NOT NULL,
      grade TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      note TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`ALTER TABLE reservations ADD COLUMN status TEXT DEFAULT 'active'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('statusカラム追加エラー:', err);
    }
  });
  db.run(`ALTER TABLE reservations ADD COLUMN member_id INTEGER`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('member_idカラム追加エラー:', err);
    }
  });


  db.run(`
    CREATE TABLE IF NOT EXISTS absences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      absence_date TEXT NOT NULL,
      note TEXT,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`ALTER TABLE absences ADD COLUMN absence_date TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('absence_dateカラム追加エラー:', err);
    }
  });
  
  db.run(`ALTER TABLE absences ADD COLUMN note TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('noteカラム追加エラー:', err);
    }
  });
  
  db.run(`ALTER TABLE absences ADD COLUMN used INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('usedカラム追加エラー:', err);
    }
  });


  db.run(`
    CREATE TABLE IF NOT EXISTS monthly_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      school_name TEXT,
      birth_date TEXT,
      course TEXT NOT NULL,
      start_month TEXT,
      sns_permission TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`ALTER TABLE monthly_entries ADD COLUMN start_month TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('start_monthカラム追加エラー:', err);
    }
  });
  db.run(`ALTER TABLE monthly_entries ADD COLUMN school_name TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('school_nameカラム追加エラー:', err);
    }
  });
  
  db.run(`ALTER TABLE monthly_entries ADD COLUMN birth_date TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('birth_dateカラム追加エラー:', err);
    }
  });
  
  db.run(`ALTER TABLE monthly_entries ADD COLUMN course TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('courseカラム追加エラー:', err);
    }
  });

  db.run(`ALTER TABLE monthly_entries ADD COLUMN sns_permission TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('sns_permissionカラム追加エラー:', err);
    }
  });



});

module.exports = db;