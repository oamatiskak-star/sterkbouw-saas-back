// Backend/utils/auditLogger.js
import { supabase } from '../config/database.js';
import winston from 'winston';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuratie
const LOG_RETENTION_DAYS = 365; // 1 jaar bewaren
const SUPER_ADMIN_EMAIL = 'o.amatiskak@sterkbouw.nl';

// Audit event typen en categorieën
export const AuditEventTypes = {
  // Authenticatie & Toegang
  AUTHENTICATION: {
    LOGIN: 'USER_LOGIN',
    LOGOUT: 'USER_LOGOUT',
    LOGIN_FAILED: 'LOGIN_FAILED',
    TOKEN_REFRESH: 'TOKEN_REFRESH',
    PASSWORD_CHANGE: 'PASSWORD_CHANGE',
    SUPER_ADMIN_ACCESS: 'SUPER_ADMIN_ACCESS'
  },
  
  // Project & Portaal
  PROJECT: {
    ACCESS: 'PROJECT_ACCESS',
    CREATE: 'PROJECT_CREATED',
    UPDATE: 'PROJECT_UPDATED',
    DELETE: 'PROJECT_DELETED',
    PORTAL_ACCESS: 'PORTAL_ACCESS'
  },
  
  // Offerte & Meerwerk
  QUOTE: {
    CREATE: 'QUOTE_CREATED',
    GENERATE: 'QUOTE_GENERATED',
    VIEW: 'QUOTE_VIEWED',
    APPROVE: 'QUOTE_APPROVED',
    DECLINE: 'QUOTE_DECLINED',
    UPDATE: 'QUOTE_UPDATED',
    DELETE: 'QUOTE_DELETED',
    DOWNLOAD: 'QUOTE_DOWNLOADED',
    EXPORT: 'QUOTE_EXPORTED'
  },
  
  // Financieel
  FINANCIAL: {
    INVOICE_CREATE: 'INVOICE_CREATED',
    PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
    PAYMENT_FAILED: 'PAYMENT_FAILED',
    BUDGET_UPDATE: 'BUDGET_UPDATED'
  },
  
  // Documenten
  DOCUMENT: {
    UPLOAD: 'DOCUMENT_UPLOADED',
    DOWNLOAD: 'DOCUMENT_DOWNLOADED',
    DELETE: 'DOCUMENT_DELETED',
    SHARE: 'DOCUMENT_SHARED',
    VIEW: 'DOCUMENT_VIEWED'
  },
  
  // Gebruikers & Permissies
  USER: {
    CREATE: 'USER_CREATED',
    UPDATE: 'USER_UPDATED',
    DELETE: 'USER_DELETED',
    ROLE_CHANGE: 'USER_ROLE_CHANGED',
    PERMISSION_CHANGE: 'PERMISSION_CHANGED'
  },
  
  // Systeem & Beveiliging
  SYSTEM: {
    CONFIG_CHANGE: 'CONFIG_CHANGED',
    BACKUP_CREATED: 'BACKUP_CREATED',
    ERROR_OCCURRED: 'SYSTEM_ERROR',
    MAINTENANCE: 'MAINTENANCE_MODE'
  },
  
  // Compliance & Regelgeving
  COMPLIANCE: {
    GDPR_REQUEST: 'GDPR_DATA_REQUEST',
    GDPR_DELETE: 'GDPR_DATA_DELETED',
    AUDIT_EXPORT: 'AUDIT_LOG_EXPORTED',
    LEGAL_HOLD: 'LEGAL_HOLD_ACTIVATED'
  }
};

// Severity levels
export const SeverityLevels = {
  LOW: 'low',        // Informatie (bijv. view acties)
  MEDIUM: 'medium',  // Wijzigingen (bijv. updates)
  HIGH: 'high',      // Kritieke acties (bijv. goedkeuringen, verwijderen)
  CRITICAL: 'critical' // SUPER_ADMIN acties, financieel, compliance
};

// Winston logger configuratie
const logger = winston.createLogger({
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    silly: 6
  },
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    // Console output (alleen in development)
    new winston.transports.Console({
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} [${level}]: ${message} ${
            Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
          }`;
        })
      )
    }),
    // Audit log bestand (dagelijks roteren)
    new winston.transports.DailyRotateFile({
      filename: path.join(__dirname, '../../logs/audit-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: `${LOG_RETENTION_DAYS}d`,
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    // Foutlog apart bestand
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 10
    })
  ],
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: path.join(__dirname, '../../logs/exceptions.log') 
    })
  ]
});

// Maak log directory aan als deze niet bestaat
const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

/**
 * Hoofd audit logging functie
 * @param {string} eventType - Type gebeurtenis (uit AuditEventTypes)
 * @param {Object} data - Audit data
 * @param {Object} options - Opties
 */
export const auditLog = async (eventType, data = {}, options = {}) => {
  const timestamp = new Date().toISOString();
  const defaultOptions = {
    severity: SeverityLevels.MEDIUM,
    storeInDatabase: true,
    logToFile: true,
    notifyAdmin: false
  };

  const config = { ...defaultOptions, ...options };
  const isSuperAdminAction = data.email === SUPER_ADMIN_EMAIL || 
                           data.userId === SUPER_ADMIN_EMAIL ||
                           eventType.includes('SUPER_ADMIN');

  // Bepaal severity voor super admin acties
  if (isSuperAdminAction) {
    config.severity = SeverityLevels.CRITICAL;
    config.notifyAdmin = true;
  }

  // Audit record
  const auditRecord = {
    event_type: eventType,
    timestamp,
    severity: config.severity,
    user_id: data.userId || data.user_id || 'system',
    user_email: data.email || data.user_email || 'system',
    user_role: data.role || data.user_role || 'system',
    ip_address: data.ip || data.ip_address || 'unknown',
    user_agent: data.userAgent || data.user_agent || 'unknown',
    endpoint: data.endpoint || data.url || 'unknown',
    method: data.method || 'unknown',
    project_id: data.projectId || data.project_id,
    quote_id: data.quoteId || data.quote_id,
    request_id: data.requestId || data.request_id,
    additional_data: {
      ...data,
      isSuperAdminAction,
      sessionId: data.sessionId,
      clientVersion: data.clientVersion,
      location: data.location // Geolocatie indien beschikbaar
    },
    metadata: {
      app_version: process.env.APP_VERSION || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      server_id: process.env.SERVER_ID || 'local'
    }
  };

  try {
    // 1. Sla op in database (indien geconfigureerd)
    if (config.storeInDatabase) {
      await storeAuditInDatabase(auditRecord);
    }

    // 2. Log naar bestand (indien geconfigureerd)
    if (config.logToFile) {
      logToFile(auditRecord);
    }

    // 3. Stuur notificatie voor kritieke acties
    if (config.notifyAdmin || config.severity === SeverityLevels.CRITICAL) {
      await notifyAdministrators(auditRecord);
    }

    // 4. Console log (development only)
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[AUDIT] ${eventType}:`, {
        user: auditRecord.user_email,
        action: eventType,
        timestamp: auditRecord.timestamp
      });
    }

    return { success: true, auditId: auditRecord.id };

  } catch (error) {
    // Fallback logging als alles faalt
    console.error('Audit logging failed:', error);
    logger.error('AUDIT_LOG_FAILED', {
      eventType,
      error: error.message,
      timestamp,
      originalData: data
    });
    
    return { success: false, error: error.message };
  }
};

/**
 * Sla audit record op in Supabase database
 */
async function storeAuditInDatabase(auditRecord) {
  try {
    // Hoofd audit record
    const { data, error } = await supabase
      .from('audit_logs')
      .insert([{
        event_type: auditRecord.event_type,
        timestamp: auditRecord.timestamp,
        severity: auditRecord.severity,
        user_id: auditRecord.user_id,
        user_email: auditRecord.user_email,
        user_role: auditRecord.user_role,
        ip_address: auditRecord.ip_address,
        user_agent: auditRecord.user_agent,
        endpoint: auditRecord.endpoint,
        method: auditRecord.method,
        project_id: auditRecord.project_id,
        quote_id: auditRecord.quote_id,
        request_id: auditRecord.request_id,
        is_super_admin_action: auditRecord.additional_data.isSuperAdminAction
      }])
      .select('id')
      .single();

    if (error) throw error;

    // Sla additional_data op in audit_details tabel
    if (auditRecord.additional_data && Object.keys(auditRecord.additional_data).length > 0) {
      await supabase
        .from('audit_details')
        .insert([{
          audit_log_id: data.id,
          data: auditRecord.additional_data,
          metadata: auditRecord.metadata
        }]);
    }

    auditRecord.id = data.id;
    return data.id;

  } catch (error) {
    console.error('Database audit storage failed:', error);
    throw error;
  }
}

/**
 * Log naar Winston logger
 */
function logToFile(auditRecord) {
  const logLevel = getWinstonLevel(auditRecord.severity);
  const message = `AUDIT: ${auditRecord.event_type}`;
  
  logger.log(logLevel, message, {
    auditId: auditRecord.id,
    user: auditRecord.user_email,
    role: auditRecord.user_role,
    ip: auditRecord.ip_address,
    endpoint: auditRecord.endpoint,
    project: auditRecord.project_id,
    quote: auditRecord.quote_id,
    isSuperAdmin: auditRecord.additional_data.isSuperAdminAction,
    timestamp: auditRecord.timestamp
  });
}

/**
 * Map severity naar Winston level
 */
function getWinstonLevel(severity) {
  const map = {
    [SeverityLevels.LOW]: 'info',
    [SeverityLevels.MEDIUM]: 'info',
    [SeverityLevels.HIGH]: 'warn',
    [SeverityLevels.CRITICAL]: 'error'
  };
  return map[severity] || 'info';
}

/**
 * Stuur notificatie naar administrators voor kritieke acties
 */
async function notifyAdministrators(auditRecord) {
  try {
    // Haal admin emails op
    const { data: admins } = await supabase
      .from('users')
      .select('email, full_name')
      .in('role', ['admin', 'SUPER_ADMIN'])
      .eq('is_active', true);

    if (!admins || admins.length === 0) return;

    // Stuur notificatie (bijv. via email service)
    const notificationPromises = admins.map(admin => 
      sendAdminNotification(admin, auditRecord)
    );

    await Promise.all(notificationPromises);

  } catch (error) {
    console.error('Admin notification failed:', error);
    // Log maar blokkeer niet de hoofdactie
  }
}

/**
 * Verstuur notificatie naar individuele admin
 */
async function sendAdminNotification(admin, auditRecord) {
  // Implementeer je notificatieservice hier
  // Bijvoorbeeld: email, Slack, SMS, etc.
  
  const isSuperAdminAction = auditRecord.additional_data.isSuperAdminAction;
  const subject = isSuperAdminAction 
    ? `🚨 SUPER_ADMIN Actie: ${auditRecord.event_type}`
    : `⚠️ Kritieke Audit Actie: ${auditRecord.event_type}`;

  const notificationData = {
    to: admin.email,
    subject,
    template: 'critical-audit-alert',
    data: {
      adminName: admin.full_name,
      eventType: auditRecord.event_type,
      timestamp: auditRecord.timestamp,
      user: auditRecord.user_email,
      role: auditRecord.user_role,
      ip: auditRecord.ip_address,
      endpoint: auditRecord.endpoint,
      severity: auditRecord.severity,
      isSuperAdminAction,
      actionRequired: isSuperAdminAction,
      portalLink: getAuditPortalLink(auditRecord)
    }
  };

  // Roep je notificatie service aan
  // await notificationService.send(notificationData);
}

/**
 * Genereer portal link voor audit record
 */
function getAuditPortalLink(auditRecord) {
  if (auditRecord.project_id) {
    return `${process.env.PORTAL_URL}/admin/audit/${auditRecord.id}?project=${auditRecord.project_id}`;
  }
  return `${process.env.PORTAL_URL}/admin/audit/${auditRecord.id}`;
}

/**
 * Exporteer audit logs voor specifieke periode
 */
export const exportAuditLogs = async (startDate, endDate, options = {}) => {
  try {
    const { format = 'json', includeDetails = true } = options;
    
    // Query audit logs met filters
    let query = supabase
      .from('audit_logs')
      .select(`
        *,
        ${includeDetails ? 'audit_details(data, metadata)' : ''}
      `)
      .gte('timestamp', startDate)
      .lte('timestamp', endDate)
      .order('timestamp', { ascending: false });

    // Filter op severity indien opgegeven
    if (options.severity) {
      query = query.in('severity', Array.isArray(options.severity) ? options.severity : [options.severity]);
    }

    // Filter op gebruiker indien opgegeven
    if (options.userId) {
      query = query.eq('user_id', options.userId);
    }

    if (options.userEmail) {
      query = query.eq('user_email', options.userEmail);
    }

    const { data: logs, error } = await query;

    if (error) throw error;

    // Formatteer export
    let exportData;
    switch (format) {
      case 'csv':
        exportData = formatAsCSV(logs);
        break;
      case 'pdf':
        exportData = await formatAsPDF(logs);
        break;
      case 'json':
      default:
        exportData = JSON.stringify(logs, null, 2);
        break;
    }

    // Log de export actie zelf
    await auditLog(AuditEventTypes.COMPLIANCE.AUDIT_EXPORT, {
      exportedBy: options.exportedBy || 'system',
      startDate,
      endDate,
      recordCount: logs.length,
      format,
      exportId: generateExportId()
    }, {
      severity: SeverityLevels.HIGH,
      notifyAdmin: true
    });

    return {
      success: true,
      data: exportData,
      count: logs.length,
      format,
      exportedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('Audit export failed:', error);
    await auditLog('AUDIT_EXPORT_FAILED', {
      error: error.message,
      startDate,
      endDate,
      exportedBy: options.exportedBy
    }, {
      severity: SeverityLevels.HIGH
    });
    
    throw error;
  }
};

/**
 * Formatteer logs als CSV
 */
function formatAsCSV(logs) {
  const headers = [
    'ID', 'Timestamp', 'Event Type', 'Severity', 'User Email', 
    'User Role', 'IP Address', 'Endpoint', 'Project ID', 'Quote ID'
  ];

  const rows = logs.map(log => [
    log.id,
    log.timestamp,
    log.event_type,
    log.severity,
    log.user_email,
    log.user_role,
    log.ip_address,
    log.endpoint,
    log.project_id || '',
    log.quote_id || ''
  ]);

  return [headers, ...rows].map(row => row.join(',')).join('\n');
}

/**
 * Formatteer logs als PDF (vereist pdfkit)
 */
async function formatAsPDF(logs) {
  // Implementatie voor PDF export
  // Gebruik pdfkit zoals in quoteGenerator.js
  return 'PDF export would be generated here';
}

/**
 * Genereer uniek export ID
 */
function generateExportId() {
  return `AUDIT-EXP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Audit log cleanup (dagelijkse taak)
 */
export const cleanupOldAuditLogs = async () => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - LOG_RETENTION_DAYS);

    // Verwijder oude logs uit database
    const { error: dbError } = await supabase
      .from('audit_logs')
      .delete()
      .lt('timestamp', cutoffDate.toISOString());

    if (dbError) throw dbError;

    // Verwijder oude log bestanden (via Winston rotation)
    // Dit wordt automatisch gedaan door DailyRotateFile

    await auditLog('AUDIT_LOG_CLEANUP', {
      cutoffDate: cutoffDate.toISOString(),
      retentionDays: LOG_RETENTION_DAYS,
      cleanedBy: 'system'
    }, {
      severity: SeverityLevels.LOW,
      storeInDatabase: false // Om recursive loop te voorkomen
    });

    return { success: true, cutoffDate };

  } catch (error) {
    console.error('Audit cleanup failed:', error);
    // Log maar blokkeer niet
    return { success: false, error: error.message };
  }
};

/**
 * Real-time audit log streaming (voor admin dashboard)
 */
export const streamAuditLogs = (io) => {
  io.on('connection', (socket) => {
    console.log('Audit log stream client connected:', socket.id);

    // Alleen admins mogen verbinden
    socket.on('authenticate', async (token) => {
      try {
        const { data: { user } } = await supabase.auth.getUser(token);
        
        if (!user || !['admin', 'SUPER_ADMIN'].includes(user.role)) {
          socket.emit('error', 'Unauthorized for audit stream');
          socket.disconnect();
          return;
        }

        socket.user = user;
        socket.join('audit-admins');

        // Stuur recente logs
        const recentLogs = await getRecentAuditLogs(50);
        socket.emit('initial-logs', recentLogs);

        console.log(`Audit stream authenticated: ${user.email}`);

      } catch (error) {
        socket.emit('error', 'Authentication failed');
        socket.disconnect();
      }
    });

    // Live updates via Supabase Realtime
    const subscription = supabase
      .channel('audit-logs')
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'audit_logs' },
        (payload) => {
          io.to('audit-admins').emit('new-audit-log', payload.new);
        }
      )
      .subscribe();

    socket.on('disconnect', () => {
      console.log('Audit log stream client disconnected:', socket.id);
      subscription.unsubscribe();
    });
  });
};

/**
 * Haal recente audit logs op
 */
async function getRecentAuditLogs(limit = 50) {
  const { data, error } = await supabase
    .from('audit_logs')
    .select(`
      *,
      audit_details(data)
    `)
    .order('timestamp', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

/**
 * GDPR compliance: Export alle data voor een gebruiker
 */
export const exportUserData = async (userId, requesterEmail) => {
  try {
    // Haal ALLE data op voor deze gebruiker
    const [auditLogs, projects, quotes, documents] = await Promise.all([
      supabase.from('audit_logs').select('*').eq('user_id', userId),
      supabase.from('projects').select('*').eq('client_id', userId),
      supabase.from('extra_work_quotes').select('*').eq('created_by', userId),
      supabase.from('documents').select('*').eq('uploaded_by', userId)
    ]);

    const userData = {
      audit_logs: auditLogs.data,
      projects: projects.data,
      quotes: quotes.data,
      documents: documents.data,
      exported_at: new Date().toISOString(),
      exported_by: requesterEmail,
      user_id: userId
    };

    // Log de GDPR export
    await auditLog(AuditEventTypes.COMPLIANCE.GDPR_REQUEST, {
      userId,
      requesterEmail,
      dataTypes: ['audit_logs', 'projects', 'quotes', 'documents'],
      recordCount: Object.values(userData).reduce((sum, arr) => sum + (arr?.length || 0), 0)
    }, {
      severity: SeverityLevels.HIGH,
      notifyAdmin: true
    });

    return {
      success: true,
      data: userData,
      format: 'json',
      exportedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('GDPR export failed:', error);
    throw error;
  }
};

export default {
  auditLog,
  exportAuditLogs,
  cleanupOldAuditLogs,
  streamAuditLogs,
  exportUserData,
  AuditEventTypes,
  SeverityLevels
};
