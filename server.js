const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const path = require("path");

const app = express();
const prod = process.env.NODE_ENV === "production";
const SECRET = process.env.JWT_SECRET;
if (!SECRET || !process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL and JWT_SECRET");
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: prod ? { rejectUnauthorized: false } : false,
});

app.use(express.json());
app.use(cookieParser());
app.use("/api", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
app.use(express.static(path.join(__dirname, "public")));

const emailOk = (e) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const setToken = (res, user) =>
  res.cookie("token", jwt.sign({ id: user.id, email: user.email }, SECRET, { expiresIn: "7d" }), {
    httpOnly: true, sameSite: "lax", secure: prod, maxAge: 7 * 864e5,
  });

function auth(req, res, next) {
  try { req.user = jwt.verify(req.cookies.token, SECRET); next(); }
  catch { res.status(401).json({ error: "Please log in." }); }
}

app.get("/api/health", (_, res) => res.json({ ok: true }));

app.post("/api/signup", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || name.trim().length < 2) return res.status(400).json({ error: "Enter your name." });
  if (!emailOk(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (typeof password !== "string" || password.length < 8)
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      "INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email",
      [name.trim(), email.toLowerCase(), hash]);
    setToken(res, r.rows[0]);
    res.status(201).json({ user: r.rows[0] });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "An account with this email already exists." });
    console.error(e); res.status(500).json({ error: "Something went wrong. Try again." });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!emailOk(email) || typeof password !== "string")
    return res.status(400).json({ error: "Enter your email and password." });
  try {
    const r = await pool.query("SELECT * FROM users WHERE email=$1", [email.toLowerCase()]);
    const u = r.rows[0];
    if (!u || !(await bcrypt.compare(password, u.password_hash)))
      return res.status(401).json({ error: "Incorrect email or password." });
    setToken(res, u);
    res.json({ user: { id: u.id, name: u.name, email: u.email } });
  } catch (e) { console.error(e); res.status(500).json({ error: "Something went wrong. Try again." }); }
});

app.post("/api/logout", (_, res) => { res.clearCookie("token"); res.json({ ok: true }); });

app.get("/api/me", auth, async (req, res) => {
  const r = await pool.query("SELECT id,name,email FROM users WHERE id=$1", [req.user.id]);
  r.rows[0] ? res.json({ user: r.rows[0] }) : res.status(401).json({ error: "Please log in." });
});

// Title autocomplete via TMDB (needs TMDB_API_KEY; returns [] if not set)
const GENRE_MAP = {28:"Action",12:"Adventure",16:"Animation",35:"Comedy",80:"Crime",99:"Documentary",18:"Drama",10751:"Family",14:"Fantasy",27:"Horror",10402:"Musical",9648:"Mystery",10749:"Romance",878:"Sci-Fi",53:"Thriller",10752:"War",37:"Western",10759:"Action",10765:"Sci-Fi",10764:"Reality",10768:"War"};
app.get("/api/search", auth, async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 80);
  if (q.length < 2 || !process.env.TMDB_API_KEY) return res.json({ results: [] });
  try {
    const r = await fetch("https://api.themoviedb.org/3/search/multi?include_adult=false&query=" + encodeURIComponent(q) +
      "&api_key=" + encodeURIComponent(process.env.TMDB_API_KEY));
    if (!r.ok) return res.json({ results: [] });
    const d = await r.json();
    const results = (d.results || []).filter((x) => x.media_type === "movie" || x.media_type === "tv").slice(0, 8).map((x) => ({
      title: x.title || x.name,
      year: (x.release_date || x.first_air_date || "").slice(0, 4),
      type: x.media_type === "tv" ? "Series" : "Movie",
      genre: (x.genre_ids || []).map((g) => GENRE_MAP[g]).find(Boolean) || "",
      poster: x.poster_path ? "https://image.tmdb.org/t/p/w92" + x.poster_path : "",
    }));
    res.json({ results });
  } catch (e) { res.json({ results: [] }); }
});

// My List CRUD (scoped to the logged-in user)
const validItem = (b) => b && typeof b.title === "string" && b.title.trim().length > 0 && b.title.length <= 120;
const STATUS = ["want", "watching", "watched"];
const num = (v, lo, hi) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
const ex = (b) => [num(b.year, 1888, 2100), num(b.rating, 1, 5), String(b.note || "").slice(0, 300)];

app.get("/api/list", auth, async (req, res) => {
  const r = await pool.query("SELECT id,title,genre,status,year,rating,note FROM list_items WHERE user_id=$1 ORDER BY id DESC", [req.user.id]);
  res.json({ items: r.rows });
});
app.post("/api/list", auth, async (req, res) => {
  if (!validItem(req.body)) return res.status(400).json({ error: "Enter a title (max 120 characters)." });
  const { title, genre = "", status = "want" } = req.body;
  if (!STATUS.includes(status)) return res.status(400).json({ error: "Invalid status." });
  const r = await pool.query(
    "INSERT INTO list_items(user_id,title,genre,status,year,rating,note) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,title,genre,status,year,rating,note",
    [req.user.id, title.trim(), String(genre).slice(0, 40), status, ...ex(req.body)]);
  res.status(201).json({ item: r.rows[0] });
});
app.put("/api/list/:id", auth, async (req, res) => {
  if (!validItem(req.body)) return res.status(400).json({ error: "Enter a title (max 120 characters)." });
  const { title, genre = "", status = "want" } = req.body;
  if (!STATUS.includes(status)) return res.status(400).json({ error: "Invalid status." });
  const r = await pool.query(
    "UPDATE list_items SET title=$1,genre=$2,status=$3,year=$4,rating=$5,note=$6 WHERE id=$7 AND user_id=$8 RETURNING id,title,genre,status,year,rating,note",
    [title.trim(), String(genre).slice(0, 40), status, ...ex(req.body), req.params.id, req.user.id]);
  r.rows[0] ? res.json({ item: r.rows[0] }) : res.status(404).json({ error: "Not found." });
});
app.delete("/api/list/:id", auth, async (req, res) => {
  const r = await pool.query("DELETE FROM list_items WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
  r.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: "Not found." });
});

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS list_items(
      id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, genre TEXT DEFAULT '', status TEXT DEFAULT 'want');
    ALTER TABLE list_items ADD COLUMN IF NOT EXISTS year INT;
    ALTER TABLE list_items ADD COLUMN IF NOT EXISTS rating INT;
    ALTER TABLE list_items ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';`);
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log("Running on " + port));
})().catch((e) => { console.error(e); process.exit(1); });
