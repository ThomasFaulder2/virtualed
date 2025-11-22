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
  apiKey: process.env.OPENAI_API_KEY
});
require("dotenv").config();

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
}

app.post("/api/chat", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY is not set");
      return res.json({
        reply:
          "Sorry, I can’t answer right now because the server is missing its AI key."
      });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

    const completion = await callOpenAIWithRetry(client, messages);
    const reply =
      completion.choices?.[0]?.message?.content || "No reply generated.";
    res.json({ reply });
  } catch (err) {
    console.error("OpenAI chat error (after retries):", err);
    // Don't surface 500 to the browser; just send a soft error message
    res.json({
      reply:
        "Sorry, I’m having trouble responding right now. Please try again in a moment."
    });
  }
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
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
