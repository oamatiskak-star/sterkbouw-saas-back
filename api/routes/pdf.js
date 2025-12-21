import express from "express";
import PDFDocument from "pdfkit";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET /api/pdf/calculatie/:id
router.get("/calculatie/:id", async (req, res) => {
  const calculatieId = req.params.id;

  try {
    // 1. Haal calculatie-regels op inclusief STABU info
    const { data: regels, error } = await supabase
      .from("calculatie_regels")
      .select(`
        hoeveelheid,
        normuren,
        arbeidsprijs,
        loonkosten,
        materiaalprijs,
        stabu_id,
        stabu_posten (code, omschrijving, eenheid)
      `)
      .eq("calculatie_id", calculatieId)
      .order("stabu_id", { ascending: true });

    if (error) throw new Error(error.message);

    // 2. Haal calculatie subtotalen op
    const { data: calc, error: calcErr } = await supabase
      .from("calculaties")
      .select(`totaal, verkoopprijs, marge`)
      .eq("id", calculatieId)
      .single();

    if (calcErr) throw new Error(calcErr.message);

    // 3. Start PDF
    const doc = new PDFDocument({ margin: 50 });
    let chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=calculatie_${calculatieId}.pdf`
      );
      res.send(pdfBuffer);
    });

    // 4. Header
    doc.fontSize(16).text("Calculatie 2Jours Layout", { align: "center" });
    doc.moveDown();

    // 5. Tabel header – exact 2Jours volgorde
    doc.fontSize(10);
    const headers = [
      "aantal", "eenh.", "uren", "loonkosten", "prijs/eenh.",
      "materiaal/eenh.", "o.a./eenh.", "o.a.", "stel/eenh.",
      "stelposten", "totaal"
    ];
    let xPositions = [50, 90, 130, 170, 220, 280, 340, 380, 420, 460, 500];
    headers.forEach((h, i) => doc.text(h, xPositions[i]));
    doc.moveDown();

    // 6. Tabel inhoud
    regels.forEach((r) => {
      const totaal = (r.materiaalprijs + r.loonkosten) * r.hoeveelheid;

      const values = [
        r.hoeveelheid.toFixed(2),             // aantal
        r.stabu_posten.eenheid || "",         // eenh.
        r.normuren.toFixed(3),                // uren
        r.loonkosten.toFixed(2),              // loonkosten
        r.arbeidsprijs.toFixed(2),            // prijs/eenh.
        r.materiaalprijs.toFixed(2),          // materiaal/eenh.
        "0.00",                               // o.a./eenh.
        "0.00",                               // o.a.
        "0.00",                               // stel/eenh.
        "0.00",                               // stelposten
        totaal.toFixed(2)                      // totaal
      ];

      values.forEach((val, i) => doc.text(val, xPositions[i]));
      doc.moveDown();
    });

    // 7. Subtotaal, opslagen, verkoopprijs en marge
    doc.moveDown();
    doc.text(`Totaal calculatie: ${calc.totaal.toFixed(2)}`, 400, undefined, { align: "right" });
    doc.text(`Verkoopprijs: ${calc.verkoopprijs.toFixed(2)}`, 400, undefined, { align: "right" });
    doc.text(`Marge: ${calc.marge.toFixed(2)}`, 400, undefined, { align: "right" });

    doc.end();
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
