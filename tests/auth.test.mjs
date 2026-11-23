import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService, tokenHash } from '../dist/auth/auth.service.js';
import { AuthGuard } from '../dist/auth/auth.guard.js';
import { hashPassword, verifyPassword } from '../dist/auth/password.js';
import { AssetsController } from '../dist/assets/assets.controller.js';
import { SessionController } from '../dist/harness/session/session.controller.js';
import { AgentController } from '../dist/harness/agent/agent.controller.js';

async function fixture() {
  const user = {userId:'user-a', username:'user_a', passwordHash:await hashPassword('test-password')};
  const records = new Map();
  const users = {
    createQueryBuilder:()=>({addSelect(){return this},where(){return this},async getOne(){return user}}),
    existsBy:async ({userId})=>userId===user.userId,
  };
  const tokens = {
    create:value=>value,
    save:async value=>{records.set(value.tokenHash,value);return value},
    findOneBy:async ({tokenHash})=>{const r=records.get(tokenHash);return r?.expiresAt>new Date()?r:null},
    delete:async ({tokenHash})=>records.delete(tokenHash),
  };
  return {user, records, service:new AuthService(users,tokens)};
}

test('密码加盐哈希：正确密码通过，错误密码拒绝，盐不复用', async()=>{
  const a=await hashPassword('password-a');const b=await hashPassword('password-a');
  assert.notEqual(a,b);assert.equal(await verifyPassword('password-a',a),true);
  assert.equal(await verifyPassword('wrong',a),false);
});

test('单 Token 登录、哈希存储、错误密码、过期和注销',async()=>{
  const {service,records}=await fixture();
  await assert.rejects(()=>service.login('demo','wrong'),{status:401});assert.equal(records.size,0);
  const result=await service.login('demo','test-password');
  assert.equal(result.token.length,64);assert.equal(result.user.username,"user_a");assert.equal("name" in result.user,false);assert.equal(result.user.passwordHash,undefined);
  assert.equal(records.has(result.token),false);assert.ok(records.has(tokenHash(result.token)));
  assert.equal(await service.authenticate(result.token),'user-a');
  await assert.rejects(()=>service.authenticate('invalid'),{status:401});
  records.get(tokenHash(result.token)).expiresAt=new Date(0);
  await assert.rejects(()=>service.authenticate(result.token),{status:401});
  const next=await service.login('demo','test-password');assert.notEqual(result.token,next.token);
  await service.logout(next.token);await assert.rejects(()=>service.authenticate(next.token),{status:401});
});

test('Guard 拒绝无 Token，身份必须来自验证结果',async()=>{
  const {service}=await fixture();const guard=new AuthGuard(service);
  const request={headers:{},body:{userId:'other-user'}};
  const context={switchToHttp:()=>({getRequest:()=>request})};
  await assert.rejects(()=>guard.canActivate(context),{status:401});
  const {token}=await service.login('demo','test-password');request.headers.authorization=`Bearer ${token}`;
  assert.equal(await guard.canActivate(context),true);assert.equal(request.currentUserId,'user-a');
});

test('业务入口均配置 Guard，业务查询使用已验证用户 ID',async()=>{
  for(const controller of [AssetsController,SessionController,AgentController]) {
    assert.ok(Reflect.getMetadata('__guards__',controller).includes(AuthGuard));
  }
  let owner,listed;
  const assets=new AssetsController({
    searchAssets:(id)=>{owner=id;return []},
    listAssets:(id,options)=>{owner=id;listed=options;return {items:[],total:0}},
  });
  assets.search('user-b','墨墨');assert.equal(owner,'user-b');
  assets.list('user-c','video','2','12','墨墨');assert.equal(owner,'user-c');
  assert.deepEqual(listed,{type:'video',page:2,pageSize:12,query:'墨墨'});
  assets.list('user-c','image');
  assert.deepEqual(listed,{type:'image',page:1,pageSize:24,query:undefined});
  for(const args of [['audio'],['image','0'],['image','1','49'],['image','1','abc']]) {
    assert.throws(()=>assets.list('user-c',...args),{status:400});
  }
  const sessions=new SessionController({create:async id=>{owner=id;return {sessionId:'s',name:'新会话'}}});
  await sessions.createSession('user-b');assert.equal(owner,'user-b');
});
