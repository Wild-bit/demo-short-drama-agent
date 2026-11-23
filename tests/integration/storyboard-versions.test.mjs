import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { EventSourceParserStream } from 'eventsource-parser/stream';
import { AppModule } from '../../dist/app.module.js';
import { hashPassword } from '../../dist/auth/password.js';

const wave = { scene: '白色背景', visual: '墨墨招手', dialogue: '你好', prompt: '固定镜头，墨墨抬爪招手' };
const end = { scene: '只在另一镜出现的房间', visual: '墨墨退场', dialogue: '', prompt: '远景，墨墨缓缓退场' };
const draft = { title: '墨墨开场', synopsis: '墨墨和观众见面', script: '墨墨走来，招手后退场。', shots: [wave, end] };
const edit = { ...wave, prompt: '特写，墨墨轻轻抬爪' };

test('10.2 从建议卡到版本保存、并发编辑和历史生成确认', {
  timeout: 30000, skip: !process.env.MYSQL_PASSWORD && '需要开发 MySQL',
}, async t => {
  const modelUrl = 'https://storyboard.fixture.invalid';
  Object.assign(process.env, {
    DEEPSEEK_BASE_URL: modelUrl, DEEPSEEK_MODEL: 'fixture', DEEPSEEK_API_KEY: 'fixture', AGENT_CONTEXT_PROFILE: 'normal',
  });
  const modelInputs = [];
  const realFetch = globalThis.fetch;
  // 只固定供应商的回答。工具注册、SSE、聊天历史、资产归属和事务走实际实现。
  t.mock.method(globalThis, 'fetch', (url, opts) => {
    if (url !== modelUrl + '/chat/completions') return realFetch(url, opts);
    const input = JSON.parse(opts.body);
    modelInputs.push(input);
    const last = input.messages.at(-1);
    const needsTool = last.role === 'user' && (last.content === '编写分镜' || last.content.startsWith('改这一镜'));
    const preamble = last.role === 'user' && last.content === '编写分镜' ? '先说明开场仪式思路，现在重写：' : undefined;
    const message = needsTool ? {
      ...(preamble && { content: preamble }),
      tool_calls: [{
        id: 'proposal-' + randomUUID(), type: 'function', function: {
          name: 'propose_storyboard', arguments: JSON.stringify(last.content === '编写分镜' ? draft : edit),
        },
      }],
    } : { content: '请审阅。' };
    if (!input.stream) return Response.json({ choices: [{ message }] });
    const delta = needsTool ? {
      ...(preamble && { content: preamble }),
      tool_calls: [{ index: 0, ...message.tool_calls[0] }],
    } : message;
    const frame = 'data: ' + JSON.stringify({ choices: [{ delta, finish_reason: needsTool ? 'tool_calls' : 'stop' }] });
    return new Response(frame + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
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
        for (const { projectId } of await db.manager.findBy('Project', { userId })) {
          for (const entity of ['GenerationConfirmation', 'StoryboardVersion']) await db.manager.delete(entity, { projectId });
        }
        for (const { sessionId } of await db.manager.findBy('Session', { userId })) {
          await db.manager.delete('SessionMessage', { sessionId });
        }
        for (const entity of ['AgentRunRecord', 'Session', 'Project', 'Asset', 'AuthToken', 'User']) {
          await db.manager.delete(entity, { userId });
        }
      }
    } finally { await app.close(); }
  });

  function http(method, path, token, body) {
    return realFetch(base + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  }
  async function json(method, path, token, status, body) {
    const res = await http(method, path, token, body);
    const result = await res.json();
    assert.equal(res.status, status, path + ' ' + JSON.stringify(result));
    return result;
  }
  async function account() {
    const username = 'storyboard-' + randomUUID();
    const password = randomUUID();
    const { userId } = await db.manager.save('User', { username, passwordHash: await hashPassword(password) });
    users.push(userId);
    return (await json('POST', '/auth/login', '', 200, { username, password })).token;
  }
  const token = await account();
  const other = await account();
  const { projectId } = await json('POST', '/projects/create', token, 201, { name: '课程验收' });
  const latestPath = '/storyboards/latest?projectId=' + projectId;
  const session = () => json('POST', '/sessions/create', token, 201, { projectId });
  const { sessionId: a } = await session();
  const { sessionId: b } = await session();
  const asset = userId => db.manager.save('Asset', {
    userId, name: '招手参考', type: 'image', source: 'upload', description: '', tags: [], objectKey: 'lesson/test.jpg',
  });
  const reference = await asset(users[0]);
  const forbidden = await asset(users[1]);

  const turn = await http('POST', '/sessions/stream', token, { sessionId: a, message: '编写分镜' });
  const frames = turn.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream());
  let terminal;
  const streamedDeltas = [];
  for await (const frame of frames) {
    const parsed = JSON.parse(frame.data);
    if (parsed.type === 'text_delta') streamedDeltas.push([parsed.modelCallNumber, parsed.text]);
    terminal = parsed;
  }
  assert.equal(terminal.type, 'completed');
  assert.deepEqual(streamedDeltas, [
    [1, '先说明开场仪式思路，现在重写：'],
    [2, '请审阅。'],
  ]);
  assert.equal(terminal.text, '先说明开场仪式思路，现在重写：\n\n请审阅。');
  const proposal = terminal.storyboardProposal;
  assert.equal(proposal.kind, 'storyboard');
  assert.equal(proposal.baseVersion, 0);
  assert.deepEqual(proposal.storyboard.shots[1], { ...end, assetIds: [] });
  const firstAssistant = await db.getRepository('SessionMessage').findOneByOrFail({ sessionId: a, sequence: 2 });
  assert.equal(firstAssistant.message.content, '先说明开场仪式思路，现在重写：');
  const toolMessage = await db.getRepository('SessionMessage').findOneByOrFail({ sessionId: a, sequence: 3 });
  assert.equal(toolMessage.message.toolName, 'propose_storyboard');
  assert.equal(JSON.parse(toolMessage.message.content).status, 'proposed');
  const finalAssistant = await db.getRepository('SessionMessage').findOneByOrFail({ sessionId: a, sequence: 4 });
  assert.equal(finalAssistant.message.content, '请审阅。');
  const history = await json('GET', `/sessions/messages?projectId=${projectId}&sessionId=${a}`, token, 200);
  assert.equal(history.at(-1).content, '先说明开场仪式思路，现在重写：\n\n请审阅。');
  assert.deepEqual(history.at(-1).storyboardProposal, proposal);
  assert.equal((await json('GET', latestPath, token, 200)).version, 0);
  const save = (expectedVersion, storyboard, status = 200) =>
    json('POST', '/storyboards/save', token, status, { projectId, expectedVersion, storyboard });
  const withAsset = id => ({ ...draft, shots: [{ ...wave, assetIds: [id] }, end] });
  await save(0, withAsset(forbidden.id), 400);
  await save(0, { ...draft, shots: [null] }, 400);
  await json('POST', '/storyboards/save', other, 404, { projectId, expectedVersion: 0, storyboard: draft });
  const first = await save(0, withAsset(reference.id));
  const [one, two] = first.storyboard.shots;
  assert.notEqual(one.shotId, two.shotId);
  assert.deepEqual(first.storyboard, (await json('GET', latestPath, token, 200)).storyboard);
  await save(1, { ...draft, shots: [one, one] }, 400);
  await save(1, { ...draft, shots: [{ ...one, shotId: randomUUID() }] }, 400);

  // 只有显式选择才送入单镜的资料；同一项目的另一镜和剧本均不进入 B。
  const selectedShot = { version: 1, shotId: one.shotId };
  const beforeEdit = modelInputs.length;
  const suggestion = await json('POST', '/sessions/turn', token, 201, { sessionId: b, message: '改这一镜', selectedShot });
  const firstEditInput = JSON.stringify(modelInputs[beforeEdit].messages);
  assert.ok(firstEditInput.includes(one.prompt));
  assert.ok(!firstEditInput.includes(two.scene) && !firstEditInput.includes(draft.script));
  assert.deepEqual(suggestion.storyboardProposal, {
    kind: 'shot', baseVersion: 1, shot: { ...one, ...edit },
  });
  const { sessionId: standalone } = await json('POST', '/sessions/create', token, 201, {});
  await json('POST', '/sessions/turn', token, 400, { sessionId: standalone, message: '改这一镜', selectedShot });

  const picked = { version: 1, shotIds: [two.shotId, one.shotId], model: 'course-video-model' };
  const id = randomUUID();
  const confirmReq = (cid, payload, status, tok = token) =>
    json('POST', '/storyboards/confirm', tok, status, { projectId, confirmationId: cid, ...payload });
  const confirmations = await Promise.all([1, 2].map(() => confirmReq(id, picked, 200)));
  assert.deepEqual(confirmations[0], confirmations[1]);
  assert.deepEqual(confirmations[0].shotIds, [one.shotId, two.shotId]);
  await confirmReq(id, { ...picked, model: 'another-model' }, 409);
  await confirmReq(randomUUID(), { ...picked, shotIds: [randomUUID()] }, 400);
  await confirmReq(randomUUID(), { ...picked, shotIds: [] }, 400);

  const updated = { ...first.storyboard, shots: [two, suggestion.storyboardProposal.shot] };
  const concurrent = await Promise.all(
    [1, 2].map(() => http('POST', '/storyboards/save', token, { projectId, expectedVersion: 1, storyboard: updated })),
  );
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  for (const res of concurrent) await res.text();
  const second = await json('GET', latestPath, token, 200);
  assert.equal(second.version, 2);
  assert.deepEqual(second.storyboard.shots, updated.shots);
  assert.deepEqual(await json('GET', `/storyboards/version?projectId=${projectId}&version=1`, token, 200), first);
  await json('POST', '/sessions/turn', token, 409, { sessionId: b, message: '过期的选镜', selectedShot });
  assert.deepEqual(await confirmReq(id, picked, 200), confirmations[0]);
  await confirmReq(randomUUID(), picked, 409);
  await json('GET', `/storyboards/confirmation?projectId=${projectId}&confirmationId=${id}`, other, 404);
  await json('GET', `/storyboards/version?projectId=${projectId}&version=1`, other, 404);
  const third = await save(2, { ...updated, shots: [two, { ...wave, visual: '新增镜头' }] });
  assert.equal(third.storyboard.shots[0].shotId, two.shotId);
  assert.notEqual(third.storyboard.shots[1].shotId, one.shotId);
  assert.deepEqual(
    await json('GET', `/storyboards/confirmation?projectId=${projectId}&confirmationId=${id}`, token, 200),
    confirmations[0],
  );
  assert.equal(await db.manager.countBy('GenerationConfirmation', { projectId }), 1);
  const scriptOnly = await save(3, { ...draft, synopsis: '', shots: [] });
  assert.deepEqual((await json('GET', latestPath, token, 200)).storyboard, scriptOnly.storyboard);
  assert.equal(scriptOnly.storyboard.script, draft.script);
});
