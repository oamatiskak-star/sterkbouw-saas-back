// Backend/services/projectService.js
import { supabase } from '../config/database.js';
import { auditLog } from '../utils/auditLogger.js';
import notificationService from './notificationService.js';

class ProjectService {
  
  /**
   * Haal volledig project op met alle relaties
   */
  async getProjectWithDetails(projectId, userId, userRole) {
    try {
      // Basis project data
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select(`
          *,
          project_leader:project_leader_id (
            id, full_name, email, phone_number, avatar_url
          ),
          company:company_id (
            id, name, logo_url, address
          )
        `)
        .eq('id', projectId)
        .single();

      if (projectError) throw projectError;

      // Haal alle gerelateerde data parallel op
      const [
        teamMembers,
        clients,
        documents,
        milestones,
        extraWorkStats,
        financials
      ] = await Promise.all([
        this.getProjectTeam(projectId),
        this.getProjectClients(projectId, userRole, userId),
        this.getProjectDocuments(projectId, userRole, userId),
        this.getProjectMilestones(projectId),
        this.getExtraWorkStatistics(projectId, userRole, userId),
        this.getFinancialOverview(projectId, userRole, userId)
      ]);

      // Bereken voortgang
      const progress = await this.calculateProjectProgress(projectId);

      // Recente activiteiten
      const recentActivities = await this.getRecentActivities(projectId, 10);

      // Voor clients: filter gevoelige informatie
      if (userRole === 'client') {
        delete project.internal_budget;
        delete project.profit_margin;
        delete project.cost_breakdown;
        delete project.risk_assessment;
        delete project.internal_notes;
        
        // Filter alleen deze client
        if (clients && clients.length > 0) {
          project.clients = clients.filter(client => 
            client.client && client.client.id === userId
          );
        }
      }

      const projectWithDetails = {
        ...project,
        team_members: teamMembers || [],
        clients: clients || [],
        documents_summary: documents || [],
        milestones: milestones || [],
        statistics: {
          extra_work: extraWorkStats,
          financial: financials,
          progress,
          document_count: documents?.length || 0,
          team_count: teamMembers?.length || 0,
          client_count: clients?.length || 0
        },
        recent_activities: recentActivities,
        portal_settings: project.portal_settings || {
          client_access: true,
          document_sharing: true,
          communication_enabled: true,
          extra_work_requests: true
        }
      };

      await auditLog('PROJECT_DETAILS_FETCHED', {
        projectId,
        userId,
        userRole,
        sections: ['team', 'clients', 'documents', 'milestones', 'statistics', 'activities']
      });

      return projectWithDetails;

    } catch (error) {
      console.error('Get project details error:', error);
      await auditLog('PROJECT_DETAILS_FETCH_FAILED', {
        projectId,
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Haal project teamleden op
   */
  async getProjectTeam(projectId) {
    const { data, error } = await supabase
      .from('project_team_members')
      .select(`
        id,
        role_in_project,
        added_at,
        user:users (
          id,
          full_name,
          email,
          phone_number,
          role,
          avatar_url,
          department
        )
      `)
      .eq('project_id', projectId)
      .eq('users.is_active', true)
      .order('added_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  /**
   * Haal project clients op
   */
  async getProjectClients(projectId, userRole, requestingUserId) {
    let query = supabase
      .from('project_clients')
      .select(`
        id,
        access_level,
        invited_at,
        invited_by,
        status,
        client:users (
          id,
          full_name,
          email,
          phone_number,
          company_name,
          avatar_url,
          is_active
        )
      `)
      .eq('project_id', projectId);

    // Voor clients: alleen eigen data
    if (userRole === 'client') {
      query = query.eq('client_id', requestingUserId);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  }

  /**
   * Haal project documenten op (samenvatting)
   */
  async getProjectDocuments(projectId, userRole, userId) {
    let query = supabase
      .from('project_documents')
      .select(`
        id,
        title,
        type,
        category,
        file_url,
        thumbnail_url,
        file_size,
        created_at,
        uploaded_by_user:users (full_name)
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (userRole === 'client') {
      query = query.eq('shared_with_clients', true);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  }

  /**
   * Haal project milestones op
   */
  async getProjectMilestones(projectId) {
    const { data, error } = await supabase
      .from('project_milestones')
      .select(`
        *,
        completed_by_user:users (full_name)
      `)
      .eq('project_id', projectId)
      .order('due_date', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  /**
   * Haal meerwerk statistieken op
   */
  async getExtraWorkStatistics(projectId, userRole, userId) {
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
      total_amount: data.reduce((sum, req) => sum + (req.total_amount || 0), 0),
      by_status: data.reduce((acc, req) => {
        acc[req.status] = (acc[req.status] || 0) + 1;
        return acc;
      }, {})
    };

    return stats;
  }

  /**
   * Haal financiële overzicht op
   */
  async getFinancialOverview(projectId, userRole, userId) {
    // Voor clients: beperkte financiële informatie
    if (userRole === 'client') {
      const { data: invoices } = await supabase
        .from('invoices')
        .select('amount, status, due_date')
        .eq('project_id', projectId)
        .eq('client_id', userId);

      const totalInvoiced = invoices?.reduce((sum, inv) => sum + (inv.amount || 0), 0) || 0;
      const paidInvoices = invoices?.filter(inv => inv.status === 'paid').length || 0;

      return {
        total_invoiced: totalInvoiced,
        invoices: {
          total: invoices?.length || 0,
          paid: paidInvoices,
          pending: (invoices?.length || 0) - paidInvoices
        },
        visible_to_client: true
      };
    }

    // Voor staff: volledig financieel overzicht
    const [
      budgetResult,
      invoicesResult,
      expensesResult,
      paymentsResult
    ] = await Promise.all([
      supabase.from('projects').select('budget, actual_costs').eq('id', projectId).single(),
      supabase.from('invoices').select('amount, status').eq('project_id', projectId),
      supabase.from('project_expenses').select('amount, category').eq('project_id', projectId),
      supabase.from('payments').select('amount, status').eq('project_id', projectId)
    ]);

    const budget = budgetResult.data?.budget || 0;
    const actualCosts = budgetResult.data?.actual_costs || 0;
    const totalInvoiced = invoicesResult.data?.reduce((sum, inv) => sum + (inv.amount || 0), 0) || 0;
    const totalExpenses = expensesResult.data?.reduce((sum, exp) => sum + (exp.amount || 0), 0) || 0;
    const totalPayments = paymentsResult.data?.reduce((sum, pay) => sum + (pay.amount || 0), 0) || 0;

    return {
      budget,
      actual_costs: actualCosts,
      remaining_budget: budget - actualCosts,
      invoiced: totalInvoiced,
      expenses: totalExpenses,
      payments_received: totalPayments,
      profit: totalInvoiced - actualCosts,
      margin_percentage: budget > 0 ? ((totalInvoiced - actualCosts) / budget) * 100 : 0
    };
  }

  /**
   * Bereken project voortgang
   */
  async calculateProjectProgress(projectId) {
    // Haal alle milestones op
    const { data: milestones } = await supabase
      .from('project_milestones')
      .select('weight, status')
      .eq('project_id', projectId);

    if (!milestones || milestones.length === 0) {
      // Fallback: gebruik project progress veld
      const { data: project } = await supabase
        .from('projects')
        .select('progress')
        .eq('id', projectId)
        .single();

      return project?.progress || 0;
    }

    // Bereken gewogen voortgang
    const totalWeight = milestones.reduce((sum, m) => sum + (m.weight || 1), 0);
    const completedWeight = milestones
      .filter(m => m.status === 'completed')
      .reduce((sum, m) => sum + (m.weight || 1), 0);

    const milestoneProgress = totalWeight > 0 ? (completedWeight / totalWeight) * 100 : 0;

    // Combineer met andere voortgangsindicatoren
    const { data: extraWork } = await supabase
      .from('extra_work_requests')
      .select('status')
      .eq('project_id', projectId);

    const completedWork = extraWork?.filter(req => 
      ['completed', 'quote_approved'].includes(req.status)
    ).length || 0;
    const totalWork = extraWork?.length || 1;
    const workProgress = (completedWork / totalWork) * 100;

    // Gewogen gemiddelde
    const overallProgress = Math.round((milestoneProgress * 0.6) + (workProgress * 0.4));

    // Update project progress in database
    await supabase
      .from('projects')
      .update({ progress: overallProgress, updated_at: new Date().toISOString() })
      .eq('id', projectId);

    return overallProgress;
  }

  /**
   * Haal recente activiteiten op
   */
  async getRecentActivities(projectId, limit = 10) {
    const activities = [];

    // Document activiteiten
    const { data: recentDocuments } = await supabase
      .from('project_documents')
      .select('title, type, created_at, uploaded_by_user:users(full_name)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit / 2);

    if (recentDocuments) {
      recentDocuments.forEach(doc => {
        activities.push({
          type: 'document_uploaded',
          title: `Nieuw document: ${doc.title}`,
          description: `${doc.uploaded_by_user?.full_name} heeft een ${doc.type} geüpload`,
          timestamp: doc.created_at,
          user: doc.uploaded_by_user,
          metadata: { document_type: doc.type }
        });
      });
    }

    // Meerwerk activiteiten
    const { data: recentExtraWork } = await supabase
      .from('extra_work_requests')
      .select('description, status, created_at, client:users(full_name)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit / 2);

    if (recentExtraWork) {
      recentExtraWork.forEach(request => {
        activities.push({
          type: 'extra_work_' + request.status,
          title: `Meerwerk: ${request.status}`,
          description: `Meerwerkaanvraag van ${request.client?.full_name}: ${request.description.substring(0, 50)}...`,
          timestamp: request.created_at,
          user: request.client,
          metadata: { request_status: request.status }
        });
      });
    }

    // Sorteer op timestamp
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return activities.slice(0, limit);
  }

  /**
   * Maak een nieuw project aan
   */
  async createProject(projectData, createdByUserId) {
    try {
      // Valideer vereiste velden
      const requiredFields = ['name', 'address', 'client_name', 'client_email'];
      for (const field of requiredFields) {
        if (!projectData[field]) {
          throw new Error(`Veld '${field}' is verplicht`);
        }
      }

      // Stel standaardwaarden in
      const projectDefaults = {
        status: 'planning',
        progress: 0,
        portal_access_enabled: true,
        portal_settings: {
          client_access: true,
          document_sharing: true,
          communication_enabled: true,
          extra_work_requests: true,
          quote_approval: true
        },
        created_by: createdByUserId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const projectToCreate = { ...projectDefaults, ...projectData };

      // Maak project aan
      const { data: newProject, error: createError } = await supabase
        .from('projects')
        .insert([projectToCreate])
        .select()
        .single();

      if (createError) throw createError;

      // Voeg creator toe als projectleider indien niet gespecificeerd
      if (!projectData.project_leader_id) {
        await supabase
          .from('projects')
          .update({ project_leader_id: createdByUserId })
          .eq('id', newProject.id);
      }

      // Voeg creator toe als teamlid
      await this.addTeamMember(newProject.id, createdByUserId, 'project_leader', createdByUserId);

      // Maak standaard milestones aan
      await this.createDefaultMilestones(newProject.id, createdByUserId);

      // Stuur welkomstnotificatie
      await this.sendProjectWelcomeNotification(newProject, createdByUserId);

      await auditLog('PROJECT_CREATED', {
        projectId: newProject.id,
        projectName: newProject.name,
        createdBy: createdByUserId,
        clientEmail: newProject.client_email
      });

      return {
        success: true,
        project: newProject,
        message: `Project '${newProject.name}' succesvol aangemaakt`
      };

    } catch (error) {
      console.error('Create project error:', error);
      await auditLog('PROJECT_CREATE_FAILED', {
        error: error.message,
        createdBy: createdByUserId,
        projectData: { name: projectData.name, client: projectData.client_email }
      });
      throw error;
    }
  }

  /**
   * Update project
   */
  async updateProject(projectId, updates, updatedByUserId) {
    try {
      // Haal huidige project data op voor logging
      const { data: currentProject } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();

      if (!currentProject) {
        throw new Error('Project niet gevonden');
      }

      // Prepare update data
      const updateData = {
        ...updates,
        updated_by: updatedByUserId,
        updated_at: new Date().toISOString()
      };

      // Voer update uit
      const { data: updatedProject, error: updateError } = await supabase
        .from('projects')
        .update(updateData)
        .eq('id', projectId)
        .select()
        .single();

      if (updateError) throw updateError;

      // Log wijzigingen
      const changes = this.getObjectChanges(currentProject, updatedProject);
      
      await auditLog('PROJECT_UPDATED', {
        projectId,
        updatedBy: updatedByUserId,
        changes: Object.keys(changes),
        details: changes
      });

      // Stuur notificatie voor belangrijke wijzigingen
      if (this.hasImportantChanges(changes)) {
        await this.sendProjectUpdateNotification(updatedProject, changes, updatedByUserId);
      }

      return {
        success: true,
        project: updatedProject,
        message: 'Project succesvol bijgewerkt',
        changes
      };

    } catch (error) {
      console.error('Update project error:', error);
      await auditLog('PROJECT_UPDATE_FAILED', {
        projectId,
        updatedBy: updatedByUserId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Voeg teamlid toe aan project
   */
  async addTeamMember(projectId, userId, roleInProject, addedByUserId) {
    try {
      // Controleer of gebruiker al in team zit
      const { data: existingMember } = await supabase
        .from('project_team_members')
        .select('id')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .single();

      if (existingMember) {
        throw new Error('Gebruiker is al lid van dit projectteam');
      }

      // Haal projectnaam op voor notificatie
      const { data: project } = await supabase
        .from('projects')
        .select('name')
        .eq('id', projectId)
        .single();

      // Voeg teamlid toe
      const { data: teamMember, error } = await supabase
        .from('project_team_members')
        .insert([{
          project_id: projectId,
          user_id: userId,
          role_in_project: roleInProject,
          added_by: addedByUserId,
          added_at: new Date().toISOString()
        }])
        .select(`
          *,
          user:users (full_name, email)
        `)
        .single();

      if (error) throw error;

      // Stuur notificatie naar toegevoegd teamlid
      await notificationService.sendNotification({
        type: 'PROJECT_TEAM_INVITE',
        recipient: { 
          email: teamMember.user.email, 
          name: teamMember.user.full_name,
          userId: userId
        },
        subject: `U bent toegevoegd aan project: ${project.name}`,
        message: `U bent toegevoegd als ${roleInProject} aan project ${project.name}.`,
        data: {
          projectId,
          projectName: project.name,
          role: roleInProject,
          addedBy: addedByUserId,
          portalLink: `/projects/${projectId}`
        }
      });

      await auditLog('PROJECT_TEAM_MEMBER_ADDED', {
        projectId,
        userId,
        roleInProject,
        addedBy: addedByUserId
      });

      return {
        success: true,
        teamMember,
        message: `Teamlid succesvol toegevoegd`
      };

    } catch (error) {
      console.error('Add team member error:', error);
      await auditLog('PROJECT_TEAM_MEMBER_ADD_FAILED', {
        projectId,
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Verwijder teamlid uit project
   */
  async removeTeamMember(projectId, userId, removedByUserId) {
    try {
      // Controleer of het teamlid bestaat
      const { data: teamMember } = await supabase
        .from('project_team_members')
        .select('user:users(full_name, email)')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .single();

      if (!teamMember) {
        throw new Error('Teamlid niet gevonden');
      }

      // Haal projectnaam op
      const { data: project } = await supabase
        .from('projects')
        .select('name')
        .eq('id', projectId)
        .single();

      // Verwijder teamlid
      const { error } = await supabase
        .from('project_team_members')
        .delete()
        .eq('project_id', projectId)
        .eq('user_id', userId);

      if (error) throw error;

      // Stuur notificatie
      await notificationService.sendNotification({
        type: 'PROJECT_TEAM_REMOVAL',
        recipient: { 
          email: teamMember.user.email, 
          name: teamMember.user.full_name
        },
        subject: `U bent verwijderd uit project: ${project.name}`,
        message: `U bent niet langer lid van het team van project ${project.name}.`,
        data: {
          projectId,
          projectName: project.name,
          removedBy: removedByUserId
        }
      });

      await auditLog('PROJECT_TEAM_MEMBER_REMOVED', {
        projectId,
        userId,
        removedBy: removedByUserId
      });

      return {
        success: true,
        message: 'Teamlid succesvol verwijderd'
      };

    } catch (error) {
      console.error('Remove team member error:', error);
      await auditLog('PROJECT_TEAM_MEMBER_REMOVE_FAILED', {
        projectId,
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Nodig client uit voor project
   */
  async inviteClientToProject(projectId, clientData, invitedByUserId) {
    try {
      const { email, name, accessLevel = 'standard' } = clientData;

      // Zoek bestaande gebruiker
      let clientUserId;
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .single();

      if (existingUser) {
        clientUserId = existingUser.id;
      } else {
        // Maak nieuwe gebruiker aan
        const { data: newUser, error: userError } = await supabase
          .from('users')
          .insert([{
            email,
            full_name: name,
            role: 'client',
            is_active: true,
            created_at: new Date().toISOString()
          }])
          .select('id')
          .single();

        if (userError) throw userError;
        clientUserId = newUser.id;
      }

      // Controleer of client al is uitgenodigd
      const { data: existingInvite } = await supabase
        .from('project_clients')
        .select('id')
        .eq('project_id', projectId)
        .eq('client_id', clientUserId)
        .single();

      if (existingInvite) {
        throw new Error('Deze client is al uitgenodigd voor dit project');
      }

      // Haal projectgegevens op
      const { data: project } = await supabase
        .from('projects')
        .select('name, portal_access_enabled')
        .eq('id', projectId)
        .single();

      if (!project.portal_access_enabled) {
        throw new Error('Portaal toegang is niet ingeschakeld voor dit project');
      }

      // Maak invite aan
      const inviteToken = this.generateInviteToken(projectId, clientUserId);
      const inviteLink = `${process.env.PORTAL_URL}/p/${projectId}/invite/${inviteToken}`;

      const { data: clientInvite, error: inviteError } = await supabase
        .from('project_clients')
        .insert([{
          project_id: projectId,
          client_id: clientUserId,
          invited_by: invitedByUserId,
          invited_at: new Date().toISOString(),
          access_level: accessLevel,
          status: 'invited',
          invite_token: inviteToken,
          invite_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 dagen
        }])
        .select()
        .single();

      if (inviteError) throw inviteError;

      // Stuur uitnodiging
      await notificationService.sendNotification({
        type: 'PROJECT_INVITE',
        recipient: { email, name },
        subject: `Uitnodiging voor projectportaal: ${project.name}`,
        message: `U bent uitgenodigd voor het projectportaal van ${project.name}.`,
        data: {
          projectName: project.name,
          inviteLink,
          invitedBy: invitedByUserId,
          expiresIn: '7 dagen',
          portalUrl: process.env.PORTAL_URL
        }
      });

      await auditLog('CLIENT_INVITED_TO_PROJECT', {
        projectId,
        clientEmail: email,
        clientName: name,
        invitedBy: invitedByUserId,
        accessLevel
      });

      return {
        success: true,
        invite: clientInvite,
        message: `Uitnodiging verstuurd naar ${email}`,
        inviteLink: process.env.NODE_ENV === 'development' ? inviteLink : undefined
      };

    } catch (error) {
      console.error('Invite client error:', error);
      await auditLog('CLIENT_INVITE_FAILED', {
        projectId,
        clientEmail: clientData.email,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Verwerk client uitnodiging
   */
  async processClientInvite(projectId, token, userId) {
    try {
      // Valideer token
      const { data: invite, error: inviteError } = await supabase
        .from('project_clients')
        .select('*')
        .eq('project_id', projectId)
        .eq('invite_token', token)
        .single();

      if (inviteError || !invite) {
        throw new Error('Ongeldige of verlopen uitnodiging');
      }

      if (invite.client_id !== userId) {
        throw new Error('Deze uitnodiging is niet voor u bedoeld');
      }

      if (invite.status !== 'invited') {
        throw new Error(`Uitnodiging is al verwerkt. Status: ${invite.status}`);
      }

      const now = new Date();
      const expiresAt = new Date(invite.invite_expires_at);
      if (now > expiresAt) {
        throw new Error('Uitnodiging is verlopen');
      }

      // Accepteer uitnodiging
      const { data: updatedInvite, error: updateError } = await supabase
        .from('project_clients')
        .update({
          status: 'active',
          accepted_at: new Date().toISOString(),
          invite_token: null,
          invite_expires_at: null
        })
        .eq('id', invite.id)
        .select()
        .single();

      if (updateError) throw updateError;

      // Haal projectgegevens op voor notificatie
      const { data: project } = await supabase
        .from('projects')
        .select('name, project_leader_id')
        .eq('id', projectId)
        .single();

      // Stuur notificatie naar projectleider
      if (project.project_leader_id) {
        const { data: projectLeader } = await supabase
          .from('users')
          .select('email, full_name')
          .eq('id', project.project_leader_id)
          .single();

        if (projectLeader) {
          const { data: client } = await supabase
            .from('users')
            .select('full_name')
            .eq('id', userId)
            .single();

          await notificationService.sendNotification({
            type: 'CLIENT_ACCEPTED_INVITE',
            recipient: { email: projectLeader.email, name: projectLeader.full_name },
            subject: `Client heeft uitnodiging geaccepteerd: ${project.name}`,
            message: `${client?.full_name || 'Een client'} heeft de uitnodiging voor het projectportaal geaccepteerd.`,
            data: {
              projectId,
              projectName: project.name,
              clientId: userId,
              clientName: client?.full_name
            }
          });
        }
      }

      await auditLog('CLIENT_INVITE_ACCEPTED', {
        projectId,
        clientId: userId,
        inviteId: invite.id
      });

      return {
        success: true,
        invite: updatedInvite,
        message: 'Uitnodiging succesvol geaccepteerd',
        projectName: project.name
      };

    } catch (error) {
      console.error('Process invite error:', error);
      await auditLog('CLIENT_INVITE_PROCESS_FAILED', {
        projectId,
        userId,
        token,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Haal project voortgangsrapport op
   */
  async getProjectProgressReport(projectId, options = {}) {
    try {
      const {
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Laatste 30 dagen
        endDate = new Date()
      } = options;

      // Haal alle relevante data op
      const [
        projectData,
        milestoneProgress,
        financialProgress,
        documentActivity,
        extraWorkActivity,
        teamActivity
      ] = await Promise.all([
        this.getProjectBasicData(projectId),
        this.getMilestoneProgress(projectId, startDate, endDate),
        this.getFinancialProgress(projectId, startDate, endDate),
        this.getDocumentActivity(projectId, startDate, endDate),
        this.getExtraWorkActivity(projectId, startDate, endDate),
        this.getTeamActivity(projectId, startDate, endDate)
      ]);

      // Bereken overall progress
      const overallProgress = await this.calculateProjectProgress(projectId);

      // Genereer rapport
      const report = {
        project: projectData,
        period: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          generated_at: new Date().toISOString()
        },
        progress: {
          overall: overallProgress,
          milestones: milestoneProgress,
          financial: financialProgress
        },
        activities: {
          documents: documentActivity,
          extra_work: extraWorkActivity,
          team: teamActivity
        },
        key_metrics: await this.calculateKeyMetrics(projectId, startDate, endDate),
        recommendations: await this.generateRecommendations(projectId, overallProgress)
      };

      await auditLog('PROJECT_REPORT_GENERATED', {
        projectId,
        reportType: 'progress',
        period: `${startDate.toISOString()} to ${endDate.toISOString()}`,
        overallProgress
      });

      return report;

    } catch (error) {
      console.error('Generate progress report error:', error);
      throw error;
    }
  }

  /**
   * Maak standaard milestones aan voor nieuw project
   */
  async createDefaultMilestones(projectId, createdByUserId) {
    const defaultMilestones = [
      {
        title: 'Project Kick-off',
        description: 'Eerste projectbijeenkomst met alle stakeholders',
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // Over 7 dagen
        weight: 5,
        phase: 'planning'
      },
      {
        title: 'Ontwerp definitief',
        description: 'Definitief ontwerp goedgekeurd door opdrachtgever',
        due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // Over 14 dagen
        weight: 15,
        phase: 'planning'
      },
      {
        title: 'Start bouwvoorbereiding',
        description: 'Start van de bouwvoorbereidende werkzaamheden',
        due_date: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(), // Over 21 dagen
        weight: 10,
        phase: 'preparation'
      },
      {
        title: 'Start uitvoering',
        description: 'Start van de daadwerkelijke bouwwerkzaamheden',
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // Over 30 dagen
        weight: 30,
        phase: 'execution'
      },
      {
        title: 'Oplevering',
        description: 'Project oplevering aan opdrachtgever',
        due_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // Over 90 dagen
        weight: 40,
        phase: 'completion'
      }
    ];

    const milestonesToCreate = defaultMilestones.map(milestone => ({
      ...milestone,
      project_id: projectId,
      created_by: createdByUserId,
      created_at: new Date().toISOString()
    }));

    const { error } = await supabase
      .from('project_milestones')
      .insert(milestonesToCreate);

    if (error) {
      console.error('Create default milestones error:', error);
    }
  }

  /**
   * Stuur welkomstnotificatie voor nieuw project
   */
  async sendProjectWelcomeNotification(project, createdByUserId) {
    try {
      // Stuur naar projectleider
      if (project.project_leader_id && project.project_leader_id !== createdByUserId) {
        const { data: projectLeader } = await supabase
          .from('users')
          .select('email, full_name')
          .eq('id', project.project_leader_id)
          .single();

        if (projectLeader) {
          await notificationService.sendNotification({
            type: 'PROJECT_ASSIGNED',
            recipient: { email: projectLeader.email, name: projectLeader.full_name },
            subject: `Nieuw project toegewezen: ${project.name}`,
            message: `U bent aangesteld als projectleider voor ${project.name}.`,
            data: {
              projectId: project.id,
              projectName: project.name,
              clientName: project.client_name,
              startDate: project.start_date,
              portalLink: `/projects/${project.id}`
            }
          });
        }
      }

      // Stuur naar creator
      const { data: creator } = await supabase
        .from('users')
        .select('email, full_name')
        .eq('id', createdByUserId)
        .single();

      if (creator) {
        await notificationService.sendNotification({
          type: 'PROJECT_CREATED_CONFIRMATION',
          recipient: { email: creator.email, name: creator.full_name },
          subject: `Project aangemaakt: ${project.name}`,
          message: `Uw project '${project.name}' is succesvol aangemaakt.`,
          data: {
            projectId: project.id,
            projectName: project.name,
            clientEmail: project.client_email,
            portalLink: `/projects/${project.id}`
          }
        });
      }

    } catch (error) {
      console.error('Send welcome notification error:', error);
      // Faal stil, blokkeer niet project creatie
    }
  }

  /**
   * Stuur project update notificatie
   */
  async sendProjectUpdateNotification(project, changes, updatedByUserId) {
    try {
      const importantFields = ['status', 'end_date', 'budget', 'project_leader_id'];
      const hasImportantChange = Object.keys(changes).some(field => 
        importantFields.includes(field)
      );

      if (!hasImportantChange) return;

      // Haal projectteam op
      const { data: teamMembers } = await supabase
        .from('project_team_members')
        .select('user:users(email, full_name)')
        .eq('project_id', project.id);

      if (!teamMembers) return;

      const notificationPromises = teamMembers.map(member => {
        if (member.user) {
          return notificationService.sendNotification({
            type: 'PROJECT_UPDATED',
            recipient: { email: member.user.email, name: member.user.full_name },
            subject: `Project update: ${project.name}`,
            message: `Er zijn belangrijke wijzigingen in project ${project.name}.`,
            data: {
              projectId: project.id,
              projectName: project.name,
              changes: Object.keys(changes),
              updatedBy: updatedByUserId,
              portalLink: `/projects/${project.id}`
            }
          });
        }
      });

      await Promise.allSettled(notificationPromises);

    } catch (error) {
      console.error('Send update notification error:', error);
    }
  }

  /**
   * Helper: Genereer invite token
   */
  generateInviteToken(projectId, clientId) {
    const payload = {
      projectId,
      clientId,
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 dagen
    };
    
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  /**
   * Helper: Vergelijk objecten voor wijzigingen
   */
  getObjectChanges(oldObj, newObj) {
    const changes = {};
    
    for (const key in newObj) {
      if (oldObj[key] !== newObj[key]) {
        changes[key] = {
          old: oldObj[key],
          new: newObj[key]
        };
      }
    }
    
    return changes;
  }

  /**
   * Helper: Controleer op belangrijke wijzigingen
   */
  hasImportantChanges(changes) {
    const importantFields = [
      'status', 'project_leader_id', 'end_date', 
      'budget', 'client_name', 'client_email'
    ];
    
    return Object.keys(changes).some(field => 
      importantFields.includes(field)
    );
  }

  // Additional helper methods for progress report
  async getProjectBasicData(projectId) {
    const { data } = await supabase
      .from('projects')
      .select('name, status, start_date, end_date, progress')
      .eq('id', projectId)
      .single();

    return data;
  }

  async getMilestoneProgress(projectId, startDate, endDate) {
    const { data } = await supabase
      .from('project_milestones')
      .select('*')
      .eq('project_id', projectId)
      .gte('due_date', startDate.toISOString())
      .lte('due_date', endDate.toISOString());

    const total = data?.length || 0;
    const completed = data?.filter(m => m.status === 'completed').length || 0;

    return {
      total,
      completed,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
      upcoming: data?.filter(m => m.status === 'pending' && new Date(m.due_date) > new Date()).length || 0,
      overdue: data?.filter(m => m.status === 'pending' && new Date(m.due_date) < new Date()).length || 0
    };
  }

  async getFinancialProgress(projectId, startDate, endDate) {
    // Implementeer financiële voortgang
    return {
      budget_utilization: 0,
      cost_variance: 0,
      invoicing_status: 'good'
    };
  }

  async getDocumentActivity(projectId, startDate, endDate) {
    const { data } = await supabase
      .from('project_documents')
      .select('type, created_at')
      .eq('project_id', projectId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    return {
      total: data?.length || 0,
      by_type: data?.reduce((acc, doc) => {
        acc[doc.type] = (acc[doc.type] || 0) + 1;
        return acc;
      }, {}) || {}
    };
  }

  async getExtraWorkActivity(projectId, startDate, endDate) {
    const { data } = await supabase
      .from('extra_work_requests')
      .select('status, total_amount, created_at')
      .eq('project_id', projectId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    const totalAmount = data?.reduce((sum, req) => sum + (req.total_amount || 0), 0) || 0;
    const approved = data?.filter(req => req.status === 'quote_approved').length || 0;

    return {
      total: data?.length || 0,
      approved,
      total_amount: totalAmount,
      average_amount: data?.length > 0 ? totalAmount / data.length : 0
    };
  }

  async getTeamActivity(projectId, startDate, endDate) {
    // Implementeer team activiteit
    return {
      active_members: 0,
      hours_logged: 0,
      tasks_completed: 0
    };
  }

  async calculateKeyMetrics(projectId, startDate, endDate) {
    // Bereken key metrics
    return {
      schedule_performance: 0,
      cost_performance: 0,
      client_satisfaction: 0,
      risk_level: 'low'
    };
  }

  async generateRecommendations(projectId, progress) {
    const recommendations = [];

    if (progress < 30) {
      recommendations.push({
        type: 'planning',
        priority: 'high',
        title: 'Stel vroege milestones bij',
        description: 'Project loopt achter op planning. Overweeg milestones aan te passen.',
        action: 'Review projectplanning met team'
      });
    }

    if (progress > 70) {
      recommendations.push({
        type: 'completion',
        priority: 'medium',
        title: 'Begin met opleveringsvoorbereiding',
        description: 'Project nadert voltooiing. Start met opleveringsdocumentatie.',
        action: 'Maak opleveringschecklist'
      });
    }

    return recommendations;
  }
}

export default new ProjectService();
