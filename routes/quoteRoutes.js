// Backend/routes/quoteRoutes.js
import express from 'express';
import QuoteService from '../services/quoteService.js';
import { authenticateToken, authorizeClient } from '../middleware/auth.js';
import { validateQuoteApproval, validateQuoteRequest } from '../middleware/validation.js';
import { auditLog } from '../utils/auditLogger.js';
import { rateLimit } from 'express-rate-limit';

const router = express.Router();

// Rate limiting voor offerte-aanvragen
const quoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuten
  max: 10, // Max 10 requests per windowMs
  message: { error: 'Te veel aanvragen, probeer het later opnieuw.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @route   GET /api/quotes/project/:projectId
 * @desc    Haal alle offertes op voor een project
 * @access  Private (Client of Projectleider)
 */
router.get('/project/:projectId', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const userRole = req.user.role;
    const userId = req.user.id;

    // Autorisatie check
    if (userRole === 'client') {
      const hasAccess = await authorizeClient(userId, projectId);
      if (!hasAccess) {
        return res.status(403).json({ 
          error: 'Geen toegang tot offertes voor dit project' 
        });
      }
    }

    const { status, limit = 50, offset = 0 } = req.query;

    const { data: quotes, error } = await supabase
      .from('extra_work_quotes')
      .select(`
        *,
        work_request:request_id (
          description, location, urgency, created_at
        ),
        project:project_id (
          name, client_name
        )
      `)
      .eq('project_id', projectId)
      .eq(userRole === 'client' ? 'show_to_client' : true, true)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) throw error;

    // Voor clients: filter gevoelige informatie
    const filteredQuotes = userRole === 'client' 
      ? quotes.map(quote => ({
          id: quote.id,
          quote_number: quote.quote_number,
          description: quote.work_request?.description,
          status: quote.status,
          total_amount: quote.total_amount,
          valid_until: quote.valid_until,
          created_at: quote.created_at,
          pdf_url: quote.pdf_url,
          can_approve: quote.status === 'ready_for_review'
        }))
      : quotes;

    await auditLog('QUOTES_FETCHED', {
      projectId,
      userId,
      userRole,
      count: filteredQuotes.length
    });

    res.json({
      success: true,
      quotes: filteredQuotes,
      pagination: {
        total: quotes.length,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });

  } catch (error) {
    console.error('Get quotes error:', error);
    res.status(500).json({ 
      error: 'Kon offertes niet ophalen',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   GET /api/quotes/:quoteId
 * @desc    Haal specifieke offerte op met alle details
 * @access  Private
 */
router.get('/:quoteId', authenticateToken, async (req, res) => {
  try {
    const { quoteId } = req.params;
    const userRole = req.user.role;
    const userId = req.user.id;

    // Haal offerte op met alle relaties
    const { data: quote, error } = await supabase
      .from('extra_work_quotes')
      .select(`
        *,
        work_request:request_id (
          *,
          drawings:drawing_links (
            id, title, revision, file_url, thumbnail_url
          ),
          location_photos:location_photos (
            id, url, description
          )
        ),
        project:project_id (
          id, name, address, client_name, client_email,
          project_leader_email, phone_number
        ),
        materials:quote_materials (*),
        labor:quote_labor (*),
        drawings:quote_drawings (
          *,
          drawing:drawing_id (
            file_url, title, revision
          )
        ),
        approval_history:quote_approvals (
          approved_by, approved_at, ip_address, user_agent
        )
      `)
      .eq('id', quoteId)
      .single();

    if (error) throw error;

    // Controleer toegang
    if (userRole === 'client') {
      const hasAccess = await authorizeClient(userId, quote.project_id);
      if (!hasAccess) {
        return res.status(403).json({ 
          error: 'Geen toegang tot deze offerte' 
        });
      }
      
      // Verwijder interne informatie voor clients
      delete quote.internal_notes;
      delete quote.cost_price;
      delete quote.profit_margin;
    }

    await auditLog('QUOTE_DETAILS_FETCHED', {
      quoteId,
      userId,
      userRole,
      projectId: quote.project_id
    });

    res.json({ success: true, quote });

  } catch (error) {
    console.error('Get quote details error:', error);
    if (error.code === 'PGRST116') {
      return res.status(404).json({ error: 'Offerte niet gevonden' });
    }
    res.status(500).json({ error: 'Kon offertedetails niet ophalen' });
  }
});

/**
 * @route   POST /api/quotes/:requestId/generate
 * @desc    Genereer een nieuwe offerte voor een meerwerkaanvraag
 * @access  Private (Alleen projectleider/manager)
 */
router.post('/:requestId/generate', 
  authenticateToken, 
  validateQuoteRequest,
  quoteLimiter,
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

      // Alleen projectleiders of managers kunnen offertes aanmaken
      if (!['project_leader', 'manager', 'admin'].includes(userRole)) {
        return res.status(403).json({ 
          error: 'Niet geautoriseerd om offertes aan te maken' 
        });
      }

      const options = {
        includeDrawings: req.body.includeDrawings !== false,
        include3DPreview: req.body.include3DPreview || false,
        language: req.body.language || 'nl'
      };

      // 1. Maak offerte aan
      const creationResult = await QuoteService.createQuote(requestId, userId, options);
      
      // 2. Genereer PDF
      const pdfResult = await QuoteService.generateQuotePDF(creationResult.quote.id, options);

      await auditLog('QUOTE_GENERATED', {
        requestId,
        quoteId: creationResult.quote.id,
        quoteNumber: creationResult.quote.quote_number,
        generatedBy: userId,
        amount: creationResult.quote.total_amount
      });

      res.status(201).json({
        success: true,
        message: `Offerte ${creationResult.quote.quote_number} succesvol aangemaakt`,
        quote: pdfResult.quote,
        pdfUrl: pdfResult.pdfUrl,
        shareableLink: `/p/${creationResult.quote.project_id}/quote/${creationResult.quote.id}`
      });

    } catch (error) {
      console.error('Generate quote error:', error);
      
      await auditLog('QUOTE_GENERATION_FAILED', {
        requestId: req.params.requestId,
        userId: req.user?.id,
        error: error.message
      });

      const statusCode = error.message.includes('niet gevonden') ? 404 : 500;
      res.status(statusCode).json({ 
        error: error.message || 'Kon offerte niet genereren'
      });
    }
  }
);

/**
 * @route   POST /api/quotes/:quoteId/approve
 * @desc    Keur offerte goed als opdrachtgever
 * @access  Private (Alleen client)
 */
router.post('/:quoteId/approve', 
  authenticateToken, 
  validateQuoteApproval,
  async (req, res) => {
    try {
      const { quoteId } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

      // Alleen clients kunnen goedkeuren
      if (userRole !== 'client') {
        return res.status(403).json({ 
          error: 'Alleen opdrachtgevers kunnen offertes goedkeuren' 
        });
      }

      const clientData = {
        clientName: req.body.clientName || req.user.fullName,
        signatureData: req.body.signature,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      };

      // Controleer of client toegang heeft tot deze offerte
      const { data: quote } = await supabase
        .from('extra_work_quotes')
        .select('project_id')
        .eq('id', quoteId)
        .single();

      const hasAccess = await authorizeClient(userId, quote.project_id);
      if (!hasAccess) {
        return res.status(403).json({ 
          error: 'Geen toegang tot deze offerte' 
        });
      }

      // Verwerk goedkeuring
      const result = await QuoteService.approveQuote(quoteId, clientData);

      res.json({
        success: true,
        message: result.message,
        quote: result.quote,
        nextSteps: [
          'Projectleider is op de hoogte gesteld',
          'Planning wordt binnen 2 werkdagen gemaakt',
          'U ontvangt een bevestigingsmail'
        ]
      });

    } catch (error) {
      console.error('Approve quote error:', error);
      
      await auditLog('QUOTE_APPROVAL_API_FAILED', {
        quoteId: req.params.quoteId,
        userId: req.user?.id,
        error: error.message,
        ip: req.ip
      });

      const statusCode = error.message.includes('niet gevonden') ? 404 : 
                        error.message.includes('niet in juiste status') ? 409 : 500;
      
      res.status(statusCode).json({ 
        error: error.message || 'Kon goedkeuring niet verwerken'
      });
    }
  }
);

/**
 * @route   POST /api/quotes/:quoteId/decline
 * @desc    Afwijzen van offerte met reden
 * @access  Private (Alleen client)
 */
router.post('/:quoteId/decline', authenticateToken, async (req, res) => {
  try {
    const { quoteId } = req.params;
    const { reason, feedback } = req.body;
    const userId = req.user.id;

    if (!reason) {
      return res.status(400).json({ error: 'Reden voor afwijzing is verplicht' });
    }

    const { data: quote } = await supabase
      .from('extra_work_quotes')
      .select('project_id, quote_number')
      .eq('id', quoteId)
      .single();

    const hasAccess = await authorizeClient(userId, quote.project_id);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Geen toegang' });
    }

    // Update status
    const { data: updatedQuote } = await supabase
      .from('extra_work_quotes')
      .update({
        status: 'declined_by_client',
        decline_reason: reason,
        client_feedback: feedback,
        declined_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', quoteId)
      .select()
      .single();

    // Notificatie naar projectleider
    await sendNotification({
      type: 'QUOTE_DECLINED',
      recipient: (await supabase
        .from('projects')
        .select('project_leader_email')
        .eq('id', quote.project_id)
        .single()).data.project_leader_email,
      subject: `Offerte afgewezen - ${quote.quote_number}`,
      data: {
        quoteNumber: quote.quote_number,
        reason,
        feedback,
        declinedBy: req.user.fullName
      }
    });

    await auditLog('QUOTE_DECLINED', {
      quoteId,
      quoteNumber: quote.quote_number,
      reason,
      declinedBy: userId
    });

    res.json({
      success: true,
      message: 'Offerte afgewezen. Projectleider is op de hoogte gesteld.',
      quote: updatedQuote
    });

  } catch (error) {
    console.error('Decline quote error:', error);
    res.status(500).json({ error: 'Kon afwijzing niet verwerken' });
  }
});

/**
 * @route   POST /api/quotes/:quoteId/request-changes
 * @desc    Vraag wijzigingen aan bij offerte
 * @access  Private (Alleen client)
 */
router.post('/:quoteId/request-changes', authenticateToken, async (req, res) => {
  try {
    const { quoteId } = req.params;
    const { requestedChanges, comments } = req.body;
    const userId = req.user.id;

    if (!requestedChanges || requestedChanges.length === 0) {
      return res.status(400).json({ error: 'Geef aan welke wijzigingen gewenst zijn' });
    }

    const { data: quote } = await supabase
      .from('extra_work_quotes')
      .select('project_id, quote_number')
      .eq('id', quoteId)
      .single();

    const hasAccess = await authorizeClient(userId, quote.project_id);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Geen toegang' });
    }

    // Update status en sla wijzigingsverzoek op
    const { data: updatedQuote } = await supabase
      .from('extra_work_quotes')
      .update({
        status: 'changes_requested',
        changes_requested: requestedChanges,
        client_comments: comments,
        changes_requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', quoteId)
      .select()
      .single();

    // Maak nieuwe offerte versie aan op basis van wijzigingen
    const newQuoteResult = await QuoteService.createRevisedQuote(quoteId, requestedChanges);

    await auditLog('QUOTE_CHANGES_REQUESTED', {
      quoteId,
      originalQuote: quote.quote_number,
      newQuote: newQuoteResult.quote.quote_number,
      changesCount: requestedChanges.length,
      requestedBy: userId
    });

    res.json({
      success: true,
      message: `Wijzigingen doorgevoerd in nieuwe offerte ${newQuoteResult.quote.quote_number}`,
      originalQuote: updatedQuote,
      revisedQuote: newQuoteResult.quote,
      changes: requestedChanges
    });

  } catch (error) {
    console.error('Request changes error:', error);
    res.status(500).json({ error: 'Kon wijzigingsverzoek niet verwerken' });
  }
});

/**
 * @route   GET /api/quotes/:quoteId/download
 * @desc    Download PDF van offerte
 * @access  Private
 */
router.get('/:quoteId/download', authenticateToken, async (req, res) => {
  try {
    const { quoteId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Haal PDF pad op
    const { data: quote } = await supabase
      .from('extra_work_quotes')
      .select('pdf_url, project_id')
      .eq('id', quoteId)
      .single();

    if (!quote || !quote.pdf_url) {
      return res.status(404).json({ error: 'PDF niet gevonden' });
    }

    // Controleer toegang
    if (userRole === 'client') {
      const hasAccess = await authorizeClient(userId, quote.project_id);
      if (!hasAccess) return res.status(403).json({ error: 'Geen toegang' });
    }

    // Vervang /quotes/ naar fysiek pad
    const filePath = path.join(
      __dirname, 
      '../../public', 
      quote.pdf_url.replace('/quotes/', '')
    );

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'PDF bestand niet gevonden op server' });
    }

    // Log download
    await auditLog('QUOTE_PDF_DOWNLOADED', {
      quoteId,
      userId,
      userRole,
      filePath
    });

    // Stuur PDF
    res.download(filePath, `offerte-${quoteId}.pdf`, (err) => {
      if (err) console.error('Download error:', err);
    });

  } catch (error) {
    console.error('Download PDF error:', error);
    res.status(500).json({ error: 'Kon PDF niet downloaden' });
  }
});

/**
 * @route   GET /api/quotes/:quoteId/status
 * @desc    Check offerte status (voor real-time updates)
 * @access  Private
 */
router.get('/:quoteId/status', authenticateToken, async (req, res) => {
  try {
    const { quoteId } = req.params;

    const { data: quote } = await supabase
      .from('extra_work_quotes')
      .select('status, updated_at, pdf_url, approved_at')
      .eq('id', quoteId)
      .single();

    if (!quote) {
      return res.status(404).json({ error: 'Offerte niet gevonden' });
    }

    res.json({
      success: true,
      status: quote.status,
      lastUpdated: quote.updated_at,
      hasPDF: !!quote.pdf_url,
      isApproved: !!quote.approved_at,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Kon status niet ophalen' });
  }
});

export default router;
