// server.js (CommonJS version)

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

// --- AI history chat endpoint ---
app.post("/api/chat", async (req, res) => {
  try {
    const userMessages = req.body.messages || [];

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

    const completion = await client.chat.completions.create({
      model: "gpt-5.1-mini",
      messages
    });

    const reply = completion.choices[0]?.message?.content || "";
    res.json({ reply });
  } catch (err) {
    console.error("OpenAI chat error:", err);
    res.status(500).json({ error: "OpenAI chat error" });
  }
});

// --- Serve static frontend from ./public ---
const publicDir = path.join(__dirname, "public");
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
