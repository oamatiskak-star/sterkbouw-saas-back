import { Router } from "express"
import { createClient } from "@supabase/supabase-js"
import {
  CALCULATION_STATES,
  getCalculationState
} from "../utils/calculationState.js"

const router = Router()
const EXECUTOR_STATE_ID = "00000000-0000-0000-0000-000000000001"

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
    if (currentState !== CALCULATION_STATES.CALCULATED) {
      return res.status(409).json({ error: "INVALID_STATE_TRANSITION" })
    }

    const { error: stateError } = await supabase
      .from("executor_state")
      .upsert({
        id: EXECUTOR_STATE_ID,
        allowed: true,
        updated_at: new Date().toISOString()
      }, { onConflict: "id" })

    if (stateError) {
      return res.status(500).json({ error: stateError.message })
    }

    const { data: existing } = await supabase
      .from("executor_tasks")
      .select("id")
      .eq("project_id", project_id)
      .eq("action", "planning")
      .in("status", ["open", "running"])
      .limit(1)
      .maybeSingle()

    if (existing?.id) {
      return res.json({ ok: true, task_id: existing.id })
    }

    const { data: task, error: taskError } = await supabase
      .from("executor_tasks")
      .insert({
        project_id,
        action: "planning",
        status: "open",
        assigned_to: "executor",
        payload: { project_id }
      })
      .select("id")
      .single()

    if (taskError) {
      return res.status(500).json({ error: taskError.message })
    }

    return res.json({ ok: true, task_id: task.id })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

export default router
