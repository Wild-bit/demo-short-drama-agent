-- 更新六种已约定的测试素材记录，不修改其他素材。
UPDATE assets
SET objectKey = 'short-drama/0f4a6b83-2e79-4c1d-b850-7a3d9e1f5c48.jpg'
WHERE (ownerId = 'demo-user' AND name IN (
    'Aurora', 'Nova', '墨墨-探头', '墨墨-招手', '红衣女主参考图（测试）'
  ))
  OR (ownerId = 'other-user' AND name = '红衣角色参考图（其他用户测试）');

SELECT ownerId, name, objectKey FROM assets
WHERE (ownerId = 'demo-user' AND name IN (
    'Aurora', 'Nova', '墨墨-探头', '墨墨-招手', '红衣女主参考图（测试）'
  ))
  OR (ownerId = 'other-user' AND name = '红衣角色参考图（其他用户测试）');
