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

// --- DATA STATE AND ASYNC LOAD ---
let CACHED_DATA = null;
let DATA_ERROR = "Data loading has not started yet.";
let isDataLoading = false;

// Function to handle the asynchronous data load
async function loadDataAsync() {
  if (isDataLoading) return; // Prevent multiple simultaneous loads
  isDataLoading = true;
  CACHED_DATA = null;
  DATA_ERROR = "Data is currently loading...";
  
  try {
    const csvPath = path.join(__dirname, "data.csv"); // Assumes data.csv is in root
    console.log("[Data Load] Attempting to read CSV from:", csvPath);

    if (!fs.existsSync(csvPath)) {
      throw new Error(`File not found at: ${csvPath}. Check your .gcloudignore!`);
    }

    // Use asynchronous reading to prevent blocking the entire Node thread
    const fileContent = await fs.promises.readFile(csvPath, "utf8");
    
    // PapaParse still runs synchronously on the content, but the I/O is async
    const parsed = Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
    });

    CACHED_DATA = parsed.data;
    console.log(`[Data Load] SUCCESS. Loaded ${CACHED_DATA.length} rows.`);
    DATA_ERROR = null;
    
  } catch (err) {
    console.error("[Data Load] CRITICAL FAILURE:", err.message);
    DATA_ERROR = err.message;
    CACHED_DATA = null;
  } finally {
    isDataLoading = false;
  }
}

// Kick off the load immediately, but ASYNCHRONOUSLY, so it doesn't block app.listen()
loadDataAsync();


// --- ENDPOINTS ---

// Health Check MUST pass immediately for Cloud Run to route traffic
app.get("/healthz", (req, res) => res.status(200).send("ok"));

app.get("/api/cases", (req, res) => {
  if (DATA_ERROR || !CACHED_DATA) {
    // If data is missing or loading, attempt to reload if not already in progress
    if (!isDataLoading) {
        loadDataAsync();
    }
    
    return res.status(503).json({ 
      error: DATA_ERROR || "Data is not ready yet.",
      fix: "The server is starting up or reloading data. Please wait a moment." 
    });
  }
  res.json(CACHED_DATA);
});

// Chat Logic (omitted for brevity, assume previous code here)
app.post("/api/chat", async (req, res) => {
    // ... [Your previous post /api/chat logic here]
    // Keeping this section short as it's not the cause of the startup error
    try {
        if (!apiKey) return res.status(500).json({ error: "Missing API Key" });
        const userMessages = req.body?.messages || [];
        // [rest of OpenAI logic]
        res.json({ reply: "AI Response Placeholder" });
    } catch (err) {
        res.status(500).json({ error: "AI Error" });
    }
});


// Static Files
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- CRITICAL: START LISTENING IMMEDIATELY ---
// This ensures the container meets the startup timeout requirement.
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Data status after start: ${DATA_ERROR ? 'FAILED' : 'Loading...'}`);
});