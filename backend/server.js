import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { determineIntent } from './services/orchestratorService.js';

dotenv.config();


const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

import chatRoutes from './routes/chatRoutes.js';
import agentRoutes from './routes/agentRoutes.js';

app.use('/chat-stream', chatRoutes);
app.use('/agents', agentRoutes);

app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});
