require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const Papa = require("papaparse");
const { OpenAI } = require("openai");

const app = express();
const PORT = process.env.PORT || 8080;

// --- 1. CONFIG ---
app.set("trust proxy", 1);
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

const apiKey = process.env.OPENAI_API_KEY;
const client = new OpenAI({ apiKey });

// --- 2. CRITICAL: SYNCHRONOUS DATA LOADING ---
// We define this variable at the top level
let CACHED_DATA = null;

function initializeServerData() {
  try {
    // 1. Construct Path
    const csvPath = path.join(__dirname, "public", "Master_Excel.csv");
    console.log(`[Startup] Loading CSV from: ${csvPath}`);

    // 2. Check existence strictly
    if (!fs.existsSync(csvPath)) {
      throw new Error(`File not found at: ${csvPath}`);
    }

    // 3. Read File (Synchronous - blocks startup until done)
    const fileContent = fs.readFileSync(csvPath, "utf8");

    // 4. Parse (Synchronous)
    const parsed = Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors.length > 0) {
      console.warn("[Startup] CSV Parser warnings:", parsed.errors);
    }

    // 5. Set the global variable
    CACHED_DATA = parsed.data;
    console.log(`[Startup] Success! Loaded ${CACHED_DATA.length} cases.`);

  } catch (err) {
    console.error("[Startup] CRITICAL ERROR: Could not load CSV.");
    console.error(err);
    // If we can't load data, we MUST crash the container so Cloud Run knows it failed.
    // Do not start the server.
    process.exit(1); 
  }
}

// LOAD DATA BEFORE STARTING SERVER
initializeServerData();


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
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// --- 4. START LISTENER ---
// We only listen AFTER the sync data load above has finished without error.
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Data Status: ${CACHED_DATA ? "READY" : "NOT READY"}`);
});