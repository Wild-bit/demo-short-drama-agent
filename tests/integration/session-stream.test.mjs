import 'reflect-metadata';
import { EventSourceParserStream } from 'eventsource-parser/stream';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../dist/app.module.js';
import { hashPassword } from '../../dist/auth/password.js';

const usage = { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 };
function chunk(delta, finish_reason = null) {
  return 'data: ' + JSON.stringify({ choices: [{ delta, finish_reason }], usage: finish_reason ? usage : null }) + '\n\n';
}

/** 固定供应商响应，真实 HTTP、Nest、会话锁、素材工具和 MySQL 均在测试路径上。 */
test('逐段展示、跨会话隔离、Trace 归属、终态与断线后的历史一致', {
  timeout: 30000, skip: !process.env.MYSQL_PASSWORD && '需要通过 --env-file=.env 连接开发库',
}, async t => {
  const nextText = Promise.withResolvers();
  const upstreamCancelled = Promise.withResolvers();
  const historyChanged = Promise.withResolvers();
  const provider = createServer(async (req, res) => {
    let body = '';
    for await (const bytes of req) body += bytes;
    const { messages, stream } = JSON.parse(body);
    const question = messages.findLast(m => m.role === 'user')?.content;
    if (question === '测试失败') { res.writeHead(503).end(); return; }
    if (!stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        choices: [{ message: { content: '普通回答' } }], usage,
      }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (question === '取消本轮') {
      res.once('close', () => upstreamCancelled.resolve());
      res.write(chunk({ content: '未写完' }));
      return;
    }
    if (question === '测试保存冲突') {
      res.write(chunk({ content: '基于旧历史的回答' }));
      await historyChanged.promise;
      res.end(chunk({}, 'stop') + 'data: [DONE]\n\n');
      return;
    }
    const tool = { index: 0, id: 'search-1', function: { name: 'search_user_assets', arguments: '{"query":"墨墨"}' } };
    if (question === '测试上限') {
      const tool_calls = Array.from({ length: 6 }, (_, index) => ({ ...tool, index, id: 'search-' + index }));
      res.end(chunk({ tool_calls }, 'tool_calls') + 'data: [DONE]\n\n');
      return;
    }
    if (question === '搜墨墨' && messages.at(-1).role !== 'tool') {
      res.end(chunk({ tool_calls: [tool] }, 'tool_calls') + 'data: [DONE]\n\n');
      return;
    }
    if (question === '搜墨墨') {
      const { assets } = JSON.parse(messages.at(-1).content);
      res.write(chunk({ content: '找到了' }));
      await nextText.promise;
      res.write(chunk({ content: assets.map(a => a.name).join('、') }));
    } else {
      res.write(chunk({ content: '分镜是按镜头组织的画面计划。' }));
    }
    res.end(chunk({}, 'stop') + 'data: [DONE]\n\n');
  });
  await new Promise((resolve, reject) => provider.once('error', reject).listen(0, '127.0.0.1', resolve));
  Object.assign(process.env, {
    DEEPSEEK_API_KEY: 'local-fixture', DEEPSEEK_MODEL: 'fixture-model',
    DEEPSEEK_BASE_URL: 'http://127.0.0.1:' + provider.address().port, AGENT_CONTEXT_PROFILE: 'normal',
  });
  t.after(() => { nextText.resolve(); historyChanged.resolve(); provider.closeAllConnections(); provider.close(); });
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const url = (await app.getUrl()) + '/api';
  const db = app.get(DataSource);
  const users = [];
  t.after(async () => {
    try {
      for (const { userId } of users) {
        const sessions = await db.getRepository('Session').findBy({ userId });
        for (const { sessionId } of sessions) await db.getRepository('SessionMessage').delete({ sessionId });
        for (const entity of ['AgentRunRecord', 'Session', 'Asset', 'AuthToken', 'User'])
          await db.getRepository(entity).delete({ userId });
      }
    } finally { await app.close(); }
  });

  function http(path, token, body, signal) {
    return fetch(url + path, {
      method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: body && JSON.stringify(body), signal: signal ?? AbortSignal.timeout(8000),
    });
  }
  async function account() {
    const password = randomUUID();
    const user = await db.getRepository('User').save({ username: 'lesson9-' + randomUUID(), passwordHash: await hashPassword(password) });
    users.push(user);
    const login = await http('/auth/login', '', { username: user.username, password });
    assert.equal(login.status, 200);
    return { ...user, token: (await login.json()).token };
  }
  const owner = await account();
  const other = await account();
  const { sessionId: a } = await (await http('/sessions', owner.token, {})).json();
  const { sessionId: b } = await (await http('/sessions', owner.token, {})).json();
  await db.getRepository('Asset').save({
    name: '墨墨-招手', userId: owner.userId, type: 'image', source: 'upload', description: '墨墨', tags: [], objectKey: 'lesson9/fixture',
  });

  async function submit(id, message, signal, onEvent) {
    const response = await http('/sessions/' + id + '/turns/stream', owner.token, { message }, signal);
    assert.match(response.headers.get('content-type'), /^text\/event-stream/);
    const events = [];
    const frames = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream());
    for await (const frame of frames) {
      const data = JSON.parse(frame.data);
      assert.equal(frame.event, data.type);
      assert.equal(data.sessionId, id);
      events.push(data);
      await onEvent?.(data);
    }
    assert.ok(['completed', 'stopped', 'failed'].includes(events.at(-1)?.type));
    assert.ok(events.every(e => e.runId === events[0].runId));
    return events;
  }
  const path = (session, run) => '/sessions/' + session + '/runs/' + run;
  const read = async (id, run) => (await http(path(id, run), owner.token)).json();
  const messages = id => db.getRepository('SessionMessage').countBy({ sessionId: id });

  const firstText = Promise.withResolvers();
  const aEvents = submit(a, '搜墨墨', undefined, e => {
    if (e.type === 'text_delta') firstText.resolve(e);
  });
  // A 的模型正在等测试端放行，客户端必须已经收到第一段文字；B 可独立完成。
  try {
    const first = await Promise.race([firstText.promise, aEvents.then(() => { throw Error('未收到文字'); })]);
    assert.equal(first.text, '找到了');
    assert.equal((await read(a, first.runId)).status, 'running');
    assert.equal(await messages(a), 0);
    const bEvents = await submit(b, '解释分镜');
    assert.equal(bEvents.at(-1).type, 'completed');
    assert.notEqual(bEvents[0].runId, first.runId);
    assert.equal((await http(path(b, first.runId), owner.token)).status, 404);
    assert.equal((await http(path(a, first.runId), other.token)).status, 404);
    assert.equal((await http('/sessions/' + a + '/turns/stream', other.token, { message: '越权' })).status, 404);
    assert.equal((await http('/sessions/' + a + '/turns/stream', owner.token, { message: '并发' })).status, 409);
  } finally { nextText.resolve(); }
  const events = await aEvents;
  assert.deepEqual(events.filter(e => e.type === 'text_delta').map(e => e.text), ['找到了', '墨墨-招手']);
  assert.equal(events.at(-1).text, '找到了墨墨-招手');
  assert.equal(events.at(-1).type, 'completed');
  const trace = await read(a, events[0].runId);
  assert.deepEqual(trace.steps.map(s => s.kind), ['model', 'tool', 'model']);
  assert.equal(trace.steps[1].toolCallId, 'search-1');
  assert.equal(trace.steps[2].usage.totalTokens, 15);
  assert.ok(trace.steps.every(s => s.status === 'completed' && s.durationMs >= 0));
  assert.equal(await messages(a), 4);

  const failed = await submit(a, '测试失败');
  assert.equal(failed.at(-1).type, 'failed');
  assert.equal((await read(a, failed[0].runId)).steps[0].status, 'failed');
  assert.equal(await messages(a), 4);

  const abort = new AbortController();
  let cancelledId;
  await assert.rejects(submit(a, '取消本轮', abort.signal, e => {
    if (e.type === 'text_delta') { cancelledId = e.runId; abort.abort(); }
  }), { name: 'AbortError' });
  await upstreamCancelled.promise;
  let cancelled = await read(a, cancelledId);
  for (let i = 0; cancelled.status === 'running' && i < 100; i++) {
    await delay(15);
    cancelled = await read(a, cancelledId);
  }
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(await messages(a), 4);

  const stopped = await submit(a, '测试上限');
  assert.equal(stopped.at(-1).type, 'stopped');
  assert.equal(stopped.at(-1).reason, 'tool_call_limit');
  assert.deepEqual((await read(a, stopped[0].runId)).steps.map(s => s.kind), ['model']);
  // 模拟另一个 API 实例在模型回答期间写入一轮；已推送的文字不能导致虚假的 completed。
  const conflicts = await submit(b, '测试保存冲突', undefined, async event => {
    if (event.type === 'text_delta') {
      try {
        await db.getRepository('SessionMessage').insert([
          { sessionId: b, sequence: 3, message: { role: 'user', content: '同时提问' } },
          { sessionId: b, sequence: 4, message: { role: 'assistant', content: '同时回答' } },
        ]);
      } finally { historyChanged.resolve(); }
    }
  });
  assert.equal(conflicts.at(-1).type, 'failed');
  assert.equal(conflicts.at(-1).statusCode, 409);
  assert.equal(await messages(b), 4);
  assert.equal((await read(b, conflicts[0].runId)).status, 'failed');

  const json = await (await http('/sessions/' + a + '/turns', owner.token, { message: '继续' })).json();
  assert.equal(json.text, '普通回答');
  assert.equal((await read(a, json.runId)).status, 'completed');
});
