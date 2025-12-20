export function calculatePhaseDuration(phase, projectType) {
  const factor =
    projectType === "Nieuwbouw" ? 1 :
    projectType === "Transformatie" ? 1.2 :
    projectType === "Renovatie" ? 0.9 :
    1

  return Math.round(phase.standaard_duur * factor)
}
