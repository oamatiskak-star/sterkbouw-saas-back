import pool from '../config/database.js';

class Company {
  static async createTable() {
    const sql = `
      CREATE TABLE IF NOT EXISTS companies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        legal_name VARCHAR(255),
        kvk_number VARCHAR(50),
        vat_number VARCHAR(50),
        company_type VARCHAR(20) NOT NULL 
          CHECK (company_type IN ('holding', 'werk_bv', 'financial_bv')),
        moneybird_administration_id VARCHAR(100),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_companies_type ON companies(company_type);
    `;
    
    await pool.query(sql);
    console.log('✓ Companies table created/verified');
  }

  static async create(data) {
    const { name, legal_name, kvk_number, vat_number, company_type } = data;
    
    const sql = `
      INSERT INTO companies 
      (name, legal_name, kvk_number, vat_number, company_type)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    
    const result = await pool.query(sql, [
      name, legal_name, kvk_number, vat_number, company_type
    ]);
    
    return result.rows[0];
  }

  static async findAll() {
    const sql = 'SELECT * FROM companies WHERE is_active = true ORDER BY name';
    const result = await pool.query(sql);
    return result.rows;
  }

  static async findById(id) {
    const sql = 'SELECT * FROM companies WHERE id = $1';
    const result = await pool.query(sql, [id]);
    return result.rows[0];
  }
}

export default Company;
