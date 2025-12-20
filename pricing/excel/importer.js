import XLSX from "xlsx"

export function importPricingExcel(filePath) {
  const wb = XLSX.readFile(filePath)
  const sheet = wb.Sheets["Calculatie"]
  const data = XLSX.utils.sheet_to_json(sheet)

  return data.map(r => ({
    hoofdstuk: r.Hoofdstuk,
    post: r.Post,
    hoeveelheid: Number(r.Hoeveelheid),
    eenheid: r.Eenheid,
    prijs: Number(r.Prijs),
    totaal: Number(r.Totaal)
  }))
}
