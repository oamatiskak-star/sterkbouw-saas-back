import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * Valideer magic link token
 */
export const validateMagicLink = async (req, res, next) => {
  try {
    const token = req.query.token || req.headers['x-portal-token'];
    
    if (!token) {
      return res.status(401).json({ 
        error: 'Magic link token vereist',
        instructions: 'Gebruik de link uit de email of vraag een nieuwe aan'
      });
    }

    // Haal token op uit database
    const { data: access, error } = await supabase
      .from('portal_access')
      .select(`
        *,
        client:clients (*),
        project:projects (*)
      `)
      .eq('magic_link_token', token)
      .eq('is_active', true)
      .single();

    if (error || !access) {
      return res.status(401).json({ error: 'Ongeldige of verlopen link' });
    }

    // Controleer expiratie
    if (new Date(access.expires_at) < new Date()) {
      // Deactiveer token
      await supabase
        .from('portal_access')
        .update({ is_active: false })
        .eq('id', access.id);

      return res.status(401).json({ 
        error: 'Link is verlopen',
        solution: 'Vraag een nieuwe link aan via het dashboard'
      });
    }

    // Update access log
    await supabase
      .from('portal_access')
      .update({
        last_access: new Date().toISOString(),
        access_count: (access.access_count || 0) + 1,
        last_ip: req.ip,
        last_user_agent: req.headers['user-agent']
      })
      .eq('id', access.id);

    // Voeg client info toe aan request
    req.client = {
      id: access.client_id,
      email: access.client.email,
      name: access.client.name,
      company: access.client.company
    };

    req.project = {
      id: access.project_id,
      name: access.project.name,
      status: access.project.status
    };

    req.accessToken = token;

    next();

  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authenticatie fout' });
  }
};

/**
 * Controleer client toegang tot specifiek project
 */
export const validateClientAccess = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const clientId = req.client.id;

    if (!projectId || !clientId) {
      return res.status(400).json({ error: 'Project ID en Client ID vereist' });
    }

    // Controleer of client toegang heeft tot dit project
    const { data: access, error } = await supabase
      .from('project_access')
      .select('role, permissions')
      .eq('project_id', projectId)
      .eq('client_id', clientId)
      .single();

    if (error || !access) {
      return res.status(403).json({ 
        error: 'Geen toegang tot dit project',
        projectId,
        clientId
      });
    }

    // Voeg rechten toe aan request
    req.client.role = access.role;
    req.client.permissions = access.permissions || {};

    next();

  } catch (error) {
    console.error('Access validation error:', error);
    res.status(500).json({ error: 'Toegangscontrole fout' });
  }
};

/**
 * Rate limiting voor portaal endpoints
 */
export const portalRateLimit = (req, res, next) => {
  const clientKey = req.client?.id || req.ip;
  const endpoint = req.path;
  
  // Implementeer rate limiting logica
  // Gebruik Redis of database voor tracking
  
  next();
};

/**
 * Audit logging middleware
 */
export const auditPortalAction = async (req, res, next) => {
  const startTime = Date.now();
  
  // Log de request
  res.on('finish', async () => {
    const duration = Date.now() - startTime;
    
    await supabase
      .from('portal_audit_log')
      .insert({
        client_id: req.client?.id,
        project_id: req.params.projectId,
        action: req.method + ' ' + req.path,
        status_code: res.statusCode,
        duration_ms: duration,
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
        request_body: req.body,
        response_size: res.get('Content-Length') || 0,
        timestamp: new Date().toISOString()
      });
  });
  
  next();
};

export default {
  validateMagicLink,
  validateClientAccess,
  portalRateLimit,
  auditPortalAction
};
