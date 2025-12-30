// backend/middleware/auth.js
import { createServerClient, supabase as serviceSupabase } from '../config/database.js';
import { auditLog } from '../utils/auditLogger.js';

// Configuratie
const SUPER_ADMIN_EMAIL = 'o.amatiskak@sterkbouw.nl';

/**
 * ADMIN HIËRARCHIE:
 * SUPER_ADMIN > admin > manager > project_leader > client > viewer
 */

/**
 * Middleware: Auth via Supabase access token (Bearer)
 * - Valideert token met anon/public key (per request)
 * - Leest profiel via service-role (server-side)
 */
export const authenticateToken = async (req, res, next) => {
  try {
    // 1. Token uit header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : null;

    if (!token) {
      return res.status(401).json({
        error: 'Toegang geweigerd. Geen token aanwezig.',
        code: 'NO_TOKEN'
      });
    }

    // 2. Maak server client MET token (anon/public key)
    const authClient = createServerClient(token);

    // 3. Valideer token
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return res.status(401).json({
        error: 'Ongeldig of verlopen token',
        code: 'INVALID_TOKEN'
      });
    }

    // 4. Super admin check
    const isSuperAdmin = user.email === SUPER_ADMIN_EMAIL;

    // 5. Haal gebruikersprofiel op (service role)
    const { data: userProfile, error: profileError } = await serviceSupabase
      .from('users')
      .select(`
        id,
        email,
        role,
        full_name,
        is_active,
        last_login,
        avatar_url,
        phone_number
      `)
      .eq('id', user.id)
      .eq('is_active', true)
      .single();

    if (profileError || !userProfile) {
      return res.status(403).json({
        error: 'Gebruikersprofiel niet gevonden of inactief',
        code: 'PROFILE_NOT_FOUND'
      });
    }

    // 6. Super admin override
    if (isSuperAdmin) {
      userProfile.role = 'SUPER_ADMIN';

      await auditLog('SUPER_ADMIN_ACCESS', {
        userId: user.id,
        email: user.email,
        ip: req.ip,
        endpoint: req.originalUrl,
        method: req.method
      });
    }

    // 7. Update last_login (non-blocking)
    serviceSupabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id)
      .then(() => {})
      .catch(() => {});

    // 8. Permissions bepalen
    const permissions = await getUserPermissions(
      userProfile.role,
      user.id,
      isSuperAdmin
    );

    // 9. Injecteer in request
    req.user = {
      id: user.id,
      email: user.email,
      role: userProfile.role,
      fullName: userProfile.full_name,
      isSuperAdmin,
      permissions,
      profile: userProfile
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({
      error: 'Authenticatie fout opgetreden',
      code: 'AUTH_ERROR'
    });
  }
};

/**
 * Bepaal gebruikerspermissies
 */
async function getUserPermissions(role, userId, isSuperAdmin = false) {
  if (isSuperAdmin) {
    return {
      canViewAllProjects: true,
      canEditAllProjects: true,
      canDeleteProjects: true,
      canManageUsers: true,
      canApproveQuotes: true,
      canViewFinancials: true,
      canExportData: true,
      canManageSettings: true,
      canAccessAuditLogs: true
    };
  }

  const rolePermissions = {
    admin: {
      canViewAllProjects: true,
      canEditAllProjects: true,
      canDeleteProjects: true,
      canManageUsers: true,
      canApproveQuotes: true,
      canViewFinancials: true,
      canExportData: true,
      canManageSettings: true,
      canAccessAuditLogs: true
    },
    manager: {
      canViewAllProjects: true,
      canEditAllProjects: false,
      canDeleteProjects: false,
      canManageUsers: false,
      canApproveQuotes: true,
      canViewFinancials: true,
      canExportData: true,
      canManageSettings: false,
      canAccessAuditLogs: false
    },
    project_leader: {
      canViewAllProjects: false,
      canEditAllProjects: false,
      canDeleteProjects: false,
      canManageUsers: false,
      canApproveQuotes: true,
      canViewFinancials: true,
      canExportData: true,
      canManageSettings: false,
      canAccessAuditLogs: false
    },
    client: {
      canViewAllProjects: false,
      canEditAllProjects: false,
      canDeleteProjects: false,
      canManageUsers: false,
      canApproveQuotes: true,
      canViewFinancials: false,
      canExportData: true,
      canManageSettings: false,
      canAccessAuditLogs: false
    },
    viewer: {
      canViewAllProjects: false,
      canEditAllProjects: false,
      canDeleteProjects: false,
      canManageUsers: false,
      canApproveQuotes: false,
      canViewFinancials: false,
      canExportData: false,
      canManageSettings: false,
      canAccessAuditLogs: false
    }
  };

  // Project-specifieke permissies (alleen indien nodig)
  if (role === 'project_leader' || role === 'client') {
    const { data: projectPerms } = await serviceSupabase
      .from('user_project_permissions')
      .select('project_id, can_view, can_edit, can_approve')
      .eq('user_id', userId);

    return {
      ...rolePermissions[role],
      projectPermissions: projectPerms || []
    };
  }

  return rolePermissions[role] || rolePermissions.viewer;
}

/**
 * Middleware: Alleen bepaalde rollen toegang
 */
export const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Niet geauthenticeerd' });
    }

    if (req.user.isSuperAdmin) {
      return next();
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Toegang geweigerd. Vereiste rol: ${allowedRoles.join(' of ')}`,
        currentRole: req.user.role
      });
    }

    next();
  };
};

/**
 * Helper: Autoriseer client/project toegang
 */
export const authorizeClient = async (userId, projectId) => {
  try {
    // Super admin
    const { data: superAdminCheck } = await serviceSupabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .eq('email', SUPER_ADMIN_EMAIL)
      .single();

    if (superAdminCheck) return true;

    // Project-client koppeling
    const { data: clientAccess } = await serviceSupabase
      .from('project_clients')
      .select('id')
      .eq('project_id', projectId)
      .eq('client_id', userId)
      .single();

    if (clientAccess) return true;

    // Expliciete permissie
    const { data: explicitPermission } = await serviceSupabase
      .from('user_project_permissions')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .eq('can_view', true)
      .single();

    return !!explicitPermission;
  } catch (error) {
    console.error('Authorize client error:', error);
    return false;
  }
};

/**
 * Middleware: Projecttoegang afdwingen
 */
export const requireProjectAccess = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const user = req.user;

    if (!projectId) return next();

    if (user.isSuperAdmin) return next();
    if (['admin', 'manager'].includes(user.role)) return next();

    if (user.role === 'project_leader') {
      const { data: project } = await serviceSupabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('project_leader_id', user.id)
        .single();

      if (project) return next();
    }

    if (user.role === 'client') {
      const hasAccess = await authorizeClient(user.id, projectId);
      if (hasAccess) return next();
    }

    return res.status(403).json({
      error: 'Geen toegang tot dit project',
      projectId,
      userId: user.id,
      userRole: user.role
    });
  } catch (error) {
    console.error('Project access middleware error:', error);
    res.status(500).json({ error: 'Toegangscontrole mislukt' });
  }
};

/**
 * Rate limiting config voor gevoelige acties
 */
export const sensitiveActionLimit = {
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Te veel gevoelige acties. Probeer het later opnieuw.'
};

/**
 * Audit helper
 */
export const logAuthAttempt = async (req, success, reason = '') => {
  await auditLog('AUTH_ATTEMPT', {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    endpoint: req.originalUrl,
    method: req.method,
    success,
    reason,
    timestamp: new Date().toISOString()
  });
};

export default {
  authenticateToken,
  requireRole,
  authorizeClient,
  requireProjectAccess,
  logAuthAttempt,
  sensitiveActionLimit
};
