const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'];
const db = new Database(process.env.DB_PATH || 'ats.db');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS candidates(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  phone TEXT DEFAULT '', role TEXT NOT NULL, skills TEXT DEFAULT '', experience REAL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'Applied', notes TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS stage_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER REFERENCES candidates(id) ON DELETE CASCADE,
  from_stage TEXT, to_stage TEXT, changed_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_stage ON candidates(stage);
`);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function clean(b, partial = false) {
  const e = [];
  const o = {};
  const s = (k) => (b[k] == null ? undefined : String(b[k]).trim());
  o.name = s('name'); o.email = s('email')?.toLowerCase(); o.role = s('role');
  o.phone = s('phone') ?? ''; o.skills = s('skills') ?? ''; o.notes = s('notes') ?? '';
  o.experience = b.experience === '' || b.experience == null ? 0 : Number(b.experience);
  o.stage = s('stage') || 'Applied';
  if (!o.name) e.push('name is required');
  if (!o.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) e.push('valid email is required');
  if (!o.role) e.push('role is required');
  if (Number.isNaN(o.experience) || o.experience < 0) e.push('experience must be a number >= 0');
  if (!STAGES.includes(o.stage)) e.push('invalid stage');
  return { o, e };
}

const wrap = (fn) => (req, res) => {
  try { fn(req, res); }
  catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ errors: ['email already exists'] });
    console.error(err); res.status(500).json({ errors: ['server error'] });
  }
};

app.get('/api/stages', (_, res) => res.json(STAGES));

app.get('/api/candidates', wrap((req, res) => {
  const { q = '', stage = '', role = '', sort = 'created_at', order = 'desc' } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const cols = ['name', 'email', 'role', 'stage', 'experience', 'created_at'];
  const sortCol = cols.includes(sort) ? sort : 'created_at';
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  const where = []; const p = {};
  if (q) { where.push('(name LIKE @q OR email LIKE @q OR skills LIKE @q OR role LIKE @q)'); p.q = `%${q}%`; }
  if (STAGES.includes(stage)) { where.push('stage = @stage'); p.stage = stage; }
  if (role) { where.push('role = @role'); p.role = role; }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM candidates ${w}`).get(p).c;
  const rows = db.prepare(`SELECT * FROM candidates ${w} ORDER BY ${sortCol} ${dir} LIMIT @limit OFFSET @offset`)
    .all({ ...p, limit, offset: (page - 1) * limit });
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) });
}));

app.get('/api/candidates/:id', wrap((req, res) => {
  const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ errors: ['not found'] });
  c.history = db.prepare('SELECT * FROM stage_history WHERE candidate_id=? ORDER BY id DESC').all(c.id);
  res.json(c);
}));

app.post('/api/candidates', wrap((req, res) => {
  const { o, e } = clean(req.body);
  if (e.length) return res.status(400).json({ errors: e });
  const r = db.prepare(`INSERT INTO candidates(name,email,phone,role,skills,experience,stage,notes)
    VALUES(@name,@email,@phone,@role,@skills,@experience,@stage,@notes)`).run(o);
  db.prepare('INSERT INTO stage_history(candidate_id,from_stage,to_stage) VALUES(?,?,?)').run(r.lastInsertRowid, null, o.stage);
  res.status(201).json(db.prepare('SELECT * FROM candidates WHERE id=?').get(r.lastInsertRowid));
}));

app.put('/api/candidates/:id', wrap((req, res) => {
  const cur = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ errors: ['not found'] });
  const { o, e } = clean({ ...cur, ...req.body });
  if (e.length) return res.status(400).json({ errors: e });
  db.prepare(`UPDATE candidates SET name=@name,email=@email,phone=@phone,role=@role,skills=@skills,
    experience=@experience,stage=@stage,notes=@notes,updated_at=CURRENT_TIMESTAMP WHERE id=@id`).run({ ...o, id: cur.id });
  if (o.stage !== cur.stage)
    db.prepare('INSERT INTO stage_history(candidate_id,from_stage,to_stage) VALUES(?,?,?)').run(cur.id, cur.stage, o.stage);
  res.json(db.prepare('SELECT * FROM candidates WHERE id=?').get(cur.id));
}));

app.patch('/api/candidates/:id/stage', wrap((req, res) => {
  const { stage } = req.body;
  if (!STAGES.includes(stage)) return res.status(400).json({ errors: ['invalid stage'] });
  const cur = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ errors: ['not found'] });
  if (cur.stage !== stage) {
    db.prepare('UPDATE candidates SET stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(stage, cur.id);
    db.prepare('INSERT INTO stage_history(candidate_id,from_stage,to_stage) VALUES(?,?,?)').run(cur.id, cur.stage, stage);
  }
  res.json(db.prepare('SELECT * FROM candidates WHERE id=?').get(cur.id));
}));

app.delete('/api/candidates/:id', wrap((req, res) => {
  const r = db.prepare('DELETE FROM candidates WHERE id=?').run(req.params.id);
  res.status(r.changes ? 204 : 404).end();
}));

app.get('/api/metrics', wrap((_, res) => {
  const total = db.prepare('SELECT COUNT(*) c FROM candidates').get().c;
  const byStage = Object.fromEntries(STAGES.map((s) => [s, 0]));
  db.prepare('SELECT stage, COUNT(*) c FROM candidates GROUP BY stage').all().forEach((r) => (byStage[r.stage] = r.c));
  const reached = Object.fromEntries(STAGES.map((s) => [s, 0]));
  db.prepare('SELECT to_stage s, COUNT(DISTINCT candidate_id) c FROM stage_history GROUP BY to_stage').all().forEach((r) => (reached[r.s] = r.c));
  const byRole = db.prepare("SELECT role, COUNT(*) c, COALESCE(SUM(stage='Hired'),0) hired FROM candidates GROUP BY role ORDER BY c DESC").all();
  const timeline = db.prepare("SELECT date(created_at) d, COUNT(*) c FROM candidates WHERE created_at >= date('now','-13 days') GROUP BY d").all();
  const byExp = db.prepare(`SELECT CASE WHEN experience<2 THEN 'Junior (0-1 yrs)' WHEN experience<5 THEN 'Mid (2-4 yrs)' ELSE 'Senior (5+ yrs)' END l, COUNT(*) c
    FROM candidates GROUP BY l ORDER BY MIN(experience)`).all();
  const sk = {};
  db.prepare('SELECT skills FROM candidates').all().forEach((r) => r.skills.split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => (sk[x] = (sk[x] || 0) + 1)));
  const topSkills = Object.entries(sk).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([skill, c]) => ({ skill, c }));
  const last7 = db.prepare("SELECT COUNT(*) c FROM candidates WHERE created_at >= datetime('now','-7 days')").get().c;
  const avg = db.prepare(`SELECT AVG(julianday(h.changed_at)-julianday(c.created_at)) d FROM stage_history h
    JOIN candidates c ON c.id=h.candidate_id WHERE h.to_stage='Hired'`).get().d;
  res.json({ total, active: total - byStage.Hired - byStage.Rejected, byStage, reached, byRole, timeline, byExp, topSkills, last7,
    hireRate: total ? +((byStage.Hired / total) * 100).toFixed(1) : 0, avgDaysToHire: avg == null ? null : +avg.toFixed(1) });
}));

if (db.prepare('SELECT COUNT(*) c FROM candidates').get().c === 0 && process.env.SEED !== '0') {
  const seed = [
    ['Aarav Mehta', 'Backend Engineer', 'Node.js, PostgreSQL', 3, 'Interview', 2],
    ['Diya Nair', 'Frontend Engineer', 'React, TypeScript', 2, 'Screening', 1],
    ['Rohan Gupta', 'Data Analyst', 'SQL, Power BI', 1, 'Applied', 0],
    ['Sneha Rao', 'ML Engineer', 'Python, PyTorch', 4, 'Offer', 9],
    ['Kiran Shetty', 'Backend Engineer', 'Django, Redis', 5, 'Hired', 12],
    ['Meera Iyer', 'Frontend Engineer', 'Vue, CSS', 1, 'Rejected', 6],
    ['Arjun Reddy', 'ML Engineer', 'Python, NLP', 2, 'Applied', 1],
    ['Priya Das', 'Data Analyst', 'SQL, Tableau', 3, 'Interview', 4],
    ['Vikram Singh', 'Backend Engineer', 'Node.js, Redis', 6, 'Offer', 8],
    ['Ananya Kulkarni', 'Frontend Engineer', 'React, CSS', 0.5, 'Applied', 0],
    ['Harsh Vora', 'Full Stack Intern', 'React, Node.js', 0, 'Screening', 3],
    ['Lakshmi Pillai', 'Data Analyst', 'Excel, SQL', 2, 'Hired', 13],
    ['Nikhil Joshi', 'ML Engineer', 'Python, TensorFlow', 1, 'Rejected', 10],
    ['Tara Menon', 'Full Stack Intern', 'React, Django', 0, 'Interview', 5],
    ['Imran Sheikh', 'Backend Engineer', 'Django, PostgreSQL', 2, 'Screening', 2],
    ['Pooja Hegde', 'Frontend Engineer', 'React, Tailwind', 3, 'Applied', 1],
  ];
  const ins = db.prepare("INSERT INTO candidates(name,email,role,skills,experience,stage,created_at) VALUES(?,?,?,?,?,?,datetime('now',?))");
  const h = db.prepare("INSERT INTO stage_history(candidate_id,from_stage,to_stage,changed_at) VALUES(?,?,?,datetime('now',?))");
  db.transaction(() => seed.forEach(([name, role, skills, exp, stage, days]) => {
    const id = ins.run(name, name.split(' ')[0].toLowerCase() + '@example.com', role, skills, exp, stage, `-${days} days`).lastInsertRowid;
    const path = stage === 'Rejected' ? ['Applied', 'Screening', 'Rejected'] : STAGES.slice(0, STAGES.indexOf(stage) + 1);
    path.forEach((s, k) => h.run(id, k ? path[k - 1] : null, s, `-${Math.max(0, days - k)} days`));
  }))();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ATS running on :${PORT}`));
