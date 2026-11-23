import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../dist/app.module.js';
import { hashPassword } from '../../dist/auth/password.js';

const draft = {
  title: '墨墨开场',
  synopsis: '墨墨向观众问好',
  script: '先招手，再退场。',
  shots: [
    { scene: '舞台', visual: '抬爪', dialogue: '你好', prompt: '固定镜头，墨墨抬爪' },
    { scene: '幕后', visual: '退场', dialogue: '', prompt: '远景，离开舞台' },
  ],
};
function frame(delta, finish_reason = null) {
  return 'data: ' + JSON.stringify({ choices: [{ delta, finish_reason }] }) + '\n\n';
}

test(
  '从登录到版本确认，刷新、并发保存、切换对话和流内错误',
  {
    timeout: 90000,
    skip: !process.env.MYSQL_PASSWORD && '需要通过 --env-file=.env 使用开发 MySQL',
  },
  async (t) => {
    const upstream = 'https://workbench.fixture.invalid';
    const held = Promise.withResolvers();
    const modelInputs = [];
    Object.assign(process.env, {
      DEEPSEEK_BASE_URL: upstream,
      DEEPSEEK_MODEL: 'fixture',
      DEEPSEEK_API_KEY: 'fixture',
      AGENT_CONTEXT_PROFILE: 'normal',
      ASSET_CDN_ORIGIN: 'https://assets.fixture.invalid',
    });
    const realFetch = globalThis.fetch;
    t.mock.method(globalThis, 'fetch', (url, options) => {
      if (url !== upstream + '/chat/completions') return realFetch(url, options);
      const input = JSON.parse(options.body);
      modelInputs.push(input);
      const last = input.messages.at(-1);
      let output = frame({ content: '请审阅分镜。' }, 'stop');
      if (last.role === 'user' && last.content === '搜索墨墨素材') {
        output = frame(
          {
            tool_calls: [
              {
                index: 0,
                id: randomUUID(),
                type: 'function',
                function: { name: 'search_user_assets', arguments: JSON.stringify({ query: '墨墨' }) },
              },
            ],
          },
          'tool_calls',
        );
      } else if (last.role === 'tool' && JSON.parse(last.content).assets) {
        const parsed = JSON.parse(last.content);
        output = frame({ content: `1. 墨墨-招手 – ${parsed.assets[0].url}` }, 'stop');
      } else if (last.role === 'user' && (last.content === '编写分镜' || last.content.startsWith('改成特写'))) {
        const isFullDraft = last.content === '编写分镜';
        const args = isFullDraft ? draft : { ...draft.shots[0], prompt: '特写，墨墨轻轻招手' };
        output =
          (isFullDraft ? frame({ content: '开场仪式设计思路：场记板合下宣布开拍。' }) : '') +
          frame(
            {
              tool_calls: [
                {
                  index: 0,
                  id: randomUUID(),
                  type: 'function',
                  function: { name: 'propose_storyboard', arguments: JSON.stringify(args) },
                },
              ],
            },
            'tool_calls',
          );
      }
      const headers = { 'Content-Type': 'text/event-stream' };
      if (last.content === '分段回答') {
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            async start(c) {
              c.enqueue(encoder.encode(frame({ content: '仅属于 A 的第一段' })));
              await held.promise;
              c.enqueue(encoder.encode(frame({ content: '与第二段' }, 'stop') + 'data: [DONE]\n\n'));
              c.close();
            },
          }),
          { headers },
        );
      }
      return new Response(output + 'data: [DONE]\n\n', { headers });
    });
    const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    const db = app.get(DataSource);
    const users = [];
    let browser, vite;
    t.after(async () => {
      held.resolve();
      try {
        await browser?.close();
        await vite?.close();
        for (const userId of users) {
          for (const { projectId } of await db.manager.findBy('Project', { userId })) {
            for (const entity of ['GenerationConfirmation', 'StoryboardVersion'])
              await db.manager.delete(entity, { projectId });
          }
          for (const { sessionId } of await db.manager.findBy('Session', { userId }))
            await db.manager.delete('SessionMessage', { sessionId });
          for (const entity of ['AgentRunRecord', 'Session', 'Project', 'Asset', 'AuthToken', 'User'])
            await db.manager.delete(entity, { userId });
        }
      } finally {
        await app.close();
      }
    });
    async function account() {
      const username = 'web-' + randomUUID();
      const password = randomUUID();
      const { userId } = await db.manager.save('User', {
        username,
        passwordHash: await hashPassword(password),
      });
      users.push(userId);
      return { username, password, userId };
    }
    const owner = await account();
    const other = await account();
    const asset = await db.manager.save('Asset', {
      userId: owner.userId,
      name: '墨墨-招手',
      type: 'image',
      source: 'upload',
      description: '',
      tags: [],
      objectKey: 'short-drama/lesson10/wave.png',
    });
    process.env.API_PROXY_TARGET = await app.getUrl();
    vite = await createServer({
      root: fileURLToPath(new URL('../', import.meta.url)),
      server: { port: 5183, strictPort: false, host: '127.0.0.1' },
      logLevel: 'error',
    });
    await vite.listen();
    const site = 'http://127.0.0.1:' + vite.httpServer.address().port;
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
    const context = await browser.newContext({ viewport: { width: 1360, height: 880 } });
    await context.route('https://assets.fixture.invalid/**', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/53kAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const button = (name) => page.getByRole('button', { name, exact: true });
    const active = () => page.locator('.thread-wrap:not([hidden])');
    async function send(value) {
      await active().getByRole('textbox', { name: '对话消息' }).fill(value);
      await active().getByRole('button', { name: '发送', exact: true }).click();
    }
    await page.goto(site);
    await page.getByLabel('用户名').fill(owner.username);
    await page.getByLabel('密码').fill(owner.password);
    await button('登录').click();
    await button('＋ 新建项目').click();
    await page.getByLabel('项目名称').fill('浏览器验收');
    await button('创建并打开').click();
    await button('＋ 新建对话').click();
    const chat = page.getByRole('complementary');
    const divider = page.getByRole('separator', { name: '调整分镜和对话宽度' });
    const composer = active().getByRole('textbox', { name: '对话消息' });
    async function checkDesktopSplit() {
      const size = page.viewportSize();
      const bounds = await chat.boundingBox();
      assert.ok(bounds.width >= size.width * 0.47 && bounds.height >= size.height * 0.8);
      const input = await composer.boundingBox();
      assert.ok(input.y + input.height <= size.height);
      assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight));
    }
    await checkDesktopSplit();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await checkDesktopSplit();
    await page.setViewportSize({ width: 1360, height: 880 });
    const grip = await divider.boundingBox();
    const x = grip.x + grip.width / 2;
    const y = grip.y + grip.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 120, y);
    await page.mouse.up();
    assert.ok(Number(await divider.getAttribute('aria-valuenow')) < 45);
    await divider.press('ArrowRight');
    await divider.dblclick();
    assert.equal(await divider.getAttribute('aria-valuenow'), '50');
    await composer.fill('保留未发送的内容');
    await button('展开对话').click();
    assert.ok((await chat.boundingBox()).width > page.viewportSize().width * 0.94);
    await button('恢复双栏').click();
    assert.equal(await composer.inputValue(), '保留未发送的内容');
    await checkDesktopSplit();
    await send('搜索墨墨素材');
    const gallery = active().getByRole('region', { name: '匹配素材卡片' });
    await gallery.getByRole('button', { name: '预览素材 墨墨-招手' }).waitFor();
    assert.equal(
      await active()
        .locator('.message-body')
        .filter({ hasText: 'https://assets.fixture.invalid' })
        .count(),
      0,
    );
    await gallery.getByRole('button', { name: '预览素材 墨墨-招手' }).click();
    await page.getByRole('dialog').locator('.chat-lightbox-stage img').waitFor();
    await button('关闭').click();

    await send('编写分镜');
    const combinedReply = '开场仪式设计思路：场记板合下宣布开拍。\n\n请审阅分镜。';
    await active().getByText(combinedReply, { exact: true }).waitFor();
    await button('展开对话').click();
    await active().getByRole('button', { name: '采用到编辑区' }).click();
    await divider.waitFor();
    let shot = page.getByRole('article', { name: '镜头 1', exact: true });
    await shot.getByRole('button', { name: '选择参考素材' }).click();
    await page.getByLabel('素材关键词').fill('墨墨');
    await button('搜索').click();
    await page.getByRole('button', { name: /墨墨-招手.*选择/ }).click();
    await button('保存作品').click();
    await page.getByText('已保存版本 1', { exact: true }).waitFor();
    const projectId = page.url().split('/').at(-1);
    const original = await db.manager.findOneByOrFail('StoryboardVersion', { projectId, version: 1 });
    assert.deepEqual(original.storyboard.shots[0].assetIds, [asset.id]);
    await page.reload();
    await active().getByText(combinedReply, { exact: true }).waitFor();
    await shot.locator('.chip-name', { hasText: '墨墨-招手' }).waitFor();
    await shot.getByRole('button', { name: '下移' }).click();
    await button('保存作品').click();
    await page.getByText('已保存版本 2', { exact: true }).waitFor();
    const second = await db.manager.findOneByOrFail('StoryboardVersion', { projectId, version: 2 });
    assert.equal(second.storyboard.shots[1].shotId, original.storyboard.shots[0].shotId);

    const sessionNav = page.getByRole('navigation', { name: '对话列表' });
    const activeRow = () => sessionNav.locator('.session-row.is-active');
    const a = await activeRow().getAttribute('data-session-id');
    // 验证通过 ⋯ 菜单重命名并置顶会话 A
    await activeRow().hover();
    await activeRow().getByRole('button', { name: /对话操作/ }).click();
    await page.getByRole('menuitem', { name: '重命名' }).click();
    await sessionNav.getByLabel('重命名对话').fill('主创一稿');
    await sessionNav.getByLabel('重命名对话').press('Enter');
    await sessionNav.getByRole('button', { name: '主创一稿', exact: true }).waitFor();

    await send('分段回答');
    await active().getByText('仅属于 A 的第一段', { exact: true }).waitFor();
    await button('＋ 新建对话').click();
    await active().getByText('这是一段新对话').waitFor();
    const b = await activeRow().getAttribute('data-session-id');
    assert.notEqual(a, b);
    // 此时会话 A 仍在后台流式接收，侧栏应展示转圈状态
    await sessionNav.locator(`.session-row[data-session-id="${a}"] .session-spinner`).waitFor();
    held.resolve();
    assert.equal(
      await active()
        .getByText(/仅属于 A/)
        .count(),
      0,
    );
    await sessionNav.getByRole('button', { name: '主创一稿', exact: true }).click();
    await active().getByText('仅属于 A 的第一段与第二段', { exact: true }).waitFor();
    await sessionNav.getByRole('button', { name: '未命名对话', exact: true }).click();
    shot = page.getByRole('article', { name: '镜头 2', exact: true });
    await shot.getByRole('button', { name: '引用到对话' }).click();
    const before = modelInputs.length;
    await send('改成特写');
    await active().getByRole('button', { name: '采用到编辑区' }).click();
    // 编辑区处于未保存状态时再次采用建议，弹出自定义暗色确认框而非原生 window.confirm
    await active().getByRole('button', { name: '采用到编辑区' }).click();
    await page.getByRole('dialog', { name: '采用分镜建议' }).getByRole('button', { name: '确认采用' }).click();
    assert.equal(await active().getByRole('button', { name: '取消引用' }).count(), 0);
    const input = JSON.stringify(modelInputs[before].messages);
    assert.ok(input.includes(draft.shots[0].prompt) && !input.includes(draft.shots[1].prompt));
    await button('保存作品').click();
    await page.getByText('已保存版本 3', { exact: true }).waitFor();

    await button('生成前确认').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox').nth(1).check();
    // 首次请求已经落库但响应丢失，再点确认时应复用 ID。
    const attempts = [];
    const confirmRoute = '**/api/storyboards/confirm';
    await page.route(confirmRoute, async (r) => {
      attempts.push(JSON.parse(r.request().postData() || '{}').confirmationId);
      if (attempts.length === 1) {
        await r.fetch();
        await r.abort();
      } else await r.continue();
    });
    await button('确认所选镜头').click();
    await dialog.getByRole('alert').waitFor();
    await button('确认所选镜头').click();
    await dialog.getByText('已记录生成前确认').waitFor();
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0], attempts[1]);
    assert.equal(await db.manager.countBy('GenerationConfirmation', { projectId }), 1);
    await page.unroute(confirmRoute);
    await button('关闭').click();
    // 在第二个标签页加载同一版本，随后向服务器提交过期的编辑。
    const tab = await context.newPage();
    await tab.goto(page.url());
    await tab.getByLabel('剧本文本').fill('第二页保留的编辑');
    await shot.getByLabel('生成提示词').fill('第四版的新提示词');
    await button('保存作品').click();
    await page.getByText('已保存版本 4', { exact: true }).waitFor();
    await tab.getByRole('button', { name: '保存作品' }).click();
    await tab.getByText(/服务器已有版本 4/).waitFor();
    assert.equal(await tab.getByLabel('剧本文本').inputValue(), '第二页保留的编辑');
    await tab.getByRole('button', { name: '载入最新版并保留本地副本' }).click();
    await tab.locator('pre').filter({ hasText: '第二页保留的编辑' }).waitFor();
    await tab.close();
    await page.reload();
    await button('生成前确认').click();
    await dialog.getByRole('button', { name: /版本 3 · 1 镜/ }).click();
    await dialog.getByText('特写，墨墨轻轻招手', { exact: false }).waitFor();
    await button('关闭').click();

    const route = '**/api/sessions/stream';
    await page.route(route, (r) => r.fulfill({ status: 413, json: { message: '超出预算' } }));
    await send('保留这段原文');
    await active()
      .getByText(/请拆成几段提交/)
      .waitFor();
    assert.equal(await active().getByLabel('对话消息').inputValue(), '保留这段原文');
    await page.unroute(route);
    const runId = randomUUID();
    await page.route(route, (r) => {
      const events = [
        { type: 'started' },
        { type: 'text_delta', modelCallNumber: 1, text: '已收到的片段' },
        { type: 'failed', statusCode: 409, message: '会话历史已更新，请重试' },
      ];
      return r.fulfill({
        contentType: 'text/event-stream',
        body: events
          .map(
            (event) =>
              'event: ' +
              event.type +
              '\ndata: ' +
              JSON.stringify({ sessionId: b, runId, ...event }) +
              '\n\n',
          )
          .join(''),
      });
    });
    await send('本轮保存冲突');
    await active().getByText('会话历史已更新，请重试').waitFor();
    assert.equal(await active().getByLabel('对话消息').inputValue(), '本轮保存冲突');
    await page.unroute(route);
    const accountResponse = await realFetch(process.env.API_PROXY_TARGET + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: other.username, password: other.password }),
    });
    const auth = { Authorization: 'Bearer ' + (await accountResponse.json()).token };
    for (const url of [
      '/assets/detail?assetId=' + asset.id,
      '/storyboards/confirmations?projectId=' + projectId,
    ]) {
      assert.equal(
        (await realFetch(process.env.API_PROXY_TARGET + '/api' + url, { headers: auth })).status,
        404,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.setViewportSize({ width: 1360, height: 880 });
    await button('删除项目').click();
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
    await page.getByText('还没有项目').waitFor();
    assert.equal(await db.manager.countBy('Project', { projectId }), 0);
    assert.deepEqual(errors, []);
  },
);
