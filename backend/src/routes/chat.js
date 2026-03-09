import express from 'express';
import { routeMessage, streamChat } from '../controllers/chatController.js';

const router = express.Router();

router.post('/route', routeMessage);
router.get('/chat-stream', streamChat);

export default router;
