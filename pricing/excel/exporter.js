import XLSX from "xlsx"
import path from "path"
import fs from "fs"

export function exportPricingExcel(project, calculatie, outputDir) {
  const wb = XLSX.utils.book_new()

  const metaSheet = XLSX.utils.json_to_sheet([
    {
      Projectnummer: project.projectnummer,
      Projectnaam: project.naam,
      Datum: new Date().toISOString().slice(0, 10)
    }
  ])

  XLSX.utils.book_append_sheet(wb, metaSheet, "Meta")

  const rows = []
  calculatie.forEach(h => {
    h.posten.forEach(p => {
      rows.push({
        Hoofdstuk: h.hoofdstuk,
        Post: p.naam,
        Hoeveelheid: p.hoeveelheid,
        Eenheid: p.eenheid,
        Prijs: "",
        Totaal: ""
      })
    })
  })

  const calcSheet = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, calcSheet, "Calculatie")

  const filePath = path.join(outputDir, `prijslaag_${project.projectnummer}.xlsx`)
  XLSX.writeFile(wb, filePath)

  return filePath
}
