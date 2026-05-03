import { Router } from 'express';
import { PSXApi } from '../lib/psx-api';

const router = Router();

router.get('/symbols', async (req, res) => {
  try {
    const symbols = await PSXApi.getSymbols();
    res.json({ symbols, updatedAt: Date.now() });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to load symbols' });
  }
});

export default router;
