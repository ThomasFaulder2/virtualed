// server.js

require("dotenv").config();
const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");
const fetch = require("node-fetch");
const fs = require("fs").promises;

const app = express();
const PORT = process.env.PORT || 8080;

// --- static frontend dir ---
const publicDir = path.join(__dirname, "public");

// === CSV from Google Cloud Storage ===
const CSV_URL = "https://storage.googleapis.com/virtualed-466321_cloudbuild/Master_Excel.csv";

app.use(bodyParser.json());

// (optional) log all requests to help debug on Cloud Run
app.use((req, res, next) => {
  console.log(req.method, req.url);
  next();
});

// --- Proxy route for your Master_Excel.csv with local fallback ---
app.get("/api/master-csv", async (req, res) => {
  try {
    console.log("Fetching CSV from:", CSV_URL);
    let csv = null;

    // Try GCS first
    try {
      const response = await fetch(CSV_URL);
      if (response.ok) {
        csv = await response.text();
        console.log("CSV fetched OK from GCS, length:", csv.length);
      } else {
        console.error("GCS fetch failed with status:", response.status);
      }
    } catch (err) {
      console.error("Error fetching CSV from GCS:", err);
    }

    // Fallback: read CSV baked into the container
    if (!csv) {
      const localPath = path.join(publicDir, "Master_Excel.csv");
      console.log("Falling back to local CSV:", localPath);
      csv = await fs.readFile(localPath, "utf8");
      console.log("Local CSV length:", csv.length);
    }

    res.type("text/csv").send(csv);
  } catch (err) {
    console.error("Error in /api/master-csv:", err);
    // worst case, send an empty CSV instead of killing the service
    res.type("text/csv").send("");
  }
});

// --- OpenAI / AI history chat endpoint ---
// lazy init so missing OPENAI_API_KEY doesn't crash the whole service
app.post("/api/chat", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY is not set");
      return res
        .status(500)
        .json({ error: "OPENAI_API_KEY not set on the server" });
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

// --- Static frontend (index.html and JS/CSS) ---
app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
