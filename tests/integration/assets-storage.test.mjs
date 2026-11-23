import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../dist/app.module.js';
import { AssetsService } from '../../dist/assets/assets.service.js';
import { hashPassword } from '../../dist/auth/password.js';

const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
const megabyte = 1024 * 1024;

test('上传素材并归档超过 5 MiB 的视频后，数据库可按所属用户查到固定链接', {
  timeout: 15000, skip: !process.env.MYSQL_PASSWORD && '需要连接本地开发库',
}, async t => {
  process.env.ASSET_CDN_ORIGIN = 'https://assets.fixture.invalid';
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  const db = app.get(DataSource);
  const users = [];
  t.after(async () => {
    try {
      for (const userId of users) {
        for (const entity of ['Asset', 'AuthToken', 'User']) {
          await db.getRepository(entity).delete({ userId });
        }
      }
    } finally { await app.close(); }
  });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const baseUrl = (await app.getUrl()) + '/api';

  function imageForm(bytes = jpeg) {
    const form = new FormData();
    form.append('name', '墨墨参考图');
    form.append('file', new Blob([bytes], { type: 'image/jpeg' }), '墨墨.jpg');
    return form;
  }
  const anonymous = await fetch(`${baseUrl}/assets/upload`, { method: 'POST', body: imageForm() });
  assert.equal(anonymous.status, 401);

  async function account() {
    const username = `storage-${randomUUID()}`;
    const password = randomUUID();
    const { userId } = await db.getRepository('User').save({ username, passwordHash: await hashPassword(password) });
    users.push(userId);
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
    });
    assert.equal(login.status, 200);
    return { userId, headers: { Authorization: `Bearer ${(await login.json()).token}` } };
  }

  const { CosStorageService } = await import('../../dist/assets/cos-storage.service.js');
  const stored = [];
  let failUpload = false;
  const storage = app.get(CosStorageService);
  t.mock.method(storage, 'uploadFile', async (objectKey, filePath, contentType) => {
    stored.push({ objectKey, filePath, contentType, bytes: (await stat(filePath)).size });
    if (failUpload) throw new Error('fixture upload failure');
  });
  const owner = await account();
  const other = await account();
  const repository = db.getRepository('Asset');

  const invalid = await fetch(`${baseUrl}/assets/upload`, {
    method: 'POST', headers: owner.headers, body: imageForm(Buffer.from('<svg/>')),
  });
  assert.equal(invalid.status, 415);
  assert.equal(stored.length, 0);

  failUpload = true;
  const failed = await fetch(`${baseUrl}/assets/upload`, { method: 'POST', headers: owner.headers, body: imageForm() });
  assert.equal(failed.status, 502);
  assert.equal(await repository.countBy({ userId: owner.userId }), 0);
  await assert.rejects(stat(stored.at(-1).filePath), { code: 'ENOENT' });

  failUpload = false;
  const upload = await fetch(`${baseUrl}/assets/upload`, { method: 'POST', headers: owner.headers, body: imageForm() });
  assert.equal(upload.status, 201);
  const image = await upload.json();
  const imageKey = `short-drama/${image.id}.jpg`;
  assert.equal(image.url, `https://assets.fixture.invalid/${imageKey}`);
  assert.equal(stored.at(-1).objectKey, imageKey);
  assert.equal(stored.at(-1).contentType, 'image/jpeg');
  assert.equal(stored.at(-1).bytes, jpeg.length);
  await assert.rejects(stat(stored.at(-1).filePath), { code: 'ENOENT' });
  assert.equal((await repository.findOneByOrFail({ id: image.id })).userId, owner.userId);

  const assets = app.get(AssetsService);
  let openedVideos = 0;
  const assetId = randomUUID();
  const generated = {
    assetId, userId: owner.userId, name: '墨墨生成镜头',
    openVideo: async () => {
      openedVideos++;
      const mp4Header = Buffer.from('000000146674797069736f6d0000000069736f6d', 'hex');
      return Readable.from([mp4Header, ...Array.from({ length: 6 }, () => Buffer.alloc(megabyte))]);
    },
  };
  const [video, concurrentVideo] = await Promise.all([
    assets.archiveGeneratedVideo(generated),
    assets.archiveGeneratedVideo(generated),
  ]);
  assert.equal(video.id, assetId);
  assert.equal(video.source, 'generated');
  assert.equal(video.url, `https://assets.fixture.invalid/short-drama/videos/${assetId}.mp4`);
  assert.equal(stored.at(-1).objectKey, `short-drama/videos/${assetId}.mp4`);
  assert.equal(stored.at(-1).contentType, 'video/mp4');
  assert.ok(stored.at(-1).bytes > 5 * megabyte);
  await assert.rejects(stat(stored.at(-1).filePath), { code: 'ENOENT' });
  assert.deepEqual(concurrentVideo, video);
  assert.deepEqual(await assets.archiveGeneratedVideo(generated), video);
  assert.equal(openedVideos, 1);

  const searchPath = `${baseUrl}/assets/search?query=${encodeURIComponent('墨墨')}`;
  const search = await fetch(searchPath, { headers: owner.headers });
  assert.deepEqual(new Set((await search.json()).map(asset => asset.url)), new Set([image.url, video.url]));
  assert.deepEqual(await (await fetch(searchPath, { headers: other.headers })).json(), []);

  // 素材库列表：按类型过滤、按更新时间倒序分页，每页条数由请求指定。
  const secondUpload = await fetch(`${baseUrl}/assets/upload`, { method: 'POST', headers: owner.headers, body: imageForm() });
  assert.equal(secondUpload.status, 201);
  const secondImage = await secondUpload.json();
  async function list(params, headers = owner.headers) {
    const response = await fetch(`${baseUrl}/assets?${new URLSearchParams(params)}`, { headers });
    return { status: response.status, body: await response.json() };
  }
  const firstPage = await list({ type: 'image', page: '1', pageSize: '1' });
  assert.equal(firstPage.status, 200);
  assert.equal(firstPage.body.total, 2);
  assert.deepEqual(firstPage.body.items.map(asset => asset.id), [secondImage.id]);
  const secondPage = await list({ type: 'image', page: '2', pageSize: '1' });
  assert.deepEqual(secondPage.body.items.map(asset => asset.id), [image.id]);
  const videos = await list({ type: 'video' });
  assert.equal(videos.body.pageSize, 24);
  assert.deepEqual(videos.body.items.map(asset => asset.url), [video.url]);
  assert.equal((await list({ type: 'image', query: '墨墨' })).body.total, 2);
  assert.equal((await list({ type: 'image', query: '查不到的名字' })).body.total, 0);
  assert.equal((await list({ type: 'image' }, other.headers)).body.total, 0);
  assert.equal((await list({ type: 'audio' })).status, 400);
  assert.equal((await list({ type: 'image', pageSize: '49' })).status, 400);
});
