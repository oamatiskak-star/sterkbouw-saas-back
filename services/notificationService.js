// Backend/services/notificationService.js
import nodemailer from 'nodemailer';
import twilio from 'twilio';
import { supabase } from '../config/database.js';
import { auditLog } from '../utils/auditLogger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuratie
const SUPER_ADMIN_EMAIL = 'o.amatiskak@sterkbouw.nl';
const COMPANY_NAME = 'SterkBouw';
const PORTAL_URL = process.env.PORTAL_URL || 'https://projectportaal.sterkbouw.nl';

// Notification types
export const NotificationTypes = {
  // Offerte gerelateerd
  QUOTE: {
    READY: 'QUOTE_READY',
    APPROVED: 'QUOTE_APPROVED',
    DECLINED: 'QUOTE_DECLINED',
    UPDATED: 'QUOTE_UPDATED',
    REMINDER: 'QUOTE_REMINDER',
    EXPIRING: 'QUOTE_EXPIRING_SOON'
  },
  
  // Project updates
  PROJECT: {
    UPDATED: 'PROJECT_UPDATED',
    MILESTONE: 'MILESTONE_REACHED',
    DELAY: 'PROJECT_DELAY',
    COMPLETED: 'PROJECT_COMPLETED'
  },
  
  // Documenten
  DOCUMENT: {
    UPLOADED: 'DOCUMENT_UPLOADED',
    APPROVED: 'DOCUMENT_APPROVED',
    COMMENT: 'DOCUMENT_COMMENT'
  },
  
  // Communicatie
  COMMUNICATION: {
    NEW_MESSAGE: 'NEW_MESSAGE',
    MENTION: 'USER_MENTIONED',
    REPLY: 'MESSAGE_REPLY'
  },
  
  // Systeem
  SYSTEM: {
    MAINTENANCE: 'SYSTEM_MAINTENANCE',
    UPDATE: 'SYSTEM_UPDATE',
    SECURITY: 'SECURITY_ALERT'
  },
  
  // Gebruikers
  USER: {
    WELCOME: 'USER_WELCOME',
    INVITE: 'PROJECT_INVITE',
    ROLE_CHANGE: 'USER_ROLE_CHANGED'
  }
};

// Notification channels
export const NotificationChannels = {
  EMAIL: 'email',
  SMS: 'sms',
  PUSH: 'push',
  IN_APP: 'in_app',
  ALL: 'all'
};

// Email template engine
class TemplateEngine {
  constructor() {
    this.templates = {};
    this.loadTemplates();
  }

  loadTemplates() {
    const templatesDir = path.join(__dirname, '../templates/email');
    
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir, { recursive: true });
      this.createDefaultTemplates(templatesDir);
    }

    // Laad alle .hbs templates
    const templateFiles = fs.readdirSync(templatesDir).filter(file => file.endsWith('.hbs'));
    
    templateFiles.forEach(file => {
      const templateName = file.replace('.hbs', '');
      const templateContent = fs.readFileSync(path.join(templatesDir, file), 'utf8');
      this.templates[templateName] = Handlebars.compile(templateContent);
    });

    // Registreer helpers
    Handlebars.registerHelper('formatDate', (date) => {
      return new Date(date).toLocaleDateString('nl-NL', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    });

    Handlebars.registerHelper('formatCurrency', (amount) => {
      return new Intl.NumberFormat('nl-NL', {
        style: 'currency',
        currency: 'EUR'
      }).format(amount);
    });

    Handlebars.registerHelper('portalLink', (path) => {
      return `${PORTAL_URL}${path}`;
    });
  }

  createDefaultTemplates(dir) {
    // Quote ready template
    const quoteReadyTemplate = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nieuwe Meerwerkofferte</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
    .quote-details { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #667eea; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Nieuwe Meerwerkofferte</h1>
    <p>{{companyName}} - Projectportaal</p>
  </div>
  
  <div class="content">
    <p>Beste {{clientName}},</p>
    
    <p>Er is een nieuwe meerwerkofferte voor u klaargezet in het projectportaal.</p>
    
    <div class="quote-details">
      <h3>Offerte details:</h3>
      <p><strong>Offertenummer:</strong> {{quoteNumber}}</p>
      <p><strong>Project:</strong> {{projectName}}</p>
      <p><strong>Bedrag:</strong> {{formatCurrency totalAmount}}</p>
      <p><strong>Geldig tot:</strong> {{formatDate validUntil}}</p>
      <p><strong>Status:</strong> In afwachting van uw goedkeuring</p>
    </div>
    
    <p>U kunt de offerte bekijken en goedkeuren via onderstaande knop:</p>
    
    <a href="{{portalLink portalPath}}" class="button">📋 Offerte Bekijken &amp; Goedkeuren</a>
    
    <p>Directe link: <a href="{{portalLink portalPath}}">{{portalLink portalPath}}</a></p>
    
    <p><strong>Belangrijk:</strong> Deze offerte is {{validDays}} dagen geldig.</p>
    
    <p>Heeft u vragen over deze offerte? U kunt direct reageren via het portaal.</p>
    
    <p>Met vriendelijke groet,<br>
    Het {{companyName}} team</p>
  </div>
  
  <div class="footer">
    <p>{{companyName}} | {{companyAddress}} | {{companyPhone}} | {{companyEmail}}</p>
    <p>Dit is een automatisch bericht vanuit het {{companyName}} projectportaal.</p>
    <p><a href="{{unsubscribeLink}}">Meld u af voor deze notificaties</a></p>
  </div>
</body>
</html>`;

    // Save template
    fs.writeFileSync(path.join(dir, 'quote-ready.hbs'), quoteReadyTemplate);
    
    // Create more default templates...
    this.createTemplate('quote-approved.hbs', 'Offerte Goedgekeurd');
    this.createTemplate('quote-declined.hbs', 'Offerte Afgewezen');
    this.createTemplate('project-update.hbs', 'Project Update');
    this.createTemplate('welcome.hbs', 'Welkom bij SterkBouw');
  }

  createTemplate(filename, subject) {
    const basicTemplate = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{subject}}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #667eea; color: white; padding: 20px; text-align: center; }
    .content { background: #f9f9f9; padding: 20px; }
    .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>{{subject}}</h1>
    </div>
    <div class="content">
      {{{content}}}
    </div>
    <div class="footer">
      <p>{{companyName}} | <a href="{{portalLink '/'}}">Projectportaal</a></p>
    </div>
  </div>
</body>
</html>`;

    fs.writeFileSync(path.join(__dirname, '../templates/email', filename), basicTemplate);
  }

  render(templateName, data) {
    const template = this.templates[templateName];
    if (!template) {
      throw new Error(`Template ${templateName} not found`);
    }
    
    const context = {
      ...data,
      companyName: COMPANY_NAME,
      portalUrl: PORTAL_URL,
      currentYear: new Date().getFullYear()
    };
    
    return template(context);
  }
}

// Hoofd Notification Service
class NotificationService {
  constructor() {
    this.templateEngine = new TemplateEngine();
    this.emailTransporter = this.createEmailTransporter();
    this.smsClient = this.createSMSClient();
  }

  createEmailTransporter() {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      tls: {
        rejectUnauthorized: false
      }
    });
  }

  createSMSClient() {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    }
    return null;
  }

  /**
   * Verstuur notificatie
   */
  async sendNotification(notification) {
    const defaultConfig = {
      channels: [NotificationChannels.EMAIL, NotificationChannels.IN_APP],
      priority: 'normal',
      trackOpen: true,
      storeInDatabase: true
    };

    const config = { ...defaultConfig, ...notification };

    try {
      // Valideer notificatie
      this.validateNotification(config);

      // Genereer tracking ID
      const trackingId = `NOTIF-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Resultaten per kanaal
      const results = {
        email: { sent: false, messageId: null, error: null },
        sms: { sent: false, messageId: null, error: null },
        in_app: { sent: false, notificationId: null, error: null },
        push: { sent: false, notificationId: null, error: null }
      };

      // Verstuur naar geselecteerde kanalen
      const channelPromises = [];

      if (config.channels.includes(NotificationChannels.EMAIL) && config.recipient.email) {
        channelPromises.push(
          this.sendEmail(config, trackingId)
            .then(emailResult => results.email = emailResult)
            .catch(error => results.email = { sent: false, error: error.message })
        );
      }

      if (config.channels.includes(NotificationChannels.SMS) && config.recipient.phone) {
        channelPromises.push(
          this.sendSMS(config, trackingId)
            .then(smsResult => results.sms = smsResult)
            .catch(error => results.sms = { sent: false, error: error.message })
        );
      }

      if (config.channels.includes(NotificationChannels.IN_APP)) {
        channelPromises.push(
          this.storeInAppNotification(config, trackingId)
            .then(inAppResult => results.in_app = inAppResult)
            .catch(error => results.in_app = { sent: false, error: error.message })
        );
      }

      if (config.channels.includes(NotificationChannels.PUSH) && config.recipient.pushToken) {
        channelPromises.push(
          this.sendPushNotification(config, trackingId)
            .then(pushResult => results.push = pushResult)
            .catch(error => results.push = { sent: false, error: error.message })
        );
      }

      // Wacht op alle kanalen
      await Promise.all(channelPromises);

      // Sla notificatie op in database
      if (config.storeInDatabase) {
        await this.storeNotificationInDatabase(config, results, trackingId);
      }

      // Audit log
      await auditLog('NOTIFICATION_SENT', {
        notificationType: config.type,
        recipient: config.recipient.email || config.recipient.phone || config.recipient.userId,
        channels: config.channels,
        trackingId,
        results,
        projectId: config.data?.projectId,
        quoteId: config.data?.quoteId
      }, {
        severity: 'low'
      });

      return {
        success: true,
        trackingId,
        results,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Notification sending failed:', error);
      
      await auditLog('NOTIFICATION_FAILED', {
        notificationType: notification?.type,
        recipient: notification?.recipient,
        error: error.message,
        stack: error.stack
      }, {
        severity: 'medium',
        notifyAdmin: true
      });

      throw error;
    }
  }

  /**
   * Verstuur email notificatie
   */
  async sendEmail(notification, trackingId) {
    const { recipient, subject, type, data } = notification;
    
    // Bepaal template op basis van type
    const templateMap = {
      [NotificationTypes.QUOTE.READY]: 'quote-ready',
      [NotificationTypes.QUOTE.APPROVED]: 'quote-approved',
      [NotificationTypes.QUOTE.DECLINED]: 'quote-declined',
      [NotificationTypes.PROJECT.UPDATED]: 'project-update',
      [NotificationTypes.USER.WELCOME]: 'welcome'
    };

    const templateName = templateMap[type] || 'default';
    const htmlContent = this.templateEngine.render(templateName, {
      ...data,
      subject: notification.subject,
      clientName: recipient.name || 'Geachte relatie',
      portalPath: data?.portalLink || '/'
    });

    // Email opties
    const mailOptions = {
      from: `"${COMPANY_NAME}" <${process.env.SMTP_FROM || 'noreply@sterkbouw.nl'}>`,
      to: recipient.email,
      subject: notification.subject,
      html: htmlContent,
      headers: {
        'X-Tracking-ID': trackingId,
        'X-Notification-Type': type,
        'X-Project-ID': data?.projectId || '',
        'X-Quote-ID': data?.quoteId || ''
      }
    };

    // Tracking pixel voor email opens
    if (notification.trackOpen) {
      const trackingPixelUrl = `${process.env.API_URL}/track/open/${trackingId}`;
      mailOptions.html += `<img src="${trackingPixelUrl}" width="1" height="1" alt="" />`;
    }

    // Verstuur email
    const info = await this.emailTransporter.sendMail(mailOptions);

    return {
      sent: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected
    };
  }

  /**
   * Verstuur SMS notificatie
   */
  async sendSMS(notification, trackingId) {
    if (!this.smsClient) {
      throw new Error('SMS client not configured');
    }

    const { recipient, data } = notification;
    
    // Genereer SMS bericht
    let messageBody = '';
    
    switch (notification.type) {
      case NotificationTypes.QUOTE.READY:
        messageBody = `Nieuwe offerte ${data.quoteNumber} klaar voor ${data.projectName}. Bedrag: €${data.totalAmount}. Bekijk: ${PORTAL_URL}/p/${data.projectId}`;
        break;
      case NotificationTypes.QUOTE.APPROVED:
        messageBody = `Offerte ${data.quoteNumber} goedgekeurd door ${data.approvedBy}. Project: ${data.projectName}`;
        break;
      default:
        messageBody = notification.subject || 'Bericht van SterkBouw Projectportaal';
    }

    // Verstuur SMS
    const message = await this.smsClient.messages.create({
      body: messageBody,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: recipient.phone,
      statusCallback: `${process.env.API_URL}/api/notifications/sms-callback/${trackingId}`
    });

    return {
      sent: true,
      messageId: message.sid,
      status: message.status,
      to: message.to
    };
  }

  /**
   * Sla in-app notificatie op
   */
  async storeInAppNotification(notification, trackingId) {
    const { recipient, type, subject, data } = notification;
    
    const { data: storedNotification, error } = await supabase
      .from('notifications')
      .insert([{
        user_id: recipient.userId,
        type,
        title: subject,
        message: notification.message || subject,
        data: {
          ...data,
          trackingId,
          read: false,
          action_required: type.includes('QUOTE') && !type.includes('APPROVED'),
          priority: notification.priority
        },
        channels: ['in_app'],
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 dagen
      }])
      .select('id')
      .single();

    if (error) throw error;

    // Real-time update via Supabase Realtime
    await supabase
      .channel(`notifications-${recipient.userId}`)
      .send({
        type: 'broadcast',
        event: 'new-notification',
        payload: {
          notificationId: storedNotification.id,
          type,
          title: subject,
          timestamp: new Date().toISOString()
        }
      });

    return {
      sent: true,
      notificationId: storedNotification.id,
      storedAt: new Date().toISOString()
    };
  }

  /**
   * Verstuur push notificatie
   */
  async sendPushNotification(notification, trackingId) {
    // Implementeer push notificaties (Firebase, OneSignal, etc.)
    // Dit is een placeholder implementatie
    
    return {
      sent: false,
      error: 'Push notifications not implemented'
    };
  }

  /**
   * Sla notificatie op in database
   */
  async storeNotificationInDatabase(notification, results, trackingId) {
    const { recipient, type, subject, channels } = notification;
    
    const notificationRecord = {
      tracking_id: trackingId,
      type,
      subject,
      recipient_email: recipient.email,
      recipient_phone: recipient.phone,
      recipient_user_id: recipient.userId,
      channels,
      results,
      sent_at: new Date().toISOString(),
      metadata: {
        project_id: notification.data?.projectId,
        quote_id: notification.data?.quoteId,
        user_agent: notification.metadata?.userAgent,
        ip_address: notification.metadata?.ip
      }
    };

    const { error } = await supabase
      .from('notification_logs')
      .insert([notificationRecord]);

    if (error) {
      console.error('Failed to store notification log:', error);
      // Gooi geen error, want notificatie is al verstuurd
    }
  }

  /**
   * Valideer notificatie
   */
  validateNotification(notification) {
    const requiredFields = ['type', 'recipient', 'subject'];
    
    for (const field of requiredFields) {
      if (!notification[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Valideer recipient
    const { recipient, channels } = notification;
    
    if (channels.includes(NotificationChannels.EMAIL) && !recipient.email) {
      throw new Error('Email required for email notifications');
    }

    if (channels.includes(NotificationChannels.SMS) && !recipient.phone) {
      throw new Error('Phone number required for SMS notifications');
    }

    if (channels.includes(NotificationChannels.IN_APP) && !recipient.userId) {
      throw new Error('User ID required for in-app notifications');
    }

    // Valideer type
    const allTypes = Object.values(NotificationTypes).flatMap(obj => Object.values(obj));
    if (!allTypes.includes(notification.type)) {
      throw new Error(`Invalid notification type: ${notification.type}`);
    }

    return true;
  }

  /**
   * Stuur notificatie naar projectleden
   */
  async notifyProjectTeam(projectId, notification, options = {}) {
    const { includeClient = true, specificRoles = [] } = options;
    
    // Haal projectteam op
    let query = supabase
      .from('project_team_members')
      .select(`
        user:users (
          id,
          email,
          full_name,
          phone_number,
          role,
          notification_preferences
        )
      `)
      .eq('project_id', projectId);

    if (specificRoles.length > 0) {
      query = query.in('users.role', specificRoles);
    }

    const { data: teamMembers, error } = await query;

    if (error) throw error;

    const recipients = [];

    // Voeg teamleden toe
    teamMembers.forEach(member => {
      if (member.user) {
        recipients.push({
          userId: member.user.id,
          email: member.user.email,
          name: member.user.full_name,
          phone: member.user.phone_number,
          role: member.user.role
        });
      }
    });

    // Voeg client toe indien gewenst
    if (includeClient) {
      const { data: client } = await supabase
        .from('projects')
        .select('client_email, client_name')
        .eq('id', projectId)
        .single();

      if (client && client.client_email) {
        recipients.push({
          email: client.client_email,
          name: client.client_name,
          role: 'client'
        });
      }
    }

    // Verstuur naar alle ontvangers
    const results = await Promise.allSettled(
      recipients.map(recipient =>
        this.sendNotification({
          ...notification,
          recipient
        })
      )
    );

    return {
      totalRecipients: recipients.length,
      successful: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length,
      details: results.map((r, i) => ({
        recipient: recipients[i],
        status: r.status,
        value: r.status === 'fulfilled' ? r.value : r.reason
      }))
    };
  }

  /**
   * Stuur offerte herinnering
   */
  async sendQuoteReminder(quoteId, reminderType = 'expiring_soon') {
    const { data: quote, error } = await supabase
      .from('extra_work_quotes')
      .select(`
        *,
        project:project_id (
          client_email,
          client_name,
          name
        )
      `)
      .eq('id', quoteId)
      .single();

    if (error) throw error;

    const daysRemaining = Math.ceil((new Date(quote.valid_until) - new Date()) / (1000 * 60 * 60 * 24));
    
    let subject, message;
    
    switch (reminderType) {
      case 'expiring_soon':
        subject = `Herinnering: Offerte ${quote.quote_number} verloopt over ${daysRemaining} dagen`;
        message = `Uw offerte verloopt binnenkort. Keur deze goed voor ${new Date(quote.valid_until).toLocaleDateString('nl-NL')}.`;
        break;
      case 'expired':
        subject = `Offerte ${quote.quote_number} is verlopen`;
        message = 'Helaas is de offerte vervallen. Neem contact op voor een nieuwe offerte.';
        break;
      case 'follow_up':
        subject = `Vervolg op offerte ${quote.quote_number}`;
        message = 'Wij zijn benieuwd of u nog vragen heeft over de offerte.';
        break;
    }

    const notification = {
      type: NotificationTypes.QUOTE.REMINDER,
      subject,
      message,
      data: {
        quoteNumber: quote.quote_number,
        projectName: quote.project.name,
        totalAmount: quote.total_amount,
        validUntil: quote.valid_until,
        daysRemaining,
        portalLink: `/p/${quote.project_id}/quote/${quote.id}`,
        reminderType
      },
      channels: [NotificationChannels.EMAIL, NotificationChannels.IN_APP]
    };

    return this.sendNotification({
      ...notification,
      recipient: {
        email: quote.project.client_email,
        name: quote.project.client_name
      }
    });
  }

  /**
   * Batch notificaties voor meerdere offertes
   */
  async sendBatchQuoteNotifications(quoteIds, notificationType) {
    const { data: quotes, error } = await supabase
      .from('extra_work_quotes')
      .select(`
        *,
        project:project_id (
          client_email,
          client_name
        )
      `)
      .in('id', quoteIds);

    if (error) throw error;

    const results = await Promise.allSettled(
      quotes.map(quote => {
        const notification = {
          type: notificationType,
          subject: `Offerte update: ${quote.quote_number}`,
          data: {
            quoteNumber: quote.quote_number,
            projectName: quote.project.name,
            portalLink: `/p/${quote.project_id}`
          },
          channels: [NotificationChannels.EMAIL]
        };

        return this.sendNotification({
          ...notification,
          recipient: {
            email: quote.project.client_email,
            name: quote.project.client_name
          }
        });
      })
    );

    return {
      total: quotes.length,
      successful: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length,
      quoteIds
    };
  }

  /**
   * Haal notificatie voorkeuren op
   */
  async getUserNotificationPreferences(userId) {
    const { data, error } = await supabase
      .from('user_notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') { // Niet gevonden is OK
      throw error;
    }

    // Default preferences
    const defaultPreferences = {
      email_quotes: true,
      email_project_updates: true,
      email_system: true,
      sms_urgent: true,
      in_app_all: true,
      digest_frequency: 'daily', // daily, weekly, never
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
      do_not_disturb: false
    };

    return { ...defaultPreferences, ...data };
  }

  /**
   * Update notificatie voorkeuren
   */
  async updateNotificationPreferences(userId, preferences) {
    const { error } = await supabase
      .from('user_notification_preferences')
      .upsert({
        user_id: userId,
        ...preferences,
        updated_at: new Date().toISOString()
      });

    if (error) throw error;

    return { success: true, userId };
  }

  /**
   * Stuur welkomstemail naar nieuwe gebruiker
   */
  async sendWelcomeEmail(user) {
    const notification = {
      type: NotificationTypes.USER.WELCOME,
      subject: `Welkom bij ${COMPANY_NAME} Projectportaal`,
      message: 'Welkom in het projectportaal. Hier kunt u al uw projecten beheren.',
      data: {
        userName: user.full_name,
        portalUrl: PORTAL_URL,
        supportEmail: 'support@sterkbouw.nl',
        quickStartGuide: `${PORTAL_URL}/help/quick-start`
      },
      channels: [NotificationChannels.EMAIL]
    };

    return this.sendNotification({
      ...notification,
      recipient: {
        email: user.email,
        name: user.full_name,
        userId: user.id
      }
    });
  }

  /**
   * Maandelijks overzicht email
   */
  async sendMonthlyDigest(userId, month = new Date().getMonth(), year = new Date().getFullYear()) {
    // Implementeer maandelijkse samenvatting
    // Bijv.: alle projectupdates, offertes, documenten van afgelopen maand
    
    return {
      success: true,
      message: 'Monthly digest not implemented'
    };
  }
}

// Export singleton instance
export default new NotificationService();

// Helper functies
export {
  NotificationTypes,
  NotificationChannels
};
