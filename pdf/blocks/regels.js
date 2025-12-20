const cols = {
  code: 57,
  omschrijving: 100,
  aantal: 255,
  eenheid: 285,
  mnorm: 305,
  uren: 325,
  loon: 345,
  materiaal: 380,
  stelpost: 420,
  totaal: 455
}

export function drawRegel(doc, y, r) {
  doc.text(r.code, cols.code, y)
  doc.text(r.omschrijving, cols.omschrijving, y, { width: 150 })
  doc.text(r.aantal, cols.aantal, y, { align: "right" })
  doc.text(r.eenheid, cols.eenheid, y)
  doc.text(r.mnorm ?? "", cols.mnorm, y, { align: "right" })
  doc.text(r.uren ?? "", cols.uren, y, { align: "right" })
  doc.text(r.loon ?? "", cols.loon, y, { align: "right" })
  doc.text(r.materiaal ?? "", cols.materiaal, y, { align: "right" })
  doc.text(r.stelpost ?? "", cols.stelpost, y, { align: "right" })
  doc.text(r.totaal, cols.totaal, y, { align: "right" })
}
