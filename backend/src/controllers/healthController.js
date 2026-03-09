const buildStatusPayload = () => ({
  status: 'ok',
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
});

export const getHealth = (req, res) => {
  res.status(200).json(buildStatusPayload());
};

export const getReady = (req, res) => {
  res.status(200).json(buildStatusPayload());
};
