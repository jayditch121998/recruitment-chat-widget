import express from 'express';
import { getActiveAgents } from '../controllers/agentController.js';

const router = express.Router();

router.get('/', getActiveAgents);

export default router;
