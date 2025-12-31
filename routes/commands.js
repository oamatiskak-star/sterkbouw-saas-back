const express = require('express');

module.exports = function commandsRouter() {
const router = express.Router();

// GET all commands
router.get('/', async (req, res) => {
try {
const commandRegistry = req.app.get('commandRegistry');

text
  if (!commandRegistry) {
    return res.status(503).json({
      error: 'Command registry not available',
      recovery: 'Try /api/recovery/system'
    });
  }
  
  const allCommands = await commandRegistry.listAllCommands();
  const stats = await commandRegistry.getStats();
  
  res.json({
    timestamp: new Date().toISOString(),
    total: stats.total,
    stats: stats.byLayer,
    commands: allCommands
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString(),
    recovery: 'Try /api/recovery/system'
  });
}
});

// GET specific command
router.get('/:commandId', async (req, res) => {
try {
const commandRegistry = req.app.get('commandRegistry');
const { commandId } = req.params;

text
  const command = await commandRegistry.getCommand(commandId);
  
  if (!command) {
    return res.status(404).json({
      error: `Command not found: ${commandId}`,
      suggestions: await commandRegistry.findSimilarCommands(commandId)
    });
  }
  
  res.json({
    command: commandId,
    details: command,
    timestamp: new Date().toISOString()
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// POST execute command
router.post('/execute', async (req, res) => {
try {
const commandRegistry = req.app.get('commandRegistry');
const { command, parameters = {}, async = false } = req.body;

text
  if (!command) {
    return res.status(400).json({
      error: 'Command name is required',
      example: { command: 'system_health', parameters: {} }
    });
  }
  
  if (async) {
    // Execute asynchronously and return immediately
    commandRegistry.executeCommand(command, parameters)
      .catch(error => {
        console.error(`Async command execution failed: ${command}`, error);
      });
    
    res.json({
      status: 'queued',
      command,
      async: true,
      timestamp: new Date().toISOString()
    });
  } else {
    // Execute synchronously
    const result = await commandRegistry.executeCommand(command, parameters);
    
    res.json({
      status: 'executed',
      command,
      result,
      timestamp: new Date().toISOString()
    });
  }
} catch (error) {
  res.status(400).json({
    error: error.message,
    command: req.body.command,
    timestamp: new Date().toISOString(),
    recovery: 'Try /api/recovery/command?command=' + encodeURIComponent(req.body.command)
  });
}
});

// POST add new command
router.post('/', async (req, res) => {
try {
const commandRegistry = req.app.get('commandRegistry');
const commandData = req.body;

text
  // Validate command data
  if (!commandData.name || !commandData.action) {
    return res.status(400).json({
      error: 'Command name and action are required'
    });
  }
  
  const commandId = await commandRegistry.addDynamicCommand(commandData);
  
  res.json({
    status: 'created',
    commandId,
    command: commandData.name,
    timestamp: new Date().toISOString(),
    note: 'Command added to dynamic layer'
  });
} catch (error) {
  res.status(400).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// DELETE command
router.delete('/:commandId', async (req, res) => {
try {
const commandRegistry = req.app.get('commandRegistry');
const { commandId } = req.params;

text
  const result = await commandRegistry.removeDynamicCommand(commandId);
  
  res.json({
    status: 'archived',
    commandId,
    result,
    timestamp: new Date().toISOString(),
    note: 'Command archived, not deleted'
  });
} catch (error) {
  res.status(400).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// GET command history
router.get('/:commandId/history', async (req, res) => {
try {
const fs = require('fs').promises;
const path = require('path');
const { commandId } = req.params;

text
  const logPath = path.join(__dirname, '../logs/executions.log');
  
  if (!await fileExists(logPath)) {
    return res.json({
      command: commandId,
      history: [],
      timestamp: new Date().toISOString()
    });
  }
  
  const logContent = await fs.readFile(logPath, 'utf8');
  const lines = logContent.trim().split('\n');
  
  const commandHistory = lines
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(entry => entry && entry.commandId === commandId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 50); // Last 50 executions
  
  res.json({
    command: commandId,
    totalExecutions: commandHistory.length,
    history: commandHistory,
    timestamp: new Date().toISOString()
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// POST bulk import commands
router.post('/bulk-import', async (req, res) => {
try {
const commandRegistry = req.app.get('commandRegistry');
const { commands, source = 'api' } = req.body;

text
  if (!Array.isArray(commands)) {
    return res.status(400).json({
      error: 'Commands must be an array',
      example: { commands: [{ name: 'test', action: 'test_action' }] }
    });
  }
  
  const results = [];
  
  for (const command of commands) {
    try {
      const commandId = await commandRegistry.addDynamicCommand({
        ...command,
        imported: new Date().toISOString(),
        source
      });
      results.push({ command: command.name, status: 'imported', commandId });
    } catch (error) {
      results.push({ command: command.name, status: 'failed', error: error.message });
    }
  }
  
  res.json({
    status: 'bulk_import_complete',
    source,
    total: commands.length,
    successful: results.filter(r => r.status === 'imported').length,
    results,
    timestamp: new Date().toISOString()
  });
} catch (error) {
  res.status(400).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// GET search commands
router.get('/search/:query', async (req, res) => {
try {
const commandRegistry = req.app.get('commandRegistry');
const { query } = req.params;
const { layer } = req.query;

text
  const allCommands = await commandRegistry.listAllCommands();
  
  const searchResults = allCommands.filter(cmd => {
    const searchable = [
      cmd.id,
      cmd.name,
      cmd.description,
      cmd.action,
      cmd.layer
    ].join(' ').toLowerCase();
    
    return searchable.includes(query.toLowerCase());
  });
  
  // Filter by layer if specified
  const filteredResults = layer 
    ? searchResults.filter(cmd => cmd.layer === layer)
    : searchResults;
  
  res.json({
    query,
    layer: layer || 'all',
    count: filteredResults.length,
    results: filteredResults,
    timestamp: new Date().toISOString()
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

async function fileExists(filePath) {
try {
await fs.access(filePath);
return true;
} catch {
return false;
}
}

return router;
};

