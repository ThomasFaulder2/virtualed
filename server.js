// server.js
require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();

// === CSV from Google Cloud Storage ===
const CSV_URL = "https://storage.googleapis.com/virtualed-466321_cloudbuild/Master_Excel.csv";

// --- CSV proxy route ---
app.get("/master-csv", async (req, res) => {
  console.log(">>> /master-csv called");
  console.log("CSV_URL =", CSV_URL);

  try {
    // Node 22 has global fetch
    const response = await fetch(CSV_URL);
    console.log("GCS status:", response.status);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("GCS fetch failed:", response.status, text.slice(0, 200));
      return res
        .status(502)
        .json({ error: "Upstream CSV fetch failed", status: response.status });
    }

    const csvText = await response.text();
    console.log("CSV length:", csvText.length);
    res.type("text/csv").send(csvText);
  } catch (err) {
    console.error("ERROR in /master-csv:", err && (err.stack || err));
    if (!res.headersSent) {
      res.status(500).json({ error: "Unable to provide CSV at this time" });
    }
  }
});

// --- serve static frontend (public folder) ---
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// SPA catch-all – keep last
app.get("*", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// --- global error handler (extra safety) ---
app.use((err, req, res, next) => {
  console.error("UNHANDLED ERROR:", err && (err.stack || err));
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
