import express from 'express';
import { handleChatStream } from '../controllers/chatController.js';

const router = express.Router();

// Define /chat-stream GET and POST routes
router.get('/', handleChatStream);
router.post('/', handleChatStream);

export default router;
