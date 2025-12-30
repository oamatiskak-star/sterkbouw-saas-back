// Backend/services/quoteService.js
import { generateQuotePDF, generateQuotesZip } from '../utils/pdf/quoteGenerator.js';
import { supabase } from '../config/database.js';
import { auditLog } from '../utils/auditLogger.js';
import { sendNotification } from './notificationService.js';

/**
 * Service voor het beheren van meerwerkoffertes
 */
class QuoteService {
  
  /**
   * Genereer een nieuwe offerte voor een meerwerkaanvraag
   */
  async createQuote(requestId, userId, options = {}) {
    try {
      // 1. Haal meerwerkaanvraag op met alle gegevens
      const { data: workRequest, error: requestError } = await supabase
        .from('extra_work_requests')
        .select(`
          *,
          project:project_id (
            id, name, address, client_name, client_email
          ),
          drawings:drawing_links (
            id, title, revision, file_url
          ),
          materials:requested_materials (
            id, description, quantity, unit_price
          )
        `)
        .eq('id', requestId)
        .single();

      if (requestError) throw new Error(`Meerwerkaanvraag niet gevonden: ${requestError.message}`);

      // 2. Bereken kosten
      const calculations = await this.calculateQuoteTotals(workRequest);
      
      // 3. Genereer uniek offertenummer
      const quoteNumber = await this.generateQuoteNumber();
      
      // 4. Maak offerte record in database
      const quoteData = {
        request_id: requestId,
        project_id: workRequest.project_id,
        quote_number: quoteNumber,
        description: workRequest.description,
        status: 'concept',
        subtotal: calculations.subtotal,
        vat_percentage: 0.21,
        vat_amount: calculations.vatAmount,
        total_amount: calculations.total,
        valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 dagen
        created_by: userId,
        created_at: new Date().toISOString(),
        materials: calculations.materials,
        labor: calculations.labor
      };

      const { data: newQuote, error: quoteError } = await supabase
        .from('extra_work_quotes')
        .insert([quoteData])
        .select()
        .single();

      if (quoteError) throw new Error(`Offerte aanmaken mislukt: ${quoteError.message}`);

      // 5. Koppel tekeningen aan offerte
      if (workRequest.drawings && workRequest.drawings.length > 0) {
        await supabase
          .from('quote_drawings')
          .insert(
            workRequest.drawings.map(drawing => ({
              quote_id: newQuote.id,
              drawing_id: drawing.id,
              title: drawing.title,
              revision: drawing.revision
            }))
          );
      }

      // 6. Audit log
      await auditLog('QUOTE_CREATED', {
        quoteId: newQuote.id,
        quoteNumber,
        requestId,
        projectId: workRequest.project_id,
        userId,
        amount: calculations.total
      });

      return {
        success: true,
        quote: newQuote,
        calculations
      };

    } catch (error) {
      console.error('QuoteService.createQuote error:', error);
      await auditLog('QUOTE_CREATE_FAILED', {
        requestId,
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Genereer PDF voor offerte
   */
  async generateQuotePDF(quoteId, options = {}) {
    try {
      // 1. Haal complete offertegegevens op
      const { data: quote, error: quoteError } = await supabase
        .from('extra_work_quotes')
        .select(`
          *,
          work_request:request_id (
            description, location, urgency
          ),
          project:project_id (
            name, address, client_name
          ),
          drawings:quote_drawings (
            title, revision, file_url
          ),
          creator:created_by (
            full_name, email
          )
        `)
        .eq('id', quoteId)
        .single();

      if (quoteError) throw new Error(`Offerte niet gevonden: ${quoteError.message}`);

      // 2. Haal kostenregels op
      const { data: materials } = await supabase
        .from('quote_materials')
        .select('*')
        .eq('quote_id', quoteId);

      const { data: labor } = await supabase
        .from('quote_labor')
        .select('*')
        .eq('quote_id', quoteId);

      // 3. Formatteer data voor PDF generator
      const pdfData = {
        id: quote.id,
        quoteNumber: quote.quote_number,
        projectName: quote.project.name,
        description: quote.work_request.description,
        validUntil: quote.valid_until,
        subtotal: quote.subtotal,
        materials: materials || [],
        labor: labor || [],
        drawings: quote.drawings || [],
        createdAt: quote.created_at
      };

      // 4. Genereer PDF
      const pdfUrl = await generateQuotePDF(pdfData, options);

      // 5. Update offerte status
      await supabase
        .from('extra_work_quotes')
        .update({ 
          pdf_url: pdfUrl,
          status: 'ready_for_review',
          updated_at: new Date().toISOString()
        })
        .eq('id', quoteId);

      // 6. Stuur notificatie naar opdrachtgever
      await sendNotification({
        type: 'QUOTE_READY',
        recipient: quote.project.client_email,
        subject: `Nieuwe meerwerkofferte beschikbaar - ${quote.quote_number}`,
        data: {
          quoteNumber: quote.quote_number,
          projectName: quote.project.name,
          amount: quote.total_amount,
          pdfUrl: pdfUrl,
          portalLink: `/p/${quote.project_id}/extraWork`
        }
      });

      // 7. Audit log
      await auditLog('QUOTE_PDF_GENERATED', {
        quoteId,
        quoteNumber: quote.quote_number,
        pdfUrl
      });

      return {
        success: true,
        pdfUrl,
        quote: {
          ...quote,
          status: 'ready_for_review'
        }
      };

    } catch (error) {
      console.error('QuoteService.generateQuotePDF error:', error);
      await auditLog('QUOTE_PDF_FAILED', {
        quoteId,
        error: error.message
      });
      
      // Fallback: update status naar failed
      await supabase
        .from('extra_work_quotes')
        .update({ 
          status: 'generation_failed',
          updated_at: new Date().toISOString()
        })
        .eq('id', quoteId);

      throw error;
    }
  }

  /**
   * Verwerk akkoord van opdrachtgever
   */
  async approveQuote(quoteId, clientData) {
    const clientIP = clientData.ip || 'unknown';
    
    try {
      // 1. Controleer offerte status
      const { data: quote, error: quoteError } = await supabase
        .from('extra_work_quotes')
        .select('status, project_id, quote_number')
        .eq('id', quoteId)
        .single();

      if (quoteError) throw new Error(`Offerte niet gevonden: ${quoteError.message}`);
      
      if (quote.status !== 'ready_for_review') {
        throw new Error(`Offerte is niet in juiste status voor akkoord. Huidige status: ${quote.status}`);
      }

      // 2. Update offerte met akkoordgegevens
      const approvalData = {
        status: 'approved_by_client',
        approved_by_client: clientData.clientName,
        approved_at: new Date().toISOString(),
        approval_ip: clientIP,
        client_signature: clientData.signatureData,
        updated_at: new Date().toISOString()
      };

      const { data: updatedQuote, error: updateError } = await supabase
        .from('extra_work_quotes')
        .update(approvalData)
        .eq('id', quoteId)
        .select()
        .single();

      if (updateError) throw new Error(`Akkoord opslaan mislukt: ${updateError.message}`);

      // 3. Update meerwerkaanvraag status
      await supabase
        .from('extra_work_requests')
        .update({ 
          status: 'quote_approved',
          updated_at: new Date().toISOString()
        })
        .eq('id', (await supabase
          .from('extra_work_quotes')
          .select('request_id')
          .eq('id', quoteId)
          .single()
        ).data.request_id);

      // 4. Stuur notificatie naar projectleider
      const { data: project } = await supabase
        .from('projects')
        .select('project_leader_email')
        .eq('id', quote.project_id)
        .single();

      if (project.project_leader_email) {
        await sendNotification({
          type: 'QUOTE_APPROVED',
          recipient: project.project_leader_email,
          subject: `Meerwerkofferte goedgekeurd - ${quote.quote_number}`,
          data: {
            quoteNumber: quote.quote_number,
            approvedBy: clientData.clientName,
            approvedAt: approvalData.approved_at,
            clientIP,
            projectId: quote.project_id
          }
        });
      }

      // 5. Audit log (cruciaal voor compliance)
      await auditLog('QUOTE_APPROVED', {
        quoteId,
        quoteNumber: quote.quote_number,
        projectId: quote.project_id,
        clientName: clientData.clientName,
        clientIP,
        approvalTimestamp: approvalData.approved_at,
        signatureHash: clientData.signatureData ? 
          this.hashSignature(clientData.signatureData) : null
      });

      return {
        success: true,
        quote: updatedQuote,
        message: `Offerte ${quote.quote_number} is succesvol goedgekeurd.`
      };

    } catch (error) {
      console.error('QuoteService.approveQuote error:', error);
      await auditLog('QUOTE_APPROVAL_FAILED', {
        quoteId,
        clientIP,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Bereken totaalbedragen
   */
  async calculateQuoteTotals(workRequest) {
    const materials = workRequest.materials || [];
    const laborHours = workRequest.estimated_hours || 0;
    const hourlyRate = 85; // €85 per uur (kan uit settings halen)

    // Bereken materiaalkosten
    const materialTotal = materials.reduce((sum, item) => {
      return sum + (item.quantity * (item.unit_price || 0));
    }, 0);

    // Bereken arbeidskosten
    const laborTotal = laborHours * hourlyRate;

    const subtotal = materialTotal + laborTotal;
    const vatAmount = subtotal * 0.21;
    const total = subtotal + vatAmount;

    return {
      materials: materials.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        total: item.quantity * (item.unit_price || 0)
      })),
      labor: [{
        description: 'Uitvoering werk',
        hours: laborHours,
        hourlyRate: hourlyRate,
        total: laborTotal
      }],
      subtotal,
      vatAmount,
      total
    };
  }

  /**
   * Genereer uniek offertenummer
   */
  async generateQuoteNumber() {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    
    // Zoek laatste nummer van deze maand
    const { data: lastQuote } = await supabase
      .from('extra_work_quotes')
      .select('quote_number')
      .like('quote_number', `MW-${year}${month}%`)
      .order('created_at', { ascending: false })
      .limit(1);

    let sequence = 1;
    if (lastQuote && lastQuote.length > 0) {
      const lastNumber = parseInt(lastQuote[0].quote_number.split('-').pop());
      sequence = lastNumber + 1;
    }

    return `MW-${year}${month}-${String(sequence).padStart(3, '0')}`;
  }

  /**
   * Veilige hash voor handtekening (vereenvoudigd)
   */
  hashSignature(signatureData) {
    // In productie gebruik bcrypt of crypto library
    return Buffer.from(signatureData).toString('base64').slice(0, 32);
  }
}

export default new QuoteService();
