import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDeepSeekContextConfig } from '../dist/config/deepseek-context.js';
import { AgentService } from '../dist/harness/agent/agent.service.js';
import { buildModelInput } from '../dist/harness/agent/context.js';

const system = '你是短剧助手';
const tools = [];
const currentTurn = [{ role: 'user', content: '刚才第三张叫什么？' }];
const oldTurn = [
  { role: 'user', content: '很早以前的一轮'.repeat(100) },
  { role: 'assistant', content: '已处理' },
];
const recentTurn = [
  { role: 'user', content: '搜索墨墨' },
  { role: 'assistant', content: '', toolCalls: [
    { id: 'search-1', name: 'search_user_assets', arguments: '{}' },
  ] },
  { role: 'tool', content: '{"assets":[]}', toolCallId: 'search-1' },
  { role: 'assistant', content: '没有候选' },
];

function configureModelFixture(t, profile = '') {
  const env = {
    AGENT_CONTEXT_PROFILE: profile,
    AGENT_CONTEXT_WINDOW_TOKENS: '5500',
    DEEPSEEK_BASE_URL: 'https://budget.fixture.invalid',
    DEEPSEEK_API_KEY: 'fixture',
    DEEPSEEK_MODEL: 'fixture',
  };
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('精确达到预算时保留整轮，旧历史仍完整', () => {
  const history = [...oldTurn, ...recentTurn];
  const original = structuredClone(history);
  const { inputSizes } = buildModelInput(system, recentTurn, currentTurn, tools, 10_000);
  const result = buildModelInput(system, history, currentTurn, tools, inputSizes.estimatedInputTokens);

  assert.deepEqual(result.request.messages, [
    { role: 'system', content: system },
    ...recentTurn,
    ...currentTurn,
  ]);
  assert.equal(result.inputSizes.droppedHistoryMessages, oldTurn.length);
  assert.equal(result.inputSizes.estimatedInputTokens, inputSizes.estimatedInputTokens);
  assert.deepEqual(history, original);
});

test('最新一轮放不下时不留下半轮或跳过它保留更旧消息', () => {
  const older = [{ role: 'user', content: '早' }, { role: 'assistant', content: '好' }];
  const { inputSizes } = buildModelInput(system, older, currentTurn, tools, 10_000);
  const result = buildModelInput(system, [...older, ...recentTurn], currentTurn, tools, inputSizes.estimatedInputTokens);

  assert.deepEqual(result.request.messages.slice(1), currentTurn);
  assert.equal(result.inputSizes.droppedHistoryMessages, older.length + recentTurn.length);
});

test('固定输入超限时返回 413，即使没有历史', () => {
  assert.throws(() => buildModelInput(system, [], currentTurn, tools, 1), {
    status: 413,
  });
});

test('显式正常模式使用官方窗口和 16K 输出上限，即使仍设置了旧窗口值', async (t) => {
  configureModelFixture(t, 'normal');
  assert.deepEqual(getDeepSeekContextConfig(), {
    contextWindowTokens: 1_048_576,
    inputBudgetTokens: 1_031_168,
    maxOutputTokens: 16_384,
  });
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({
    choices: [{ message: { content: '收到' } }],
  }));
  const agent = new AgentService({ getDefinitions: () => [] });

  const result = await agent.runOnce('较长的原文'.repeat(1_200), { userId: 'fixture' });

  assert.equal(result.text, '收到');
  assert.equal(fetch.mock.callCount(), 1);
  const request = JSON.parse(fetch.mock.calls[0].arguments[1].body);
  assert.equal(request.max_tokens, 16_384);
});

test('新增工具结果超限会拦住第二次模型调用', async (t) => {
  configureModelFixture(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({
    choices: [{ message: { tool_calls: [{
      id: 'large-1', type: 'function', function: { name: 'large_tool', arguments: '{}' },
    }] } }],
  }));
  let executions = 0;
  const agent = new AgentService({
    getDefinitions: () => [{
      name: 'large_tool',
      description: '返回需要分析的内容',
      parameters: { type: 'object', properties: {} },
    }],
    execute: async () => {
      executions += 1;
      if (executions > 1) throw new Error('重复执行了工具');
      return { content: '大结果'.repeat(2_000) };
    },
  });

  await assert.rejects(agent.runOnce('分析工具结果', { userId: 'fixture' }), error => {
    assert.equal(error.getStatus(), 413);
    const response = error.getResponse();
    assert.equal(response.code, 'AGENT_INPUT_BUDGET_EXCEEDED');
    assert.equal(response.inputBudgetTokens, 3_452);
    assert.ok(response.estimatedInputTokens > response.inputBudgetTokens);
    return true;
  });
  assert.equal(fetch.mock.callCount(), 1);
  const request = JSON.parse(fetch.mock.calls[0].arguments[1].body);
  assert.equal(request.max_tokens, 1_024);
  assert.equal(request.tools[0].function.name, 'large_tool');
  assert.equal(executions, 1);
});

test('超长素材结果自动简化后继续，候选顺序与原始记录可核对', async (t) => {
  configureModelFixture(t);
  let executions = 0;
  let sentTool;
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { messages } = JSON.parse(options.body);
    sentTool = messages.find(message => message.role === 'tool');
    return Response.json({ choices: [{ message: sentTool
      ? { content: '第三张是墨墨-思考。' }
      : { tool_calls: [{
        id: 'search-1', type: 'function',
        function: { name: 'search_user_assets', arguments: '{"query":"墨墨"}' },
      }] },
    }] });
  });
  const assets = ['探头', '招手', '思考'].map((name, index) => ({
    id: `asset-${index + 1}`,
    name: `墨墨-${name}`,
    type: 'image',
    description: '待选择的素材详情'.repeat(500),
    tags: ['墨墨'],
  }));
  const agent = new AgentService({
    getDefinitions: () => [{
      name: 'search_user_assets',
      description: '搜索当前用户的素材',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
    }],
    execute: async () => {
      executions += 1;
      return { assets };
    },
  });
  const { result, newMessages } = await agent.runWithHistory(
    '搜索墨墨，告诉我第三张叫什么',
    { userId: 'fixture' },
    [],
  );

  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(executions, 1);
  assert.equal(result.text, '第三张是墨墨-思考。');
  assert.equal(sentTool.tool_call_id, 'search-1');
  assert.deepEqual(JSON.parse(sentTool.content), {
    assets: assets.map(({ id, name, type }) => ({ id, name, type })),
    detailsOmitted: true,
  });
  assert.deepEqual(JSON.parse(newMessages.find(message => message.role === 'tool').content), { assets });
  assert.deepEqual(result.toolResults[0].result, { assets });
});
