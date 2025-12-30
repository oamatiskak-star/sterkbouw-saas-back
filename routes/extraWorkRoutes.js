// Backend/routes/extraWorkRoutes.js
import express from 'express';
import { authenticateToken, requireRole, authorizeClient, requireProjectAccess } from '../middleware/auth.js';
import { 
  validateRequest, 
  validateQuoteRequest, 
  validateQuoteApproval,
  validateFileUpload 
} from '../middleware/validation.js';
import QuoteService from '../services/quoteService.js';
import ExtraWorkService from '../services/extraWorkService.js';
import { auditLog } from '../utils/auditLogger.js';
import { supabase } from '../config/database.js';
import multer from 'multer';
import path from 'path';

const router = express.Router();

// Multer configuratie voor bestandsuploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../../uploads/extra-work');
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

/**
 * @route   GET /api/extra-work/project/:projectId
 * @desc    Haal alle meerwerkaanvragen op voor een project
 * @access  Private
 */
router.get('/project/:projectId', 
  authenticateToken, 
  requireProjectAccess,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const { status, limit = 50, offset = 0 } = req.query;
      const userRole = req.user.role;
      const userId = req.user.id;

      // Bouw query
      let query = supabase
        .from('extra_work_requests')
        .select(`
          *,
          client:client_id (
            full_name, email, phone_number
          ),
          project:project_id (
            name, project_leader_id
          ),
          quotes:extra_work_quotes (
            id, quote_number, status, total_amount, created_at
          ),
          drawings:drawing_links (
            id, title, file_url, created_at
          )
        `)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      // Filter op status indien opgegeven
      if (status) {
        query = query.in('status', Array.isArray(status) ? status : [status]);
      }

      // Voor clients: alleen eigen aanvragen tonen
      if (userRole === 'client') {
        query = query.eq('client_id', userId);
      }

      const { data: requests, error, count } = await query;

      if (error) throw error;

      // Audit log
      await auditLog('EXTRA_WORK_REQUESTS_FETCHED', {
        projectId,
        userId,
        userRole,
        count: requests?.length || 0,
        filters: { status, limit, offset }
      });

      res.json({
        success: true,
        requests: requests || [],
        pagination: {
          total: count || 0,
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      });

    } catch (error) {
      console.error('Get extra work requests error:', error);
      res.status(500).json({ 
        error: 'Kon meerwerkaanvragen niet ophalen',
        code: 'FETCH_REQUESTS_FAILED'
      });
    }
  }
);

/**
 * @route   GET /api/extra-work/:requestId
 * @desc    Haal specifieke meerwerkaanvraag op met alle details
 * @access  Private
 */
router.get('/:requestId', 
  authenticateToken, 
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const userRole = req.user.role;
      const userId = req.user.id;

      // Haal aanvraag op met alle details
      const { data: request, error } = await supabase
        .from('extra_work_requests')
        .select(`
          *,
          client:client_id (
            id, full_name, email, phone_number, company_name
          ),
          project:project_id (
            id, name, address, project_leader_id,
            project_leader:project_leader_id (
              full_name, email, phone_number
            )
          ),
          quotes:extra_work_quotes (
            id, quote_number, status, total_amount, 
            pdf_url, created_at, valid_until,
            materials:quote_materials (
              description, quantity, unit_price, total
            ),
            labor:quote_labor (
              description, hours, hourly_rate, total
            )
          ),
          drawings:drawing_links (
            id, title, description, file_url, 
            thumbnail_url, revision, created_at
          ),
          location_photos:location_photos (
            id, url, description, taken_at
          ),
          materials:requested_materials (
            id, description, quantity, unit_price, supplier, notes
          )
        `)
        .eq('id', requestId)
        .single();

      if (error || !request) {
        return res.status(404).json({
          error: 'Meerwerkaanvraag niet gevonden',
          code: 'REQUEST_NOT_FOUND'
        });
      }

      // Controleer toegang
      const hasAccess = await checkRequestAccess(userId, userRole, request);
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Geen toegang tot deze meerwerkaanvraag',
          code: 'NO_REQUEST_ACCESS'
        });
      }

      // Voor clients: verwijder interne informatie
      if (userRole === 'client') {
        delete request.internal_notes;
        delete request.cost_estimate;
        delete request.profit_margin;
      }

      await auditLog('EXTRA_WORK_REQUEST_VIEWED', {
        requestId,
        projectId: request.project_id,
        userId,
        userRole
      });

      res.json({
        success: true,
        request
      });

    } catch (error) {
      console.error('Get request details error:', error);
      res.status(500).json({ 
        error: 'Kon aanvraagdetails niet ophalen',
        code: 'FETCH_REQUEST_DETAILS_FAILED'
      });
    }
  }
);

/**
 * @route   POST /api/extra-work
 * @desc    Maak een nieuwe meerwerkaanvraag
 * @access  Private
 */
router.post('/',
  authenticateToken,
  upload.array('attachments', 5),
  validateFileUpload(),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const requestData = req.body;

      // Valideer vereiste velden
      const requiredFields = ['project_id', 'description', 'location'];
      for (const field of requiredFields) {
        if (!requestData[field]) {
          return res.status(400).json({
            error: `Veld '${field}' is verplicht`,
            code: 'MISSING_REQUIRED_FIELD'
          });
        }
      }

      // Voor clients: automatisch client_id instellen
      if (userRole === 'client') {
        requestData.client_id = userId;
        
        // Controleer of client toegang heeft tot dit project
        const hasAccess = await authorizeClient(userId, requestData.project_id);
        if (!hasAccess) {
          return res.status(403).json({
            error: 'Geen toegang tot dit project',
            code: 'CLIENT_NO_PROJECT_ACCESS'
          });
        }
      }

      // Maak aanvraag aan
      const { data: newRequest, error: createError } = await supabase
        .from('extra_work_requests')
        .insert([{
          ...requestData,
          status: userRole === 'client' ? 'pending' : 'under_review',
          created_by: userId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (createError) throw createError;

      // Verwerk geüploade bestanden
      if (req.files && req.files.length > 0) {
        await processUploadedFiles(req.files, newRequest.id, userId);
      }

      // Verwerk materialen indien meegegeven
      if (requestData.materials && Array.isArray(requestData.materials)) {
        await saveRequestMaterials(newRequest.id, requestData.materials);
      }

      // Stuur notificatie naar projectleider
      if (userRole === 'client') {
        await sendRequestNotification(newRequest.id, 'new_request_from_client');
      }

      await auditLog('EXTRA_WORK_REQUEST_CREATED', {
        requestId: newRequest.id,
        projectId: newRequest.project_id,
        createdBy: userId,
        userRole,
        hasAttachments: !!req.files?.length,
        materialCount: requestData.materials?.length || 0
      });

      res.status(201).json({
        success: true,
        message: 'Meerwerkaanvraag succesvol aangemaakt',
        request: newRequest,
        nextStep: 'De projectleider zal de aanvraag beoordelen en een offerte maken.'
      });

    } catch (error) {
      console.error('Create request error:', error);
      res.status(500).json({ 
        error: 'Kon meerwerkaanvraag niet aanmaken',
        code: 'CREATE_REQUEST_FAILED',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

/**
 * @route   PUT /api/extra-work/:requestId
 * @desc    Update een meerwerkaanvraag
 * @access  Private
 */
router.put('/:requestId',
  authenticateToken,
  requireRole('project_leader', 'manager', 'admin'),
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const userId = req.user.id;
      const updates = req.body;

      // Haal huidige aanvraag op
      const { data: currentRequest, error: fetchError } = await supabase
        .from('extra_work_requests')
        .select('project_id, status')
        .eq('id', requestId)
        .single();

      if (fetchError) throw fetchError;

      // Controleer of update is toegestaan
      if (currentRequest.status === 'quote_approved') {
        return res.status(409).json({
          error: 'Aanvraag kan niet worden gewijzigd na goedkeuring offerte',
          code: 'REQUEST_LOCKED'
        });
      }

      // Update aanvraag
      const { data: updatedRequest, error: updateError } = await supabase
        .from('extra_work_requests')
        .update({
          ...updates,
          updated_by: userId,
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId)
        .select()
        .single();

      if (updateError) throw updateError;

      await auditLog('EXTRA_WORK_REQUEST_UPDATED', {
        requestId,
        projectId: updatedRequest.project_id,
        updatedBy: userId,
        changes: Object.keys(updates),
        oldStatus: currentRequest.status,
        newStatus: updatedRequest.status
      });

      res.json({
        success: true,
        message: 'Meerwerkaanvraag succesvol bijgewerkt',
        request: updatedRequest
      });

    } catch (error) {
      console.error('Update request error:', error);
      res.status(500).json({ 
        error: 'Kon aanvraag niet bijwerken',
        code: 'UPDATE_REQUEST_FAILED'
      });
    }
  }
);

/**
 * @route   POST /api/extra-work/:requestId/request-quote
 * @desc    Vraag offerte aan voor meerwerkaanvraag
 * @access  Private (Client)
 */
router.post('/:requestId/request-quote',
  authenticateToken,
  requireRole('client'),
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const userId = req.user.id;

      // Controleer of aanvraag bestaat en van deze client is
      const { data: request, error: fetchError } = await supabase
        .from('extra_work_requests')
        .select('id, project_id, client_id, status')
        .eq('id', requestId)
        .single();

      if (fetchError) throw fetchError;

      if (request.client_id !== userId) {
        return res.status(403).json({
          error: 'Alleen de aanvrager kan een offerte aanvragen',
          code: 'NOT_REQUEST_OWNER'
        });
      }

      // Controleer status
      if (request.status !== 'pending') {
        return res.status(400).json({
          error: `Aanvraag is niet in juiste status voor offerteaanvraag. Huidige status: ${request.status}`,
          code: 'INVALID_REQUEST_STATUS'
        });
      }

      // Update status naar offerte aangevraagd
      const { data: updatedRequest, error: updateError } = await supabase
        .from('extra_work_requests')
        .update({
          status: 'quote_requested',
          quote_requested_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId)
        .select()
        .single();

      if (updateError) throw updateError;

      // Stuur notificatie naar projectleider
      await sendRequestNotification(requestId, 'quote_requested_by_client');

      await auditLog('QUOTE_REQUESTED_BY_CLIENT', {
        requestId,
        projectId: request.project_id,
        clientId: userId,
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        message: 'Offerte succesvol aangevraagd. De projectleider wordt op de hoogte gesteld.',
        request: updatedRequest
      });

    } catch (error) {
      console.error('Request quote error:', error);
      res.status(500).json({ 
        error: 'Kon offerte niet aanvragen',
        code: 'REQUEST_QUOTE_FAILED'
      });
    }
  }
);

/**
 * @route   POST /api/extra-work/:requestId/generate-quote
 * @desc    Genereer offerte voor meerwerkaanvraag
 * @access  Private (Projectleider, Manager, Admin)
 */
router.post('/:requestId/generate-quote',
  authenticateToken,
  requireRole('project_leader', 'manager', 'admin'),
  validateQuoteRequest,
  validateRequest('quoteRequest'),
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const userId = req.user.id;
      const options = req.body;

      // Gebruik QuoteService om offerte te genereren
      const result = await QuoteService.createQuote(requestId, userId, options);
      const pdfResult = await QuoteService.generateQuotePDF(result.quote.id, options);

      res.status(201).json({
        success: true,
        message: `Offerte ${result.quote.quote_number} succesvol gegenereerd`,
        quote: pdfResult.quote,
        pdfUrl: pdfResult.pdfUrl,
        shareableLink: `/p/${result.quote.project_id}/quote/${result.quote.id}`
      });

    } catch (error) {
      console.error('Generate quote error:', error);
      
      const statusCode = error.message.includes('niet gevonden') ? 404 : 500;
      res.status(statusCode).json({ 
        error: error.message || 'Kon offerte niet genereren',
        code: 'GENERATE_QUOTE_FAILED'
      });
    }
  }
);

/**
 * @route   POST /api/extra-work/:requestId/approve
 * @desc    Keur meerwerkaanvraag goed (voor projectleider)
 * @access  Private (Projectleider, Manager, Admin)
 */
router.post('/:requestId/approve',
  authenticateToken,
  requireRole('project_leader', 'manager', 'admin'),
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const userId = req.user.id;
      const { notes, estimated_hours, priority } = req.body;

      // Haal aanvraag op
      const { data: request, error: fetchError } = await supabase
        .from('extra_work_requests')
        .select('*')
        .eq('id', requestId)
        .single();

      if (fetchError) throw fetchError;

      // Controleer status
      if (!['pending', 'under_review', 'quote_requested'].includes(request.status)) {
        return res.status(400).json({
          error: `Aanvraag kan niet worden goedgekeurd in huidige status: ${request.status}`,
          code: 'INVALID_STATUS_FOR_APPROVAL'
        });
      }

      // Update aanvraag
      const { data: updatedRequest, error: updateError } = await supabase
        .from('extra_work_requests')
        .update({
          status: 'approved_for_quote',
          approved_by: userId,
          approved_at: new Date().toISOString(),
          approval_notes: notes,
          estimated_hours: estimated_hours || request.estimated_hours,
          priority: priority || request.priority,
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId)
        .select()
        .single();

      if (updateError) throw updateError;

      // Stuur notificatie naar client
      await sendRequestNotification(requestId, 'request_approved_for_quote');

      await auditLog('EXTRA_WORK_REQUEST_APPROVED', {
        requestId,
        projectId: request.project_id,
        approvedBy: userId,
        estimatedHours: estimated_hours,
        priority
      });

      res.json({
        success: true,
        message: 'Meerwerkaanvraag goedgekeurd voor offerte',
        request: updatedRequest,
        nextStep: 'Er kan nu een offerte worden gegenereerd voor deze aanvraag.'
      });

    } catch (error) {
      console.error('Approve request error:', error);
      res.status(500).json({ 
        error: 'Kon aanvraag niet goedkeuren',
        code: 'APPROVE_REQUEST_FAILED'
      });
    }
  }
);

/**
 * @route   POST /api/extra-work/:requestId/decline
 * @desc    Wijzig meerwerkaanvraag af
 * @access  Private (Projectleider, Manager, Admin)
 */
router.post('/:requestId/decline',
  authenticateToken,
  requireRole('project_leader', 'manager', 'admin'),
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const userId = req.user.id;
      const { reason, feedback, alternative_suggestion } = req.body;

      if (!reason) {
        return res.status(400).json({
          error: 'Reden voor afwijzing is verplicht',
          code: 'DECLINE_REASON_REQUIRED'
        });
      }

      // Update aanvraag
      const { data: updatedRequest, error: updateError } = await supabase
        .from('extra_work_requests')
        .update({
          status: 'declined',
          declined_by: userId,
          declined_at: new Date().toISOString(),
          decline_reason: reason,
          feedback_to_client: feedback,
          alternative_suggestion: alternative_suggestion,
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId)
        .select()
        .single();

      if (updateError) throw updateError;

      // Stuur notificatie naar client
      await sendRequestNotification(requestId, 'request_declined');

      await auditLog('EXTRA_WORK_REQUEST_DECLINED', {
        requestId,
        projectId: updatedRequest.project_id,
        declinedBy: userId,
        reason,
        hasFeedback: !!feedback,
        hasAlternative: !!alternative_suggestion
      });

      res.json({
        success: true,
        message: 'Meerwerkaanvraag afgewezen',
        request: updatedRequest
      });

    } catch (error) {
      console.error('Decline request error:', error);
      res.status(500).json({ 
        error: 'Kon aanvraag niet afwijzen',
        code: 'DECLINE_REQUEST_FAILED'
      });
    }
  }
);

/**
 * @route   POST /api/extra-work/:requestId/cancel
 * @desc    Annuleer meerwerkaanvraag (alleen door aanvrager)
 * @access  Private
 */
router.post('/:requestId/cancel',
  authenticateToken,
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const userId = req.user.id;
      const { reason } = req.body;

      // Controleer of gebruiker de aanvrager is
      const { data: request, error: fetchError } = await supabase
        .from('extra_work_requests')
        .select('client_id, status')
        .eq('id', requestId)
        .single();

      if (fetchError) throw fetchError;

      if (request.client_id !== userId && req.user.role !== 'admin') {
        return res.status(403).json({
          error: 'Alleen de aanvrager kan deze aanvraag annuleren',
          code: 'NOT_AUTHORIZED_TO_CANCEL'
        });
      }

      // Controleer of annulering mogelijk is
      if (['quote_approved', 'in_progress', 'completed'].includes(request.status)) {
        return res.status(409).json({
          error: `Aanvraag kan niet worden geannuleerd in huidige status: ${request.status}`,
          code: 'CANNOT_CANCEL_IN_STATUS'
        });
      }

      // Update aanvraag
      const { data: updatedRequest, error: updateError } = await supabase
        .from('extra_work_requests')
        .update({
          status: 'cancelled',
          cancelled_by: userId,
          cancelled_at: new Date().toISOString(),
          cancellation_reason: reason,
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId)
        .select()
        .single();

      if (updateError) throw updateError;

      // Stuur notificatie naar projectleider
      await sendRequestNotification(requestId, 'request_cancelled_by_client');

      await auditLog('EXTRA_WORK_REQUEST_CANCELLED', {
        requestId,
        cancelledBy: userId,
        reason,
        previousStatus: request.status
      });

      res.json({
        success: true,
        message: 'Meerwerkaanvraag geannuleerd',
        request: updatedRequest
      });

    } catch (error) {
      console.error('Cancel request error:', error);
      res.status(500).json({ 
        error: 'Kon aanvraag niet annuleren',
        code: 'CANCEL_REQUEST_FAILED'
      });
    }
  }
);

/**
 * @route   POST /api/extra-work/:requestId/upload-drawing
 * @desc    Upload tekening voor meerwerkaanvraag
 * @access  Private (Projectleider, Manager, Admin)
 */
router.post('/:requestId/upload-drawing',
  authenticateToken,
  requireRole('project_leader', 'manager', 'admin'),
  upload.single('drawing'),
  validateFileUpload(),
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const userId = req.user.id;
      const { title, description, revision } = req.body;

      if (!req.file) {
        return res.status(400).json({
          error: 'Geen bestand geüpload',
          code: 'NO_FILE_UPLOADED'
        });
      }

      // Sla tekening op in database
      const { data: drawing, error: drawingError } = await supabase
        .from('drawing_links')
        .insert([{
          request_id: requestId,
          title: title || 'Tekening voor meerwerk',
          description: description,
          file_url: `/uploads/extra-work/${req.file.filename}`,
          uploaded_by: userId,
          revision: revision || 'A',
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (drawingError) throw drawingError;

      await auditLog('DRAWING_UPLOADED_FOR_REQUEST', {
        requestId,
        drawingId: drawing.id,
        uploadedBy: userId,
        fileName: req.file.originalname,
        fileSize: req.file.size
      });

      res.status(201).json({
        success: true,
        message: 'Tekening succesvol geüpload',
        drawing
      });

    } catch (error) {
      console.error('Upload drawing error:', error);
      res.status(500).json({ 
        error: 'Kon tekening niet uploaden',
        code: 'UPLOAD_DRAWING_FAILED'
      });
    }
  }
);

/**
 * @route   GET /api/extra-work/:requestId/quote
 * @desc    Haal offerte op voor meerwerkaanvraag
 * @access  Private
 */
router.get('/:requestId/quote',
  authenticateToken,
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

      // Haal offerte op
      const { data: quote, error } = await supabase
        .from('extra_work_quotes')
        .select(`
          *,
          materials:quote_materials (*),
          labor:quote_labor (*),
          drawings:quote_drawings (
            drawing:drawing_id (*)
          )
        `)
        .eq('request_id', requestId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !quote) {
        return res.status(404).json({
          error: 'Geen offerte gevonden voor deze aanvraag',
          code: 'QUOTE_NOT_FOUND'
        });
      }

      // Controleer toegang
      const hasAccess = await checkQuoteAccess(userId, userRole, quote);
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Geen toegang tot deze offerte',
          code: 'NO_QUOTE_ACCESS'
        });
      }

      res.json({
        success: true,
        quote
      });

    } catch (error) {
      console.error('Get quote for request error:', error);
      res.status(500).json({ 
        error: 'Kon offerte niet ophalen',
        code: 'FETCH_QUOTE_FAILED'
      });
    }
  }
);

/**
 * @route   POST /api/extra-work/:requestId/status
 * @desc    Update status van meerwerkaanvraag
 * @access  Private (Projectleider, Manager, Admin)
 */
router.post('/:requestId/status',
  authenticateToken,
  requireRole('project_leader', 'manager', 'admin'),
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const { status, notes } = req.body;

      const validStatuses = [
        'pending', 'under_review', 'approved_for_quote',
        'quote_requested', 'quote_provided', 'quote_approved',
        'in_progress', 'completed', 'cancelled', 'declined'
      ];

      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error: `Ongeldige status: ${status}`,
          validStatuses,
          code: 'INVALID_STATUS'
        });
      }

      const { data: updatedRequest, error } = await supabase
        .from('extra_work_requests')
        .update({
          status,
          status_notes: notes,
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId)
        .select()
        .single();

      if (error) throw error;

      await auditLog('EXTRA_WORK_STATUS_CHANGED', {
        requestId,
        newStatus: status,
        changedBy: req.user.id,
        notes,
        projectId: updatedRequest.project_id
      });

      res.json({
        success: true,
        message: `Status bijgewerkt naar: ${status}`,
        request: updatedRequest
      });

    } catch (error) {
      console.error('Update status error:', error);
      res.status(500).json({ 
        error: 'Kon status niet bijwerken',
        code: 'UPDATE_STATUS_FAILED'
      });
    }
  }
);

/**
 * @route   GET /api/extra-work/stats/project/:projectId
 * @desc    Haal statistieken op voor meerwerk in project
 * @access  Private
 */
router.get('/stats/project/:projectId',
  authenticateToken,
  requireProjectAccess,
  async (req, res) => {
    try {
      const { projectId } = req.params;

      const [
        statusStats,
        monthlyStats,
        quoteStats
      ] = await Promise.all([
        getStatusStatistics(projectId),
        getMonthlyStatistics(projectId),
        getQuoteStatistics(projectId)
      ]);

      res.json({
        success: true,
        stats: {
          status: statusStats,
          monthly: monthlyStats,
          quotes: quoteStats,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Get statistics error:', error);
      res.status(500).json({ 
        error: 'Kon statistieken niet ophalen',
        code: 'FETCH_STATS_FAILED'
      });
    }
  }
);

// Helper functies

async function checkRequestAccess(userId, userRole, request) {
  // SUPER_ADMIN heeft altijd toegang
  const { data: superAdminCheck } = await supabase
    .from('users')
    .select('email')
    .eq('id', userId)
    .eq('email', 'o.amatiskak@sterkbouw.nl')
    .single();

  if (superAdminCheck) return true;

  switch (userRole) {
    case 'admin':
    case 'manager':
      return true;

    case 'project_leader':
      const { data: project } = await supabase
        .from('projects')
        .select('project_leader_id')
        .eq('id', request.project_id)
        .single();
      return project?.project_leader_id === userId;

    case 'client':
      return request.client_id === userId;

    default:
      return false;
  }
}

async function checkQuoteAccess(userId, userRole, quote) {
  // SUPER_ADMIN heeft altijd toegang
  const { data: superAdminCheck } = await supabase
    .from('users')
    .select('email')
    .eq('id', userId)
    .eq('email', 'o.amatiskak@sterkbouw.nl')
    .single();

  if (superAdminCheck) return true;

  switch (userRole) {
    case 'admin':
    case 'manager':
    case 'project_leader':
      return true;

    case 'client':
      const { data: projectClient } = await supabase
        .from('project_clients')
        .select('id')
        .eq('project_id', quote.project_id)
        .eq('client_id', userId)
        .single();
      return !!projectClient;

    default:
      return false;
  }
}

async function processUploadedFiles(files, requestId, userId) {
  const fileRecords = files.map(file => ({
    request_id: requestId,
    file_name: file.originalname,
    file_path: `/uploads/extra-work/${file.filename}`,
    file_type: file.mimetype,
    file_size: file.size,
    uploaded_by: userId,
    created_at: new Date().toISOString()
  }));

  const { error } = await supabase
    .from('request_attachments')
    .insert(fileRecords);

  if (error) throw error;
}

async function saveRequestMaterials(requestId, materials) {
  const materialRecords = materials.map(material => ({
    request_id: requestId,
    description: material.description,
    quantity: material.quantity,
    unit_price: material.unit_price,
    supplier: material.supplier,
    notes: material.notes,
    created_at: new Date().toISOString()
  }));

  const { error } = await supabase
    .from('requested_materials')
    .insert(materialRecords);

  if (error) throw error;
}

async function sendRequestNotification(requestId, notificationType) {
  try {
    // Implementeer notificatie logica
    // Gebruik de notificationService die we eerder hebben gemaakt
    console.log(`Notification ${notificationType} for request ${requestId}`);
  } catch (error) {
    console.error('Send notification error:', error);
    // Faal stil, blokkeer niet de hoofdactie
  }
}

async function getStatusStatistics(projectId) {
  const { data, error } = await supabase
    .from('extra_work_requests')
    .select('status')
    .eq('project_id', projectId);

  if (error) throw error;

  const statusCounts = data.reduce((acc, request) => {
    acc[request.status] = (acc[request.status] || 0) + 1;
    return acc;
  }, {});

  return {
    total: data.length,
    byStatus: statusCounts
  };
}

async function getMonthlyStatistics(projectId) {
  const currentYear = new Date().getFullYear();
  
  const { data, error } = await supabase
    .from('extra_work_requests')
    .select('created_at, total_amount')
    .eq('project_id', projectId)
    .gte('created_at', `${currentYear}-01-01`)
    .lte('created_at', `${currentYear}-12-31`);

  if (error) throw error;

  const monthlyStats = Array(12).fill(0).map(() => ({ count: 0, amount: 0 }));

  data.forEach(request => {
    const month = new Date(request.created_at).getMonth();
    monthlyStats[month].count += 1;
    monthlyStats[month].amount += (request.total_amount || 0);
  });

  return monthlyStats;
}

async function getQuoteStatistics(projectId) {
  const { data, error } = await supabase
    .from('extra_work_quotes')
    .select('status, total_amount')
    .eq('project_id', projectId);

  if (error) throw error;

  const quoteStats = {
    total: data.length,
    totalAmount: data.reduce((sum, quote) => sum + (quote.total_amount || 0), 0),
    byStatus: data.reduce((acc, quote) => {
      acc[quote.status] = (acc[quote.status] || 0) + 1;
      return acc;
    }, {})
  };

  return quoteStats;
}

export default router;
