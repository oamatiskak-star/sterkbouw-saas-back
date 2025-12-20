import { exportPricingExcel } from "../pricing/excel/exporter.js"
import { importPricingExcel } from "../pricing/excel/importer.js"
import { exportCUF } from "../pricing/cuf/exporter.js"
import { importCUF } from "../pricing/cuf/importer.js"

export async function pricingDispatcher({ action, payload }) {
  switch (action) {
    case "export_excel":
      return exportPricingExcel(payload.project, payload.calculatie, payload.outputDir)

    case "import_excel":
      return importPricingExcel(payload.filePath)

    case "export_cuf":
      return exportCUF(payload.project, payload.calculatie, payload.outputDir)

    case "import_cuf":
      return importCUF(payload.filePath)

    default:
      throw new Error("UNKNOWN_PRICING_ACTION")
  }
}
