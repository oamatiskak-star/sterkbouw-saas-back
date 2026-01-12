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
    const {
      project_id,
      scenario_name,
      calculation_type,
      calculation_level,
      fixed_price
    } = req.body || {}

    if (!project_id || !scenario_name || !calculation_type || !calculation_level) {
      return res.status(400).json({ error: "CALCULATION_INPUT_REQUIRED" })
    }

    const currentState = await getCalculationState(supabase, project_id)
    if (currentState !== CALCULATION_STATES.STABU_CONFIRMED) {
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

    const { data: existingRun } = await supabase
      .from("calculation_runs")
      .select("id, status")
      .eq("project_id", project_id)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingRun?.id) {
      return res.status(409).json({ error: "CALCULATION_RUN_ALREADY_ACTIVE" })
    }

    const { data: run, error: runError } = await supabase
      .from("calculation_runs")
      .insert({
        project_id,
        scenario_name,
        calculation_type,
        calculation_level,
        fixed_price: fixed_price || null,
        status: "queued",
        current_step: "queued",
        created_at: new Date().toISOString()
      })
      .select("id")
      .single()

    if (runError) {
      return res.status(500).json({ error: runError.message })
    }

    const { data: task, error: taskError } = await supabase
      .from("executor_tasks")
      .insert({
        project_id,
        action: "start_rekenwolk",
        status: "open",
        assigned_to: "executor",
        payload: {
          project_id,
          calculation_run_id: run.id
        }
      })
      .select("id")
      .single()

    if (taskError) {
      return res.status(500).json({ error: taskError.message })
    }

    return res.json({ ok: true, run_id: run.id, task_id: task.id })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

export default router
