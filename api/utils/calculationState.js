export const CALCULATION_STATES = {
  PROJECT_CREATED: "PROJECT_CREATED",
  SETTINGS_SET: "SETTINGS_SET",
  DATA_ANALYSED: "DATA_ANALYSED",
  STABU_DRAFT: "STABU_DRAFT",
  STABU_CONFIRMED: "STABU_CONFIRMED",
  CALCULATED: "CALCULATED",
  OFFER_READY: "OFFER_READY"
}

const ALLOWED_TRANSITIONS = {
  PROJECT_CREATED: [CALCULATION_STATES.SETTINGS_SET],
  SETTINGS_SET: [CALCULATION_STATES.DATA_ANALYSED],
  DATA_ANALYSED: [CALCULATION_STATES.STABU_DRAFT],
  STABU_DRAFT: [CALCULATION_STATES.STABU_CONFIRMED],
  STABU_CONFIRMED: [CALCULATION_STATES.CALCULATED],
  CALCULATED: [CALCULATION_STATES.OFFER_READY]
}

export async function getCalculationState(supabase, projectId) {
  const { data, error } = await supabase
    .from("calculation_state")
    .select("state")
    .eq("project_id", projectId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data?.state || null
}

export async function setCalculationState(supabase, projectId, state) {
  const { error } = await supabase
    .from("calculation_state")
    .upsert({
      project_id: projectId,
      state,
      updated_at: new Date().toISOString()
    }, { onConflict: "project_id" })

  if (error) {
    throw new Error(error.message)
  }
}

export function isTransitionAllowed(currentState, nextState) {
  if (!currentState) {
    return nextState === CALCULATION_STATES.PROJECT_CREATED
  }

  const allowed = ALLOWED_TRANSITIONS[currentState] || []
  return allowed.includes(nextState)
}
