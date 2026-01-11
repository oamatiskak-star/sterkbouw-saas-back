import { createClient } from "@supabase/supabase-js";

const EXECUTOR_STATE_ID = "00000000-0000-0000-0000-000000000001";

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
if (req.method !== "POST") {
return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
}

try {
const { project_id, scenario_name, calculation_type, calculation_level, fixed_price } = req.body;

if (!project_id) {
  console.error("START_CALCULATION_API: Missing project_id");
  return res.status(400).json({ error: "project_id is required" });
}

const activeStatuses = [
  "queued",
  "running",
  "scanning",
  "calculating",
  "analysing_documents",
  "generating_stabu",
  "scan_completed",
];

const { error: stateError } = await supabase
  .from("executor_state")
  .upsert({
    id: EXECUTOR_STATE_ID,
    allowed: true,
    updated_at: new Date().toISOString()
  }, { onConflict: "id" });

if (stateError) {
  console.error("START_CALCULATION_API: executor_state update failed", stateError);
  return res.status(500).json({ error: stateError.message });
}

const { data: existingRun, error: existingRunError } = await supabase
  .from("calculation_runs")
  .select("id, status")
  .eq("project_id", project_id)
  .in("status", activeStatuses)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (existingRunError) {
  console.error("START_CALCULATION_API: Supabase select error", existingRunError);
  return res.status(500).json({ error: existingRunError.message });
}

if (existingRun?.id) {
  return res.status(409).json({ error: "CALCULATION_RUN_ALREADY_ACTIVE" });
}

const { data: existingTask, error: existingError } = await supabase
  .from("executor_tasks")
  .select("id")
  .eq("project_id", project_id)
  .eq("action", "start_calculation")
  .in("status", ["open", "running"])
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (existingError) {
  console.error("START_CALCULATION_API: Supabase select error", existingError);
  return res.status(500).json({ error: existingError.message });
}

if (existingTask?.id) {
  return res.json({ ok: true, task_id: existingTask.id });
}

const { data, error } = await supabase
  .from("executor_tasks")
  .insert({
    project_id,
    action: "start_calculation",
    assigned_to: "executor",
    status: "open",
    payload: {
      project_id,
      scenario_name,
      calculation_type,
      calculation_level,
      fixed_price,
    },
  })
  .select("id")
  .single();

if (error) {
  console.error("START_CALCULATION_API: Supabase insert error", error);
  return res.status(500).json({ error: error.message });
}

res.json({ ok: true, task_id: data.id });
} catch (err) {
console.error("START_CALCULATION_API: Unexpected error", err);
res.status(500).json({ error: "Internal server error" });
}
}
