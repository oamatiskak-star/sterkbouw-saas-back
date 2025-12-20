export default function cover(doc, data) {
  doc.fontSize(22).text(data.project.naam, { align: "center" })
  doc.moveDown()
  doc.fontSize(12).text(`Projectnummer: ${data.project.projectnummer}`, { align: "center" })
  doc.text(`Datum: ${data.meta.datum}`, { align: "center" })

  doc.moveDown(2)
  doc.fontSize(14).text("Facturatieadres", { underline: true })
  doc.fontSize(11).text(data.facturatie.naam)
  doc.text(data.facturatie.adres)
  doc.text(`${data.facturatie.postcode} ${data.facturatie.plaats}`)
  doc.text(data.facturatie.land)
}
