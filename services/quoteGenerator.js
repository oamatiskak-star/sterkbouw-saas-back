import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../config/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Genereer meerwerk offerte PDF
 */
export const generateQuotePDF = async (quoteData, options = {}) => {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        info: {
          Title: `Offerte Meerwerk - ${quoteData.projectName}`,
          Author: 'SterkBouw',
          Subject: `Offerte MW-${quoteData.quoteNumber}`,
          Keywords: 'meerwerk, offerte, bouw, sterkbouw',
          Creator: 'SterkBouw Portal System',
          CreationDate: new Date()
        }
      });

      const fileName = `quote-${quoteData.quoteNumber}-${Date.now()}.pdf`;
      const outputPath = path.join(__dirname, '../../public/quotes', fileName);
      
      // Ensure directory exists
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // Add logo if exists
      const logoPath = path.join(__dirname, '../../public/logo.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 50, 45, { width: 100 });
      }

      // HEADER
      doc.fontSize(24)
         .font('Helvetica-Bold')
         .text('OFFERTE MEERWERK', 200, 50, { align: 'center' });
      
      doc.fontSize(10)
         .font('Helvetica')
         .text(`Offertenummer: MW-${quoteData.quoteNumber}`, 50, 100)
         .text(`Project: ${quoteData.projectName}`, 50, 115)
         .text(`Datum: ${new Date().toLocaleDateString('nl-NL')}`, 50, 130)
         .text(`Geldig tot: ${new Date(quoteData.validUntil).toLocaleDateString('nl-NL')}`, 50, 145);

      // Client info
      doc.fontSize(11)
         .font('Helvetica-Bold')
         .text('Geachte heer/mevrouw,', 50, 180)
         .font('Helvetica')
         .text(`Betreft: ${quoteData.description}`, 50, 200, { width: 500 });

      // Cost table
      const tableTop = 250;
      await renderCostTable(doc, quoteData, tableTop);

      // Terms and conditions
      doc.addPage()
         .fontSize(14)
         .font('Helvetica-Bold')
         .text('Voorwaarden en specificaties:', 50, 50);
      
      doc.fontSize(10)
         .font('Helvetica')
         .text(await getTermsAndConditions(), 50, 80, {
           width: 500,
           align: 'left'
         });

      // Drawings section if available
      if (quoteData.drawings && quoteData.drawings.length > 0) {
        doc.addPage()
           .fontSize(14)
           .font('Helvetica-Bold')
           .text('Bijlagen - Technische tekeningen:', 50, 50);
        
        quoteData.drawings.forEach((drawing, index) => {
          const y = 80 + (index * 20);
          doc.fontSize(10)
             .font('Helvetica')
             .text(`${index + 1}. ${drawing.title} (revisie ${drawing.revision})`, 50, y);
        });
      }

      // Approval section
      const approvalY = doc.y + 50;
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Voor akkoord:', 50, approvalY);
      
      doc.moveDown(3)
         .fontSize(10)
         .font('Helvetica')
         .text('Naam: _________________________________________', 50)
         .text('Handtekening: _________________________________', 70)
         .text('Datum: _______________', 90)
         .text('Plaats: _______________', 110);

      // Footer
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc.fontSize(8)
           .font('Helvetica')
           .text(`Pagina ${i + 1} van ${pageCount}`, 50, 800, { align: 'center' })
           .text(`Offertenummer: MW-${quoteData.quoteNumber}`, 50, 815, { align: 'center' });
      }

      doc.end();

      stream.on('finish', () => {
        const publicUrl = `/quotes/${fileName}`;
        
        // Store in database
        storeQuotePDF(quoteData.id, publicUrl, outputPath)
          .then(() => resolve(publicUrl))
          .catch(reject);
      });

      stream.on('error', reject);

    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Render cost table in PDF
 */
async function renderCostTable(doc, quoteData, startY) {
  const tableConfig = {
    x: 50,
    y: startY,
    rowHeight: 25,
    col1Width: 350,
    col2Width: 100,
    col3Width: 100
  };

  // Table header
  doc.fontSize(10)
     .font('Helvetica-Bold')
     .text('Omschrijving', tableConfig.x, tableConfig.y)
     .text('Aantal', tableConfig.x + tableConfig.col1Width, tableConfig.y)
     .text('Bedrag', tableConfig.x + tableConfig.col1Width + tableConfig.col2Width, tableConfig.y);

  // Draw line
  doc.moveTo(tableConfig.x, tableConfig.y + 15)
     .lineTo(tableConfig.x + tableConfig.col1Width + tableConfig.col2Width + tableConfig.col3Width, tableConfig.y + 15)
     .stroke();

  // Table rows
  let currentY = tableConfig.y + tableConfig.rowHeight;
  
  // Materials
  if (quoteData.materials && quoteData.materials.length > 0) {
    doc.fontSize(10).font('Helvetica-Bold').text('Materialen:', tableConfig.x, currentY);
    currentY += 20;
    
    quoteData.materials.forEach(item => {
      doc.fontSize(9).font('Helvetica')
         .text(item.description, tableConfig.x, currentY, { width: tableConfig.col1Width - 10 })
         .text(item.quantity.toString(), tableConfig.x + tableConfig.col1Width, currentY)
         .text(`€ ${item.total.toFixed(2)}`, tableConfig.x + tableConfig.col1Width + tableConfig.col2Width, currentY);
      currentY += tableConfig.rowHeight;
    });
  }

  // Labor
  if (quoteData.labor && quoteData.labor.length > 0) {
    doc.fontSize(10).font('Helvetica-Bold').text('Arbeid:', tableConfig.x, currentY);
    currentY += 20;
    
    quoteData.labor.forEach(item => {
      doc.fontSize(9).font('Helvetica')
         .text(item.description, tableConfig.x, currentY)
         .text(`${item.hours} uur`, tableConfig.x + tableConfig.col1Width, currentY)
         .text(`€ ${item.total.toFixed(2)}`, tableConfig.x + tableConfig.col1Width + tableConfig.col2Width, currentY);
      currentY += tableConfig.rowHeight;
    });
  }

  // Subtotals
  currentY += 10;
  doc.fontSize(10).font('Helvetica-Bold')
     .text('Subtotaal:', tableConfig.x + tableConfig.col1Width, currentY)
     .text(`€ ${quoteData.subtotal.toFixed(2)}`, tableConfig.x + tableConfig.col1Width + tableConfig.col2Width, currentY);
  
  currentY += tableConfig.rowHeight;
  const vatAmount = quoteData.subtotal * 0.21;
  doc.fontSize(10).font('Helvetica')
     .text('BTW (21%):', tableConfig.x + tableConfig.col1Width, currentY)
     .text(`€ ${vatAmount.toFixed(2)}`, tableConfig.x + tableConfig.col1Width + tableConfig.col2Width, currentY);
  
  currentY += tableConfig.rowHeight;
  doc.fontSize(11).font('Helvetica-Bold')
     .text('TOTAAL:', tableConfig.x + tableConfig.col1Width, currentY)
     .text(`€ ${(quoteData.subtotal + vatAmount).toFixed(2)}`, tableConfig.x + tableConfig.col1Width + tableConfig.col2Width, currentY);
}

/**
 * Get terms and conditions
 */
async function getTermsAndConditions() {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'quote_terms')
      .single();

    if (!error && data) {
      return data.value;
    }
  } catch (error) {
    console.error('Failed to fetch terms:', error);
  }

  // Default terms
  return `
1. Deze offerte is 30 dagen geldig vanaf bovenstaande datum.
2. Prijzen zijn exclusief 21% BTW, tenzij anders vermeld.
3. Uitvoering vindt plaats na schriftelijke opdracht.
4. Planning wordt in overleg vastgesteld na opdrachtbevestiging.
5. Meerwerk wordt gefactureerd volgens de voortgangsrapportage.
6. Eventuele wijzigingen worden schriftelijk bevestigd.
7. Deze offerte vervangt alle eerdere afspraken en overeenkomsten.
8. Geschillen vallen onder Nederlands recht.
  `;
}

/**
 * Store PDF reference in database
 */
async function storeQuotePDF(quoteId, publicUrl, filePath) {
  const fileStats = fs.statSync(filePath);
  
  const { error } = await supabase
    .from('quote_documents')
    .insert({
      quote_id: quoteId,
      file_url: publicUrl,
      file_path: filePath,
      file_size: fileStats.size,
      generated_at: new Date().toISOString()
    });

  if (error) throw error;
  
  // Also update the quote
  await supabase
    .from('extra_work_quotes')
    .update({ pdf_url: publicUrl })
    .eq('id', quoteId);

  return true;
}

/**
 * Generate multiple quotes as ZIP
 */
export const generateQuotesZip = async (quoteIds) => {
  // Implement ZIP generation logic
  return `/quotes/batch-${Date.now()}.zip`;
};

export default {
  generateQuotePDF,
  generateQuotesZip
};
