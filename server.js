// server.js (CommonJS version)

const CSV_URL = "https://storage.googleapis.com/virtualed-466321_cloudbuild/Master_Excel.csv";

const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");

const app = express();
app.use(bodyParser.json());

// IMPORTANT: use env var, DO NOT hard-code your key
const client = new OpenAI({
  apiKey: "ssh-ed25519AAAAC3NzaC1lZDI1NTE5AAAAIEeTlq1ompR0zUmYalPertPUz1V9eBtRlQHvnScalsTi"
});
try {
  require("dotenv").config();
  console.log("dotenv loaded");
} catch (err) {
  console.log("dotenv not found, skipping (using Cloud Run env vars only)");
}


// --- AI history chat endpoint ---
async function callOpenAIWithRetry(client, messages, maxRetries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`OpenAI attempt ${attempt}`);
      return await client.chat.completions.create({
        model: "gpt-5.1-mini",
        messages
      });
    } catch (err) {
      lastErr = err;
      const retryable = [429, 500, 502, 503, 504].includes(err.status);
      console.error(`OpenAI error on attempt ${attempt}:`, err.status, err.message);
      if (!retryable || attempt === maxRetries) break;
      // simple backoff
      await new Promise(r => setTimeout(r, attempt * 500));
    }
  }
  throw lastErr;
}app.post("/api/chat", (req, res) => {
  console.log("Hit /api/chat test stub");
  res.json({ reply: "Test reply from stub endpoint." });
});

// --- Serve static frontend from ./public ---
const publicDir = path.join(__dirname, "public");

// --- Proxy CSV so browser doesn't hit GCS directly ---
app.get("/api/master-csv", async (req, res) => {
  try {
    const response = await fetch(CSV_URL); // Node 22+ has global fetch
    if (!response.ok) {
      console.error("Failed to fetch CSV from GCS:", response.status, await response.text());
      return res.status(500).send("Failed to fetch CSV from storage");
    }

    const text = await response.text();
    res.type("text/csv").send(text);
  } catch (err) {
    console.error("Error fetching CSV from GCS:", err);
    res.status(500).send("Error fetching CSV");
  }
});

app.use(express.static(publicDir));

// Health check / root
app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// --- Start server ---
const PORT = process.env.PORT;
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (req.url.startsWith("/api/")) {
    // API fallback
    return res.json({
      error: "Something went wrong on the server.",
      details: err.message
    });
  }

  // For non-API routes, just send a simple message
  res.status(500).send("Something went wrong.");
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
