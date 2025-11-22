require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const Papa = require("papaparse");
const { OpenAI } = require("openai");

const app = express();
const PORT = process.env.PORT || 8080;

// --- CONFIG ---
app.set("trust proxy", 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const apiKey = process.env.OPENAI_API_KEY;
const client = new OpenAI({ apiKey });

// --- ROBUST DATA LOADING ---
let CACHED_DATA = [];
let DATA_ERROR = null;

function loadData() {
  try {
    // Look for data.csv in the ROOT folder (simplest path possible)
    const csvPath = path.join(__dirname, "data.csv");
    console.log("[Startup] Reading CSV from:", csvPath);

    if (!fs.existsSync(csvPath)) {
      throw new Error(`File not found at: ${csvPath}`);
    }

    const fileContent = fs.readFileSync(csvPath, "utf8");
    const parsed = Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
    });

    CACHED_DATA = parsed.data;
    console.log(`[Startup] SUCCESS. Loaded ${CACHED_DATA.length} rows.`);
    DATA_ERROR = null;
  } catch (err) {
    console.error("[Startup] CSV LOAD FAILED:", err.message);
    // We do NOT crash. We record the error to show the user later.
    DATA_ERROR = err.message;
    CACHED_DATA = [];
  }
}

// Load immediately
loadData();

// --- ENDPOINTS ---

// Always return 200 OK so Cloud Run lets the container start
app.get("/healthz", (req, res) => res.status(200).send("ok"));

app.get("/api/cases", (req, res) => {
  if (DATA_ERROR) {
    return res.status(500).json({ 
      error: "Server could not load CSV file.", 
      details: DATA_ERROR,
      fix: "Ensure data.csv is in the root folder and redeploy." 
    });
  }
  res.json(CACHED_DATA);
});

// Chat Logic
app.post("/api/chat", async (req, res) => {
  try {
    if (!apiKey) return res.status(500).json({ error: "Missing API Key" });
    
    const userMessages = req.body?.messages || [];
    const systemMsg = userMessages.find(m => m.role === 'system');
    const conversation = userMessages.filter(m => m.role !== 'system');
    const finalSystem = systemMsg || { role: "system", content: "You are a helpful assistant." };
    
    const messages = [finalSystem, ...conversation.slice(-10)];
    
    // Simple retry wrapper
    let reply = "";
    for (let i = 0; i < 3; i++) {
        try {
            const completion = await client.chat.completions.create({
                model: "gpt-4o-mini",
                messages,
                max_tokens: 500,
            }, { timeout: 10000 });
            reply = completion.choices[0]?.message?.content;
            break;
        } catch (e) { 
            console.log(`Retry ${i+1} failed`);
            if (i===2) throw e; 
        }
    }
    
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI Error" });
  }
});

// Static Files
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});