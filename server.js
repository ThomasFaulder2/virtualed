// server.js

require("dotenv").config();          // at very top

const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");

const app = express();
const PORT = process.env.PORT || 8080;

// Very important: Cloud Run sets PORT – don’t hard-code anything else
app.set("trust proxy", 1);
app.use(bodyParser.json());

// OpenAI client – safe even if key missing
const apiKey = process.env.OPENAI_API_KEY;
const client = new OpenAI({ apiKey });

// Health endpoint for Cloud Run
app.get("/healthz", (req, res) => {
  res.status(200).send("ok");
});

// Chat endpoint (unchanged logic, just retry wrapper)
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
      console.error(`OpenAI attempt ${attempt} failed:`, err.message || err);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
  }
  throw lastErr;
}

app.post("/api/chat", async (req, res) => {
  try {
    if (!apiKey) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const userMessages = Array.isArray(req.body?.messages)
      ? req.body.messages
      : [];

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

    const trimmed = messages.slice(-20);
    const reply = await callOpenAIWithRetry(trimmed);
    res.json({ reply });
  } catch (err) {
    console.error("OpenAI chat error:", err);
    res.status(502).json({ error: "OpenAI chat error" });
  }
});

// Static frontend *including* Master_Excel.csv in /public
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// Safety nets so the container doesn’t die silently
process.on("unhandledRejection", (reason, p) => {
  console.error("Unhandled Rejection at:", p, "reason:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
