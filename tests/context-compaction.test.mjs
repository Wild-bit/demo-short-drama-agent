import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentService } from '../dist/harness/agent/agent.service.js';
import { ToolRegistryService } from '../dist/tools/tool-registry.service.js';

const searchResults = [
  { id: 'asset-a', name: '墨墨-探头' },
  { id: 'asset-b', name: '墨墨-招手' },
  { id: 'asset-c', name: '墨墨-思考' },
];
const displayedList = '1. 墨墨-思考（asset-c）\n2. 墨墨-探头（asset-a）\n3. 墨墨-招手（asset-b）';
const oldTurn = [
  { role: 'user', content: '搜索墨墨，列出三张候选' },
  { role: 'assistant', content: '', toolCalls: [
    { id: 'search-archive', name: 'search_user_assets', arguments: '{"query":"墨墨"}' },
  ] },
  { role: 'tool', toolCallId: 'search-archive',
    content: JSON.stringify({ assets: searchResults, detail: '旧工具结果'.repeat(500) }) },
  { role: 'assistant', content: displayedList },
];

function entries(messages, firstSequence = 1) {
  return messages.map((message, index) => ({ sequence: firstSequence + index, message }));
}

function mockModel(t, respond) {
  const env = {
    AGENT_CONTEXT_PROFILE: 'lesson',
    AGENT_CONTEXT_WINDOW_TOKENS: '6500',
    DEEPSEEK_BASE_URL: 'https://compaction.fixture.invalid',
    DEEPSEEK_API_KEY: 'fixture',
    DEEPSEEK_MODEL: 'fixture',
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    return respond(request, requests.length);
  });
  return requests;
}

function modelResponse(message) {
  return Response.json({ choices: [{ message }] });
}

test('摘要后经统一工具入口回查用户看见的顺序', async (t) => {
  const requests = mockModel(t, (_request, number) => {
    if (number === 1) return modelResponse({ content: '用户已搜索墨墨并查看候选。' });
    if (number === 2) return modelResponse({ tool_calls: [{
      id: 'read-1', type: 'function',
      function: { name: 'read_session_history', arguments: '{"query":"墨墨"}' },
    }] });
    return modelResponse({ content: '第三张是墨墨-招手，素材 ID 为 asset-b。' });
  });
  const registry = new ToolRegistryService([]);
  const execute = t.mock.method(ToolRegistryService.prototype, 'execute');
  const agent = new AgentService(registry);
  const history = entries([
    ...oldTurn,
    { role: 'user', content: '墨墨适合出现在什么场景？' },
    { role: 'assistant', content: '可以用夜晚的窗台。' },
  ]);
  const original = structuredClone(history);
  const turn = await agent.runWithHistory('刚才第三张是哪张？', { userId: 'user-a' }, history);

  assert.equal(requests.length, 3);
  assert.equal(turn.checkpoint.coveredThroughSequence, 4);
  assert.equal(turn.result.summaryModelCallCount, 1);
  assert.match(requests[1].messages[1].content, /用户已搜索墨墨/);
  assert.ok(requests[1].messages.some(({ content }) => content === '墨墨适合出现在什么场景？'));
  assert.deepEqual(requests[1].tools.map(({ function: { name } }) => name), ['read_session_history']);
  assert.deepEqual(execute.mock.calls.map(({ arguments: args }) => args[0]), ['read_session_history']);
  assert.deepEqual(registry.getDefinitions(), []);
  const toolMessage = requests[2].messages.at(-1);
  assert.equal(toolMessage.tool_call_id, 'read-1');
  const recalled = JSON.parse(toolMessage.content);
  assert.equal(recalled.messages.at(-1).content, displayedList);
  assert.equal(recalled.messages.at(-1).sequence, 4);
  assert.match(turn.result.text, /asset-b/);
  assert.deepEqual(history, original);
});

test('摘要失败后复用已落库的旧检查点', async (t) => {
  const requests = mockModel(t, (_request, number) =>
    number === 1 ? new Response(null, { status: 503 }) : modelResponse({ content: '继续工作' }),
  );
  const agent = new AgentService(new ToolRegistryService([]));
  const history = entries([
    ...oldTurn,
    { role: 'user', content: '写一段新剧情'.repeat(400) },
    { role: 'assistant', content: '新剧情已写完' },
  ]);
  const previous = { coveredThroughSequence: 4, text: '之前已经确定主角是墨墨。' };
  const next = await agent.runWithHistory('继续', { userId: 'user-a' }, history, previous);

  assert.equal(requests.length, 2);
  assert.match(requests[1].messages[1].content, /之前已经确定主角是墨墨/);
  assert.equal(next.checkpoint, undefined);
  assert.equal(next.result.text, '继续工作');
});

test('新会话没有可回查的旧会话内容', async (t) => {
  const requests = mockModel(t, () => modelResponse({ content: '请告诉我指的是哪一份列表。' }));
  const agent = new AgentService(new ToolRegistryService([]));
  const reply = await agent.runWithHistory('刚才第三张是哪张？', { userId: 'user-b' }, []);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].messages.length, 2);
  assert.deepEqual(requests[0].tools, []);
  assert.match(reply.result.text, /请告诉我/);
});
