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
import startCalculationRouter from "./api/executor/start-calculation.js"
import projectScanRouter from "./api/executor/project-scan.js"
import workflowRunRouter from "./api/workflow/run.js"
import customerCreateRouter from "./api/customer/create.js"
import projectCreateRouter from "./api/project/create.js"
import projectSettingsRouter from "./api/project/settings.js"
import analysisStartRouter from "./api/analysis/start.js"
import stabuConfirmRouter from "./api/stabu/confirm.js"
import calculationRunRouter from "./api/calculation/run.js"
import calculationFixedPriceRouter from "./api/calculation/fixed-price.js"
import calculationSplitRouter from "./api/calculation/split.js"
import offerGenerateRouter from "./api/offer/generate.js"
import riskAnalyseRouter from "./api/risk/analyse.js"
import planningGenerateRouter from "./api/planning/generate.js"

// ===============================
// BIM API ROUTES - NIEUW
// ===============================

import generateRenderRouter from "./api/bim/generate-render.js"
import extractMaterialsRouter from "./api/bim/extract-materials.js"
// Voeg hier later meer BIM routes toe:
// import createModelRouter from "./api/bim/create-model.js"
// import detectClashesRouter from "./api/bim/detect-clashes.js"
// import quantityTakeoffRouter from "./api/bim/quantity-takeoff.js"

// ===============================
// BASIS
// ===============================

const PORT = process.env.PORT || 10000
const BACKEND_URL = process.env.BACKEND_URL
const EXECUTOR_URL = process.env.EXECUTOR_URL || "http://localhost:3000"

const app = express()
app.use(cors())
app.use(express.json({ limit: "10mb" })) // Verhoog limiet voor BIM data
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
  res.json({ 
    status: "ok", 
    ts: Date.now(),
    service: "saas-backend",
    version: "2.0.0",
    features: ["calculatie", "bim", "api"]
  })
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
app.use("/api/executor/start-calculation", startCalculationRouter)
app.use("/api/executor/project-scan", projectScanRouter)
app.use("/api/workflow/run", workflowRunRouter)
app.use("/api/customer/create", customerCreateRouter)
app.use("/api/project/create", projectCreateRouter)
app.use("/api/project/settings", projectSettingsRouter)
app.use("/api/analysis/start", analysisStartRouter)
app.use("/api/stabu/confirm", stabuConfirmRouter)
app.use("/api/calculation/run", calculationRunRouter)
app.use("/api/calculation/fixed-price", calculationFixedPriceRouter)
app.use("/api/calculation/split", calculationSplitRouter)
app.use("/api/offer/generate", offerGenerateRouter)
app.use("/api/risk/analyse", riskAnalyseRouter)
app.use("/api/planning/generate", planningGenerateRouter)

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
// BIM API
// ===============================

app.use("/api/bim/generate-render", generateRenderRouter)
app.use("/api/bim/extract-materials", extractMaterialsRouter)

// Health check voor BIM API
app.get("/api/bim/health", async (req, res) => {
  try {
    // Check Executor connectivity
    let executorStatus = "unknown"
    try {
      const executorResponse = await axios.get(`${EXECUTOR_URL}/ping`, { timeout: 5000 })
      executorStatus = executorResponse.data.ok ? "connected" : "error"
    } catch (e) {
      executorStatus = "disconnected"
    }

    // Check database connectivity
    let dbStatus = "unknown"
    try {
      const { error } = await supabase.from("projects").select("count", { count: "exact", head: true })
      dbStatus = error ? "error" : "connected"
    } catch (e) {
      dbStatus = "disconnected"
    }

    res.json({ 
      status: "ok", 
      service: "bim-api",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      connectivity: {
        database: dbStatus,
        executor: executorStatus,
        storage: "enabled"
      },
      endpoints: {
        generate_render: "/api/bim/generate-render",
        extract_materials: "/api/bim/extract-materials",
        status: "/api/bim/health"
      },
      features: [
        "3d_render_generation",
        "material_extraction",
        "executor_integration",
        "supabase_storage"
      ]
    })
  } catch (error) {
    res.status(500).json({
      status: "error",
      error: error.message
    })
  }
})

// BIM Status endpoint voor specifieke job
app.get("/api/bim/status/:job_type/:job_id", async (req, res) => {
  try {
    const { job_type, job_id } = req.params
    
    let tableName
    switch (job_type) {
      case 'render':
        tableName = 'bim_render_jobs'
        break
      case 'material-analysis':
        tableName = 'bim_material_analysis'
        break
      case 'ai-processing':
        tableName = 'ai_processing_jobs'
        break
      default:
        return res.status(400).json({
          success: false,
          error: `Ongeldig job type: ${job_type}`
        })
    }

    const { data: job, error } = await supabase
      .from(tableName)
      .select("*")
      .eq("id", job_id)
      .single()

    if (error) throw error

    res.json({
      success: true,
      job_type: job_type,
      job: job
    })

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
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

async function checkExecutorHealth() {
  try {
    const response = await axios.get(`${EXECUTOR_URL}/ping`, { timeout: 5000 })
    console.log(`[BIM] Executor gezond: ${response.data.ok ? 'OK' : 'ERROR'}`)
    return response.data.ok
  } catch (error) {
    console.warn(`[BIM] Executor niet bereikbaar: ${error.message}`)
    return false
  }
}

console.log("[AO] Backend + API + Calculatie + BIM gestart")
await sendTelegram("[AO] Backend + API + Calculatie + BIM gestart")

// Check Executor health bij startup
const executorHealthy = await checkExecutorHealth()
if (!executorHealthy) {
  console.warn("[BIM] WAARSCHUWING: Executor niet bereikbaar. BIM functionaliteiten mogelijk beperkt.")
  await sendTelegram("[BIM] WAARSCHUWING: Executor niet bereikbaar")
}

await pingBackend()

// ===============================
// ERROR HANDLING
// ===============================

app.use((err, req, res, next) => {
  console.error("[AO] Server error:", err)
  res.status(500).json({
    ok: false,
    error: process.env.NODE_ENV === "development" ? err.message : "Internal server error",
    request_id: req.headers['x-request-id'] || Date.now()
  })
})

app.use("*", (req, res) => {
  res.status(404).json({ 
    ok: false, 
    error: "Endpoint not found",
    available_endpoints: {
      calculatie: "/api/calculatie/health",
      bim: "/api/bim/health",
      projecten: "/api/projecten",
      pdf: "/pdf/*"
    }
  })
})

// ===============================
// START SERVER
// ===============================

app.listen(PORT, () => {
  console.log(`[AO] Service draait op poort ${PORT}`)
  console.log(`[CALC] Calculatie API beschikbaar op http://localhost:${PORT}/api/calculatie/health`)
  console.log(`[BIM] BIM API beschikbaar op http://localhost:${PORT}/api/bim/health`)
  console.log(`[BIM] Executor URL: ${EXECUTOR_URL}`)
  
  // Log alle beschikbare endpoints
  console.log("\n[ENDPOINTS] Beschikbare API's:")
  console.log("  GET  /api/projecten              - Project management")
  console.log("  POST /api/generate-calculatie    - Calculatie generatie")
  console.log("  POST /api/executor/upload-task   - Bestand upload")
  console.log("  POST /api/bim/generate-render    - 3D render generatie")
  console.log("  POST /api/bim/extract-materials  - Materialen extractie")
  console.log("  GET  /api/bim/health             - BIM systeem status")
})
