// server.js

// Load environment variables ASAP
require("dotenv").config();

const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");
const fetch = require("node-fetch"); // ensure fetch exists regardless of Node version

// === CONFIG ===
const CSV_URL = "https://storage.googleapis.com/virtualed-466321_cloudbuild/Master_Excel.csv";
const PORT = process.env.PORT || 8080;

// === EXPRESS APP ===
const app = express();
app.use(bodyParser.json());

// --- OpenAI client (do NOT hard-code keys) ---
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // set this in Cloud Run env vars
});

// Simple test / stub chat endpoint
app.post("/api/chat", (req, res) => {
  console.log("Hit /api/chat test stub");
  res.json({ reply: "Test reply from stub endpoint." });
});

// --- CSV proxy route ---
app.get("/api/master-csv", async (req, res) => {
  console.log("GET /api/master-csv -> fetching from GCS:", CSV_URL);
  try {
    const response = await fetch(CSV_URL);

    console.log("GCS response status:", response.status);

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "<unable to read body>");
      console.error("Failed to fetch CSV from GCS:", response.status, bodyText);
      return res.status(500).send("Failed to fetch CSV from storage");
    }

    const text = await response.text();
    res.type("text/csv").send(text);
  } catch (err) {
    console.error("Error fetching CSV from GCS:", err);
    res.status(500).send("Error fetching CSV");
  }
});

// --- Static frontend ---
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// Root route
app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// --- Error handler (must be after routes) ---
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (req.url.startsWith("/api/")) {
    return res.status(500).json({
      error: "Something went wrong on the server.",
      details: err.message,
    });
  }
  res.status(500).send("Something went wrong.");
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
