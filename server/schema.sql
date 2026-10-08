-- אקורדי – מסד הנתונים של שרת הסטטיסטיקה (Cloudflare D1)
-- מכשיר = מספר אקראי שנוצר באפליקציה. בלי מייל, בלי שם, בלי כתובת IP.
CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, first TEXT NOT NULL, last TEXT NOT NULL, u TEXT);
CREATE INDEX IF NOT EXISTS devices_u ON devices(u);
-- סיכום יומי אחד לכל מכשיר
CREATE TABLE IF NOT EXISTS daily (
  day TEXT NOT NULL, id TEXT NOT NULL,
  v TEXT, dv TEXT, os TEXT, br TEXT, cc TEXT,
  st INTEGER, li INTEGER, dk INTEGER, ins TEXT,
  ns INTEGER, nf INTEGER, he INTEGER, en INTEGER,
  ev TEXT, bn TEXT,
  PRIMARY KEY (day, id));
CREATE INDEX IF NOT EXISTS daily_day ON daily(day);
-- שגיאות: הודעת השגיאה בלבד, כמה מכשירים בכל יום
CREATE TABLE IF NOT EXISTS errors (day TEXT NOT NULL, msg TEXT NOT NULL, v TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, msg, v));
-- משובים שמשתמשים שולחים מההגדרות
CREATE TABLE IF NOT EXISTS feedback (fid INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, id TEXT, v TEXT, text TEXT NOT NULL, email TEXT, done INTEGER NOT NULL DEFAULT 0);
-- הודעה לכל המשתמשים (שורה אחת)
CREATE TABLE IF NOT EXISTS msg (k INTEGER PRIMARY KEY CHECK (k=1), mid INTEGER NOT NULL, text TEXT NOT NULL, until INTEGER);
