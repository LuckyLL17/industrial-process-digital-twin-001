import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/index.js';

test('重复执行已执行窗口：幂等返回原结果，资产状态与执行审计均不重复', async () => {
  const w = (
    await app.inject({
      method: 'POST',
      url: '/api/maintenance/windows',
      payload: {
        assetId: 'pump-01',
        start: '2026-10-04T22:00:00Z',
        end: '2026-10-05T02:00:00Z',
        requiredLockout: true,
        downstreamImpact: true,
        sparesReady: true,
      },
    })
  ).json();

  const first = await app.inject({
    method: 'POST',
    url: `/api/maintenance/${w.id}/execute`,
    payload: { lockoutConfirmed: true },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().executedAt, first.json().executedAt);
  const executedAt = first.json().executedAt;

  // 第二次执行（甚至不带 LOTO 确认，证明不会重新走门禁或产生副作用）
  const second = await app.inject({ method: 'POST', url: `/api/maintenance/${w.id}/execute` });
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().status, 'executing');
  assert.equal(second.json().executedAt, executedAt, 'executedAt 必须保持首次执行时间');

  const state = (await app.inject({ method: 'GET', url: '/api/twin/state' })).json();
  assert.equal(state.assets.find((a: any) => a.id === 'pump-01').state, 'stopped');

  const audit = (await app.inject({ method: 'GET', url: '/api/audit' })).json();
  const execAudits = audit.filter((x: any) => x.action === 'maintenance.execute' && x.entity === w.id);
  assert.equal(execAudits.length, 1, '重复执行不得追加审计');
  const deniedAudits = audit.filter((x: any) => x.action === 'maintenance.execute.denied' && x.entity === w.id);
  assert.equal(deniedAudits.length, 0, '已执行窗口不得产生拒绝审计');
});

test('不存在的窗口执行返回 404', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/maintenance/does-not-exist/execute' });
  assert.equal(r.statusCode, 404);
});
