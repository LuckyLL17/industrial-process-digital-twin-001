import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/index.js';

const health = async () => (await app.inject({ method: 'GET', url: '/api/process/health-score' })).json();

test('门禁失败不改变健康评分', async () => {
  const before = await health();

  const w = (
    await app.inject({
      method: 'POST',
      url: '/api/maintenance/windows',
      payload: {
        assetId: 'reactor-01',
        start: '2026-10-04T22:00:00Z',
        end: '2026-10-05T02:00:00Z',
        downstreamImpact: false,
        sparesReady: true,
      },
    })
  ).json();

  const denied = await app.inject({
    method: 'POST',
    url: `/api/maintenance/${w.id}/execute`,
    payload: { lockoutConfirmed: true },
  });
  assert.equal(denied.statusCode, 409);

  const after = await health();
  assert.equal(after.score, before.score);
  assert.deepEqual(after.components, before.components);
});

test('执行成功后健康评分与资产状态一致：1 台停止 -> 扣分并反映可用性', async () => {
  const initial = await health();
  assert.equal(initial.score, 100);
  assert.equal(initial.components.assetAvailability, 1);

  const w = (
    await app.inject({
      method: 'POST',
      url: '/api/maintenance/windows',
      payload: {
        assetId: 'pump-01',
        start: '2026-10-04T22:00:00Z',
        end: '2026-10-05T02:00:00Z',
        downstreamImpact: true,
        sparesReady: true,
        requiredLockout: true,
      },
    })
  ).json();

  const res = await app.inject({
    method: 'POST',
    url: `/api/maintenance/${w.id}/execute`,
    payload: { lockoutConfirmed: true },
  });
  assert.equal(res.statusCode, 200);

  const state = (await app.inject({ method: 'GET', url: '/api/twin/state' })).json();
  assert.equal(state.assets.find((a: any) => a.id === 'pump-01').state, 'stopped');

  const after = await health();
  assert.equal(after.score, 82, '停止 1 台资产应扣 18 分');
  assert.ok(Math.abs(after.components.assetAvailability - 2 / 3) < 1e-9);
});
