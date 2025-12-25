const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');

const app = express();
const db = new sqlite3.Database('database.db');

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: 'uploads/' });

// Initialize DB
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT,
        role TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        number TEXT,
        location TEXT,
        profile TEXT,
        remarks TEXT,
        called INTEGER DEFAULT 0,
        called_by TEXT,
        called_at TEXT,
        assigned_to TEXT
    )`);

    // Default admin
    const hash = bcrypt.hashSync('admin', 10);
    db.get("SELECT * FROM users WHERE username = 'admin'", (err, row) => {
        if (!row) {
            db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", 
                ['admin', hash, 'admin']);
        }
    });
});

// Login
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (user && bcrypt.compareSync(password, user.password)) {
            res.json({ success: true, role: user.role });
        } else {
            res.json({ success: false });
        }
    });
});

// Get candidates for user
app.get('/candidates', (req, res) => {
    const username = req.query.user;
    const role = req.query.role;
    let query = "SELECT * FROM candidates";
    let params = [];
    if (role !== 'admin') {
        query += " WHERE assigned_to = ? OR assigned_to = ''";
        params = [username];
    }
    db.all(query, params, (err, rows) => {
        res.json(rows || []);
    });
});

// Update remark or call
app.post('/update', (req, res) => {
    const { id, remarks, called, called_by, called_at } = req.body;
    db.run(`UPDATE candidates SET remarks = ?, called = ?, called_by = ?, called_at = ? WHERE id = ?`,
        [remarks || "", called || 0, called_by || "", called_at || "", id], (err) => {
            res.json({ success: !err });
        });
});

// Admin: Create user
app.post('/create-user', (req, res) => {
    const { username, password } = req.body;
    const hash = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
        [username, hash, 'telecaller'], (err) => {
            res.json({ success: !err });
        });
});

// Admin: Upload candidates
app.post('/upload', upload.single('file'), (req, res) => {
    const assignTo = req.body.assign_to || "";
    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet);

    const stmt = db.prepare(`INSERT INTO candidates 
        (name, number, location, profile, remarks, called, called_by, called_at, assigned_to) 
        VALUES (?, ?, ?, ?, '', 0, '', '', ?)`);

    json.forEach(row => {
        let name = row.name || row.Name || "";
        let number = (row.mobile || row.Mobile || row.number || row.Phone || "").toString().replace(/[^0-9+]/g, "");
        let location = row.location || row.Location || "";
        let profile = row.profile || row.Profile || "";
        if (name && number.length >= 10) {
            stmt.run(name.trim(), number, location.trim(), profile.trim(), assignTo);
        }
    });

    stmt.finalize();
    require('fs').unlinkSync(filePath);
    res.json({ success: true });
});

// Admin: Get all users (telecallers only)
app.get('/users', (req, res) => {
    db.all("SELECT username FROM users WHERE role = 'telecaller'", (err, rows) => {
        res.json(rows || []);
    });
});

// Admin: Get stats
app.get('/stats', (req, res) => {
    db.all("SELECT * FROM candidates", (err, all) => {
        const total = all.length;
        const called = all.filter(c => c.called).length;
        const userStats = {};
        all.forEach(c => {
            const user = c.assigned_to || "Unassigned";
            if (!userStats[user]) userStats[user] = { total: 0, called: 0 };
            userStats[user].total++;
            if (c.called) userStats[user].called++;
        });
        res.json({ total, called, notCalled: total - called, userStats });
    });
});

app.listen(3000, () => {
    console.log('Telecalling Server running on http://localhost:3000');
    console.log('Admin login: admin / admin');
});