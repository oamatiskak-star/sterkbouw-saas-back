// API endpoints for project portal
const API_BASE = process.env.REACT_APP_API_BASE || '/api/v1';

export const fetchProjectData = async (projectId, options = {}) => {
  const response = await fetch(`${API_BASE}/projects/${projectId}/portal`, {
    headers: {
      'Authorization': `Bearer ${options.token}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) throw new Error('Project data fetch failed');
  return response.json();
};

export const postClientAction = async (projectId, actionType, payload) => {
  const response = await fetch(`${API_BASE}/projects/${projectId}/actions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ actionType, ...payload })
  });
  
  if (!response.ok) throw new Error('Action failed');
  return response.json();
};
