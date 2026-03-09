import express from 'express';
import { getHealth, getReady } from '../controllers/healthController.js';

const router = express.Router();

router.get('/', getHealth);
router.get('/ready', getReady);

export default router;
