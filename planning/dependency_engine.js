export function buildDependencies(phases) {
  return phases.map((p, index) => ({
    ...p,
    start_after: index === 0 ? null : phases[index - 1].key
  }))
}
