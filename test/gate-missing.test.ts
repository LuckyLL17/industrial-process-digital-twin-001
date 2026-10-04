import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/index.js';

const create = async (overrides: any) =>
  (
    await app.inject({
      method: 'POST',
      url: '/api/maintenance/windows',
      payload: {
        assetId: 'heater-01',
        start: '2026-10-04T22:00:00Z',
        end: '2026-10-05T02:00:00Z',
        requiredLockout: true,
        downstreamImpact: true,
        sparesReady: true,
        ...overrides,
      },
    })
  ).json();

const execute = (id: string, payload?: any) =>
  app.inject({ method: 'POST', url: `/api/maintenance/${id}/execute`, payload });

const assetState = async () =>
  (await app.inject({ method: 'GET', url: '/api/twin/state' })).json().assets.find(
    (a: any) => a.id === 'heater-01',
  ).state;

const execAuditCount = async (id: string) => {
  const audit = (await app.inject({ method: 'GET', url: '/api/audit' })).json();
  return audit.filter((x: any) => x.action === 'maintenance.execute' && x.entity === id).length;
};

test('downstreamImpact 缺失：拒绝执行，资产与审计不变，重试仍被拒绝', async () => {
  const w = await create({ assetId: 'reactor-01', downstreamImpact: false });
  const before = (await app.inject({ method: 'GET', url: '/api/twin/state' })).json().assets.find(
    (a: any) => a.id === 'reactor-01',
  ).state;

  const r1 = await execute(w.id, { lockoutConfirmed: true });
  assert.equal(r1.statusCode, 409);
  assert.deepEqual(r1.json().missing, ['downstreamImpact']);

  const after = (await app.inject({ method: 'GET', url: '/api/twin/state' })).json().assets.find(
    (a: any) => a.id === 'reactor-01',
  ).state;
  assert.equal(after, before, '资产状态不得改变');
  assert.equal(await execAuditCount(w.id), 0, '不得写入成功执行审计');

  // 失败重试：仍然 409，且无副作用
  const r2 = await execute(w.id, { lockoutConfirmed: true });
  assert.equal(r2.statusCode, 409);
  const afterRetry = (await app.inject({ method: 'GET', url: '/api/twin/state' })).json().assets.find(
    (a: any) => a.id === 'reactor-01',
  ).state;
  assert.equal(afterRetry, before);
  assert.equal(await execAuditCount(w.id), 0);
});

test('sparesReady 缺失：拒绝执行，资产与审计不变', async () => {
  const w = await create({ sparesReady: false });
  const before = await assetState();

  const r = await execute(w.id, { lockoutConfirmed: true });
  assert.equal(r.statusCode, 409);
  assert.deepEqual(r.json().missing, ['sparesReady']);
  assert.equal(await assetState(), before);
  assert.equal(await execAuditCount(w.id), 0);
});

test('LOTO 未确认：拒绝执行；补齐确认后重试成功且仅一条执行审计', async () => {
  const w = await create({ requiredLockout: true });
  const before = await assetState();

  const denied = await execute(w.id, { lockoutConfirmed: false });
  assert.equal(denied.statusCode, 409);
  assert.deepEqual(denied.json().missing, ['lockoutConfirmed']);
  assert.equal(await assetState(), before);
  assert.equal(await execAuditCount(w.id), 0);

  const ok = await execute(w.id, { lockoutConfirmed: true });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().status, 'executing');
  assert.equal(await assetState(), 'stopped');
  assert.equal(await execAuditCount(w.id), 1, '重试成功只能写入一条执行审计');
});
