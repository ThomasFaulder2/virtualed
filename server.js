// server.js (CommonJS version)

// 1) Load env vars BEFORE using them
require("dotenv").config();

const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");

const app = express();
const PORT = process.env.PORT || 8080;

// Trust the Cloud Run proxy for correct protocol, IP, etc.
app.set("trust proxy", 1);

// Parse JSON bodies
app.use(bodyParser.json());

// --- OpenAI client ---
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.warn(
    "WARNING: OPENAI_API_KEY is not set. /api/chat requests will fail until this is configured."
  );
}

const client = new OpenAI({
  apiKey
});

// -------- Health checks (for Cloud Run) --------
app.get("/healthz", (req, res) => {
  res.status(200).send("ok");
});

// Root can also act as a basic health endpoint by serving the app
// (Cloud Run usually hits '/' by default)

// -------- Robust OpenAI caller with retries --------
async function callOpenAIWithRetry(messages, maxRetries = 2) {
  let lastErr;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: "gpt-5.1-mini",
        messages
      });

      return completion.choices[0]?.message?.content || "";
    } catch (err) {
      lastErr = err;
      console.error(
        `OpenAI call attempt ${attempt} failed:`,
        err?.message || err
      );

      if (attempt < maxRetries) {
        // small backoff before retry
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }

  throw lastErr;
}

// --- AI history chat endpoint ---
app.post("/api/chat", async (req, res) => {
  try {
    if (!apiKey) {
      return res
        .status(500)
        .json({ error: "Server not configured with OpenAI API key" });
    }

    const userMessages = Array.isArray(req.body?.messages)
      ? req.body.messages
      : [];

    // System prompt first, then conversation
    const messages = [
      {
        role: "system",
        content:
          "You are roleplaying as a patient for a medical student. " +
          "Answer strictly as the patient, focusing on symptoms, history, and concerns. " +
          "Do NOT give diagnoses, investigations, or management advice."
      },
      ...userMessages
    ];

    // safety: cap conversation length
    const trimmedMessages = messages.slice(-20);

    const reply = await callOpenAIWithRetry(trimmedMessages);

    res.json({ reply });
  } catch (err) {
    console.error("OpenAI chat error:", err);
    // 502 = upstream dependency failed
    res.status(502).json({ error: "OpenAI chat error" });
  }
});

// --- Serve static frontend from ./public ---
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// Root serves index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// --- Process-level safety nets (log instead of silent crash) ---
process.on("unhandledRejection", (reason, p) => {
  console.error("Unhandled Rejection at:", p, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
