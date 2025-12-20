import PDFDocument from "pdfkit"
import fs from "fs"
import path from "path"

import template from "../reports/2jours/template.json"
import cover from "../reports/2jours/sections/cover.js"
import projectOverview from "../reports/2jours/sections/project_overview.js"
import scope from "../reports/2jours/sections/scope.js"
import assumptions from "../reports/2jours/sections/assumptions.js"
import risks from "../reports/2jours/sections/risks.js"
import calculationStructure from "../reports/2jours/sections/calculation_structure.js"
import planning from "../reports/2jours/sections/planning.js"
import footer from "../reports/2jours/sections/footer.js"

export async function generate2JoursPDF(projectData, outputDir) {
  const outputPath = path.join(outputDir, "2jours_v1.pdf")
  const doc = new PDFDocument({ size: template.page.size, margin: template.page.margin })

  doc.pipe(fs.createWriteStream(outputPath))

  cover(doc, projectData)
  projectOverview(doc, projectData)
  scope(doc, projectData)
  assumptions(doc, projectData)
  risks(doc, projectData)
  calculationStructure(doc, projectData)
  planning(doc, projectData)
  footer(doc)

  doc.end()

  return outputPath
}
