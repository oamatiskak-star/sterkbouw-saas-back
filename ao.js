import * as dotenv from "dotenv"
dotenv.config()

import express from "express"
import axios from "axios"
import cors from "cors"
import morgan from "morgan"
import { createClient } from "@supabase/supabase-js"
import { sendTelegram } from "./telegram/telegram.js"

// ===============================
// PDF ROUTES
// ===============================

import pdfRoutes from "./routes/pdfRoutes.js"

// ===============================
// CALCULATIE API ROUTES
// ===============================

import projectenRouter from "./api/projecten.js"
import generateCalculatieRouter from "./api/generate-calculatie.js"
import uploadTaskRouter from "./api/executor/upload-task.js"

// ===============================
// BASIS
// ===============================

const PORT = process.env.PORT || 10000
const BACKEND_URL = process.env.BACKEND_URL

const app = express()
app.use(cors())
app.use(express.json())
app.use(morgan("dev"))

// ===============================
// SUPABASE
// ===============================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ===============================
// PING
// ===============================

app.get("/ping", async (req, res) => {
  res.json({ status: "ok", ts: Date.now() })
})

// ===============================
// UI API – KNOPPENMATRIX
// ===============================

app.get("/api/ui/:page_slug", async (req, res) => {
  const { page_slug } = req.params

  const { data, error } = await supabase
    .from("page_buttons")
    .select(`
      sort_order,
      ui_buttons (
        label,
        icon,
        action_type,
        action_target,
        variant
      )
    `)
    .eq("page_slug", page_slug)
    .order("sort_order", { ascending: true })

  if (error) {
    return res.status(500).json({ ok: false, error: error.message })
  }

  const buttons = (data || []).map(row => ({
    label: row.ui_buttons.label,
    icon: row.ui_buttons.icon,
    type: row.ui_buttons.action_type || "route",
    action: row.ui_buttons.action_target,
    style: row.ui_buttons.variant || "primary"
  }))

  res.json({
    ok: true,
    components: [
      {
        type: "action_group",
        config: {
          title: "Acties",
          buttons,
          ui: {
            wrapper: "card",
            shadow: "soft",
            buttons: {
              primary: { bg: "#F5C400", text: "#000", radius: 10 },
              secondary: { bg: "#EEF1F6", text: "#1C2434", radius: 10 },
              danger: { bg: "#E5533D", text: "#fff", radius: 10 }
            }
          }
        }
      }
    ]
  })
})

// ===============================
// PDF API
// ===============================

app.use(pdfRoutes)

// ===============================
// CALCULATIE API
// ===============================

app.use("/api/projecten", projectenRouter)
app.use("/api/generate-calculatie", generateCalculatieRouter)
app.use("/api/executor/upload-task", uploadTaskRouter)

// Health check voor calculatie API
app.get("/api/calculatie/health", (req, res) => {
  res.json({ 
    status: "ok", 
    service: "calculatie-api",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    endpoints: {
      projecten: "/api/projecten",
      generate_calculatie: "/api/generate-calculatie",
      upload: "/api/executor/upload-task"
    }
  })
})

// ===============================
// BESTAANDE EXECUTOR LOGICA
// ===============================

async function pingBackend() {
  if (!BACKEND_URL) return
  try {
    const response = await axios.get(`${BACKEND_URL}/ping`)
    const msg = `[AO] Backend reageert: ${response.status}`
    console.log(msg)
    await sendTelegram(msg)
  } catch (error) {
    const errMsg = `[AO] FOUT bij ping backend: ${error.message}`
    console.error(errMsg)
    await sendTelegram(errMsg)
  }
}

console.log("[AO] Executor + API + Calculatie gestart")
await sendTelegram("[AO] Executor + API + Calculatie gestart")
await pingBackend()

// ===============================
// ERROR HANDLING
// ===============================

app.use((err, req, res, next) => {
  console.error("[AO] Server error:", err)
  res.status(500).json({
    ok: false,
    error: process.env.NODE_ENV === "development" ? err.message : "Internal server error"
  })
})

app.use("*", (req, res) => {
  res.status(404).json({ ok: false, error: "Endpoint not found" })
})

// ===============================
// START SERVER
// ===============================

app.listen(PORT, () => {
  console.log(`[AO] Service draait op poort ${PORT}`)
  console.log(`[CALC] Calculatie API beschikbaar op http://localhost:${PORT}/api/calculatie/health`)
})
