// Backend/routes/projectRoutes.js
import express from 'express';
import { authenticateToken, requireRole, requireProjectAccess, authorizeClient } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validation.js';
import { auditLog } from '../utils/auditLogger.js';
import notificationService from '../services/notificationService.js';
import { supabase } from '../config/database.js';
import multer from 'multer';
import path from 'path';

const router = express.Router();

// Multer config voor project afbeeldingen
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads/projects'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'project-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

/**
 * @route   GET /api/projects
 * @desc    Haal alle projecten op voor gebruiker
 * @access  Private
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { status, limit = 100, offset = 0 } = req.query;

    let projects = [];

    if (userRole === 'client') {
      // Clients: alleen hun eigen projecten
      const { data, error } = await supabase
        .from('project_clients')
        .select(`
          project:projects (
            id,
            name,
            address,
            status,
            start_date,
            end_date,
            client_name,
            client_email,
            project_leader:project_leader_id (full_name, email, phone_number),
            progress,
            last_updated,
            portal_access_enabled
          )
        `)
        .eq('client_id', userId)
        .eq('projects.portal_access_enabled', true);

      if (error) throw error;
      projects = data.map(item => item.project).filter(Boolean);
    } else {
      // Staff: alle projecten met filter op rol
      let query = supabase
        .from('projects')
        .select(`
          *,
          project_leader:project_leader_id (full_name, email, phone_number),
          client_count:project_clients(count)
        `)
        .order('created_at', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      // Project leaders: alleen hun eigen projecten
      if (userRole === 'project_leader') {
        query = query.eq('project_leader_id', userId);
      }

      if (status) {
        query = query.in('status', Array.isArray(status) ? status : [status]);
      }

      const { data, error } = await query;
      if (error) throw error;
      projects = data;
    }

    await auditLog('PROJECTS_FETCHED', {
      userId,
      userRole,
      count: projects.length,
      filters: { status, limit, offset }
    });

    res.json({
      success: true,
      projects,
      total: projects.length
    });

  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ 
      error: 'Kon projecten niet ophalen',
      code: 'FETCH_PROJECTS_FAILED'
    });
  }
});

/**
 * @route   GET /api/projects/:projectId
 * @desc    Haal specifiek project op met volledige details
 * @access  Private
 */
router.get('/:projectId', authenticateToken, requireProjectAccess, async (req, res) => {
  try {
    const { projectId } = req.params;
    const userRole = req.user.role;
    const userId = req.user.id;

    // Basis project query
    let query = supabase
      .from('projects')
      .select(`
        *,
        project_leader:project_leader_id (
          id, full_name, email, phone_number, avatar_url
        ),
        team_members:project_team_members (
          user:users (
            id, full_name, email, role, phone_number, avatar_url
          ),
          role_in_project
        ),
        clients:project_clients (
          client:users (
            id, full_name, email, company_name, phone_number
          ),
          access_level
        ),
        documents:project_documents (
          id, title, type, file_url, uploaded_by, created_at
        )
      `)
      .eq('id', projectId)
      .single();

    const { data: project, error } = await query;

    if (error || !project) {
      return res.status(404).json({
        error: 'Project niet gevonden',
        code: 'PROJECT_NOT_FOUND'
      });
    }

    // Voor clients: filter gevoelige informatie
    if (userRole === 'client') {
      delete project.internal_budget;
      delete project.profit_margin;
      delete project.cost_breakdown;
      delete project.team_salaries;
      
      // Alleen eigen client data tonen
      project.clients = project.clients.filter(client => 
        client.client?.id === userId
      );
    }

    // Haal statistieken op
    const stats = await getProjectStats(projectId, userRole, userId);

    await auditLog('PROJECT_DETAILS_FETCHED', {
      projectId,
      userId,
      userRole
    });

    res.json({
      success: true,
      project: {
        ...project,
        stats
      }
    });

  } catch (error) {
    console.error('Get project details error:', error);
    res.status(500).json({ 
      error: 'Kon projectdetails niet ophalen',
      code: 'FETCH_PROJECT_DETAILS_FAILED'
    });
  }
});

/**
 * @route   GET /api/projects/:projectId/portal
 * @desc    Haal portaal-specifieke project data op
 * @access  Private (Client toegang)
 */
router.get('/:projectId/portal', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;

    // Controleer client toegang
    const hasAccess = await authorizeClient(userId, projectId);
    if (!hasAccess && req.user.role !== 'client') {
      return res.status(403).json({
        error: 'Geen toegang tot dit projectportaal',
        code: 'NO_PORTAL_ACCESS'
      });
    }

    // Haal alle portaal data in één keer op
    const [
      projectData,
      extraWorkRequests,
      quotes,
      documents,
      communications,
      milestones
    ] = await Promise.all([
      getPortalProjectData(projectId),
      getPortalExtraWorkRequests(projectId, userId),
      getPortalQuotes(projectId, userId),
      getPortalDocuments(projectId, userId),
      getPortalCommunications(projectId, userId),
      getPortalMilestones(projectId, userId)
    ]);

    await auditLog('PORTAL_DATA_FETCHED', {
      projectId,
      userId,
      sections: ['project', 'extraWork', 'quotes', 'documents', 'communications', 'milestones']
    });

    res.json({
      success: true,
      portalData: {
        project: projectData,
        extraWork: extraWorkRequests,
        quotes,
        documents,
        communications,
        milestones,
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Get portal data error:', error);
    res.status(500).json({ 
      error: 'Kon portaal data niet ophalen',
      code: 'FETCH_PORTAL_DATA_FAILED'
    });
  }
});

/**
 * @route   POST /api/projects/:projectId/invite-client
 * @desc    Nodig client uit voor projectportaal
 * @access  Private (Projectleider, Admin)
 */
router.post('/:projectId/invite-client', 
  authenticateToken, 
  requireRole('project_leader', 'manager', 'admin'),
  validateRequest('clientInvite'),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user.id;
      const { clientEmail, clientName, accessLevel = 'standard' } = req.body;

      // Haal project op
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('name, portal_access_enabled')
        .eq('id', projectId)
        .single();

      if (projectError) throw projectError;

      if (!project.portal_access_enabled) {
        return res.status(400).json({
          error: 'Portaal toegang is niet ingeschakeld voor dit project',
          code: 'PORTAL_DISABLED'
        });
      }

      // Zoek of maak gebruiker
      let clientUserId;
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', clientEmail)
        .single();

      if (existingUser) {
        clientUserId = existingUser.id;
      } else {
        // Maak nieuwe gebruiker aan
        const { data: newUser, error: userError } = await supabase
          .from('users')
          .insert([{
            email: clientEmail,
            full_name: clientName,
            role: 'client',
            is_active: true,
            created_at: new Date().toISOString()
          }])
          .select('id')
          .single();

        if (userError) throw userError;
        clientUserId = newUser.id;
      }

      // Voeg client toe aan project
      const { data: clientLink, error: linkError } = await supabase
        .from('project_clients')
        .insert([{
          project_id: projectId,
          client_id: clientUserId,
          invited_by: userId,
          invited_at: new Date().toISOString(),
          access_level: accessLevel,
          status: 'invited'
        }])
        .select()
        .single();

      if (linkError) throw linkError;

      // Genereer invite token
      const inviteToken = generateInviteToken(projectId, clientUserId);
      const inviteLink = `${process.env.PORTAL_URL}/p/${projectId}/invite/${inviteToken}`;

      // Stuur uitnodiging
      await notificationService.sendNotification({
        type: 'PROJECT_INVITE',
        recipient: { email: clientEmail, name: clientName },
        subject: `Uitnodiging voor projectportaal: ${project.name}`,
        data: {
          projectName: project.name,
          inviteLink,
          invitedBy: req.user.fullName,
          expiresIn: '7 dagen'
        }
      });

      await auditLog('CLIENT_INVITED_TO_PORTAL', {
        projectId,
        projectName: project.name,
        clientEmail,
        clientName,
        invitedBy: userId,
        inviteLink,
        accessLevel
      });

      res.json({
        success: true,
        message: `Uitnodiging verstuurd naar ${clientEmail}`,
        inviteLink: process.env.NODE_ENV === 'development' ? inviteLink : undefined,
        clientLink
      });

    } catch (error) {
      console.error('Invite client error:', error);
      res.status(500).json({ 
        error: 'Kon client niet uitnodigen',
        code: 'INVITE_CLIENT_FAILED'
      });
    }
  }
);

/**
 * @route   POST /api/projects/:projectId/upload-document
 * @desc    Upload document naar project
 * @access  Private
 */
router.post('/:projectId/upload-document',
  authenticateToken,
  requireProjectAccess,
  upload.single('document'),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user.id;
      const { title, description, type, category } = req.body;

      if (!req.file) {
        return res.status(400).json({
          error: 'Geen bestand geüpload',
          code: 'NO_FILE_UPLOADED'
        });
      }

      // Valideer document type
      const allowedTypes = ['contract', 'drawing', 'report', 'photo', 'other'];
      if (type && !allowedTypes.includes(type)) {
        return res.status(400).json({
          error: `Ongeldig document type. Toegestaan: ${allowedTypes.join(', ')}`,
          code: 'INVALID_DOCUMENT_TYPE'
        });
      }

      // Sla document op
      const { data: document, error } = await supabase
        .from('project_documents')
        .insert([{
          project_id: projectId,
          title: title || req.file.originalname,
          description,
          file_name: req.file.originalname,
          file_path: `/uploads/projects/${req.file.filename}`,
          file_url: `${process.env.API_URL}/uploads/projects/${req.file.filename}`,
          file_type: req.file.mimetype,
          file_size: req.file.size,
          type: type || 'other',
          category: category || 'general',
          uploaded_by: userId,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) throw error;

      // Stuur notificatie naar projectteam
      await notificationService.notifyProjectTeam(projectId, {
        type: 'DOCUMENT_UPLOADED',
        subject: `Nieuw document: ${title || req.file.originalname}`,
        message: `Een nieuw document is geüpload voor project ${projectId}`,
        data: {
          documentId: document.id,
          fileName: req.file.originalname,
          uploadedBy: req.user.fullName
        }
      });

      await auditLog('PROJECT_DOCUMENT_UPLOADED', {
        projectId,
        documentId: document.id,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
        uploadedBy: userId
      });

      res.status(201).json({
        success: true,
        message: 'Document succesvol geüpload',
        document
      });

    } catch (error) {
      console.error('Upload document error:', error);
      res.status(500).json({ 
        error: 'Kon document niet uploaden',
        code: 'UPLOAD_DOCUMENT_FAILED'
      });
    }
  }
);

/**
 * @route   GET /api/projects/:projectId/documents
 * @desc    Haal alle documenten op voor project
 * @access  Private
 */
router.get('/:projectId/documents', authenticateToken, requireProjectAccess, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { type, category, limit = 50, offset = 0 } = req.query;
    const userRole = req.user.role;

    let query = supabase
      .from('project_documents')
      .select(`
        *,
        uploaded_by_user:users (full_name, email)
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (type) {
      query = query.in('type', Array.isArray(type) ? type : [type]);
    }

    if (category) {
      query = query.eq('category', category);
    }

    // Voor clients: alleen gedeelde documenten
    if (userRole === 'client') {
      query = query.eq('shared_with_clients', true);
    }

    const { data: documents, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      documents: documents || [],
      pagination: {
        total: documents?.length || 0,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });

  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ 
      error: 'Kon documenten niet ophalen',
      code: 'FETCH_DOCUMENTS_FAILED'
    });
  }
});

/**
 * @route   GET /api/projects/:projectId/timeline
 * @desc    Haal project tijdlijn/milestones op
 * @access  Private
 */
router.get('/:projectId/timeline', authenticateToken, requireProjectAccess, async (req, res) => {
  try {
    const { projectId } = req.params;

    const { data: milestones, error } = await supabase
      .from('project_milestones')
      .select(`
        *,
        completed_by_user:users (full_name)
      `)
      .eq('project_id', projectId)
      .order('due_date', { ascending: true });

    if (error) throw error;

    const { data: timelineEvents } = await supabase
      .from('project_timeline_events')
      .select('*')
      .eq('project_id', projectId)
      .order('event_date', { ascending: false })
      .limit(20);

    res.json({
      success: true,
      timeline: {
        milestones: milestones || [],
        recentEvents: timelineEvents || [],
        currentPhase: await getCurrentProjectPhase(projectId)
      }
    });

  } catch (error) {
    console.error('Get timeline error:', error);
    res.status(500).json({ 
      error: 'Kon tijdlijn niet ophalen',
      code: 'FETCH_TIMELINE_FAILED'
    });
  }
});

/**
 * @route   POST /api/projects/:projectId/communication
 * @desc    Verstuur bericht in project
 * @access  Private
 */
router.post('/:projectId/communication', 
  authenticateToken, 
  requireProjectAccess,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user.id;
      const { message, type = 'message', attachments, recipientIds } = req.body;

      if (!message?.trim()) {
        return res.status(400).json({
          error: 'Bericht is verplicht',
          code: 'MESSAGE_REQUIRED'
        });
      }

      // Sla bericht op
      const { data: communication, error } = await supabase
        .from('project_communications')
        .insert([{
          project_id: projectId,
          user_id: userId,
          message: message.trim(),
          type,
          attachments: attachments || [],
          recipient_ids: recipientIds || [], // Leeg array = naar iedereen
          created_at: new Date().toISOString()
        }])
        .select(`
          *,
          user:users (full_name, email, avatar_url)
        `)
        .single();

      if (error) throw error;

      // Stuur notificaties
      await sendCommunicationNotifications(projectId, communication, recipientIds);

      // Real-time update via Supabase
      await supabase
        .channel(`project-${projectId}-communications`)
        .send({
          type: 'broadcast',
          event: 'new-message',
          payload: communication
        });

      await auditLog('PROJECT_COMMUNICATION_SENT', {
        projectId,
        messageId: communication.id,
        senderId: userId,
        type,
        hasAttachments: !!(attachments && attachments.length > 0),
        recipientCount: recipientIds?.length || 'all'
      });

      res.status(201).json({
        success: true,
        message: 'Bericht verstuurd',
        communication
      });

    } catch (error) {
      console.error('Send communication error:', error);
      res.status(500).json({ 
        error: 'Kon bericht niet versturen',
        code: 'SEND_COMMUNICATION_FAILED'
      });
    }
  }
);

/**
 * @route   GET /api/projects/:projectId/communications
 * @desc    Haal communicatiegeschiedenis op
 * @access  Private
 */
router.get('/:projectId/communications', authenticateToken, requireProjectAccess, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { limit = 50, offset = 0, type } = req.query;
    const userId = req.user.id;

    let query = supabase
      .from('project_communications')
      .select(`
        *,
        user:users (full_name, email, avatar_url, role)
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    // Filter: alleen berichten waar gebruiker bij hoort
    query = query.or(`recipient_ids.cs.{${userId}},recipient_ids.is.null`);

    if (type) {
      query = query.eq('type', type);
    }

    const { data: communications, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      communications: communications || [],
      pagination: {
        total: communications?.length || 0,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });

  } catch (error) {
    console.error('Get communications error:', error);
    res.status(500).json({ 
      error: 'Kon communicatiegeschiedenis niet ophalen',
      code: 'FETCH_COMMUNICATIONS_FAILED'
    });
  }
});

/**
 * @route   GET /api/projects/:projectId/stats
 * @desc    Haal project statistieken op
 * @access  Private
 */
router.get('/:projectId/stats', authenticateToken, requireProjectAccess, async (req, res) => {
  try {
    const { projectId } = req.params;
    const userRole = req.user.role;

    const stats = await getProjectStats(projectId, userRole, req.user.id);

    res.json({
      success: true,
      stats,
      updatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get project stats error:', error);
    res.status(500).json({ 
      error: 'Kon statistieken niet ophalen',
      code: 'FETCH_STATS_FAILED'
    });
  }
});

/**
 * @route   POST /api/projects/:projectId/client-action
 * @desc    Verwerk actie van opdrachtgever (goedkeuring, vraag, etc.)
 * @access  Private (Client)
 */
router.post('/:projectId/client-action',
  authenticateToken,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user.id;
      const { actionType, payload } = req.body;

      // Controleer of gebruiker client is van dit project
      const hasAccess = await authorizeClient(userId, projectId);
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Geen toegang tot dit project',
          code: 'NO_PROJECT_ACCESS'
        });
      }

      // Valideer actie type
      const validActions = [
        'ASK_QUESTION',
        'CONFIRM_CONTRACT',
        'CONFIRM_DELIVERY_POINT',
        'REQUEST_EXTRA_WORK',
        'APPROVE_EXTRA_WORK_QUOTE',
        'DECLINE_EXTRA_WORK_QUOTE',
        'REQUEST_CHANGES',
        'UPLOAD_DOCUMENT',
        'SEND_MESSAGE'
      ];

      if (!validActions.includes(actionType)) {
        return res.status(400).json({
          error: `Ongeldige actie type: ${actionType}`,
          validActions,
          code: 'INVALID_ACTION_TYPE'
        });
      }

      // Verwerk de actie
      const result = await processClientAction(projectId, userId, actionType, payload);

      await auditLog('CLIENT_ACTION_PERFORMED', {
        projectId,
        clientId: userId,
        actionType,
        payload,
        result: result.success ? 'success' : 'failed'
      });

      res.json({
        success: true,
        message: result.message || 'Actie succesvol verwerkt',
        data: result.data,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Process client action error:', error);
      res.status(500).json({ 
        error: 'Kon actie niet verwerken',
        code: 'PROCESS_CLIENT_ACTION_FAILED',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// Helper functies

async function getProjectStats(projectId, userRole, userId) {
  const [
    extraWorkStats,
    quoteStats,
    documentStats,
    milestoneStats
  ] = await Promise.all([
    getExtraWorkStats(projectId, userRole, userId),
    getQuoteStats(projectId, userRole, userId),
    getDocumentStats(projectId, userRole, userId),
    getMilestoneStats(projectId)
  ]);

  return {
    extraWork: extraWorkStats,
    quotes: quoteStats,
    documents: documentStats,
    milestones: milestoneStats,
    lastUpdated: new Date().toISOString()
  };
}

async function getExtraWorkStats(projectId, userRole, userId) {
  let query = supabase
    .from('extra_work_requests')
    .select('status, total_amount')
    .eq('project_id', projectId);

  if (userRole === 'client') {
    query = query.eq('client_id', userId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const stats = {
    total: data.length,
    totalAmount: data.reduce((sum, req) => sum + (req.total_amount || 0), 0),
    byStatus: data.reduce((acc, req) => {
      acc[req.status] = (acc[req.status] || 0) + 1;
      return acc;
    }, {})
  };

  return stats;
}

async function getQuoteStats(projectId, userRole, userId) {
  let query = supabase
    .from('extra_work_quotes')
    .select('status, total_amount')
    .eq('project_id', projectId);

  if (userRole === 'client') {
    // Voor clients: alleen quotes van hun aanvragen
    const { data: clientRequests } = await supabase
      .from('extra_work_requests')
      .select('id')
      .eq('project_id', projectId)
      .eq('client_id', userId);

    if (clientRequests && clientRequests.length > 0) {
      const requestIds = clientRequests.map(r => r.id);
      query = query.in('request_id', requestIds);
    } else {
      return { total: 0, totalAmount: 0, byStatus: {} };
    }
  }

  const { data, error } = await query;
  if (error) throw error;

  const stats = {
    total: data.length,
    totalAmount: data.reduce((sum, quote) => sum + (quote.total_amount || 0), 0),
    byStatus: data.reduce((acc, quote) => {
      acc[quote.status] = (acc[quote.status] || 0) + 1;
      return acc;
    }, {})
  };

  return stats;
}

async function getDocumentStats(projectId, userRole, userId) {
  let query = supabase
    .from('project_documents')
    .select('type, shared_with_clients')
    .eq('project_id', projectId);

  if (userRole === 'client') {
    query = query.eq('shared_with_clients', true);
  }

  const { data, error } = await query;
  if (error) throw error;

  return {
    total: data.length,
    byType: data.reduce((acc, doc) => {
      acc[doc.type] = (acc[doc.type] || 0) + 1;
      return acc;
    }, {}),
    sharedWithClients: data.filter(doc => doc.shared_with_clients).length
  };
}

async function getMilestoneStats(projectId) {
  const { data, error } = await supabase
    .from('project_milestones')
    .select('status, due_date')
    .eq('project_id', projectId);

  if (error) throw error;

  const now = new Date();
  const upcoming = data.filter(m => 
    m.status === 'pending' && new Date(m.due_date) > now
  ).length;

  const overdue = data.filter(m => 
    m.status === 'pending' && new Date(m.due_date) < now
  ).length;

  return {
    total: data.length,
    completed: data.filter(m => m.status === 'completed').length,
    pending: data.filter(m => m.status === 'pending').length,
    upcoming,
    overdue
  };
}

async function getPortalProjectData(projectId) {
  const { data, error } = await supabase
    .from('projects')
    .select(`
      id,
      name,
      address,
      description,
      status,
      start_date,
      end_date,
      progress,
      client_name,
      client_email,
      project_leader:project_leader_id (full_name, email, phone_number),
      portal_settings
    `)
    .eq('id', projectId)
    .single();

  if (error) throw error;
  return data;
}

async function getPortalExtraWorkRequests(projectId, userId) {
  const { data, error } = await supabase
    .from('extra_work_requests')
    .select(`
      id,
      description,
      location,
      status,
      created_at,
      quotes:extra_work_quotes (
        id,
        quote_number,
        status,
        total_amount,
        pdf_url
      )
    `)
    .eq('project_id', projectId)
    .eq('client_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function getPortalQuotes(projectId, userId) {
  // Haal quotes op via de aanvragen van deze client
  const { data: requests } = await supabase
    .from('extra_work_requests')
    .select('id')
    .eq('project_id', projectId)
    .eq('client_id', userId);

  if (!requests || requests.length === 0) {
    return [];
  }

  const requestIds = requests.map(r => r.id);
  
  const { data, error } = await supabase
    .from('extra_work_quotes')
    .select(`
      *,
      request:extra_work_requests (description)
    `)
    .in('request_id', requestIds)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function getPortalDocuments(projectId, userId) {
  const { data, error } = await supabase
    .from('project_documents')
    .select(`
      id,
      title,
      description,
      type,
      file_url,
      file_size,
      created_at,
      uploaded_by_user:users (full_name)
    `)
    .eq('project_id', projectId)
    .eq('shared_with_clients', true)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return data || [];
}

async function getPortalCommunications(projectId, userId) {
  const { data, error } = await supabase
    .from('project_communications')
    .select(`
      id,
      message,
      type,
      created_at,
      user:users (full_name, avatar_url)
    `)
    .eq('project_id', projectId)
    .or(`recipient_ids.cs.{${userId}},recipient_ids.is.null`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return data || [];
}

async function getPortalMilestones(projectId, userId) {
  const { data, error } = await supabase
    .from('project_milestones')
    .select('*')
    .eq('project_id', projectId)
    .eq('visible_to_clients', true)
    .order('due_date', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getCurrentProjectPhase(projectId) {
  const { data: project } = await supabase
    .from('projects')
    .select('status, progress, start_date, end_date')
    .eq('id', projectId)
    .single();

  if (!project) return 'unknown';

  const phases = {
    'planning': { min: 0, max: 20 },
    'preparation': { min: 21, max: 40 },
    'execution': { min: 41, max: 80 },
    'completion': { min: 81, max: 100 }
  };

  for (const [phase, range] of Object.entries(phases)) {
    if (project.progress >= range.min && project.progress <= range.max) {
      return phase;
    }
  }

  return 'unknown';
}

function generateInviteToken(projectId, clientId) {
  const payload = {
    projectId,
    clientId,
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 dagen
  };
  
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

async function sendCommunicationNotifications(projectId, communication, recipientIds) {
  try {
    // Haal alle teamleden en clients op voor dit project
    const { data: recipients } = await supabase
      .from('project_team_members')
      .select('user_id')
      .eq('project_id', projectId)
      .union(
        supabase
          .from('project_clients')
          .select('client_id as user_id')
          .eq('project_id', projectId)
      );

    if (!recipients) return;

    // Filter op specifieke ontvangers indien opgegeven
    const finalRecipientIds = recipientIds && recipientIds.length > 0 
      ? recipients.filter(r => recipientIds.includes(r.user_id)).map(r => r.user_id)
      : recipients.map(r => r.user_id);

    // Haal gebruikersgegevens op
    const { data: users } = await supabase
      .from('users')
      .select('id, email, full_name')
      .in('id', finalRecipientIds)
      .neq('id', communication.user_id); // Verzender geen notificatie sturen

    if (!users) return;

    // Stuur notificaties
    const notificationPromises = users.map(user =>
      notificationService.sendNotification({
        type: 'NEW_MESSAGE',
        recipient: { email: user.email, name: user.full_name, userId: user.id },
        subject: `Nieuw bericht in project: ${projectId}`,
        message: communication.message.substring(0, 100) + '...',
        data: {
          projectId,
          messageId: communication.id,
          sender: communication.user.full_name,
          portalLink: `/p/${projectId}/communication`
        }
      })
    );

    await Promise.allSettled(notificationPromises);

  } catch (error) {
    console.error('Send communication notifications error:', error);
    // Faal stil, blokkeer niet de hoofdactie
  }
}

async function processClientAction(projectId, clientId, actionType, payload) {
  switch (actionType) {
    case 'ASK_QUESTION':
      return await processQuestion(projectId, clientId, payload);
    
    case 'CONFIRM_CONTRACT':
      return await confirmContract(projectId, clientId, payload);
    
    case 'APPROVE_EXTRA_WORK_QUOTE':
      return await approveQuote(payload.quoteId, {
        clientName: payload.clientName,
        signature: payload.signature,
        ip: payload.ip
      });
    
    case 'REQUEST_EXTRA_WORK':
      return await requestExtraWork(projectId, clientId, payload);
    
    default:
      throw new Error(`Actie type niet geïmplementeerd: ${actionType}`);
  }
}

async function processQuestion(projectId, clientId, payload) {
  const { data: question, error } = await supabase
    .from('client_questions')
    .insert([{
      project_id: projectId,
      client_id: clientId,
      subject: payload.subject,
      message: payload.message,
      status: 'open',
      created_at: new Date().toISOString()
    }])
    .select()
    .single();

  if (error) throw error;

  // Stuur notificatie naar projectleider
  await notificationService.notifyProjectTeam(projectId, {
    type: 'NEW_QUESTION',
    subject: `Nieuwe vraag van opdrachtgever: ${payload.subject}`,
    message: payload.message.substring(0, 200),
    data: {
      questionId: question.id,
      clientId,
      projectId
    }
  });

  return {
    success: true,
    message: 'Vraag succesvol verzonden',
    data: { questionId: question.id }
  };
}

async function confirmContract(projectId, clientId, payload) {
  const { data: contract, error } = await supabase
    .from('project_contracts')
    .update({
      confirmed_by_client: clientId,
      confirmed_at: new Date().toISOString(),
      confirmation_ip: payload.ip,
      client_signature: payload.signature,
      status: 'confirmed'
    })
    .eq('id', payload.documentId)
    .eq('project_id', projectId)
    .select()
    .single();

  if (error) throw error;

  return {
    success: true,
    message: 'Contract succesvol bevestigd',
    data: { contractId: contract.id }
  };
}

async function requestExtraWork(projectId, clientId, payload) {
  // Gebruik de bestaande extra work functionaliteit
  const { data: request, error } = await supabase
    .from('extra_work_requests')
    .insert([{
      project_id: projectId,
      client_id: clientId,
      description: payload.description,
      location: payload.location,
      urgency: payload.urgency,
      status: 'pending',
      created_at: new Date().toISOString()
    }])
    .select()
    .single();

  if (error) throw error;

  return {
    success: true,
    message: 'Meerwerkaanvraag succesvol ingediend',
    data: { requestId: request.id }
  };
}

async function approveQuote(quoteId, clientData) {
  // Gebruik de bestaande quote service
  const quoteService = await import('../services/quoteService.js').then(m => m.default);
  return await quoteService.approveQuote(quoteId, clientData);
}

export default router;
