// server.js

require("dotenv").config();
const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const fs = require("fs").promises;

const app = express();
const PORT = process.env.PORT || 8080;

// --- Static frontend dir ---
const publicDir = path.join(__dirname, "public");

// === CSV from Google Cloud Storage ===
const CSV_URL = "https://storage.googleapis.com/virtualed-466321_cloudbuild/Master_Excel.csv";

app.use(bodyParser.json());

// Optional: log requests (helpful on Cloud Run)
app.use((req, res, next) => {
  console.log(req.method, req.url);
  next();
});

// --- Proxy route for Master_Excel.csv with safe fallback ---
app.get("/api/master-csv", async (req, res) => {
  try {
    let csvText = null;

    // Try GCS first if fetch is available
    if (typeof fetch === "function") {
      try {
        console.log("Trying to fetch CSV from GCS:", CSV_URL);
        const response = await fetch(CSV_URL);

        if (response.ok) {
          csvText = await response.text();
          console.log("Fetched CSV from GCS, length:", csvText.length);
        } else {
          console.error("GCS fetch failed, status:", response.status);
        }
      } catch (err) {
        console.error("Error contacting GCS:", err);
      }
    } else {
      console.warn("Global fetch is not available, skipping GCS fetch.");
    }

    // Fallback to local CSV baked into the image
    if (!csvText) {
      const localPath = path.join(publicDir, "Master_Excel.csv");
      console.log("Falling back to local CSV:", localPath);
      csvText = await fs.readFile(localPath, "utf8");
      console.log("Local CSV length:", csvText.length);
    }

    res.type("text/csv").send(csvText);
  } catch (err) {
    // Final fallback: avoid crashing the service – at worst return empty CSV
    console.error("Error in /api/master-csv:", err);
    res.type("text/csv").send("");
  }
});

// --- OpenAI / AI history chat endpoint ---
// Lazy require inside the handler so a missing openai package / env var
// does NOT crash the whole container startup.
app.post("/api/chat", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY is not set");
      return res.status(500).json({ error: "OPENAI_API_KEY not set on server" });
    }

    let OpenAI;
    try {
      ({ OpenAI } = require("openai"));
    } catch (e) {
      console.error("openai package is not installed or cannot be required:", e);
      return res.status(500).json({ error: "OpenAI client not available on server" });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const userMessages = req.body.messages || [];
    const messages = [
      {
        role: "system",
        content:
          "You are roleplaying as a patient for a medical student. " +
          "Answer as the patient, giving history details only. " +
          "Do NOT give diagnoses, investigations or management."
      },
      ...userMessages
    ];

    const completion = await client.chat.completions.create({
      model: "gpt-5.1-mini",
      messages
    });

    const reply = completion.choices[0]?.message?.content || "No reply generated.";
    res.json({ reply });
  } catch (err) {
    console.error("OpenAI chat error:", err);
    res.status(500).json({ error: "OpenAI chat error" });
  }
});

// --- Static frontend (index.html and assets) ---
app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
