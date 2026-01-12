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
    const { project_id, split_request } = req.body || {}

    if (!project_id || !split_request) {
      return res.status(400).json({ error: "SPLIT_REQUEST_REQUIRED" })
    }

    const currentState = await getCalculationState(supabase, project_id)
    if (currentState !== CALCULATION_STATES.CALCULATED) {
      return res.status(409).json({ error: "INVALID_STATE_TRANSITION" })
    }

    return res.json({ ok: true, project_id, split_request })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

export default router
