import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import COS from 'cos-nodejs-sdk-v5';
import { sts } from 'tencentcloud-sdk-nodejs-sts';
import { CosStorageService } from '../../dist/assets/cos-storage.service.js';
import { CosStsService } from '../../dist/assets/cos-sts.service.js';

const location = { Bucket: 'fixture-1328693273', Region: 'ap-guangzhou' };
const megabyte = 1024 * 1024;

function configureSts(t) {
  Object.assign(process.env, {
    COS_BUCKET: location.Bucket,
    COS_REGION: location.Region,
    COS_STS_SECRET_ID: 'fixture-cam-id',
    COS_STS_SECRET_KEY: 'fixture-cam-secret',
  });
  return t.mock.method(sts.v20180813.Client.prototype, 'GetFederationToken', async () => ({
    Credentials: { TmpSecretId: 'fixture-sts-id', TmpSecretKey: 'fixture-sts-secret', Token: 'fixture-sts-token' },
    ExpiredTime: Math.floor(Date.now() / 1000) + 3600,
  }));
}

test('STS 请求限制到短剧目录，并发申请共用凭证，到期前重新请求', async t => {
  const authorize = configureSts(t);
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const provider = new CosStsService();
  const [a, b] = await Promise.all([provider.credentials(location), provider.credentials(location)]);
  assert.equal(a, b);
  assert.equal(a.SecurityToken, 'fixture-sts-token');
  assert.equal(authorize.mock.callCount(), 1);
  assert.equal(await provider.credentials(location), a);

  const request = authorize.mock.calls[0].arguments[0];
  const [{ resource, action }] = JSON.parse(decodeURIComponent(request.Policy)).statement;
  assert.deepEqual(resource, ['qcs::cos:ap-guangzhou:uid/1328693273:fixture-1328693273/short-drama/*']);
  assert.ok(action.includes('name/cos:UploadPart'));
  assert.match(request.Name, /^[a-z]+$/i);
  assert.equal(request.DurationSeconds, 3600);

  now += 3500 * 1000;
  const renewed = await provider.credentials(location);
  assert.equal(authorize.mock.callCount(), 2);
  assert.ok(renewed.ExpiredTime > a.ExpiredTime);
});

test('COS SDK 对小文件发送 PutObject，对超过 5 MiB 的视频发送分块请求', { timeout: 12000 }, async t => {
  const authorize = configureSts(t);
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let bytes = 0;
    for await (const chunk of req) bytes += chunk.length;
    requests.push({ method: req.method, path: url.pathname, params: url.searchParams, headers: req.headers, bytes });

    if (req.method === 'GET' && url.searchParams.has('uploads')) {
      res.end('<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>');
    } else if (req.method === 'POST' && url.searchParams.has('uploads')) {
      res.end('<InitiateMultipartUploadResult><UploadId>fixture-upload</UploadId></InitiateMultipartUploadResult>');
    } else if (req.method === 'PUT') {
      res.setHeader('ETag', '"2d8c6079ee9efc0b9dd8a4fbdbe327cc"');
      res.end();
    } else if (req.method === 'POST' && url.searchParams.has('uploadId')) {
      res.end('<CompleteMultipartUploadResult><ETag>"fixture-video"</ETag></CompleteMultipartUploadResult>');
    } else {
      res.writeHead(501).end();
    }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const directory = await mkdtemp(join(tmpdir(), 'short-drama-cos-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  // 保留 SDK 的签名和分块过程，只把最终请求送到本地 COS 模拟服务。
  const upload = COS.prototype.uploadFile;
  t.mock.method(COS.prototype, 'uploadFile', function (params) {
    this.options.ConfCwd = directory;
    this.on('before-send', options => {
      const url = new URL(options.url);
      options.url = `${origin}${url.pathname}${url.search}`;
    });
    return upload.call(this, params);
  });

  const imagePath = join(directory, 'image');
  const videoPath = join(directory, 'video');
  await writeFile(imagePath, 'image fixture');
  await writeFile(videoPath, 'video fixture');
  await truncate(videoPath, 6 * megabyte);

  const storage = new CosStorageService(new CosStsService());
  await storage.uploadFile('short-drama/fixture.jpg', imagePath, 'image/jpeg');
  await storage.uploadFile('short-drama/videos/fixture.mp4', videoPath, 'video/mp4');

  assert.equal(authorize.mock.callCount(), 1);
  assert.ok(requests.every(request => request.headers['x-cos-security-token'] === 'fixture-sts-token'));
  assert.ok(requests.every(request => request.headers.authorization.includes('q-ak=fixture-sts-id')));
  const image = requests.find(request => request.path === '/short-drama/fixture.jpg');
  assert.equal(image.method, 'PUT');
  assert.equal(image.headers['content-type'], 'image/jpeg');
  assert.equal(image.bytes, 'image fixture'.length);

  const videoRequests = requests.filter(request => request.path === '/short-drama/videos/fixture.mp4');
  const initiate = videoRequests.find(request => request.method === 'POST' && request.params.has('uploads'));
  assert.equal(initiate.headers['content-type'], 'video/mp4');
  const parts = videoRequests.filter(request => request.method === 'PUT' && request.params.has('partNumber'));
  assert.ok(parts.length > 1);
  assert.equal(parts.reduce((total, part) => total + part.bytes, 0), 6 * megabyte);
  assert.ok(videoRequests.some(request => request.method === 'POST' && request.params.get('uploadId') === 'fixture-upload'));
});
