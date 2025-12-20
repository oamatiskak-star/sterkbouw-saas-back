import fs from "fs"
import path from "path"

export function exportCUF(project, calculatie, outputDir) {
  const cuf = {
    project: {
      id: project.projectnummer,
      naam: project.naam
    },
    calculatie: {
      hoofdstukken: calculatie.map(h => ({
        naam: h.hoofdstuk,
        posten: h.posten.map(p => ({
          omschrijving: p.naam,
          aantal: p.hoeveelheid,
          eenheid: p.eenheid,
          prijs: p.prijs || 0
        }))
      }))
    }
  }

  const filePath = path.join(outputDir, `calculatie_${project.projectnummer}.cuf`)
  fs.writeFileSync(filePath, JSON.stringify(cuf, null, 2))

  return filePath
}
