import { Router } from "express"
import { createClient } from "@supabase/supabase-js"
import {
  CALCULATION_STATES,
  getCalculationState,
  isTransitionAllowed,
  setCalculationState
} from "../utils/calculationState.js"

const router = Router()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

router.post("/", async (req, res) => {
  try {
    const { project_id } = req.body || {}

    if (!project_id) {
      return res.status(400).json({ error: "PROJECT_ID_REQUIRED" })
    }

    const currentState = await getCalculationState(supabase, project_id)
    if (!isTransitionAllowed(currentState, CALCULATION_STATES.STABU_CONFIRMED)) {
      return res.status(409).json({ error: "INVALID_STATE_TRANSITION" })
    }

    await setCalculationState(supabase, project_id, CALCULATION_STATES.STABU_CONFIRMED)

    return res.json({ ok: true, project_id })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

export default router
