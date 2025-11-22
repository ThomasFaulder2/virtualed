// server.js

require("dotenv").config();
const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");
const fetch = require("node-fetch");
const app = express();
const PORT = process.env.PORT || 8080;

// === CSV from Google Cloud Storage ===
const CSV_URL = "https://storage.googleapis.com/virtualed-466321_cloudbuild/Master_Excel.csv";
// Parse JSON bodies (for /api/chat)
app.use(bodyParser.json());

// --- Proxy route for your Master_Excel.csv ---
app.get("/api/master-csv", async (req, res) => {
  try {
    console.log("Fetching CSV from:", CSV_URL);

    const response = await fetch(CSV_URL); // Node 18+ has global fetch
    if (!response.ok) {
      const text = await response.text();
      console.error("GCS fetch failed:", response.status, text);
      return res.status(500).send("Failed to fetch CSV from GCS");
    }

    const csv = await response.text();
    console.log("CSV fetched OK, length:", csv.length);

    res.type("text/csv").send(csv);
  } catch (err) {
    console.error("Error fetching CSV:", err);
    res.status(500).send("Server error fetching CSV");
  }
});

// --- OpenAI / AI history chat endpoint ---
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/api/chat", async (req, res) => {
  try {
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
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
