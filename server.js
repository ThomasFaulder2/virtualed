require("dotenv").config();

const path = require("path");
const express = require("express");
const { OpenAI } = require("openai"); // No need for body-parser separate install in modern Express

const app = express();
const PORT = process.env.PORT || 8080;

// 1. Cloud Run & Express Config
app.set("trust proxy", 1);
app.use(express.json()); // Built-in replacement for body-parser
app.use(express.urlencoded({ extended: true }));

// 2. OpenAI Client
const apiKey = process.env.OPENAI_API_KEY;
const client = new OpenAI({ apiKey });

// 3. Robust Retry Logic
async function callOpenAIWithRetry(messages, maxRetries = 3) {
  let lastErr;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Add a timeout for the specific API call (e.g., 15 seconds)
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini", // FIXED: Valid model name (was gpt-5.1-mini)
        messages,
        max_tokens: 500, // Safety limit for output
      }, { timeout: 15000 }); // Client-side timeout

      return completion.choices[0]?.message?.content || "";

    } catch (err) {
      lastErr = err;
      const status = err.status || 500;

      console.error(`Attempt ${attempt} failed. Status: ${status}. Msg: ${err.message}`);

      // CRITICAL: Do not retry on client errors (400, 401, 404)
      // Only retry on Rate Limits (429) or Server Errors (5xx)
      if (status < 500 && status !== 429) {
        throw err; // Fail fast for invalid keys or models
      }

      if (attempt < maxRetries) {
        // Exponential backoff: 500ms, 1000ms, 2000ms
        const delay = 500 * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// 4. Health Endpoint
app.get("/healthz", (req, res) => {
  res.status(200).send("ok");
});

// 5. Chat Endpoint
app.post("/api/chat", async (req, res) => {
  try {
    if (!apiKey) {
      console.error("Server missing API Key");
      return res.status(500).json({ error: "Server configuration error" });
    }

    const userMessages = Array.isArray(req.body?.messages)
      ? req.body.messages
      : [];

    // FIXED: Context Window Management
    // We keep the System Prompt (always index 0) AND the last 10 messages.
    // Previous code sliced strictly at -20, which deleted the System Prompt on long chats.
    const systemMessage = {
      role: "system",
      content:
        "You are roleplaying as a patient for a medical student. " +
        "Answer strictly as the patient, focusing on symptoms, history, and concerns. " +
        "Do NOT give diagnoses, investigations, or management advice."
    };

    // Take only the last 10 user messages to save tokens, but prepend System message
    const recentHistory = userMessages.slice(-10); 
    const messages = [systemMessage, ...recentHistory];

    const reply = await callOpenAIWithRetry(messages);
    res.json({ reply });

  } catch (err) {
    console.error("Final OpenAI Handler Error:", err);

    // Return specific error codes to frontend
    const status = err.status || 500;
    const message = err.error?.message || "Internal Service Error";
    
    res.status(status).json({ error: message });
  }
});

// 6. Static Files
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// 7. Process Safety
process.on("unhandledRejection", (reason, p) => {
  console.error("Unhandled Rejection:", reason);
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});