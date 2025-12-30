import Company from '../models/Company.js';
import Project from '../models/Project.js';
import Invoice from '../models/Invoice.js';

async function initDatabase() {
  console.log('🚀 Initializing database...');
  
  try {
    // Create tables in correct order
    await Company.createTable();
    await Project.createTable();
    await Invoice.createTable();
    
    console.log('✅ Database initialized successfully');
    
    // Create sample data for testing
    await createSampleData();
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

async function createSampleData() {
  // Create Holding company
  const holding = await Company.create({
    name: 'Bouwproffs Holding BV',
    legal_name: 'Bouwproffs Holding B.V.',
    kvk_number: '12345678',
    vat_number: 'NL123456789B01',
    company_type: 'holding'
  });

  // Create Werk-BV
  const werkBv = await Company.create({
    name: 'Bouwproffs BV',
    legal_name: 'Bouwproffs B.V.',
    kvk_number: '87654321',
    vat_number: 'NL987654321B02',
    company_type: 'werk_bv'
  });

  // Create Financial BV
  const financialBv = await Company.create({
    name: 'Modiwerijo Financial Management BV',
    legal_name: 'Modiwerijo Financial Management B.V.',
    kvk_number: '55555555',
    vat_number: 'NL555555555B03',
    company_type: 'financial_bv'
  });

  // Create sample projects
  await Project.create({
    company_id: werkBv.id,
    project_code: 'BP2024-001',
    name: 'Villa Nova Renovatie',
    total_budget: 250000,
    start_date: '2024-01-15',
    end_date: '2024-06-30'
  });

  await Project.create({
    company_id: werkBv.id,
    project_code: 'BP2024-002',
    name: 'Kantoorpunt Utrecht',
    total_budget: 180000,
    start_date: '2024-02-01',
    end_date: '2024-08-31'
  });

  console.log('✅ Sample data created');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initDatabase();
}

export default initDatabase;
