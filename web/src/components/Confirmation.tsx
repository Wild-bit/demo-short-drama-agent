import { useState } from 'react';
import type { Confirmation, SavedShot, Version } from '~web/types';
import { api, ApiError, errorText } from '~web/api';
import { Dialog } from '~web/components/Dialog';
import { IconClapper } from '~web/components/Icons';

const presetModels = ['MiniMax-H3', 'MiniMax-H3-Lite', 'wan3.0-video', 'seedance-2.5'];

export function ConfirmationPanel({
  token,
  projectId,
  version,
  records,
  recorded,
  reloadVersion,
  close,
  scope,
}: {
  token: string;
  projectId: string;
  version: Version;
  records: Confirmation[];
  recorded: (record: Confirmation) => void;
  reloadVersion: () => void;
  close: () => void;
  scope: string;
}) {
  const shots = version.storyboard?.shots || [];
  const [ids, select] = useState<string[]>([]);
  const [model, setModel] = useState(import.meta.env.VITE_VIDEO_MODEL || 'MiniMax-H3');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const [view, setView] = useState<{ record: Confirmation; shots: SavedShot[] }>();
  const [loading, setLoading] = useState(false);

  /** 同一点击在结果未知时使用相同 ID 重试，成功后结束本次确认。 */
  async function confirm() {
    if (!ids.length || !model.trim() || busy) return;
    const data = {
      version: version.version,
      shotIds: shots.filter((s) => ids.includes(s.shotId)).map((s) => s.shotId),
      model: model.trim(),
    };
    const signature = JSON.stringify(data);
    const key = scope + '.confirm';
    setBusy(true);
    setError('');
    try {
      const previous = JSON.parse(sessionStorage.getItem(key) || 'null');
      const id = previous?.signature === signature ? previous.id : crypto.randomUUID();
      sessionStorage.setItem(key, JSON.stringify({ signature, id }));
      const record = await api<Confirmation>(token, '/storyboards/confirm', 'POST', {
        projectId,
        confirmationId: id,
        ...data,
      });
      sessionStorage.removeItem(key);
      recorded(record);
      setSuccess('已记录生成前确认');
      select([]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) reloadVersion();
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function inspect(record: Confirmation) {
    setLoading(true);
    setError('');
    setView(undefined);
    try {
      const query = '?projectId=' + encodeURIComponent(projectId) + '&version=' + record.version;
      const snapshot = await api<Version>(token, '/storyboards/version' + query);
      setView({ record, shots: snapshot.storyboard!.shots.filter((s) => record.shotIds.includes(s.shotId)) });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      wide
      title="生成前确认"
      subtitle="核对本次开拍的分镜版本、镜头范围与视频模型；确认后即使后续修改分镜，仍可追溯当时的提示词快照。"
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="confirm-grid">
        <fieldset disabled={busy} className="confirm-main">
          <div className="panel-head confirm-sec-head">
            <h3>
              <IconClapper size={16} /> 版本 {version.version} · 选择镜头
            </h3>
            {shots.length > 0 && (
              <div className="row compact">
                <button
                  type="button"
                  onClick={() => {
                    select(shots.map((s) => s.shotId));
                    setSuccess('');
                  }}
                >
                  全选 ({shots.length})
                </button>
                {ids.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      select([]);
                      setSuccess('');
                    }}
                  >
                    清空
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="confirm-shot-list">
            {shots.map((s, i) => {
              const checked = ids.includes(s.shotId);
              return (
                <label className={'check' + (checked ? ' is-checked' : '')} key={s.shotId}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      select(e.target.checked ? [...ids, s.shotId] : ids.filter((id) => id !== s.shotId));
                      setSuccess('');
                    }}
                  />
                  <span className="check-body">
                    <strong>
                      <em className="shot-pill">SHOT {String(i + 1).padStart(2, '0')}</em>
                      镜头 {i + 1}　{s.scene || '未命名场景'}
                    </strong>
                    <small>{s.prompt || '（尚未填写生成提示词）'}</small>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="model-config">
            <label>
              生成模型
              <input value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
            <div className="model-presets" aria-label="常用视频模型预设">
              {presetModels.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={model === preset ? 'preset-pill active' : 'preset-pill'}
                  onClick={() => setModel(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <button className="primary confirm-submit" disabled={!ids.length || !model.trim() || busy} onClick={confirm}>
            {busy ? '正在确认…' : '确认所选镜头'}
          </button>

          {success && (
            <p role="status" className="notice">
              {success}
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </fieldset>

        <section className="confirm-history">
          <h3>确认记录 ({records.length})</h3>
          {!records.length ? (
            <p className="muted empty-records">暂无确认记录。勾选左侧分镜并确认后，将在此生成不可变快照。</p>
          ) : (
            <div className="record-list">
              {records.map((r) => {
                const active = view?.record.confirmationId === r.confirmationId;
                return (
                  <button
                    type="button"
                    className={'record' + (active ? ' is-active' : '')}
                    key={r.confirmationId}
                    disabled={loading}
                    onClick={() => inspect(r)}
                  >
                    <div>
                      <strong>
                        版本 {r.version} · {r.shotIds.length} 镜 · {r.model}
                      </strong>
                      <small>{new Date(r.createdAt).toLocaleString('zh-CN')}</small>
                    </div>
                    <span className="record-tag">核对快照</span>
                  </button>
                );
              })}
            </div>
          )}

          {view && (
            <section className="paper snapshot-box">
              <h3>当时确认的提示词 · 版本 {view.record.version}</h3>
              <div className="snapshot-shots">
                {view.shots.map((s, idx) => (
                  <div className="snapshot-item" key={s.shotId}>
                    <strong>
                      #{idx + 1} {s.scene || '未命名场景'}
                    </strong>
                    <p>{s.prompt}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </section>
      </div>
    </Dialog>
  );
}
