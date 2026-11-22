import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentService } from '../dist/harness/agent/agent.service.js';
import { SearchUserAssetsTool } from '../dist/tools/search-user-assets.tool.js';
import { ToolRegistryService } from '../dist/tools/tool-registry.service.js';

function stubModel(t, respond) {
  const env = {
    AGENT_CONTEXT_PROFILE: 'normal',
    DEEPSEEK_BASE_URL: 'https://run-control.fixture.invalid',
    DEEPSEEK_API_KEY: 'fixture',
    DEEPSEEK_MODEL: 'fixture',
  };
  const previous = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    return Response.json({ choices: [{ message: respond(request, requests.length) }] });
  });
  return requests;
}

function searchCall(id) {
  return { id, type: 'function', function: { name: 'search_user_assets', arguments: '{"query":"墨墨"}' } };
}

function createSearchAgent(t) {
  const searchAssets = t.mock.fn(async () => []);
  const tool = new SearchUserAssetsTool({ searchAssets });
  const agent = new AgentService(new ToolRegistryService([tool]));
  return { agent, searchAssets };
}

test('第六次请求搜索时停止；新的会话轮次重新计数', async (t) => {
  const requests = stubModel(t, (_request, n) => n === 8
    ? { content: '没有找到墨墨。' }
    : { tool_calls: [searchCall('s' + n)] });
  const { agent, searchAssets } = createSearchAgent(t);
  const { result, newMessages } = await agent.runWithHistory('搜索墨墨', { userId: 'user-a' }, []);

  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'tool_call_limit');
  assert.equal(searchAssets.mock.callCount(), 5);
  assert.equal(result.modelCallCount, 6);
  const ids = ['s1', 's2', 's3', 's4', 's5'];
  assert.deepEqual(result.toolCalls.map(call => call.id), ids);
  assert.deepEqual(newMessages.filter(m => m.role === 'tool').map(m => m.toolCallId), ids);
  assert.deepEqual(newMessages.flatMap(m => (m.toolCalls ?? []).map(call => call.id)), ids);
  assert.deepEqual(newMessages.at(-1), { role: 'assistant', content: result.text });

  const history = newMessages.map((message, index) => ({ sequence: index + 1, message }));
  const next = await agent.runWithHistory('再查一次', { userId: 'user-a' }, history);
  assert.equal(next.result.status, 'completed');
  assert.equal(next.result.modelCallCount, 2);
  assert.equal(next.result.toolCalls.length, 1);
  assert.equal(searchAssets.mock.callCount(), 6);
  assert.deepEqual(requests[6].tools.map(tool => tool.function.name), ['search_user_assets', 'read_session_history']);
});

test('刚好处理五个调用，仍能把结果交给模型正常回答', async (t) => {
  const ids = ['s1', 's2', 's3', 's4', 's5'];
  const requests = stubModel(t, (_request, n) => n === 1
    ? { tool_calls: ids.map(searchCall) }
    : { content: '没有找到墨墨。' });
  const { agent, searchAssets } = createSearchAgent(t);

  const result = await agent.runOnce('搜索墨墨', { userId: 'user-a' });

  assert.equal(result.status, 'completed');
  assert.equal(result.modelCallCount, 2);
  assert.equal(searchAssets.mock.callCount(), 5);
  assert.deepEqual(requests[1].messages.filter(m => m.role === 'tool').map(m => m.tool_call_id), ids);
});

test('已执行四次再请求两个，整批停止，两个都不进入执行记录', async (t) => {
  stubModel(t, (_request, n) => ({
    tool_calls: (n === 1 ? ['s1', 's2', 's3', 's4'] : ['s5', 's6']).map(searchCall),
  }));
  const { agent, searchAssets } = createSearchAgent(t);
  const result = await agent.runOnce('搜索墨墨', { userId: 'user-a' });

  assert.equal(result.status, 'stopped');
  assert.equal(result.modelCallCount, 2);
  assert.equal(searchAssets.mock.callCount(), 4);
  assert.deepEqual(result.toolResults.map(item => item.toolCallId), ['s1', 's2', 's3', 's4']);
});

test('参数不是合法 JSON 时保留配对的失败结果，该尝试占用一次额度', async (t) => {
  const broken = searchCall('broken');
  broken.function.arguments = '{"query":';
  const requests = stubModel(t, (_request, n) => ({
    tool_calls: n === 1 ? [broken] : (n === 2 ? ['s2', 's3', 's4', 's5'] : ['s6']).map(searchCall),
  }));
  const { agent, searchAssets } = createSearchAgent(t);
  const result = await agent.runOnce('搜索墨墨', { userId: 'user-a' });

  assert.equal(result.status, 'stopped');
  assert.equal(result.modelCallCount, 3);
  const failure = requests[1].messages.at(-1);
  assert.equal(failure.tool_call_id, 'broken');
  assert.equal(JSON.parse(failure.content).reason, 'invalid_arguments');
  assert.equal(result.toolCalls.length, 5);
  assert.equal(searchAssets.mock.callCount(), 4);
});
