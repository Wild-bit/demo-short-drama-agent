import { useState } from 'react';
import type { EditableShot, StoryboardDraft } from '~web/types';
import { AssetChip, AssetPicker, ShotFramePreview } from '~web/components/Assets';
import { IconBoard, IconList, IconQuote, IconScript } from '~web/components/Icons';

export type EditorShot = EditableShot & { key: string };
export type Draft = StoryboardDraft<EditorShot>;

export function editable(board: StoryboardDraft): Draft {
  return { ...board, shots: board.shots.map((s) => ({ ...s, key: s.shotId || crypto.randomUUID() })) };
}

export function forSave(draft: Draft): StoryboardDraft {
  return { ...draft, shots: draft.shots.map(({ key: _key, ...shot }) => shot) };
}

const storyFields = [
  ['scene', '场景', '例如：夜色木质舞台 · 暖金追光'],
  ['visual', '画面与动作', '描述角色站位、神态动作与景别调度'],
  ['dialogue', '对白', '角色台词或旁白（无台词可留空）'],
] as const;

export function Editor({
  token,
  draft,
  change,
  onQuote,
  canQuote,
  quotedShotId,
  station = 'board',
  onBackToBoard,
  busy,
}: {
  token: string;
  draft: Draft;
  change: (draft: Draft) => void;
  busy: boolean;
  canQuote: boolean;
  quotedShotId?: string;
  station?: 'board' | 'script';
  onBackToBoard?: () => void;
  onQuote: (shot: EditorShot) => void;
}) {
  const [pick, setPick] = useState('');
  const [layout, setLayout] = useState<'grid' | 'detail'>('grid');
  const [scriptCollapsed, setScriptCollapsed] = useState(false);
  const target = draft.shots.find((s) => s.key === pick);

  function update(key: string, patch: Partial<EditorShot>) {
    change({ ...draft, shots: draft.shots.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  }

  function move(from: number, to: number) {
    const shots = [...draft.shots];
    [shots[from], shots[to]] = [shots[to], shots[from]];
    change({ ...draft, shots });
  }

  function appendShot() {
    change({
      ...draft,
      shots: [
        ...draft.shots,
        { key: crypto.randomUUID(), scene: '', visual: '', dialogue: '', prompt: '', assetIds: [] },
      ],
    });
  }

  const scriptWords = draft.script.trim().length;

  return (
    <fieldset disabled={busy} className={'editor station-' + station}>
      <section className={'bezel-shell script-pod' + (station === 'script' ? ' is-fullscreen' : '')}>
        <div className="bezel-core paper">
          <header className="panel-head script-pod-head">
            <div className="section-title-group">
              <span className="section-icon" aria-hidden="true">
                <IconScript size={16} />
              </span>
              <h2>剧本</h2>
              <span className="meta-pill">{scriptWords ? `${scriptWords} 字` : '待撰写'}</span>
            </div>
            <div className="row compact">
              {station === 'script' && onBackToBoard ? (
                <button type="button" onClick={onBackToBoard}>
                  返回分镜故事板
                </button>
              ) : (
                <button
                  type="button"
                  className="subtle-btn"
                  aria-expanded={!scriptCollapsed}
                  onClick={() => setScriptCollapsed((v) => !v)}
                >
                  {scriptCollapsed ? '展开剧本舱' : '收起剧本舱'}
                </button>
              )}
            </div>
          </header>

          {(!scriptCollapsed || station === 'script') && (
            <div className={'script-grid' + (station === 'script' ? ' script-focus-grid' : '')}>
              <div className="script-meta-col">
                <label>
                  剧名
                  <input
                    placeholder="输入短剧名称"
                    value={draft.title}
                    onChange={(e) => change({ ...draft, title: e.target.value })}
                  />
                </label>
                <label>
                  剧情梗概
                  <textarea
                    value={draft.synopsis}
                    rows={station === 'script' ? 4 : 3}
                    placeholder="一句话概括核心冲突、人物关系与反转看点"
                    onChange={(e) => change({ ...draft, synopsis: e.target.value })}
                  />
                </label>
              </div>
              <div className="script-body-col">
                <label>
                  剧本文本
                  <textarea
                    value={draft.script}
                    rows={station === 'script' ? 16 : 6}
                    placeholder="写下分场剧本与台词，或在右侧向 AI 导演助手描述灵感并采用分镜建议"
                    onChange={(e) => change({ ...draft, script: e.target.value })}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </section>

      {station === 'board' && (
        <>
          <div className="panel-head shots-heading">
            <div className="section-title-group">
              <h2>
                分镜 <small>{draft.shots.length} 镜</small>
              </h2>
              {draft.shots.length > 0 && (
                <div className="seg-toggle" role="group" aria-label="分镜排布视图">
                  <button
                    type="button"
                    aria-pressed={layout === 'grid'}
                    onClick={() => setLayout('grid')}
                  >
                    <IconBoard size={14} /> 宫格视图
                  </button>
                  <button
                    type="button"
                    aria-pressed={layout === 'detail'}
                    onClick={() => setLayout('detail')}
                  >
                    <IconList size={14} /> 场记精修
                  </button>
                </div>
              )}
            </div>
            <button type="button" className="primary-outline" onClick={appendShot}>
              ＋ 添加镜头
            </button>
          </div>

          {draft.shots.length === 0 ? (
            <div className="bezel-shell">
              <div className="bezel-core empty-shots">
                <div className="film-icon" aria-hidden="true">
                  <IconBoard size={22} />
                </div>
                <h3>还没有镜头，可以先保存剧本或召唤导演助手拆分镜</h3>
                <p className="muted">
                  在右侧对话输入一句话创意自动生成分镜卡片，也可以直接手动添加第一镜。
                </p>
              </div>
            </div>
          ) : (
            <div className={'shots-collection mode-' + layout}>
              {draft.shots.map((shot, i) => {
                const isQuoted = !!shot.shotId && quotedShotId === shot.shotId;
                return (
                  <article
                    className={'bezel-shell shot-shell' + (isQuoted ? ' is-quoted' : '')}
                    key={shot.key}
                    aria-label={'镜头 ' + (i + 1)}
                  >
                    <div className="bezel-core shot">
                      <header className="panel-head shot-head">
                        <div className="shot-title-wrap">
                          <span className="shot-index" aria-hidden="true">
                            SHOT {String(i + 1).padStart(2, '0')}
                          </span>
                          <h3>镜头 {String(i + 1).padStart(2, '0')}</h3>
                          {shot.shotId ? (
                            <span className="sync-dot synced" title="已持久化稳定镜头 ID">
                              已归档
                            </span>
                          ) : (
                            <span className="sync-dot draft">新镜头</span>
                          )}
                        </div>
                        <div className="row compact">
                          <button type="button" disabled={!i} onClick={() => move(i, i - 1)}>
                            上移
                          </button>
                          <button
                            type="button"
                            disabled={i === draft.shots.length - 1}
                            onClick={() => move(i, i + 1)}
                          >
                            下移
                          </button>
                          <button
                            type="button"
                            className="danger-subtle"
                            onClick={() =>
                              change({ ...draft, shots: draft.shots.filter((s) => s.key !== shot.key) })
                            }
                          >
                            移除
                          </button>
                        </div>
                      </header>

                      <div className="shot-main">
                        <div className="shot-visual-col">
                          <ShotFramePreview
                            assetIds={shot.assetIds}
                            token={token}
                            shotNumber={i + 1}
                            onOpenPicker={() => setPick(shot.key)}
                          />
                          {shot.assetIds.length > 0 && (
                            <div className="refs">
                              {shot.assetIds.map((id) => (
                                <AssetChip
                                  key={id}
                                  id={id}
                                  token={token}
                                  remove={() =>
                                    update(shot.key, { assetIds: shot.assetIds.filter((v) => v !== id) })
                                  }
                                />
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="shot-editor-col">
                          <div className="shot-fields">
                            {storyFields.map(([key, name, placeholder]) => (
                              <label key={key} className={'field-' + key}>
                                {name}
                                <textarea
                                  rows={key === 'dialogue' ? 1 : 2}
                                  placeholder={placeholder}
                                  value={shot[key]}
                                  onChange={(e) => update(shot.key, { [key]: e.target.value })}
                                />
                              </label>
                            ))}
                          </div>

                          <label className="prompt-terminal">
                            <span className="prompt-label-row">
                              <span>生成提示词</span>
                              <small>VIDEO PROMPT</small>
                            </span>
                            <textarea
                              rows={2}
                              placeholder="景别、机位运镜、光影氛围与主体动作提示词…"
                              value={shot.prompt}
                              onChange={(e) => update(shot.key, { prompt: e.target.value })}
                            />
                          </label>
                        </div>
                      </div>

                      <footer className="row shot-footer">
                        <button type="button" onClick={() => setPick(shot.key)}>
                          选择参考素材
                        </button>
                        <button
                          type="button"
                          className={isQuoted ? 'quote-btn active' : 'quote-btn'}
                          disabled={!canQuote || !shot.shotId}
                          title="保存作品后可引用这一镜让导演助手定点修改"
                          onClick={() => onQuote(shot)}
                        >
                          <IconQuote size={13} /> 引用到对话
                        </button>
                      </footer>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {target && (
        <AssetPicker
          token={token}
          ids={target.assetIds}
          add={(id) => {
            update(target.key, { assetIds: [...target.assetIds, id] });
            setPick('');
          }}
          close={() => setPick('')}
        />
      )}
    </fieldset>
  );
}
