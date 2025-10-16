import express from 'express';
import session from 'express-session';
import SQLiteStoreFactory from 'connect-sqlite3';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import helmet from 'helmet';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", 'data:']
    }
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessions
const SQLiteStore = SQLiteStoreFactory(session);
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, 'db') }),
  secret: process.env.SESSION_SECRET || 'replace-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 14 }
}));

// DB init
const db = new Database(path.join(__dirname, 'db', 'database.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  is_solved INTEGER NOT NULL DEFAULT 0,
  solved_at INTEGER,
  PRIMARY KEY (user_id, level),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

const LEVELS = [
  { id: 1, prompt: 'I speak without a mouth and hear without ears. What am I?', answer: 'echo' },
  { id: 2, prompt: 'Find the hidden word in: C R Y P T I C — remove edges, read center.', answer: 'rypti' },
  { id: 3, prompt: 'An anagram of “LISTEN” that is a verb.', answer: 'silent' },
  { id: 4, prompt: 'Binary 01101000 01110101 01101110 01110100', answer: 'hunt' },
  { id: 5, prompt: 'Clock puzzle: 3:15 angle smaller one?', answer: '7.5' },
  { id: 6, prompt: 'Vigenere key=RING. Cipher: VYYMZ QN. Plain?', answer: 'solve me' },
  { id: 7, prompt: 'Acrostic of: Hidden Under Nightfall Trail', answer: 'hunt' },
  { id: 8, prompt: 'MD5 of answer is 5d41402abc4b2a76b9719d911017c592', answer: 'hello' },
  { id: 9, prompt: 'Roman: XIV + VI = ?', answer: '20' },
  { id: 10, prompt: 'Final: keyword from levels 1,4,7 combined.', answer: 'echohunthunt' }
];

const norm = s => (s || '').toString().trim().toLowerCase();

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'missing' });
  if (username.length < 3 || username.length > 24) return res.status(400).json({ error: 'username_length' });
  if (password.length < 6) return res.status(400).json({ error: 'password_length' });

  try {
    const id = nanoid();
    const hash = await bcrypt.hash(password, 12);
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(id, username, hash, Date.now());

    const insert = db.prepare('INSERT INTO progress (user_id, level, is_solved) VALUES (?, ?, 0)');
    const tx = db.transaction((uid) => {
      for (let i = 1; i <= LEVELS.length; i++) insert.run(uid, i);
    });
    tx(id);

    req.session.user = { id, username };
    res.json({ ok: true, user: { id, username } });
  } catch (e) {
    if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'username_taken' });
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'missing' });
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row) return res.status(401).json({ error: 'invalid' });
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid' });
  req.session.user = { id: row.id, username: row.username };
  res.json({ ok: true, user: { id: row.id, username: row.username } });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => {
  const { id, username } = req.session.user;
  const prog = db.prepare('SELECT level, is_solved, solved_at FROM progress WHERE user_id = ? ORDER BY level ASC').all(id);
  const highestSolved = Math.max(0, ...prog.filter(p => p.is_solved).map(p => p.level));
  res.json({ user: { id, username }, highestSolved, totalLevels: LEVELS.length, progress: prog });
});

app.get('/api/level/:level', requireAuth, (req, res) => {
  const n = Number(req.params.level);
  if (!Number.isInteger(n) || n < 1 || n > LEVELS.length) return res.status(400).json({ error: 'bad_level' });
  const { id } = req.session.user;
  const prog = db.prepare('SELECT level, is_solved FROM progress WHERE user_id = ? ORDER BY level ASC').all(id);
  const highestSolved = Math.max(0, ...prog.filter(p => p.is_solved).map(p => p.level));
  if (n > highestSolved + 1) return res.status(403).json({ error: 'locked' });
  const prompt = LEVELS[n - 1].prompt;
  const is_solved = prog.find(p => p.level === n)?.is_solved === 1;
  res.json({ level: n, prompt, is_solved });
});

app.post('/api/answer', requireAuth, (req, res) => {
  const { level, answer } = req.body;
  const n = Number(level);
  if (!Number.isInteger(n) || n < 1 || n > LEVELS.length) return res.status(400).json({ error: 'bad_level' });
  const expected = LEVELS[n - 1].answer;
  const correct = norm(answer) === norm(expected);
  const { id } = req.session.user;

  const prog = db.prepare('SELECT level, is_solved FROM progress WHERE user_id = ? ORDER BY level ASC').all(id);
  const highestSolved = Math.max(0, ...prog.filter(p => p.is_solved).map(p => p.level));
  if (n > highestSolved + 1) return res.status(403).json({ error: 'locked' });

  if (correct) {
    const already = db.prepare('SELECT is_solved FROM progress WHERE user_id = ? AND level = ?').get(id, n);
    if (!already || already.is_solved === 0) {
      db.prepare('UPDATE progress SET is_solved = 1, solved_at = ? WHERE user_id = ? AND level = ?')
        .run(Date.now(), id, n);
    }
  }
  res.json({ correct });
});

app.get('/api/leaderboard', (req, res) => {
  const rows = db.prepare(`
    SELECT u.username,
           COALESCE(MAX(CASE WHEN p.is_solved = 1 THEN p.level END), 0) AS solved_levels,
           MIN(CASE WHEN p.is_solved = 1 AND p.level = (
                 SELECT COALESCE(MAX(level),0) FROM progress WHERE user_id = u.id AND is_solved = 1
               ) THEN p.solved_at END) AS tiebreak_ts
    FROM users u
    LEFT JOIN progress p ON p.user_id = u.id
    GROUP BY u.id
    ORDER BY solved_levels DESC, tiebreak_ts ASC NULLS LAST, u.username ASC
    LIMIT 100
  `).all();
  res.json({ leaderboard: rows });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`cryptic hunt running on http://localhost:${PORT}`);
});

