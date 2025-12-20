export default function projectOverview(doc, data) {
  doc.addPage()
  doc.fontSize(16).text("Projectoverzicht")
  doc.moveDown()

  doc.fontSize(11).text(`Projecttype: ${data.project.type}`)
  doc.text(`Locatie: ${data.project.locatie}`)
  doc.text(`Opdrachtgever: ${data.project.opdrachtgever}`)
  doc.text(`Projectleider: ${data.project.projectleider || "-"}`)
}
