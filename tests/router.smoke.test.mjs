import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDwtcRouter } from '../router.mjs';

test('meta endpoint returns configured year range', async () => {
  const service = {
    meta: () => ({ yearMin: 2020, yearMax: 2035 }),
    start: () => ({ id: 'job-1', status: 'running' }),
    get: () => null
  };
  const app = express(); app.use(express.json()); app.use('/api/dwtc', createDwtcRouter({ express, service }));
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/dwtc/meta`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { yearMin: 2020, yearMax: 2035 });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
