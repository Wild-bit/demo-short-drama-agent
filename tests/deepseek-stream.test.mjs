import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readDeepSeekStream } from '../dist/gateway/text/deepseek-stream.js';

function frame(delta, finish_reason = null, usage) {
  return 'data: ' + JSON.stringify({ choices: [{ delta, finish_reason }], usage }) + '\r\n\r\n';
}

function splitResponse(body, width) {
  const bytes = Buffer.from(body);
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += width) controller.enqueue(bytes.subarray(i, i + width));
      controller.close();
    },
  }));
}

test('中文按字节拆开、CRLF 跨块和多个事件合包时，实际增量与用量相同', async () => {
  const usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 };
  const body = ': heartbeat\r\n\r\n' + frame({ content: '墨' }) + frame({ content: '墨。' })
    + frame({}, 'stop', usage) + 'data: [DONE]\r\n\r\n';
  for (const width of [1, 7, 4096]) {
    const deltas = [];
    const result = await readDeepSeekStream(splitResponse(body, width), text => { deltas.push(text); });
    assert.deepEqual(deltas, ['墨', '墨。']);
    assert.deepEqual(result, { text: '墨墨。', toolCalls: [], usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } });
  }
});

test('多个工具按 index 分别拼接原始参数和名称', async () => {
  const body = frame({ tool_calls: [
    { index: 1, id: 'b', function: { name: 'read_', arguments: '{"before' } },
    { index: 0, id: 'a', function: { name: 'search_', arguments: '{"query":' } },
  ] }) + frame({ tool_calls: [
    { index: 0, function: { name: 'user_assets', arguments: '"墨墨"}' } },
    { index: 1, function: { name: 'session_history', arguments: 'Sequence":5}' } },
  ] }, 'tool_calls') + 'data: [DONE]\n\n';
  const result = await readDeepSeekStream(splitResponse(body, 3), () => assert.fail('参数不能作为文字增量显示'));
  assert.deepEqual(result.toolCalls, [
    { id: 'a', name: 'search_user_assets', arguments: '{"query":"墨墨"}' },
    { id: 'b', name: 'read_session_history', arguments: '{"beforeSequence":5}' },
  ]);
});

test('截断的文本、缺少名称的工具、长度截断都不能被当作完成', async () => {
  for (const body of [
    frame({ content: '半句' }),
    frame({ tool_calls: [{ index: 0, id: 'a' }] }, 'tool_calls') + 'data: [DONE]\n\n',
    frame({}, 'length') + 'data: [DONE]\n\n',
  ]) await assert.rejects(readDeepSeekStream(splitResponse(body, 7), () => {}));
});
