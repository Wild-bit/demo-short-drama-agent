-- 更新六种已约定的测试素材记录，不修改其他素材。
-- 演示素材随认证迁移归属到 demo 账号，另一条记录保留原测试归属。
SET @demo_user_id = (SELECT user_id FROM users WHERE username = 'demo');

UPDATE assets
SET objectKey = 'short-drama/0f4a6b83-2e79-4c1d-b850-7a3d9e1f5c48.jpg'
WHERE (user_id = @demo_user_id AND name IN (
    'Aurora', 'Nova', '墨墨-探头', '墨墨-招手', '红衣女主参考图（测试）'
  ))
  OR (user_id = 'other-user' AND name = '红衣角色参考图（其他用户测试）');

SELECT user_id, name, objectKey FROM assets
WHERE (user_id = @demo_user_id AND name IN (
    'Aurora', 'Nova', '墨墨-探头', '墨墨-招手', '红衣女主参考图（测试）'
  ))
  OR (user_id = 'other-user' AND name = '红衣角色参考图（其他用户测试）');
