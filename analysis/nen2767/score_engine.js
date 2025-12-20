import { mapConditionScore } from "./condition_mapper.js"

export function calculateNenScore(defects) {
  const scored = defects.map(d => ({
    ...d,
    score: mapConditionScore(d)
  }))

  const gemiddelde =
    scored.reduce((a, b) => a + b.score, 0) / scored.length

  return {
    score_gemiddeld: Math.round(gemiddelde * 10) / 10,
    details: scored
  }
}
