const dotenv = require("dotenv").config();

const path = require("path");
const fs = require("fs").promises;
const express = require("express");

const { OpenAI } = require("openai");
const fetch = require("node-fetch");
const app = express();
const PORT = 8080;

// --- 1. CONFIG ---
app.set("trust proxy", 1);
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

const apiKey = process.env.OPENAI_API_KEY;
const client = new OpenAI({ apiKey });

const CSV_URL = "https://storage.googleapis.com/virtualed-466321_cloudbuild/Master_Excel.csv";
const LOCAL_CSV_PATH = path.join(__dirname, "public", "Master_Excel.csv");

// In-memory cache (per container instance)
let cachedCsv = null;
let cachedSource = null;   // "remote" | "local" | null
let cachedUpdatedAt = null;

// Load local CSV on startup (best-effort)
(async () => {
  try {
    const text = await fs.readFile(LOCAL_CSV_PATH, "utf8");
    cachedCsv = text;
    cachedSource = "local";
    cachedUpdatedAt = new Date();
    console.log("Loaded local CSV at startup from", LOCAL_CSV_PATH);
  } catch (err) {
    console.error("Could not load local CSV on startup:", err);
  }
})();

// Helper: try remote, fall back to cache/local
async function getCsvWithFallback() {
  // 1. Try remote
  try {
    console.log("Attempting remote CSV fetch from:", CSV_URL);
    const response = await fetch(CSV_URL);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("Remote CSV fetch failed:", response.status, text.slice(0, 200));
      throw new Error("Remote CSV not OK");
    }

    const csvText = await response.text();
    cachedCsv = csvText;
    cachedSource = "remote";
    cachedUpdatedAt = new Date();

    console.log("Remote CSV fetch succeeded, cache updated");
    return csvText;
  } catch (err) {
    console.error("Error fetching remote CSV, using cache/local if possible:", err.message);

    // 2. Use cached CSV if we have one
    if (cachedCsv) {
      console.log(`Serving cached CSV from ${cachedSource}, last updated at ${cachedUpdatedAt.toISOString()}`);
      return cachedCsv;
    }

    // 3. As a last resort, read local file synchronously now
    try {
      console.log("No cache yet – reading local CSV file as fallback");
      const text = await fs.readFile(LOCAL_CSV_PATH, "utf8");
      cachedCsv = text;
      cachedSource = "local";
      cachedUpdatedAt = new Date();
      return text;
    } catch (localErr) {
      console.error("Failed to read local CSV fallback:", localErr);
      // Truly nothing left to serve
      throw new Error("No CSV available from remote or local");
    }
  }
}

// --- API ROUTE: /api/master-csv ---
app.get("/master-csv", async (req, res) => {
  console.log("GET /api/master-csv");
  try {
    const response = await fetch(CSV_URL);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("GCS fetch failed:", response.status, text.slice(0, 200));
      return res.status(502).json({ error: "Upstream CSV fetch failed" });
    }

    const csvText = await response.text();
    res.type("text/csv").send(csvText);
  } catch (err) {
    console.error("Error in /api/master-csv:", err);
    res.status(500).json({ error: "Unable to provide CSV at this time" });
  }
});
// --- serve static frontend (public folder) ---
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// OPTIONAL: SPA catch-all – put this LAST
app.get("*", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});


// --- 2. CRITICAL: SYNCHRONOUS DATA LOADING ---
// We define this variable at the top level
let CACHED_DATA = null;


// --- 3. ENDPOINTS ---

// Cloud Run Health Check
// We check if data exists. If not, we tell Cloud Run "I am not ready".
app.get("/healthz", (req, res) => {
  if (!CACHED_DATA || CACHED_DATA.length === 0) {
    return res.status(503).send("Data not loaded");
  }
  res.status(200).send("ok");
});

app.get("/api/cases", (req, res) => {
  // Double safety check
  if (!CACHED_DATA) {
     return res.status(503).json({ error: "Server starting up, please retry." });
  }
  res.json(CACHED_DATA);
});

// Chat Endpoint
async function callOpenAIWithRetry(messages, maxRetries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 500,
      }, { timeout: 15000 });
      return completion.choices[0]?.message?.content || "";
    } catch (err) {
      lastErr = err;
      const status = err.status || 500;
      console.error(`OpenAI Attempt ${attempt} failed: ${err.message}`);
      if (status < 500 && status !== 429) throw err;
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
    }
  }
  throw lastErr;
}

app.post("/api/chat", async (req, res) => {
  try {
    if (!apiKey) return res.status(500).json({ error: "Missing API Key" });
    
    const userMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const systemMsg = userMessages.find(m => m.role === 'system');
    const conversation = userMessages.filter(m => m.role !== 'system');

    const finalSystem = systemMsg || { role: "system", content: "You are a helpful assistant." };
    const messages = [finalSystem, ...conversation.slice(-10)];

    const reply = await callOpenAIWithRetry(messages);
    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(err.status || 500).json({ error: "OpenAI error" });
  }
});

// Static Files

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// --- 4. START LISTENER ---
// We only listen AFTER the sync data load above has finished without error.
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Data Status: ${CACHED_DATA ? "READY" : "NOT READY"}`);
});