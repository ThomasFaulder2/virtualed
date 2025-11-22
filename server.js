// server.js

require("dotenv").config();
const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 8080;

const publicDir = path.join(__dirname, "public");

// ============ LOAD CSV ONCE AT STARTUP (LOCAL ONLY) ============

let cachedCsv = "";

try {
  const csvPath = path.join(publicDir, "Master_Excel.csv");
  cachedCsv = fs.readFileSync(csvPath, "utf8");
  console.log("Loaded CSV at startup, length:", cachedCsv.length);
} catch (err) {
  console.error("FAILED to load Master_Excel.csv at startup:", err);
  // Don't crash – just leave cachedCsv = ""
}

// ===============================================================

app.use(bodyParser.json());

// (Optional) log requests – handy in Cloud Run logs
app.use((req, res, next) => {
  console.log(req.method, req.url);
  next();
});

// ------------- CSV endpoint (NO GCS, NO NETWORK) ----------------

app.get("/api/master-csv", (req, res) => {
  try {
    if (!cachedCsv) {
      console.warn("CSV not loaded; returning empty CSV");
      return res.type("text/csv").send("");
    }
    res.type("text/csv").send(cachedCsv);
  } catch (err) {
    console.error("Error in /api/master-csv:", err);
    res.type("text/csv").send(""); // don’t 500/503, just empty
  }
});

// ------------- OpenAI /chat endpoint (safe) ---------------------

app.post("/api/chat", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY is not set");
      return res
        .status(500)
        .json({ error: "OPENAI_API_KEY not set on server" });
    }

    let OpenAI;
    try {
      ({ OpenAI } = require("openai"));
    } catch (e) {
      console.error("openai package is not installed:", e);
      return res
        .status(500)
        .json({ error: "OpenAI client not available on server" });
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

// ------------- Static frontend ---------------------------

app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
