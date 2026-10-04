import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/index.js';

const post = (url: string, payload?: any) =>
  app.inject({ method: 'POST', url, payload });

test('所有门禁满足时执行窗口：状态 executing、资产 stopped、写入执行审计', async () => {
  const w = (
    await post('/api/maintenance/windows', {
      assetId: 'pump-01',
      start: '2026-10-04T22:00:00Z',
      end: '2026-10-05T02:00:00Z',
      requiredLockout: true,
      downstreamImpact: true,
      sparesReady: true,
    })
  ).json();

  const res = await post(`/api/maintenance/${w.id}/execute`, { lockoutConfirmed: true });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.status, 'executing');
  assert.ok(body.executedAt, '应记录执行时间');

  const state = (await app.inject({ method: 'GET', url: '/api/twin/state' })).json();
  const pump = state.assets.find((a: any) => a.id === 'pump-01');
  assert.equal(pump.state, 'stopped');

  const audit = (await app.inject({ method: 'GET', url: '/api/audit' })).json();
  const execAudits = audit.filter((x: any) => x.action === 'maintenance.execute' && x.entity === w.id);
  assert.equal(execAudits.length, 1);
});
