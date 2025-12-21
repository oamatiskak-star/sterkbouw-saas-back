import express from "express"
import dotenv from "dotenv"
import cors from "cors"
import morgan from "morgan"
import { logEvent } from "./utils/log.js"

// ===============================
// ROUTES
// ===============================

import apiRouter from "./api/routes/index.js"
import pdfRoutes from "./api/routes/pdf.js" // correct pad naar PDF router

// ===============================
// INIT
// ===============================

dotenv.config()

const app = express()

app.use(cors())
app.use(express.json())
app.use(morgan("dev"))

// ===============================
// PING
// ===============================

app.get("/ping", (req, res) => {
  logEvent("Ping ontvangen")
  res.json({ status: "ok", timestamp: Date.now() })
})

// ===============================
// API ROUTES
// ===============================

app.use("/api", apiRouter)

// ===============================
// PDF ROUTES (LAAG 2 – NIEUW)
// ===============================

app.use("/api/pdf", pdfRoutes) // base path voor PDF endpoints

// ===============================
// START SERVER
// ===============================

const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  logEvent(`Server draait op poort ${PORT}`)
})
