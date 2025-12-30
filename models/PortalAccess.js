import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Portal Access Model
 */
export class PortalAccess {
  static async createMagicLink(projectId, clientId, createdBy, expiresInDays = 30) {
    const token = require('crypto').randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const { data, error } = await supabase
      .from('portal_access')
      .insert({
        project_id: projectId,
        client_id: clientId,
        magic_link_token: token,
        expires_at: expiresAt.toISOString(),
        created_by: createdBy,
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async validateToken(token) {
    const { data, error } = await supabase
      .from('portal_access')
      .select(`
        *,
        client:clients (*),
        project:projects (*)
      `)
      .eq('magic_link_token', token)
      .eq('is_active', true)
      .single();

    if (error) return null;
    
    // Check expiration
    if (new Date(data.expires_at) < new Date()) {
      await this.deactivateToken(token);
      return null;
    }

    return data;
  }

  static async deactivateToken(token) {
    const { error } = await supabase
      .from('portal_access')
      .update({ is_active: false })
      .eq('magic_link_token', token);

    return !error;
  }

  static async logAccess(token, ip, userAgent) {
    const { error } = await supabase
      .from('portal_access')
      .update({
        last_access: new Date().toISOString(),
        last_ip: ip,
        last_user_agent: userAgent,
        access_count: supabase.raw('access_count + 1')
      })
      .eq('magic_link_token', token);

    return !error;
  }

  static async getActiveLinks(projectId) {
    const { data, error } = await supabase
      .from('portal_access')
      .select(`
        *,
        client:clients (name, email)
      `)
      .eq('project_id', projectId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  static async revokeAllAccess(projectId) {
    const { error } = await supabase
      .from('portal_access')
      .update({ is_active: false })
      .eq('project_id', projectId);

    return !error;
  }
}

/**
 * Portal Cache Model
 */
export class PortalCache {
  static async get(projectId) {
    const { data, error } = await supabase
      .from('portal_cache')
      .select('data, last_sync, sync_status')
      .eq('project_id', projectId)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
    return data;
  }

  static async set(projectId, data) {
    const { error } = await supabase
      .from('portal_cache')
      .upsert({
        project_id: projectId,
        data,
        last_sync: new Date().toISOString(),
        sync_status: 'success',
        updated_at: new Date().toISOString()
      }, { onConflict: 'project_id' });

    if (error) throw error;
    return true;
  }

  static async invalidate(projectId) {
    const { error } = await supabase
      .from('portal_cache')
      .update({
        sync_status: 'stale',
        updated_at: new Date().toISOString()
      })
      .eq('project_id', projectId);

    return !error;
  }

  static async getStaleCaches(olderThanMinutes = 5) {
    const cutoff = new Date();
    cutoff.setMinutes(cutoff.getMinutes() - olderThanMinutes);

    const { data, error } = await supabase
      .from('portal_cache')
      .select('project_id, last_sync')
      .or(`sync_status.eq.stale,and(last_sync.lt.${cutoff.toISOString()},sync_status.eq.success)`)
      .order('last_sync', { ascending: true });

    if (error) throw error;
    return data;
  }
}

/**
 * Extra Work Model
 */
export class ExtraWork {
  static async createRequest(data) {
    const { error } = await supabase
      .from('extra_work_requests')
      .insert({
        ...data,
        status: 'requested',
        requested_at: new Date().toISOString()
      });

    if (error) throw error;
    return true;
  }

  static async getForPortal(projectId, clientId) {
    const { data, error } = await supabase
      .from('extra_work_requests')
      .select(`
        *,
        quotes (*),
        drawings (*)
      `)
      .eq('project_id', projectId)
      .eq('client_id', clientId)
      .order('requested_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  static async approveQuote(quoteId, approvalData) {
    const { error } = await supabase
      .from('extra_work_quotes')
      .update({
        client_approved: true,
        approved_at: new Date().toISOString(),
        ...approvalData
      })
      .eq('id', quoteId);

    if (error) throw error;
    return true;
  }
}

export default {
  PortalAccess,
  PortalCache,
  ExtraWork
};
