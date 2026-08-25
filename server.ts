import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";

// --- Database setup -------------------------------------------------------
const DB_PATH = process.env.DATABASE_URL || "./data/app.db";
try {
  mkdirSync(dirname(DB_PATH), { recursive: true });
} catch {}

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company      TEXT NOT NULL,
    contact_name TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL DEFAULT '',
    plan         TEXT NOT NULL DEFAULT 'Starter',
    owner        TEXT NOT NULL DEFAULT '',
    stage        TEXT NOT NULL DEFAULT 'Kickoff',
    health       TEXT NOT NULL DEFAULT 'on_track',
    arr          INTEGER NOT NULL DEFAULT 0,
    start_date   TEXT NOT NULL DEFAULT '',
    target_date  TEXT NOT NULL DEFAULT '',
    notes        TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    archived     INTEGER NOT NULL DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    phase       TEXT NOT NULL DEFAULT 'Kickoff',
    done        INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL DEFAULT 0
  )
`);

// --- Domain constants -----------------------------------------------------
export const STAGES = ["Kickoff", "Configuration", "Training", "Go-Live", "Onboarded"];

// Default onboarding playbook seeded for every new customer.
const PLAYBOOK: { phase: string; title: string }[] = [
  { phase: "Kickoff", title: "Schedule kickoff call" },
  { phase: "Kickoff", title: "Identify stakeholders & success criteria" },
  { phase: "Kickoff", title: "Share onboarding plan & timeline" },
  { phase: "Configuration", title: "Provision workspace & invite users" },
  { phase: "Configuration", title: "Configure SSO / authentication" },
  { phase: "Configuration", title: "Import initial data" },
  { phase: "Configuration", title: "Set up integrations" },
  { phase: "Training", title: "Admin training session" },
  { phase: "Training", title: "End-user training session" },
  { phase: "Training", title: "Share documentation & resources" },
  { phase: "Go-Live", title: "Production readiness review" },
  { phase: "Go-Live", title: "Go-live sign-off" },
  { phase: "Onboarded", title: "30-day check-in scheduled" },
  { phase: "Onboarded", title: "Handoff to Customer Success" },
];

function seedTasks(customerId: number) {
  const insert = db.prepare(
    "INSERT INTO tasks (customer_id, title, phase, done, position) VALUES (?, ?, ?, 0, ?)"
  );
  PLAYBOOK.forEach((t, i) => insert.run(customerId, t.title, t.phase, i));
}

// --- Sample data (first run only) ----------------------------------------
function seedSampleData() {
  const count = db.query("SELECT COUNT(*) AS c FROM customers").get() as { c: number };
  if (count.c > 0) return;

  const sample = [
    { company: "Northwind Traders", contact_name: "Maya Chen", contact_email: "maya@northwind.io", plan: "Enterprise", owner: "Sunny Lee", stage: "Configuration", health: "on_track", arr: 84000, start: -12, target: 18 },
    { company: "Acme Robotics", contact_name: "Dev Patel", contact_email: "dev@acmerobotics.com", plan: "Growth", owner: "Sunny Lee", stage: "Training", health: "at_risk", arr: 42000, start: -21, target: 6 },
    { company: "Lumen Health", contact_name: "Priya Nair", contact_email: "priya@lumenhealth.co", plan: "Enterprise", owner: "Jordan Diaz", stage: "Kickoff", health: "on_track", arr: 120000, start: -3, target: 40 },
    { company: "Fjord Analytics", contact_name: "Erik Sund", contact_email: "erik@fjord.no", plan: "Growth", owner: "Jordan Diaz", stage: "Go-Live", health: "delayed", arr: 55000, start: -34, target: -2 },
    { company: "Bright Coffee Co.", contact_name: "Tara Ok", contact_email: "tara@brightcoffee.com", plan: "Starter", owner: "Sunny Lee", stage: "Onboarded", health: "on_track", arr: 12000, start: -48, target: -20 },
    { company: "Vela Logistics", contact_name: "Sam Whitfield", contact_email: "sam@vela.io", plan: "Growth", owner: "Alex Kim", stage: "Configuration", health: "on_track", arr: 61000, start: -9, target: 22 },
  ];

  const insert = db.prepare(`
    INSERT INTO customers (company, contact_name, contact_email, plan, owner, stage, health, arr, start_date, target_date, notes)
    VALUES ($company, $contact_name, $contact_email, $plan, $owner, $stage, $health, $arr, $start_date, $target_date, '')
  `);

  const today = new Date();
  const iso = (offsetDays: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  };

  const stageIndex = (s: string) => STAGES.indexOf(s);

  for (const c of sample) {
    const info = insert.run({
      $company: c.company,
      $contact_name: c.contact_name,
      $contact_email: c.contact_email,
      $plan: c.plan,
      $owner: c.owner,
      $stage: c.stage,
      $health: c.health,
      $arr: c.arr,
      $start_date: iso(c.start),
      $target_date: iso(c.target),
    });
    const id = Number(info.lastInsertRowid);
    seedTasks(id);
    // Mark tasks done up to (and partway through) the customer's current stage.
    const reached = stageIndex(c.stage);
    const rows = db.query("SELECT id, phase, position FROM tasks WHERE customer_id = ? ORDER BY position").all(id) as any[];
    for (const r of rows) {
      const pi = stageIndex(r.phase);
      if (pi < reached) db.run("UPDATE tasks SET done = 1 WHERE id = ?", [r.id]);
      else if (pi === reached && Math.random() > 0.5) db.run("UPDATE tasks SET done = 1 WHERE id = ?", [r.id]);
    }
  }
}
seedSampleData();

// --- Helpers --------------------------------------------------------------
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function customerWithProgress(row: any) {
  const stats = db
    .query("SELECT COUNT(*) AS total, COALESCE(SUM(done),0) AS done FROM tasks WHERE customer_id = ?")
    .get(row.id) as { total: number; done: number };
  return {
    ...row,
    tasks_total: stats.total,
    tasks_done: stats.done,
    progress: stats.total ? Math.round((stats.done / stats.total) * 100) : 0,
  };
}

async function body(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

const CUSTOMER_FIELDS = [
  "company", "contact_name", "contact_email", "plan",
  "owner", "stage", "health", "arr", "start_date", "target_date", "notes", "archived",
];

// --- Static file serving --------------------------------------------------
const PUBLIC_DIR = `${import.meta.dir}/public`;

async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = Bun.file(`${PUBLIC_DIR}${rel}`);
  if (await file.exists()) return new Response(file);
  // SPA fallback
  return new Response(Bun.file(`${PUBLIC_DIR}/index.html`));
}

// --- Router ---------------------------------------------------------------
async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  if (!pathname.startsWith("/api/")) return serveStatic(pathname);

  // GET /api/meta
  if (pathname === "/api/meta" && method === "GET") {
    const owners = db.query("SELECT DISTINCT owner FROM customers WHERE owner != '' ORDER BY owner").all() as any[];
    return json({ stages: STAGES, playbook: PLAYBOOK, owners: owners.map((o) => o.owner) });
  }

  // GET /api/customers
  if (pathname === "/api/customers" && method === "GET") {
    const rows = db.query("SELECT * FROM customers WHERE archived = 0 ORDER BY created_at DESC").all() as any[];
    return json(rows.map(customerWithProgress));
  }

  // POST /api/customers
  if (pathname === "/api/customers" && method === "POST") {
    const b = await body(req);
    if (!b.company || !String(b.company).trim()) return json({ error: "Company is required" }, 400);
    const info = db
      .prepare(`INSERT INTO customers (company, contact_name, contact_email, plan, owner, stage, health, arr, start_date, target_date, notes)
                VALUES ($company,$contact_name,$contact_email,$plan,$owner,$stage,$health,$arr,$start_date,$target_date,$notes)`)
      .run({
        $company: String(b.company).trim(),
        $contact_name: b.contact_name || "",
        $contact_email: b.contact_email || "",
        $plan: b.plan || "Starter",
        $owner: b.owner || "",
        $stage: STAGES.includes(b.stage) ? b.stage : "Kickoff",
        $health: b.health || "on_track",
        $arr: Number(b.arr) || 0,
        $start_date: b.start_date || "",
        $target_date: b.target_date || "",
        $notes: b.notes || "",
      });
    const id = Number(info.lastInsertRowid);
    seedTasks(id);
    const row = db.query("SELECT * FROM customers WHERE id = ?").get(id);
    return json(customerWithProgress(row), 201);
  }

  // Match /api/customers/:id and sub-resources
  const custMatch = pathname.match(/^\/api\/customers\/(\d+)(\/tasks)?$/);
  if (custMatch) {
    const id = Number(custMatch[1]);
    const isTasks = !!custMatch[2];
    const exists = db.query("SELECT id FROM customers WHERE id = ?").get(id);
    if (!exists) return json({ error: "Not found" }, 404);

    if (isTasks) {
      // GET tasks
      if (method === "GET") {
        const rows = db.query("SELECT * FROM tasks WHERE customer_id = ? ORDER BY position, id").all(id);
        return json(rows);
      }
      // POST task
      if (method === "POST") {
        const b = await body(req);
        if (!b.title || !String(b.title).trim()) return json({ error: "Title required" }, 400);
        const max = db.query("SELECT COALESCE(MAX(position),0)+1 AS p FROM tasks WHERE customer_id = ?").get(id) as any;
        const info = db
          .prepare("INSERT INTO tasks (customer_id, title, phase, done, position) VALUES (?,?,?,0,?)")
          .run(id, String(b.title).trim(), STAGES.includes(b.phase) ? b.phase : "Kickoff", max.p);
        const row = db.query("SELECT * FROM tasks WHERE id = ?").get(Number(info.lastInsertRowid));
        return json(row, 201);
      }
    } else {
      // GET single customer (with tasks)
      if (method === "GET") {
        const row = db.query("SELECT * FROM customers WHERE id = ?").get(id);
        const tasks = db.query("SELECT * FROM tasks WHERE customer_id = ? ORDER BY position, id").all(id);
        return json({ ...customerWithProgress(row), tasks });
      }
      // PATCH customer
      if (method === "PATCH") {
        const b = await body(req);
        const sets: string[] = [];
        const params: any = { $id: id };
        for (const f of CUSTOMER_FIELDS) {
          if (f in b) {
            if (f === "stage" && !STAGES.includes(b[f])) continue;
            sets.push(`${f} = $${f}`);
            params[`$${f}`] = f === "arr" || f === "archived" ? Number(b[f]) || 0 : b[f];
          }
        }
        if (sets.length) db.prepare(`UPDATE customers SET ${sets.join(", ")} WHERE id = $id`).run(params);
        const row = db.query("SELECT * FROM customers WHERE id = ?").get(id);
        return json(customerWithProgress(row));
      }
      // DELETE customer
      if (method === "DELETE") {
        db.run("DELETE FROM customers WHERE id = ?", [id]);
        return json({ ok: true });
      }
    }
  }

  // Task update / delete: /api/tasks/:id
  const taskMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);
  if (taskMatch) {
    const id = Number(taskMatch[1]);
    const task = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as any;
    if (!task) return json({ error: "Not found" }, 404);
    if (method === "PATCH") {
      const b = await body(req);
      if ("done" in b) db.run("UPDATE tasks SET done = ? WHERE id = ?", [b.done ? 1 : 0, id]);
      if ("title" in b && String(b.title).trim()) db.run("UPDATE tasks SET title = ? WHERE id = ?", [String(b.title).trim(), id]);
      if ("phase" in b && STAGES.includes(b.phase)) db.run("UPDATE tasks SET phase = ? WHERE id = ?", [b.phase, id]);
      return json(db.query("SELECT * FROM tasks WHERE id = ?").get(id));
    }
    if (method === "DELETE") {
      db.run("DELETE FROM tasks WHERE id = ?", [id]);
      return json({ ok: true });
    }
  }

  return json({ error: "Not found" }, 404);
}

export default {
  port: process.env.PORT || 3000,
  async fetch(req: Request) {
    try {
      return await handle(req);
    } catch (err) {
      console.error(err);
      return json({ error: "Internal error" }, 500);
    }
  },
};

console.log(`Onboard tracker running on port ${process.env.PORT || 3000}`);
