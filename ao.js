import * as dotenv from "dotenv"
dotenv.config()

import express from "express"
import axios from "axios"
import cors from "cors"
import morgan from "morgan"
import { createClient } from "@supabase/supabase-js"
import { sendTelegram } from "./telegram/telegram.js"

// ===============================
// PDF ROUTES (NIEUW)
// ===============================

import pdfRoutes from "./routes/pdfRoutes.js"

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
// PDF API (NIEUW – LAAG 2)
// ===============================

app.use(pdfRoutes)

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

console.log("[AO] Executor + API gestart")
await sendTelegram("[AO] Executor + API gestart")
await pingBackend()

// ===============================
// START SERVER
// ===============================

app.listen(PORT, () => {
  console.log(`[AO] Service draait op poort ${PORT}`)
})
