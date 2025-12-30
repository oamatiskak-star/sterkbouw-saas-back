import pool from '../config/database.js';

class Project {
  static async createTable() {
    const sql = `
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID,
        project_code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        
        total_budget DECIMAL(12,2),
        start_date DATE,
        end_date DATE,
        status VARCHAR(20) DEFAULT 'planned',
        
        total_invoiced DECIMAL(12,2) DEFAULT 0.00,
        total_received DECIMAL(12,2) DEFAULT 0.00,
        total_costs DECIMAL(12,2) DEFAULT 0.00,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id);
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    `;
    
    await pool.query(sql);
    console.log('✓ Projects table created/verified');
  }

  static async create(data) {
    const { company_id, project_code, name, total_budget, start_date, end_date } = data;
    
    const sql = `
      INSERT INTO projects 
      (company_id, project_code, name, total_budget, start_date, end_date)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const result = await pool.query(sql, [
      company_id, project_code, name, total_budget, start_date, end_date
    ]);
    
    return result.rows[0];
  }

  static async findByCompany(companyId) {
    const sql = 'SELECT * FROM projects WHERE company_id = $1 ORDER BY created_at DESC';
    const result = await pool.query(sql, [companyId]);
    return result.rows;
  }

  static async updateFinancials(projectId, data) {
    const { total_invoiced, total_received, total_costs } = data;
    
    const sql = `
      UPDATE projects 
      SET total_invoiced = COALESCE($1, total_invoiced),
          total_received = COALESCE($2, total_received),
          total_costs = COALESCE($3, total_costs),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `;
    
    const result = await pool.query(sql, [
      total_invoiced, total_received, total_costs, projectId
    ]);
    
    return result.rows[0];
  }
}

export default Project;
