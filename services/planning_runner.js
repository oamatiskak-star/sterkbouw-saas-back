import { PHASE_LIBRARY } from "../planning/phase_library.js"
import { calculatePhaseDuration } from "../planning/duration_engine.js"
import { buildDependencies } from "../planning/dependency_engine.js"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function runPlanningGenerator({
  project_id,
  project_type,
  start_date
}) {
  let currentDate = new Date(start_date)

  const phases = PHASE_LIBRARY.map(p => {
    const duur = calculatePhaseDuration(p, project_type)
    const start = new Date(currentDate)
    const eind = new Date(currentDate)
    eind.setDate(eind.getDate() + duur)

    currentDate = new Date(eind)

    return {
      key: p.key,
      naam: p.naam,
      duur_dagen: duur,
      startdatum: start.toISOString().slice(0, 10),
      einddatum: eind.toISOString().slice(0, 10)
    }
  })

  const planned = buildDependencies(phases)

  await supabase.from("project_planning").insert(
    planned.map(p => ({
      project_id,
      fase_key: p.key,
      fase_naam: p.naam,
      startdatum: p.startdatum,
      einddatum: p.einddatum,
      duur_dagen: p.duur_dagen,
      start_after: p.start_after
    }))
  )

  return planned
}
