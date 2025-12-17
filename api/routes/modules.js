import express from "express"
import { createClient } from "@supabase/supabase-js"

const router = express.Router()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

router.get("/", async (req, res) => {
  try {
    const { data: modules, error } = await supabase
      .from("modules")
      .select("key, label, route, active")
      .eq("active", true)
      .order("sort_order", { ascending: true })

    if (error) throw error

    res.json({
      ok: true,
      modules: modules.map(m => ({
        key: m.key,
        label: m.label,
        path: m.route
      }))
    })
  } catch (err) {
    console.error("MODULES API ERROR", err)
    res.status(500).json({
      ok: false,
      error: "Modules laden mislukt"
    })
  }
})

export default router
