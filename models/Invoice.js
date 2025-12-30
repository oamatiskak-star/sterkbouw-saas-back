import pool from '../config/database.js';

class Invoice {
  static async createTable() {
    const sql = `
      CREATE TABLE IF NOT EXISTS invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        external_id VARCHAR(100) NOT NULL,
        company_id UUID,
        project_id UUID,
        
        invoice_number VARCHAR(100) NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('purchase', 'sales')),
        status VARCHAR(50) NOT NULL,
        
        contact_name VARCHAR(255),
        amount DECIMAL(12,2) NOT NULL,
        date DATE NOT NULL,
        due_date DATE NOT NULL,
        paid_at TIMESTAMP,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        UNIQUE(company_id, external_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices(project_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date) WHERE paid_at IS NULL;
    `;
    
    await pool.query(sql);
    console.log('✓ Invoices table created/verified');
  }

  static async createFromMoneybird(data) {
    const sql = `
      INSERT INTO invoices 
      (external_id, company_id, project_id, invoice_number, type, status, 
       contact_name, amount, date, due_date, paid_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (company_id, external_id) 
      DO UPDATE SET
        status = EXCLUDED.status,
        paid_at = EXCLUDED.paid_at,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const result = await pool.query(sql, [
      data.external_id,
      data.company_id,
      data.project_id,
      data.invoice_number,
      data.type,
      data.status,
      data.contact_name,
      data.amount,
      data.date,
      data.due_date,
      data.paid_at
    ]);
    
    return result.rows[0];
  }

  static async getOpenInvoices(companyId) {
    const sql = `
      SELECT * FROM invoices 
      WHERE company_id = $1 
        AND paid_at IS NULL
        AND due_date >= CURRENT_DATE
      ORDER BY due_date ASC
    `;
    
    const result = await pool.query(sql, [companyId]);
    return result.rows;
  }

  static async getOverdueInvoices(companyId) {
    const sql = `
      SELECT * FROM invoices 
      WHERE company_id = $1 
        AND paid_at IS NULL
        AND due_date < CURRENT_DATE
      ORDER BY due_date ASC
    `;
    
    const result = await pool.query(sql, [companyId]);
    return result.rows;
  }
}

export default Invoice;
