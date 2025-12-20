import fs from "fs"

export function importCUF(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8")
  const json = JSON.parse(raw)

  return {
    projectnummer: json.project.id,
    calculatie: json.calculatie.hoofdstukken.map(h => ({
      hoofdstuk: h.naam,
      posten: h.posten.map(p => ({
        naam: p.omschrijving,
        hoeveelheid: p.aantal,
        eenheid: p.eenheid,
        prijs: p.prijs
      }))
    }))
  }
}
