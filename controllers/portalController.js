import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import { portalConfig } from '../config/portalConfig.js';
import { generateQuotePDF } from '../services/quoteGenerator.js';
import { auditLog } from '../utils/auditLogger.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Haal portaal data op voor specifiek project
 */
export const getPortalData = async (req, res) => {
  try {
    const { projectId } = req.params;
    const clientId = req.client.id;

    // Controleer toegang
    const { data: access, error: accessError } = await supabase
      .from('project_access')
      .select('role')
      .eq('project_id', projectId)
      .eq('client_id', clientId)
      .single();

    if (accessError || !access) {
      return res.status(403).json({ error: 'Geen toegang tot dit project' });
    }

    // Haal gepagineerde data op
    const section = req.params.section || 'overview';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    let data;
    
    switch(section) {
      case 'overview':
        data = await getProjectOverview(projectId);
        break;
      case 'contracts':
        data = await getContracts(projectId, page, limit);
        break;
      case 'extra-work':
        data = await getExtraWork(projectId, clientId, page, limit);
        break;
      case 'delivery':
        data = await getDeliveryStatus(projectId, page, limit);
        break;
      case 'communication':
        data = await getCommunication(projectId, clientId, page, limit);
        break;
      default:
        data = await getAllPortalData(projectId, clientId);
    }

    // Log de toegang
    await auditLog('PORTAL_ACCESS', {
      projectId,
      clientId,
      section,
      userAgent: req.headers['user-agent'],
      ip: req.ip
    });

    res.json({
      success: true,
      section,
      data,
      pagination: {
        page,
        limit,
        total: data.totalCount || data.length
      }
    });

  } catch (error) {
    console.error('Portal data error:', error);
    res.status(500).json({ 
      error: 'Kon portaal data niet laden',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Meerwerk aanvraag van opdrachtgever
 */
export const requestExtraWork = async (req, res) => {
  try {
    const { projectId } = req.params;
    const clientId = req.client.id;
    const { description, location, type, attachments, urgency } = req.body;

    // Valideer dat tekeningen zijn toegevoegd voor constructieve wijzigingen
    if (type === 'constructive' && (!attachments || attachments.length === 0)) {
      return res.status(400).json({
        error: 'Constructief meerwerk vereist tekeningen of schetsen'
      });
    }

    // Maak meerwerk aanvraag aan
    const extraWorkId = uuidv4();
    const { data, error } = await supabase
      .from('extra_work_requests')
      .insert({
        id: extraWorkId,
        project_id: projectId,
        client_id: clientId,
        description,
        location,
        type,
        status: 'requested',
        urgency: urgency || 'normal',
        attachments: attachments || [],
        requested_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    // Stuur notificatie naar projectleider
    await notifyProjectLeader(projectId, {
      type: 'EXTRA_WORK_REQUESTED',
      extraWorkId,
      clientId,
      description,
      urgency
    });

    // Log de actie
    await auditLog('EXTRA_WORK_REQUESTED', {
      projectId,
      clientId,
      extraWorkId,
      description
    });

    res.json({
      success: true,
      message: 'Meerwerkaanvraag succesvol ingediend',
      data: {
        id: extraWorkId,
        status: 'requested',
        estimatedReviewTime: '2-3 werkdagen'
      }
    });

  } catch (error) {
    console.error('Extra work request error:', error);
    res.status(500).json({ error: 'Kon meerwerk niet aanvragen' });
  }
};

/**
 * Offerte akkoord geven
 */
export const approveQuote = async (req, res) => {
  try {
    const { projectId, quoteId } = req.params;
    const clientId = req.client.id;
    const { conditions, electronicSignature } = req.body;

    // Haal offerte op
    const { data: quote, error: quoteError } = await supabase
      .from('extra_work_quotes')
      .select('*, extra_work_request(*)')
      .eq('id', quoteId)
      .eq('project_id', projectId)
      .single();

    if (quoteError || !quote) {
      return res.status(404).json({ error: 'Offerte niet gevonden' });
    }

    // Controleer of offerte nog geldig is
    if (new Date(quote.valid_until) < new Date()) {
      return res.status(400).json({ error: 'Offerte is verlopen' });
    }

    // Controleer of client bevoegd is
    if (quote.extra_work_request.client_id !== clientId) {
      return res.status(403).json({ error: 'Niet bevoegd voor deze offerte' });
    }

    // Update akkoord status
    const { error: updateError } = await supabase
      .from('extra_work_quotes')
      .update({
        client_approved: true,
        approved_at: new Date().toISOString(),
        approval_conditions: conditions || null,
        electronic_signature: electronicSignature || null,
        approval_ip: req.ip,
        approval_user_agent: req.headers['user-agent']
      })
      .eq('id', quoteId);

    if (updateError) throw updateError;

    // Update meerwerk status
    await supabase
      .from('extra_work_requests')
      .update({ status: 'approved' })
      .eq('id', quote.extra_work_request_id);

    // Genereer contract
    const contractUrl = await generateContract(quoteId);

    // Stuur bevestiging
    await notifyClientApproval(projectId, clientId, quoteId, contractUrl);

    // Log juridische akkoord
    await auditLog('QUOTE_APPROVED', {
      projectId,
      clientId,
      quoteId,
      amount: quote.total_amount,
      conditions,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Offerte succesvol goedgekeurd',
      data: {
        quoteId,
        contractUrl,
        nextSteps: ['Planning wordt aangepast', 'U ontvangt een bevestiging per email']
      }
    });

  } catch (error) {
    console.error('Quote approval error:', error);
    res.status(500).json({ error: 'Kon akkoord niet verwerken' });
  }
};

/**
 * Vraag stellen over project
 */
export const askQuestion = async (req, res) => {
  try {
    const { projectId } = req.params;
    const clientId = req.client.id;
    const { subject, message, category, attachments } = req.body;

    const questionId = uuidv4();
    
    const { data, error } = await supabase
      .from('client_questions')
      .insert({
        id: questionId,
        project_id: projectId,
        client_id: clientId,
        subject,
        message,
        category: category || 'general',
        status: 'open',
        attachments: attachments || [],
        asked_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    // Stuur naar project team
    await forwardToProjectTeam(projectId, {
      type: 'CLIENT_QUESTION',
      questionId,
      subject,
      priority: category === 'urgent' ? 'high' : 'normal'
    });

    res.json({
      success: true,
      message: 'Vraag succesvol verstuurd',
      data: {
        id: questionId,
        expectedResponseTime: '1-2 werkdagen',
        reference: `VRAAG-${questionId.slice(0, 8)}`
      }
    });

  } catch (error) {
    console.error('Ask question error:', error);
    res.status(500).json({ error: 'Kon vraag niet versturen' });
  }
};

/**
 * Contract bevestigen
 */
export const confirmContract = async (req, res) => {
  try {
    const { projectId, contractId } = req.params;
    const clientId = req.client.id;
    const { electronicSignature } = req.body;

    // Valideer contract
    const { data: contract, error: contractError } = await supabase
      .from('contracts')
      .select('*')
      .eq('id', contractId)
      .eq('project_id', projectId)
      .eq('requires_client_signature', true)
      .single();

    if (contractError || !contract) {
      return res.status(404).json({ error: 'Contract niet gevonden of vereist geen handtekening' });
    }

    // Controleer of niet al ondertekend
    if (contract.client_signed_at) {
      return res.status(400).json({ error: 'Contract is al ondertekend' });
    }

    // Update ondertekening
    const { error: updateError } = await supabase
      .from('contracts')
      .update({
        client_signed_at: new Date().toISOString(),
        electronic_signature: electronicSignature,
        signed_ip: req.ip,
        signed_user_agent: req.headers['user-agent']
      })
      .eq('id', contractId);

    if (updateError) throw updateError;

    // Genereer PDF met handtekening
    const signedPdfUrl = await generateSignedContract(contractId, electronicSignature);

    // Log juridische handtekening
    await auditLog('CONTRACT_SIGNED', {
      projectId,
      clientId,
      contractId,
      contractVersion: contract.version,
      signatureMethod: 'electronic',
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Contract succesvol ondertekend',
      data: {
        contractId,
        signedPdfUrl,
        effectiveDate: new Date().toISOString().split('T')[0]
      }
    });

  } catch (error) {
    console.error('Contract confirmation error:', error);
    res.status(500).json({ error: 'Kon contract niet bevestigen' });
  }
};

/**
 * Exporteer volledig dossier
 */
export const exportDossier = async (req, res) => {
  try {
    const { projectId } = req.params;
    const clientId = req.client.id;
    const { format, includeSections } = req.body;

    // Controleer export limiet
    const exportCount = await checkExportLimit(clientId);
    if (exportCount >= portalConfig.export.maxPerDay) {
      return res.status(429).json({ 
        error: 'Dagelijkse export limiet bereikt',
        limit: portalConfig.export.maxPerDay
      });
    }

    // Start export job
    const exportId = uuidv4();
    const exportJob = await supabase
      .from('export_jobs')
      .insert({
        id: exportId,
        project_id: projectId,
        client_id: clientId,
        format: format || 'zip',
        status: 'processing',
        requested_at: new Date().toISOString(),
        include_sections: includeSections || [
          'contracts',
          'drawings',
          'delivery',
          'extra_work',
          'communication',
          'approvals'
        ]
      })
      .select()
      .single();

    // Start achtergrond verwerking
    setTimeout(() => processExportJob(exportId), 100);

    res.json({
      success: true,
      message: 'Export gestart',
      data: {
        exportId,
        estimatedTime: '2-5 minuten',
        downloadUrl: `/api/portal/${projectId}/export/${exportId}/download`,
        statusUrl: `/api/portal/${projectId}/export/${exportId}/status`
      }
    });

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Kon export niet starten' });
  }
};

/**
 * Genereer magic link voor opdrachtgever
 */
export const generateMagicLink = async (req, res) => {
  try {
    const { projectId, clientEmail, expiresIn = '30d' } = req.body;
    
    // Controleer of project bestaat en client gekoppeld is
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*, clients(*)')
      .eq('id', projectId)
      .eq('clients.email', clientEmail)
      .single();

    if (projectError || !project) {
      return res.status(404).json({ error: 'Project of opdrachtgever niet gevonden' });
    }

    // Genereer token
    const token = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(expiresIn));

    // Sla token op
    const { error: tokenError } = await supabase
      .from('portal_access')
      .insert({
        project_id: projectId,
        client_id: project.clients.id,
        magic_link_token: token,
        expires_at: expiresAt.toISOString(),
        created_by: req.user?.id || 'system'
      });

    if (tokenError) throw tokenError;

    // Bouw URL
    const portalUrl = `${portalConfig.baseUrl}/p/${projectId}?token=${token}`;

    // Stuur email (optioneel)
    if (req.body.sendEmail !== false) {
      await sendMagicLinkEmail(clientEmail, portalUrl, expiresAt, project.name);
    }

    res.json({
      success: true,
      data: {
        token,
        url: portalUrl,
        expiresAt: expiresAt.toISOString(),
        qrCodeUrl: await generateQRCode(portalUrl)
      }
    });

  } catch (error) {
    console.error('Magic link generation error:', error);
    res.status(500).json({ error: 'Kon magic link niet genereren' });
  }
};

// Helper functies
async function getProjectOverview(projectId) {
  const { data, error } = await supabase
    .from('projects')
    .select(`
      name,
      status,
      expected_delivery,
      updated_at,
      delivery_points (count)
    `)
    .eq('id', projectId)
    .single();

  if (error) throw error;

  return {
    ...data,
    open_points: data.delivery_points?.filter(p => !p.completed).length || 0
  };
}

async function notifyProjectLeader(projectId, notification) {
  // Implementeer notificatie logica
  console.log(`Notificatie voor project ${projectId}:`, notification);
}

// Exporteer alle functies
export {
  getPortalData,
  requestExtraWork,
  approveQuote,
  askQuestion,
  confirmContract,
  exportDossier,
  generateMagicLink
};
