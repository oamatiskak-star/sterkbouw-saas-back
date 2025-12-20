import { createClient } from "@supabase/supabase-js"

import { runNen2767 } from "./nen2767_runner.js"
import { runFoundationAnalysis } from "./foundation_runner.js"
import { runPlanningGenerator } from "./planning_runner.js"
import { generate2JoursPDF } from "./report_preparer_2jours.js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/*
ORCHESTRATOR
– sequentieel
– options gestuurd
– logging verplicht
*/

export async function runInitializationOrchestrator({ project_id, options }) {
  const log = async (module, status, error = null) => {
    await supabase.from("project_initialization_log").insert({
      project_id,
      module,
      status,
      error,
      started_at: status === "running" ? new Date().toISOString() : null,
      finished_at: status === "done" ? new Date().toISOString() : null
    })
  }

  /*
  MODULES IN VASTE VOLGORDE
  */
  const FLOW = [
    {
      key: "foundation_check",
      fn: () =>
        runFoundationAnalysis({
          project_id,
          ...options.foundation_payload
        })
    },
    {
      key: "nen_meting",
      fn: () =>
        runNen2767({
          project_id,
          input_defects: options.nen_defects || []
        })
    },
    {
      key: "planning_generator",
      fn: () =>
        runPlanningGenerator({
          project_id,
          project_type: options.project_type,
          start_date: options.start_date
        })
    },
    {
      key: "report_pdf",
      fn: () =>
        generate2JoursPDF(options.project_data, options.output_dir)
    }
  ]

  for (const step of FLOW) {
    if (!options[step.key]) continue

    await log(step.key, "running")

    try {
      await step.fn()
      await log(step.key, "done")
    } catch (err) {
      await log(step.key, "failed", err.message)
      throw err
    }
  }

  await supabase
    .from("projects_runtime_status")
    .update({
      status: "initialized",
      last_step: "complete",
      updated_at: new Date().toISOString()
    })
    .eq("project_id", project_id)

  return { status: "initialized" }
}
