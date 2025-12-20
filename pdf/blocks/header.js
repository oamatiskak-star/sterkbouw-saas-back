export function drawHeader(doc, data) {
  doc.font("Helvetica-Bold").fontSize(9)
  doc.text(data.bedrijfsnaam, 57, 42)

  doc.font("Helvetica").fontSize(8)
  doc.text(data.adres, 57, 54)
  doc.text(`${data.postcode} ${data.plaats}`, 57, 66)
  doc.text(`KvK: ${data.kvk}`, 57, 78)
  doc.text(`BTW: ${data.btw}`, 57, 90)

  doc.text(`Factuurnummer: ${data.factuurnummer}`, 370, 42)
  doc.text(`Datum: ${data.datum}`, 370, 54)
  doc.text(`Project: ${data.projectnummer}`, 370, 66)
}
