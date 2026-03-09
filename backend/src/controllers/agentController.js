import { AGENT_CATALOG } from '../config/agents.js';

export const getAgents = (req, res) => {
    try {
        const config = Object.keys(AGENT_CATALOG).reduce((acc, key) => {
            acc[key] = AGENT_CATALOG[key].isActive;
            return acc;
        }, {});
        return res.json(config);
    } catch (error) {
        console.error('Error fetching agent config:', error);
        return res.status(500).json({ error: 'Failed to fetch agent configurations' });
    }
};
