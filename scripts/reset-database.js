import pool from '../config/database.js';

async function resetDatabase() {
  console.log('⚠️  Resetting database...');
  
  try {
    // Drop tables in correct order (reverse of creation)
    await pool.query('DROP TABLE IF EXISTS invoices CASCADE');
    await pool.query('DROP TABLE IF EXISTS projects CASCADE');
    await pool.query('DROP TABLE IF EXISTS companies CASCADE');
    
    console.log('✅ Database reset complete');
    
    // Re-initialize
    const { default: initDatabase } = await import('./init-database.js');
    await initDatabase();
    
  } catch (error) {
    console.error('❌ Database reset failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

resetDatabase();
