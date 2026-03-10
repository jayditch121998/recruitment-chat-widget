export const getActiveAgents = (req, res) => {
    // The frontend expects a JSON payload saying which agents are active
    // This allows backend to remotely toggle frontend UI buttons
    res.json({
        job_description_generator: process.env.JD_AGENT_ACTIVE !== 'false',
        job_ad_creator: process.env.AD_AGENT_ACTIVE !== 'false'
    });
};
