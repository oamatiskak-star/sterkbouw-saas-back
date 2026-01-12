import { Router } from "express"
import { createClient } from "@supabase/supabase-js"
import {
  CALCULATION_STATES,
  getCalculationState
} from "../utils/calculationState.js"

const router = Router()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

router.post("/", async (req, res) => {
  try {
    const { project_id, fixed_price } = req.body || {}

    if (!project_id || fixed_price === undefined || fixed_price === null) {
      return res.status(400).json({ error: "FIXED_PRICE_REQUIRED" })
    }

    const currentState = await getCalculationState(supabase, project_id)
    if (![CALCULATION_STATES.STABU_CONFIRMED, CALCULATION_STATES.CALCULATED].includes(currentState)) {
      return res.status(409).json({ error: "INVALID_STATE_TRANSITION" })
    }

    const { data: run, error: runError } = await supabase
      .from("calculation_runs")
      .select("id")
      .eq("project_id", project_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (runError) {
      return res.status(500).json({ error: runError.message })
    }

    if (!run?.id) {
      return res.status(409).json({ error: "CALCULATION_RUN_MISSING" })
    }

    const { error } = await supabase
      .from("calculation_runs")
      .update({ fixed_price })
      .eq("id", run.id)

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    return res.json({ ok: true, run_id: run.id })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

export default router
