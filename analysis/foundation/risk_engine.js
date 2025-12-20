export function calculateFoundationRisk({ broData, archiveData }) {
  let score = 1
  let factoren = []

  if (archiveData?.risico === "hoog") {
    score += 3
    factoren.push("Oud bouwjaar")
  }

  if (broData.length > 0) {
    score += 2
    factoren.push("BRO signalen in omgeving")
  }

  const niveau =
    score >= 5 ? "hoog" :
    score >= 3 ? "middel" :
    "laag"

  return {
    score,
    niveau,
    factoren
  }
}
