// Backend/middleware/validation.js
import Joi from 'joi';
import { supabase } from '../config/database.js';
import { auditLog } from '../utils/auditLogger.js';

/**
 * Validatieschema's voor offerte-gerelateerde requests
 */
const validationSchemas = {
  // Schema voor offerte-aanvraag
  quoteRequest: Joi.object({
    includeDrawings: Joi.boolean().default(true),
    include3DPreview: Joi.boolean().default(false),
    language: Joi.string().valid('nl', 'en', 'de').default('nl'),
    additionalNotes: Joi.string().max(1000).allow('', null),
    urgency: Joi.string().valid('normal', 'urgent', 'very_urgent').default('normal'),
    requestedCompletionDate: Joi.date().min('now').iso(),
    specialRequirements: Joi.array().items(
      Joi.object({
        type: Joi.string().required(),
        description: Joi.string().required(),
        mandatory: Joi.boolean().default(false)
      })
    ).max(10)
  }),

  // Schema voor offerte-goedkeuring
  quoteApproval: Joi.object({
    clientName: Joi.string()
      .min(2)
      .max(100)
      .pattern(/^[a-zA-Z\s\-'.]+$/)
      .required()
      .messages({
        'string.pattern.base': 'Naam mag alleen letters, spaties, koppeltekens en punten bevatten'
      }),
    signature: Joi.string()
      .base64()
      .max(50000) // Max 50KB voor handtekening data
      .allow(null, '')
      .optional(),
    approvalMethod: Joi.string()
      .valid('digital', 'manual', 'email_confirmation')
      .default('digital'),
    ipAddress: Joi.string().ip(),
    termsAccepted: Joi.boolean().valid(true).required(),
    termsAcceptedAt: Joi.date().iso(),
    additionalComments: Joi.string().max(500).allow('', null)
  }),

  // Schema voor offerte-afwijzing
  quoteDecline: Joi.object({
    reason: Joi.string()
      .valid(
        'too_expensive',
        'not_needed_anymore',
        'timing_issues',
        'found_other_supplier',
        'scope_changed',
        'budget_constraints',
        'other'
      )
      .required(),
    feedback: Joi.string().max(1000).required().when('reason', {
      is: 'other',
      then: Joi.string().min(10).required()
    }),
    preferredAlternative: Joi.object({
      type: Joi.string().valid('revised_quote', 'different_scope', 'postpone'),
      details: Joi.string().max(500),
      expectedBudget: Joi.number().min(0).max(1000000)
    }).optional(),
    contactRequested: Joi.boolean().default(false)
  }),

  // Schema voor wijzigingsverzoek
  quoteChangeRequest: Joi.object({
    requestedChanges: Joi.array().items(
      Joi.object({
        section: Joi.string()
          .valid('materials', 'labor', 'scope', 'timeline', 'specifications')
          .required(),
        currentValue: Joi.string().required(),
        requestedValue: Joi.string().required(),
        reason: Joi.string().max(200).required(),
        impactOnPrice: Joi.string().valid('increase', 'decrease', 'neutral').default('neutral'),
        estimatedPriceChange: Joi.number().min(-100000).max(100000)
      })
    ).min(1).max(20).required(),
    comments: Joi.string().max(1000).allow('', null),
    deadlineForRevision: Joi.date().min('now').max('+90 days'),
    priority: Joi.string().valid('low', 'medium', 'high').default('medium')
  }),

  // Schema voor project-toegang
  projectAccess: Joi.object({
    projectId: Joi.string().uuid().required(),
    accessType: Joi.string().valid('view', 'edit', 'admin').default('view'),
    duration: Joi.string().regex(/^[1-9][0-9]*(d|w|m|y)$/), // 30d, 4w, 6m, 1y
    reason: Joi.string().max(200)
  })
};

/**
 * Algemene validatie middleware
 */
export const validateRequest = (schemaName) => {
  return async (req, res, next) => {
    try {
      const schema = validationSchemas[schemaName];
      if (!schema) {
        return res.status(500).json({ error: `Validatieschema '${schemaName}' niet gevonden` });
      }

      // Valideer request body
      const { error, value } = schema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
        convert: true
      });

      if (error) {
        const validationErrors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          type: detail.type
        }));

        // Log validatiefouten
        await auditLog('VALIDATION_FAILED', {
          schema: schemaName,
          errors: validationErrors,
          endpoint: req.originalUrl,
          userId: req.user?.id,
          ip: req.ip
        });

        return res.status(400).json({
          error: 'Validatiefouten gevonden',
          details: validationErrors,
          code: 'VALIDATION_ERROR'
        });
      }

      // Vervang request body met gevalideerde data
      req.body = value;
      next();

    } catch (validationError) {
      console.error('Validation middleware error:', validationError);
      res.status(500).json({ 
        error: 'Validatieproces mislukt',
        code: 'VALIDATION_PROCESS_ERROR'
      });
    }
  };
};

/**
 * Specifieke validatie voor offerte-aanvraag
 */
export const validateQuoteRequest = async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.id;

    // 1. Check of meerwerkaanvraag bestaat
    const { data: workRequest, error: requestError } = await supabase
      .from('extra_work_requests')
      .select(`
        id,
        status,
        project_id,
        client_id,
        estimated_hours,
        materials:requested_materials(count)
      `)
      .eq('id', requestId)
      .single();

    if (requestError || !workRequest) {
      return res.status(404).json({
        error: 'Meerwerkaanvraag niet gevonden',
        code: 'REQUEST_NOT_FOUND'
      });
    }

    // 2. Check of gebruiker toegang heeft tot dit project
    const hasAccess = await checkProjectAccess(userId, workRequest.project_id, req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Geen toegang tot dit project',
        code: 'NO_PROJECT_ACCESS'
      });
    }

    // 3. Check of offerte al bestaat voor deze aanvraag
    const { data: existingQuote } = await supabase
      .from('extra_work_quotes')
      .select('id, status')
      .eq('request_id', requestId)
      .in('status', ['concept', 'ready_for_review', 'approved_by_client'])
      .single();

    if (existingQuote) {
      return res.status(409).json({
        error: 'Er bestaat al een offerte voor deze aanvraag',
        quoteId: existingQuote.id,
        status: existingQuote.status,
        code: 'QUOTE_ALREADY_EXISTS'
      });
    }

    // 4. Check of aanvraag geschikt is voor offerte
    if (!['pending', 'quote_requested'].includes(workRequest.status)) {
      return res.status(400).json({
        error: `Meerwerkaanvraag is niet in juiste status voor offerte. Huidige status: ${workRequest.status}`,
        code: 'INVALID_REQUEST_STATUS'
      });
    }

    // 5. Check minimale informatie voor offerte
    if (workRequest.materials && workRequest.materials[0]?.count === 0) {
      return res.status(400).json({
        error: 'Meerwerkaanvraag bevat onvoldoende informatie voor offerte',
        missing: ['Materialen specificatie', 'Urenschatting'],
        code: 'INSUFFICIENT_REQUEST_DATA'
      });
    }

    // Sla gevalideerde data op in request
    req.validatedData = {
      workRequest,
      canProceed: true
    };

    next();

  } catch (error) {
    console.error('Quote request validation error:', error);
    res.status(500).json({ 
      error: 'Offerte-aanvraag validatie mislukt',
      code: 'QUOTE_VALIDATION_ERROR'
    });
  }
};

/**
 * Specifieke validatie voor offerte-goedkeuring
 */
export const validateQuoteApproval = async (req, res, next) => {
  try {
    const { quoteId } = req.params;
    const userId = req.user.id;

    // 1. Check of offerte bestaat en geldig is
    const { data: quote, error: quoteError } = await supabase
      .from('extra_work_quotes')
      .select(`
        id,
        quote_number,
        status,
        project_id,
        valid_until,
        total_amount,
        pdf_url
      `)
      .eq('id', quoteId)
      .single();

    if (quoteError || !quote) {
      return res.status(404).json({
        error: 'Offerte niet gevonden',
        code: 'QUOTE_NOT_FOUND'
      });
    }

    // 2. Check geldigheid
    const now = new Date();
    const validUntil = new Date(quote.valid_until);
    
    if (now > validUntil) {
      return res.status(410).json({
        error: 'Offerte is verlopen',
        quoteNumber: quote.quote_number,
        validUntil: quote.valid_until,
        code: 'QUOTE_EXPIRED'
      });
    }

    // 3. Check status
    if (quote.status !== 'ready_for_review') {
      const allowedStatuses = ['ready_for_review'];
      const isApproved = ['approved_by_client', 'approved_by_project_leader'].includes(quote.status);
      
      return res.status(isApproved ? 409 : 400).json({
        error: isApproved 
          ? 'Offerte is reeds goedgekeurd' 
          : `Offerte is niet in juiste status voor goedkeuring. Huidige status: ${quote.status}`,
        currentStatus: quote.status,
        allowedStatuses,
        code: isApproved ? 'QUOTE_ALREADY_APPROVED' : 'INVALID_QUOTE_STATUS'
      });
    }

    // 4. Check PDF beschikbaarheid
    if (!quote.pdf_url) {
      return res.status(400).json({
        error: 'Offerte PDF is niet beschikbaar',
        code: 'PDF_NOT_AVAILABLE'
      });
    }

    // 5. Check project toegang voor deze gebruiker
    const hasAccess = await checkProjectAccess(userId, quote.project_id, req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Geen toegang tot deze offerte',
        code: 'NO_QUOTE_ACCESS'
      });
    }

    // 6. Voor clients: extra checks
    if (req.user.role === 'client') {
      // Check of client echt bij dit project hoort
      const { data: clientCheck } = await supabase
        .from('project_clients')
        .select('id')
        .eq('project_id', quote.project_id)
        .eq('client_id', userId)
        .single();

      if (!clientCheck) {
        return res.status(403).json({
          error: 'Geen toegang tot deze offerte',
          code: 'CLIENT_NOT_AUTHORIZED'
        });
      }

      // Check maximum goedkeuringsbedrag (indien van toepassing)
      const maxAmount = await getClientApprovalLimit(userId, quote.project_id);
      if (maxAmount && quote.total_amount > maxAmount) {
        return res.status(403).json({
          error: 'Offertebedrag overschrijdt uw goedkeuringslimiet',
          quoteAmount: quote.total_amount,
          maxAmount,
          requires: 'Goedkeuring projectleider nodig',
          code: 'AMOUNT_EXCEEDS_LIMIT'
        });
      }
    }

    // Sla gevalideerde quote data op
    req.validatedQuote = {
      ...quote,
      isValid: true,
      canBeApproved: true
    };

    next();

  } catch (error) {
    console.error('Quote approval validation error:', error);
    res.status(500).json({ 
      error: 'Goedkeuringsvalidatie mislukt',
      code: 'APPROVAL_VALIDATION_ERROR'
    });
  }
};

/**
 * Helper: Check project toegang
 */
async function checkProjectAccess(userId, projectId, userRole) {
  // SUPER_ADMIN heeft altijd toegang
  const { data: superAdminCheck } = await supabase
    .from('users')
    .select('email')
    .eq('id', userId)
    .eq('email', 'o.amatiskak@sterkbouw.nl')
    .single();

  if (superAdminCheck) return true;

  // Check op basis van rol
  switch (userRole) {
    case 'admin':
    case 'manager':
      return true; // Hebben toegang tot alle projecten

    case 'project_leader':
      const { data: projectLeaderCheck } = await supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('project_leader_id', userId)
        .single();
      return !!projectLeaderCheck;

    case 'client':
      const { data: clientCheck } = await supabase
        .from('project_clients')
        .select('id')
        .eq('project_id', projectId)
        .eq('client_id', userId)
        .single();
      return !!clientCheck;

    default:
      return false;
  }
}

/**
 * Helper: Haal goedkeuringslimiet op voor client
 */
async function getClientApprovalLimit(userId, projectId) {
  const { data: limitSetting } = await supabase
    .from('client_approval_limits')
    .select('max_amount')
    .eq('client_id', userId)
    .eq('project_id', projectId)
    .single();

  return limitSetting?.max_amount || null;
}

/**
 * Validatie voor bestandsuploads (PDF, tekeningen, etc.)
 */
export const validateFileUpload = (options = {}) => {
  const defaults = {
    maxSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ['application/pdf', 'image/jpeg', 'image/png', 'application/zip'],
    maxFiles: 5
  };

  const config = { ...defaults, ...options };

  return async (req, res, next) => {
    try {
      if (!req.files || req.files.length === 0) {
        return next(); // Geen bestanden, skip validatie
      }

      const files = Array.isArray(req.files) ? req.files : [req.files];
      
      // Check aantal bestanden
      if (files.length > config.maxFiles) {
        return res.status(400).json({
          error: `Te veel bestanden. Maximaal ${config.maxFiles} toegestaan.`,
          code: 'TOO_MANY_FILES'
        });
      }

      const validationErrors = [];

      // Valideer elk bestand
      for (const file of files) {
        // Check bestandsgrootte
        if (file.size > config.maxSize) {
          validationErrors.push({
            filename: file.originalname,
            error: `Bestand is te groot (max ${config.maxSize / (1024 * 1024)}MB)`,
            size: file.size
          });
        }

        // Check bestandstype
        if (!config.allowedTypes.includes(file.mimetype)) {
          validationErrors.push({
            filename: file.originalname,
            error: `Bestandstype niet toegestaan: ${file.mimetype}`,
            allowedTypes: config.allowedTypes
          });
        }

        // Extra PDF validatie
        if (file.mimetype === 'application/pdf') {
          const pdfValidation = await validatePDF(file);
          if (!pdfValidation.valid) {
            validationErrors.push({
              filename: file.originalname,
              error: 'PDF validatie mislukt',
              details: pdfValidation.errors
            });
          }
        }
      }

      if (validationErrors.length > 0) {
        return res.status(400).json({
          error: 'Bestandsvalidatiefouten',
          details: validationErrors,
          code: 'FILE_VALIDATION_ERROR'
        });
      }

      // Sla gevalideerde bestanden op
      req.validatedFiles = files;
      next();

    } catch (error) {
      console.error('File upload validation error:', error);
      res.status(500).json({ 
        error: 'Bestandsvalidatie mislukt',
        code: 'FILE_VALIDATION_PROCESS_ERROR'
      });
    }
  };
};

/**
 * Helper: PDF validatie
 */
async function validatePDF(file) {
  // Implementeer PDF validatie logica
  // Bijvoorbeeld: controleer op PDF magic number, versleuteling, etc.
  return {
    valid: true,
    errors: []
  };
}

/**
 * Validatie voor API rate limiting headers
 */
export const validateRateLimitHeaders = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const clientVersion = req.headers['x-client-version'];

  // Vereiste headers voor bepaalde endpoints
  if (req.originalUrl.includes('/api/quotes/')) {
    if (!apiKey) {
      return res.status(400).json({
        error: 'API key vereist voor offerte endpoints',
        code: 'API_KEY_REQUIRED'
      });
    }

    // Valideer API key format
    if (!/^sk_[a-zA-Z0-9]{32}$/.test(apiKey)) {
      return res.status(400).json({
        error: 'Ongeldig API key format',
        code: 'INVALID_API_KEY_FORMAT'
      });
    }
  }

  next();
};

export default {
  validateRequest,
  validateQuoteRequest,
  validateQuoteApproval,
  validateFileUpload,
  validateRateLimitHeaders,
  schemas: validationSchemas
};
