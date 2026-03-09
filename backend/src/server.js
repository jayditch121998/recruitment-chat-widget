import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import healthRoutes from './routes/health.js';
import agentRoutes from './routes/agents.js';
import chatRoutes from './routes/chat.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/health', healthRoutes);
app.use('/agents', agentRoutes);
app.use('/', chatRoutes);

app.get('/', (req, res) => {
    res.json({ message: 'Welcome to the Node.js Chat Widget API.' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});
