import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../dist/app.module.js';
import { hashPassword } from '../../dist/auth/password.js';
import { agentSystemPrompt } from '../../dist/prompts/system/agent.js';

test('10.1 项目归属、独立会话兼容、切换对话与模型输入隔离', {
  timeout: 30000, skip: !process.env.MYSQL_PASSWORD && '需要配置开发 MySQL',
}, async t => {
  const modelUrl = 'https://lesson10.invalid';
  Object.assign(process.env, {
    DEEPSEEK_BASE_URL: modelUrl, DEEPSEEK_MODEL: 'fixture', DEEPSEEK_API_KEY: 'fixture',
    AGENT_CONTEXT_PROFILE: 'normal',
  });
  const inputs = [];
  const search = '从我的素材库找墨墨-招手';
  const clarify = '刚才的第三张是哪张？';
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (url !== modelUrl + '/chat/completions') return realFetch(url, options);
    const body = JSON.parse(options.body);
    inputs.push(body);
    const last = body.messages.at(-1);
    let message;
    if (last.role === 'tool') {
      message = { content: JSON.parse(last.content).assets[0].name };
    } else if (last.content === search) {
      message = { tool_calls: [{
        id: randomUUID(), type: 'function',
        function: { name: 'search_user_assets', arguments: JSON.stringify({ query: '墨墨-招手' }) },
      }] };
    } else {
      message = { content: '请指明具体素材。' };
    }
    return Response.json({ choices: [{ message }] });
  });

  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()) + '/api';
  const db = app.get(DataSource);
  const users = [];
  t.after(async () => {
    try {
      for (const userId of users) {
        const sessions = await db.getRepository('Session').findBy({ userId });
        for (const { sessionId } of sessions) await db.getRepository('SessionMessage').delete({ sessionId });
        for (const entity of ['AgentRunRecord', 'Session', 'Project', 'Asset', 'AuthToken', 'User']) {
          await db.getRepository(entity).delete({ userId });
        }
      }
    } finally { await app.close(); }
  });

  async function request(path, token, status, data, method = data === undefined ? 'GET' : 'POST') {
    const response = await realFetch(base + path, {
      method,
      headers: {
        ...(data !== undefined && { 'Content-Type': 'application/json' }),
        Authorization: 'Bearer ' + token,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(8000),
    });
    const result = response.status === 204 ? undefined : await response.json();
    assert.equal(response.status, status, path + ' ' + JSON.stringify(result));
    return result;
  }

  async function account() {
    const username = 'lesson10-' + randomUUID();
    const password = randomUUID();
    const { userId } = await db.getRepository('User').save({ username, passwordHash: await hashPassword(password) });
    users.push(userId);
    const { token } = await request('/auth/login', '', 200, { username, password });
    return { userId, token };
  }

  const owner = await account();
  const other = await account();
  const { token } = owner;
  await request('/projects/list', '', 401);
  await request('/projects/create', token, 400, { name: '  ' });
  await request('/projects/create', token, 400, { name: '甲'.repeat(256) });
  const project = await request('/projects/create', token, 201, { name: ' 墨墨开场 ', userId: other.userId });
  const second = await request('/projects/create', token, 201, { name: '另一部短剧' });
  const detailPath = '/projects/detail?projectId=' + project.projectId;
  assert.equal(project.userId, owner.userId);
  assert.equal(project.name, '墨墨开场');
  assert.deepEqual(await request(detailPath, token, 200), project);
  assert.deepEqual(new Set((await request('/projects/list', token, 200)).map(p => p.projectId)),
    new Set([project.projectId, second.projectId]));
  assert.deepEqual(await request('/projects/list', other.token, 200), []);
  await request(detailPath, other.token, 404);
  await request('/sessions/list?projectId=' + project.projectId, other.token, 404);
  await request('/sessions/create', other.token, 404, { projectId: project.projectId });

  const listSessionsPath = '/sessions/list?projectId=' + project.projectId;
  assert.deepEqual(await request(listSessionsPath, token, 200), []);
  const independent = await request('/sessions/create', token, 201, {});
  const sessionRows = db.getRepository('Session');
  assert.equal((await sessionRows.findOneByOrFail({ sessionId: independent.sessionId })).projectId, null);
  await request('/sessions/turn', token, 201, { sessionId: independent.sessionId, message: '独立会话' });
  const a = await request('/sessions/create', token, 201, { projectId: project.projectId });
  const b = await request('/sessions/create', token, 201, { projectId: project.projectId.toUpperCase() });
  assert.equal(a.projectId, project.projectId);
  assert.equal(b.projectId, project.projectId);
  assert.notEqual(a.sessionId, b.sessionId);
  const list = await request(listSessionsPath, token, 200);
  assert.deepEqual(new Set(list.map(s => s.sessionId)), new Set([a.sessionId, b.sessionId]));
  const messages = (id, pid = project.projectId) => `/sessions/messages?projectId=${pid}&sessionId=${id}`;
  await request(messages(independent.sessionId), token, 404);
  await request(messages(a.sessionId), other.token, 404);
  assert.deepEqual(await request('/sessions/list?projectId=' + second.projectId, token, 200), []);
  await request(messages(a.sessionId, second.projectId), token, 404);

  const asset = await db.getRepository('Asset').save({
    userId: owner.userId, name: '墨墨-招手', type: 'image', source: 'upload', description: '',
    tags: [], objectKey: 'short-drama/lesson10/wave.jpg',
  });
  const turn = (id, message) => request('/sessions/turn', token, 201, { sessionId: id, message });
  const turnA = await turn(a.sessionId, search);
  assert.equal(turnA.uiBlocks?.length, 1);
  assert.equal(turnA.uiBlocks[0].component, 'asset_gallery');
  assert.equal(turnA.uiBlocks[0].assets[0].id, asset.id);
  const visibleA = [
    { sequence: 1, role: 'user', content: search },
    { sequence: 4, role: 'assistant', content: asset.name, uiBlocks: turnA.uiBlocks },
  ];
  assert.deepEqual(await request(messages(a.sessionId), token, 200), visibleA);
  // 模拟旧历史消息未存 uiBlocks 字段时，读取接口仍能从同一轮 tool 记录自动补齐素材卡片块。
  await db.getRepository('SessionMessage').update(
    { sessionId: a.sessionId, sequence: 4 },
    { message: { role: 'assistant', content: asset.name, toolCalls: [] } },
  );
  assert.deepEqual(await request(messages(a.sessionId), token, 200), visibleA);
  await sessionRows.update(a.sessionId, { contextSummary: '只属于 A 的摘要', contextSummaryThroughSequence: 4 });
  assert.deepEqual(await request(messages(b.sessionId), token, 200), []);
  const bRow = await sessionRows.findOneByOrFail({ sessionId: b.sessionId });
  assert.equal(bRow.contextSummary, null);
  assert.equal(bRow.contextSummaryThroughSequence, 0);

  const beforeB = inputs.length;
  await turn(b.sessionId, clarify);
  assert.deepEqual(inputs[beforeB].messages, [
    { role: 'system', content: agentSystemPrompt }, { role: 'user', content: clarify },
  ]);
  assert.ok(!inputs[beforeB].tools.some(tool => tool.function.name === 'read_session_history'));
  const result = await turn(b.sessionId, search);
  assert.deepEqual(result.toolResults.map(call => call.result.assets[0].id), [asset.id]);
  const trace = await request(`/sessions/run?sessionId=${b.sessionId}&runId=${result.runId}`, token, 200);
  assert.deepEqual(trace.steps.map(step => step.kind), ['model', 'tool', 'model']);
  assert.equal(trace.steps[1].name, 'search_user_assets');
  assert.deepEqual(await request(messages(a.sessionId), token, 200), visibleA);

  // 首轮自动生成会话标题，并校验重命名、置顶排序、单会话删除与项目级联删除。
  assert.equal((await sessionRows.findOneByOrFail({ sessionId: a.sessionId })).name, search);
  await request('/sessions/rename', token, 400, { projectId: project.projectId, sessionId: a.sessionId, name: '   ' });
  await request('/sessions/rename', other.token, 404, { projectId: project.projectId, sessionId: a.sessionId, name: '越权改名' });
  await request('/sessions/rename', token, 404, { projectId: second.projectId, sessionId: a.sessionId, name: '错配项目改名' });
  const renamedA = await request('/sessions/rename', token, 200, {
    projectId: project.projectId, sessionId: a.sessionId, name: ' 墨墨选角讨论 ',
  });
  assert.equal(renamedA.name, '墨墨选角讨论');
  const pinnedA = await request('/sessions/pin', token, 200, {
    projectId: project.projectId, sessionId: a.sessionId, pinned: true,
  });
  assert.equal(pinnedA.pinned, true);
  const ordered = await request(listSessionsPath, token, 200);
  assert.equal(ordered[0].sessionId, a.sessionId);

  // 删除单条会话 B：清理其消息与运行记录，保留会话 A。
  await request('/sessions/delete', other.token, 404, { projectId: project.projectId, sessionId: b.sessionId });
  await request('/sessions/delete', token, 200, { projectId: project.projectId, sessionId: b.sessionId });
  assert.equal(await db.getRepository('SessionMessage').countBy({ sessionId: b.sessionId }), 0);
  assert.equal(await db.getRepository('AgentRunRecord').countBy({ sessionId: b.sessionId }), 0);
  await request(messages(b.sessionId), token, 404);

  // 删除整个项目：清理项目及其剩余会话、消息和运行记录，保留独立会话与用户个人 Asset。
  await request('/projects/delete', other.token, 404, { projectId: project.projectId });
  await request('/projects/delete', token, 200, { projectId: project.projectId });
  await request(detailPath, token, 404);
  assert.equal(await sessionRows.countBy({ projectId: project.projectId }), 0);
  assert.equal(await db.getRepository('SessionMessage').countBy({ sessionId: a.sessionId }), 0);
  assert.ok(await sessionRows.findOneBy({ sessionId: independent.sessionId }));
  assert.ok(await db.getRepository('Asset').findOneBy({ id: asset.id }));
});
