const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'geotagging.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_filename TEXT,
    item_tag TEXT NOT NULL,
    location TEXT,
    note TEXT,
    latitude TEXT,
    longitude TEXT,
    altitude TEXT,
    datetime_taken TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE INDEX IF NOT EXISTS idx_item_tag ON photos(item_tag);
  CREATE INDEX IF NOT EXISTS idx_location ON photos(location);
  CREATE INDEX IF NOT EXISTS idx_created_at ON photos(created_at);
`);

module.exports = db;
