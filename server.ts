import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import helmet from "helmet";
import { GoogleGenerativeAI } from "@google/generative-ai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Security Headers
  app.use(helmet({
    contentSecurityPolicy: false, // Vite needs this disabled or carefully configured for dev
    crossOriginEmbedderPolicy: false,
  }));

  // API Proxy for Google Sheets to bypass CORS
  app.get("/api/proxy-sheet", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    // SSRF Protection: Only allow Google Sheets URLs
    try {
      const parsedUrl = new URL(url);
      const allowedHosts = ["docs.google.com", "sheets.googleapis.com"];
      if (!allowedHosts.includes(parsedUrl.hostname)) {
        return res.status(403).json({ error: "Forbidden: Only Google Sheets URLs are allowed" });
      }
    } catch (e) {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    try {
      console.log(`Proxying request to: ${url}`);
      const response = await axios.get(url, {
        responseType: "text",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
      });
      res.setHeader("Content-Type", "text/csv");
      res.send(response.data);
    } catch (error: any) {
      console.error("Proxy error:", error.message);
      res.status(500).json({ 
        error: "Failed to fetch Google Sheet", 
        details: error.message,
        url: url
      });
    }
  });

  // AI Price Analysis Endpoint
  app.post("/api/analyze-price", async (req, res) => {
    const { materialName, category, currentPrice, unit } = req.body;
    
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Gemini API key not configured" });
    }

    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      
      const prompt = `Analyze current regional commodities data for ${materialName} (Category: ${category}). 
      The current buy price is $${currentPrice}/${unit}. 
      Provide a suggested price, trend, and reasoning in JSON format: {"suggestedPrice": number, "trend": "up"|"down"|"flat", "reasoning": "string"}`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      // Clean up potential markdown formatting in response
      const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim();
      res.json(JSON.parse(jsonStr));
    } catch (error: any) {
      console.error("AI Analysis error:", error.message);
      res.status(500).json({ error: "AI analysis failed", details: error.message });
    }
  });

  // Automated LEADS/DHS Submission Endpoint
  app.post("/api/submit-leads", async (req, res) => {
    const { reportData, date, submittedBy } = req.body;
    const submissionUrl = process.env.WORKCENTER_SUBMISSION_URL;
    const apiKey = process.env.WORKCENTER_API_KEY;
    const accountId = process.env.WORKCENTER_ACCOUNT_ID;

    console.log(`Compliance submission initiated for ${date} by ${submittedBy}`);

    // If no URL configured yet, we return a "Pre-flight Check" success with a warning
    if (!submissionUrl) {
      return res.status(200).json({ 
        status: "mock_success", 
        message: "Submission simulation successful. Please configure WORKCENTER_SUBMISSION_URL in settings for live transmission.",
        timestamp: new Date().toISOString()
      });
    }

    try {
      // Robust submission logic using axios
      const response = await axios.post(submissionUrl, {
        source: "Preferred Metals Recycling App",
        accountId: accountId,
        reportDate: date,
        submittedAt: new Date().toISOString(),
        submissionUser: submittedBy,
        data: reportData // This would be the filtered CSV or JSON payload
      }, {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        timeout: 15000 // 15s timeout for compliance endpoints
      });

      res.json({
        status: "success",
        externalResponse: response.data,
        message: "Data successfully transmitted to WorkCenter."
      });
    } catch (error: any) {
      console.error("LEADS Submission Error:", error.message);
      res.status(500).json({
        status: "failed",
        error: error.message,
        details: error.response?.data || "No external error details"
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
