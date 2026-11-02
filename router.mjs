import { randomUUID } from 'node:crypto';

export function createDwtcRouter({ express, service, logger = console }) {
  if (!express?.Router) throw new TypeError('createDwtcRouter requires the Express module.');
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/meta', (_req, res) => res.json(service.meta()));
  router.post('/jobs', (req, res) => {
    try {
      const job = service.start({ year: Number(req.body?.year), month: Number(req.body?.month) });
      res.status(202).json(job);
    } catch (e) {
      const status = /too many|running/i.test(e.message) ? 429 : 400;
      res.status(status).json({ error: { message: e.message } });
    }
  });
  router.get('/jobs/:id', (req, res) => {
    const job = service.get(req.params.id);
    if (!job) return res.status(404).json({ error: { message: 'Job not found or expired.' } });
    res.json(job);
  });
  router.get('/jobs/:id/export', async (req, res) => {
    try {
      const file = await service.export(req.params.id);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename.replace(/["\r\n]/g, '')}"`);
      res.send(file.buffer);
    } catch (e) {
      logger.warn?.('Excel export failed', { reason: e.message });
      res.status(404).json({ error: { message: e.message } });
    }
  });
  return router;
}
