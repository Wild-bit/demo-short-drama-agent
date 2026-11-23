import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorText } from '~web/api';
import type {
  Confirmation,
  Login,
  Project,
  Session,
  StoryboardDraft,
  StoryboardProposal,
  Version,
} from '~web/types';
import { AssetLibraryView } from '~web/components/Assets';
import { Chat, type ChatQuote } from '~web/components/Chat';
import { ConfirmationPanel } from '~web/components/Confirmation';
import { Dialog } from '~web/components/Dialog';
import { Editor, editable, forSave, type Draft } from '~web/components/Editor';
import { IconAssets, IconBoard, IconClapper, IconScript, IconTrash } from '~web/components/Icons';
import { StudioSplit } from '~web/components/StudioSplit';

type LocalDraft = { version: number; draft: Draft; backup?: StoryboardDraft };
type Station = 'board' | 'script' | 'assets';

export function purgeProjectCache(userId: string, projectId: string) {
  const prefix = `short-drama.${userId}.${projectId}.`;
  for (const suffix of ['draft', 'session', 'confirm']) {
    sessionStorage.removeItem(prefix + suffix);
  }
}

function sortSessions(list: Session[]): Session[] {
  return [...list].sort((a, b) => {
    const pinDiff = Number(!!b.pinned) - Number(!!a.pinned);
    if (pinDiff !== 0) return pinDiff;
    const timeDiff = Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt);
    return timeDiff !== 0 ? timeDiff : a.sessionId.localeCompare(b.sessionId);
  });
}

function readDraft(key: string): LocalDraft | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function blank(name: string): Draft {
  return editable({ title: name, synopsis: '', script: '', shots: [] });
}

export function Workspace({ login, projectId, home }: { login: Login; projectId: string; home: () => void }) {
  const token = login.token;
  const scope = 'short-drama.' + login.user.userId + '.' + projectId;
  const [project, setProject] = useState<Project>();
  const [saved, setSaved] = useState<Version>();
  const [draft, setDraft] = useState<Draft>();
  const [base, setBase] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [backup, setBackup] = useState<StoryboardDraft>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sid, setSid] = useState('');
  const [records, setRecords] = useState<Confirmation[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<StoryboardProposal | null>(null);
  const [station, setStation] = useState<Station>('board');
  const [quote, setQuote] = useState<ChatQuote>();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [load, refresh] = useState(0);
  const [focusChat, setFocusChat] = useState(false);
  const localKey = scope + '.draft';
  const chatArea = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = new AbortController();
    setError('');
    const q = '?projectId=' + encodeURIComponent(projectId);
    const get = <T,>(route: string) => api<T>(token, route, 'GET', undefined, c.signal);
    Promise.all([
      get<Project>('/projects/detail' + q),
      get<Version>('/storyboards/latest' + q),
      get<Session[]>('/sessions/list' + q),
      get<Confirmation[]>('/storyboards/confirmations' + q),
    ])
      .then(([p, board, list, confirmations]) => {
        if (c.signal.aborted) return;
        const ordered = sortSessions(list);
        const local = readDraft(localKey);
        setProject(p);
        setSaved(board);
        setBase(local?.version ?? board.version);
        setDirty(!!local);
        setBackup(local?.backup);
        setDraft(local?.draft ?? (board.storyboard ? editable(board.storyboard) : blank(p.name)));
        setSessions(ordered);
        const previous = sessionStorage.getItem(scope + '.session');
        setSid(ordered.find((s) => s.sessionId === previous)?.sessionId || ordered[0]?.sessionId || '');
        setRecords(confirmations);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorText(e));
      });
    return () => c.abort();
  }, [token, projectId, scope, localKey, load]);

  useEffect(() => {
    if (dirty && draft) {
      try {
        sessionStorage.setItem(localKey, JSON.stringify({ version: base, draft, backup }));
      } catch {
        setError('浏览器暂存空间不足，请先保存到项目');
      }
    }
  }, [localKey, base, dirty, draft, backup]);

  function change(value: Draft) {
    setDraft(value);
    setDirty(true);
    setNotice('');
  }

  function select(id: string) {
    setSid(id);
    setQuote(undefined);
    if (id) sessionStorage.setItem(scope + '.session', id);
    else sessionStorage.removeItem(scope + '.session');
  }

  async function createSession() {
    if (creating) return;
    setCreating(true);
    setError('');
    try {
      const s = await api<Session>(token, '/sessions/create', 'POST', { projectId });
      setSessions((old) => sortSessions([s, ...old]));
      select(s.sessionId);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setCreating(false);
    }
  }

  async function renameSession(sessionId: string, name: string) {
    setError('');
    try {
      const updated = await api<Session>(token, '/sessions/rename', 'POST', {
        projectId,
        sessionId,
        name,
      });
      setSessions((old) => sortSessions(old.map((s) => (s.sessionId === sessionId ? updated : s))));
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function pinSession(sessionId: string, pinned: boolean) {
    setError('');
    try {
      const updated = await api<Session>(token, '/sessions/pin', 'POST', {
        projectId,
        sessionId,
        pinned,
      });
      setSessions((old) => sortSessions(old.map((s) => (s.sessionId === sessionId ? updated : s))));
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function removeSession(sessionId: string) {
    setError('');
    try {
      await api<{ deleted: boolean }>(token, '/sessions/delete', 'POST', { projectId, sessionId });
      setSessions((old) => {
        const remaining = old.filter((s) => s.sessionId !== sessionId);
        if (sid === sessionId) {
          const nextId = remaining[0]?.sessionId || '';
          setSid(nextId);
          setQuote(undefined);
          if (nextId) sessionStorage.setItem(scope + '.session', nextId);
          else sessionStorage.removeItem(scope + '.session');
        }
        return remaining;
      });
    } catch (e) {
      setError(errorText(e));
    }
  }

  const syncSessionName = useCallback((sessionId: string, name: string) => {
    setSessions((old) =>
      sortSessions(
        old.map((s) => (s.sessionId === sessionId ? { ...s, name, updatedAt: new Date().toISOString() } : s)),
      ),
    );
  }, []);

  async function removeProject() {
    if (deletingProject) return;
    setDeletingProject(true);
    setError('');
    try {
      await api<{ deleted: boolean }>(token, '/projects/delete', 'POST', { projectId });
      purgeProjectCache(login.user.userId, projectId);
      home();
    } catch (e) {
      setConfirmDeleteProject(false);
      setError(errorText(e));
    } finally {
      setDeletingProject(false);
    }
  }

  /** 将编辑区提交为新版本；发生并发冲突时保留原稿并读取服务器版本。 */
  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await api<Version>(token, '/storyboards/save', 'POST', {
        projectId,
        expectedVersion: base,
        storyboard: forSave(draft),
      });
      setSaved(value);
      setDraft(editable(value.storyboard!));
      setBase(value.version);
      setDirty(false);
      setQuote(undefined);
      setBackup(undefined);
      sessionStorage.removeItem(localKey);
      setNotice('已保存版本 ' + value.version);
    } catch (e) {
      setFocusChat(false);
      setError(errorText(e));
      if (e instanceof ApiError && e.status === 409) {
        try {
          setSaved(await api<Version>(token, '/storyboards/latest?projectId=' + encodeURIComponent(projectId)));
        } catch (readError) {
          setError(errorText(readError));
        }
      }
    } finally {
      setBusy(false);
    }
  }

  function commitProposal(proposal: StoryboardProposal) {
    if (!draft) return;
    change(
      proposal.kind === 'storyboard'
        ? editable(proposal.storyboard)
        : {
            ...draft,
            shots: draft.shots.map((s) =>
              s.shotId === proposal.shot.shotId ? { ...proposal.shot, key: s.key } : s,
            ),
          },
    );
    setPendingProposal(null);
    setError('');
    setNotice('已采用到编辑区，点击保存后写入项目');
  }

  /** 模型提出建议后，由用户决定替换整份草案还是更新一镜。 */
  function apply(proposal: StoryboardProposal) {
    if (!draft || !saved || busy) return;
    setFocusChat(false);
    setStation('board');
    if (proposal.baseVersion !== base || base !== saved.version) {
      setError('这份建议基于旧版本，请根据当前版本重新提出修改');
      return;
    }
    if (proposal.kind === 'shot' && !draft.shots.some((s) => s.shotId === proposal.shot.shotId)) {
      setError('这条镜头已移除');
      return;
    }
    if (dirty || (proposal.kind === 'storyboard' && !!draft.script)) {
      setPendingProposal(proposal);
      return;
    }
    commitProposal(proposal);
  }

  if (!project || !draft || !saved)
    return (
      <main className="projects loading-screen">
        <button type="button" onClick={home}>
          返回项目列表
        </button>
        <p role="status" className="muted">
          {error || '正在载入短剧项目工作台…'}
        </p>
        {error && (
          <button type="button" className="primary" onClick={() => refresh((n) => n + 1)}>
            重试
          </button>
        )}
      </main>
    );

  const conflict = base !== saved.version;

  return (
    <main className="workspace">
      <header className="workspace-head">
        <div className="project-path">
          <button type="button" className="text-btn crumb-back" onClick={home}>
            我的项目
          </button>
          <span aria-hidden="true">/</span>
          <h1 title={project.name}>{project.name}</h1>
        </div>
        <div className="actions">
          <span className={'version' + (dirty ? ' is-dirty' : '')}>
            版本 {base} · {dirty ? '待保存' : '已同步'}
          </span>
          <button
            type="button"
            className="danger-subtle"
            disabled={busy || deletingProject}
            onClick={() => setConfirmDeleteProject(true)}
          >
            <IconTrash size={14} /> 删除项目
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={dirty || busy || !saved.version}
            title={!saved.version ? '请先保存至少一个分镜版本' : dirty ? '请先保存当前修改后再确认生成' : undefined}
          >
            <IconClapper size={15} /> 生成前确认
          </button>
          <button type="button" className="primary" onClick={save} disabled={!dirty || busy || conflict}>
            {busy ? '正在保存…' : '保存作品'}
          </button>
        </div>
      </header>

      <div className="workspace-body">
        <nav className="studio-rail" aria-label="工作台工位">
          <button
            type="button"
            className="rail-btn"
            aria-pressed={station === 'board'}
            onClick={() => {
              setStation('board');
              setFocusChat(false);
            }}
          >
            <IconBoard size={18} />
            <span>故事板</span>
          </button>
          <button
            type="button"
            className="rail-btn"
            aria-pressed={station === 'script'}
            onClick={() => {
              setStation('script');
              setFocusChat(false);
            }}
          >
            <IconScript size={18} />
            <span>剧本台</span>
          </button>
          <button
            type="button"
            className="rail-btn"
            aria-pressed={station === 'assets'}
            onClick={() => {
              setStation('assets');
              setFocusChat(false);
            }}
          >
            <IconAssets size={18} />
            <span>素材库</span>
          </button>
        </nav>

        <StudioSplit focusChat={focusChat}>
          <div className="editor-area" id="storyboard-pane">
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            {conflict && (
              <div className="alert-box conflict-banner">
                <div>
                  <strong>服务器已有版本 {saved.version}，本地编辑仍然保留。</strong>
                  <p className="muted">你可以载入服务器最新版，同时将当前未保存内容保留为下方对照副本。</p>
                </div>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    setBackup(forSave(draft));
                    setBase(saved.version);
                    change(saved.storyboard ? editable(saved.storyboard) : blank(project.name));
                    setError('');
                  }}
                >
                  载入最新版并保留本地副本
                </button>
              </div>
            )}
            {backup && (
              <details className="alert-box backup-box" open>
                <summary>冲突前的编辑副本，可复制内容合并</summary>
                <pre>{JSON.stringify(backup, null, 2)}</pre>
              </details>
            )}

            {station === 'assets' ? (
              <section className="bezel-shell asset-station-shell">
                <div className="bezel-core paper">
                  <header className="panel-head station-head">
                    <div className="section-title-group">
                      <span className="section-icon" aria-hidden="true">
                        <IconAssets size={16} />
                      </span>
                      <div>
                        <h2>个人角色与场景素材库</h2>
                        <small className="muted">上传设定图或检索已有资产，可在任意项目与分镜中跨会话复用</small>
                      </div>
                    </div>
                    <button type="button" onClick={() => setStation('board')}>
                      返回分镜故事板
                    </button>
                  </header>
                  <AssetLibraryView token={token} defaultOpenUpload />
                </div>
              </section>
            ) : (
              <Editor
                token={token}
                draft={draft}
                change={change}
                busy={busy}
                station={station}
                onBackToBoard={() => setStation('board')}
                canQuote={!!sid && !dirty && !conflict}
                quotedShotId={quote?.sessionId === sid ? quote.shotId : undefined}
                onQuote={(s) => {
                  setQuote({
                    sessionId: sid,
                    version: base,
                    shotId: s.shotId!,
                    label: '镜头 ' + (draft.shots.indexOf(s) + 1),
                  });
                  chatArea.current
                    ?.querySelector<HTMLTextAreaElement>('.thread-wrap:not([hidden]) .composer textarea')
                    ?.focus();
                }}
              />
            )}
          </div>

          <div ref={chatArea} className="chat-area" id="chat-pane">
            <Chat
              token={token}
              projectId={projectId}
              active={sid}
              select={select}
              sessions={sessions}
              create={createSession}
              creating={creating}
              renameSession={renameSession}
              pinSession={pinSession}
              deleteSession={removeSession}
              syncSessionName={syncSessionName}
              focusChat={focusChat}
              toggleFocus={() => setFocusChat((current) => !current)}
              quote={quote}
              clearQuote={(used) => setQuote((current) => (current === used ? undefined : current))}
              allowQuote={!dirty && quote?.version === base}
              apply={apply}
            />
          </div>
        </StudioSplit>
      </div>

      {confirming && (
        <ConfirmationPanel
          token={token}
          projectId={projectId}
          scope={scope}
          records={records}
          recorded={(r) =>
            setRecords((prev) => [r, ...prev.filter((x) => x.confirmationId !== r.confirmationId)])
          }
          version={saved}
          reloadVersion={() => {
            setConfirming(false);
            setFocusChat(false);
            setQuote(undefined);
            setNotice('作品版本已变更，请核对最新镜头后重新确认');
            refresh((n) => n + 1);
          }}
          close={() => setConfirming(false)}
        />
      )}

      {pendingProposal && (
        <Dialog
          title="采用分镜建议"
          subtitle="采用后内容会先进入本地编辑区，确认无误再点击「保存作品」写入项目版本。"
          close={() => setPendingProposal(null)}
        >
          <div className="confirm-delete-body">
            <p>
              {pendingProposal.kind === 'storyboard' ? (
                <>
                  确定用建议草案{' '}
                  <strong>「{pendingProposal.storyboard.title || '新分镜草案'}」</strong>
                  （共 {pendingProposal.storyboard.shots.length} 个镜头）替换当前编辑区的剧本与分镜吗？
                </>
              ) : (
                <>
                  确定用这条单镜建议覆盖{' '}
                  <strong>
                    镜头 {draft.shots.findIndex((s) => s.shotId === pendingProposal.shot.shotId) + 1}
                  </strong>{' '}
                  的画面、对白与生成提示词吗？
                </>
              )}
              {dirty && '当前编辑区中尚未保存的本地修改将被覆盖。'}
            </p>
            <div className="row confirm-delete-actions">
              <button type="button" onClick={() => setPendingProposal(null)}>
                取消
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => commitProposal(pendingProposal)}
              >
                确认采用
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {confirmDeleteProject && (
        <Dialog
          title="删除短剧项目"
          subtitle="此操作不可撤销，请确认是否清理该项目数据。"
          close={() => {
            if (!deletingProject) setConfirmDeleteProject(false);
          }}
        >
          <div className="confirm-delete-body">
            <p>
              确定要删除项目 <strong>「{project.name}」</strong> 吗？该项目下的所有剧本与分镜版本、对话记录及生成前确认将被永久删除；你个人素材库中的参考图和视频资产会保留。
            </p>
            <div className="row confirm-delete-actions">
              <button
                type="button"
                disabled={deletingProject}
                onClick={() => setConfirmDeleteProject(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="danger-solid"
                disabled={deletingProject}
                onClick={removeProject}
              >
                {deletingProject ? '正在删除…' : '确认删除'}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </main>
  );
}
