import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';

async function createWindow(app:any,overrides:Record<string,unknown>={}){
 const res=await app.inject({method:'POST',url:'/api/maintenance/windows',payload:{assetId:'reactor-01',start:'2026-10-04T02:00:00.000Z',end:'2026-10-04T04:00:00.000Z',...overrides}});
 assert.equal(res.statusCode,200);
 return res.json();
}
const execute=(app:any,id:string,payload:Record<string,unknown>={})=>app.inject({method:'POST',url:`/api/maintenance/${id}/execute`,payload});
const executeAudits=async(app:any)=>((await app.inject({method:'GET',url:'/api/audit'})).json() as any[]).filter(e=>e.action==='maintenance.execute');
const assetState=async(app:any,id:string)=>((await app.inject({method:'GET',url:'/api/twin/state'})).json().assets as any[]).find(a=>a.id===id).state;
const healthScore=async(app:any)=>(await app.inject({method:'GET',url:'/api/process/health-score'})).json().score;

test('门禁全部满足：窗口进入 executing，资产停止，写入执行审计，健康评分下降',async()=>{
 const app=buildApp({logger:false});
 const before=await healthScore(app);
 const w=await createWindow(app,{downstreamImpact:true,sparesReady:true,requiredLockout:true});
 const res=await execute(app,w.id,{lockoutConfirmed:true});
 assert.equal(res.statusCode,200);
 const body=res.json();
 assert.equal(body.status,'executing');
 assert.ok(body.executedAt);
 assert.equal(await assetState(app,'reactor-01'),'stopped');
 const audits=await executeAudits(app);
 assert.equal(audits.length,1);
 assert.equal(audits[0].entity,w.id);
 assert.equal(await healthScore(app),before-18); // 一台资产停机，可用性扣分
 await app.close();
});

test('downstreamImpact 未评估：拒绝执行且无任何副作用',async()=>{
 const app=buildApp({logger:false});
 const before=await healthScore(app);
 const w=await createWindow(app,{downstreamImpact:false,sparesReady:true,requiredLockout:true});
 const res=await execute(app,w.id,{lockoutConfirmed:true});
 assert.equal(res.statusCode,409);
 assert.match(res.json().error,/downstream impact/);
 assert.equal(await assetState(app,'reactor-01'),'running'); // 资产未被停止
 assert.equal((await executeAudits(app)).length,0); // 未写入成功执行记录
 assert.equal(await healthScore(app),before); // 健康评分不变
 await app.close();
});

test('备件未就绪：拒绝执行且无任何副作用',async()=>{
 const app=buildApp({logger:false});
 const before=await healthScore(app);
 const w=await createWindow(app,{downstreamImpact:true,sparesReady:false,requiredLockout:true});
 const res=await execute(app,w.id,{lockoutConfirmed:true});
 assert.equal(res.statusCode,409);
 assert.match(res.json().error,/spares/);
 assert.equal(await assetState(app,'reactor-01'),'running');
 assert.equal((await executeAudits(app)).length,0);
 assert.equal(await healthScore(app),before);
 await app.close();
});

test('LOTO 未确认：拒绝执行且无任何副作用',async()=>{
 const app=buildApp({logger:false});
 const before=await healthScore(app);
 const w=await createWindow(app,{downstreamImpact:true,sparesReady:true,requiredLockout:true});
 const res=await execute(app,w.id,{lockoutConfirmed:false});
 assert.equal(res.statusCode,409);
 assert.match(res.json().error,/lockout/);
 assert.equal(await assetState(app,'reactor-01'),'running');
 assert.equal((await executeAudits(app)).length,0);
 assert.equal(await healthScore(app),before);
 await app.close();
});

test('失败重试：门禁失败后窗口保持 planned，补齐条件可成功执行',async()=>{
 const app=buildApp({logger:false});
 const w=await createWindow(app,{downstreamImpact:true,sparesReady:true,requiredLockout:true});
 const failed=await execute(app,w.id,{}); // 缺 LOTO
 assert.equal(failed.statusCode,409);
 assert.equal(await assetState(app,'reactor-01'),'running');
 const retried=await execute(app,w.id,{lockoutConfirmed:true}); // 补齐后重试
 assert.equal(retried.statusCode,200);
 assert.equal(retried.json().status,'executing');
 assert.equal(await assetState(app,'reactor-01'),'stopped');
 assert.equal((await executeAudits(app)).length,1); // 仅成功执行写入一条审计
 await app.close();
});

test('重复执行幂等：已执行窗口返回相同状态，不重复变更资产或写审计',async()=>{
 const app=buildApp({logger:false});
 const w=await createWindow(app,{downstreamImpact:true,sparesReady:true,requiredLockout:true});
 const first=await execute(app,w.id,{lockoutConfirmed:true});
 assert.equal(first.statusCode,200);
 const second=await execute(app,w.id,{}); // 再次执行，即使不带 LOTO 也不再校验
 assert.equal(second.statusCode,200);
 assert.equal(second.json().status,'executing');
 assert.equal(second.json().executedAt,first.json().executedAt); // executedAt 不被刷新
 const third=await execute(app,w.id,{lockoutConfirmed:true});
 assert.equal(third.json().executedAt,first.json().executedAt);
 assert.equal(await assetState(app,'reactor-01'),'stopped');
 assert.equal((await executeAudits(app)).length,1); // 审计只有一条
 await app.close();
});

test('健康评分与资产状态一致：门禁拦截前后评分不变，执行后按停机扣分',async()=>{
 const app=buildApp({logger:false});
 const initial=await healthScore(app);
 const blocked=await createWindow(app,{downstreamImpact:false,sparesReady:false,requiredLockout:true});
 await execute(app,blocked.id,{lockoutConfirmed:true});
 assert.equal(await healthScore(app),initial); // 被拦截不影响评分
 const ok=await createWindow(app,{downstreamImpact:true,sparesReady:true,requiredLockout:true});
 await execute(app,ok.id,{lockoutConfirmed:true});
 const after=await healthScore(app);
 assert.equal(after,initial-18);
 const health=(await app.inject({method:'GET',url:'/api/process/health-score'})).json();
 assert.ok(Math.abs(health.components.assetAvailability-(1-1/3))<1e-9); // 3 台资产 1 台停机
 await app.close();
});
