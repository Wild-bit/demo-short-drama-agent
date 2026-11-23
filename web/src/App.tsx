import { useEffect, useState, type FormEvent } from 'react';
import { api, errorText } from '~web/api';
import type { Login, Project } from '~web/types';
import { AssetLibraryView } from '~web/components/Assets';
import { Brand, Slate } from '~web/components/Brand';
import { Dialog } from '~web/components/Dialog';
import { IconAssets, IconChevron, IconClapper, IconSparkles, IconTrash } from '~web/components/Icons';
import { purgeProjectCache, Workspace } from '~web/components/Workspace';

const authKey = 'short-drama.auth';
const sampleNames = ['墨墨开场', '失踪的戒指', '城市夜光'];

function readAuth(includeExpired = false): Login | null {
  try {
    const auth = JSON.parse(localStorage.getItem(authKey) || 'null');
    return auth?.token && auth.user?.userId && (includeExpired || Date.parse(auth.expiresAt) > Date.now())
      ? auth
      : null;
  } catch {
    return null;
  }
}

function route() {
  return location.pathname.match(/^\/projects\/([a-f\d-]{36})\/?$/i)?.[1] || '';
}

export function App() {
  const [login, setLogin] = useState<Login | null>(readAuth);
  const [projectId, setProject] = useState(route);
  const [error, setError] = useState('');

  function navigate(id: string) {
    history.pushState(null, '', id ? '/projects/' + id : '/');
    setProject(id);
  }

  function clear() {
    localStorage.removeItem(authKey);
    setLogin(null);
  }

  useEffect(() => {
    const pop = () => setProject(route());
    const sync = (e: StorageEvent) => {
      if (e.key === authKey) setLogin(readAuth());
    };
    const expired = (e: Event) => {
      if ((e as CustomEvent).detail === readAuth(true)?.token) {
        clear();
        setError('登录已过期，请重新登录');
      }
    };
    window.addEventListener('popstate', pop);
    window.addEventListener('storage', sync);
    window.addEventListener('auth-expired', expired);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('storage', sync);
      window.removeEventListener('auth-expired', expired);
    };
  }, []);

  if (!login)
    return (
      <LoginPage
        notice={error}
        onLogin={(value) => {
          localStorage.setItem(authKey, JSON.stringify(value));
          setLogin(value);
          setError('');
        }}
      />
    );

  async function logout() {
    try {
      await api(login!.token, '/auth/logout', 'POST');
      if (readAuth(true)?.token === login!.token) clear();
      navigate('');
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <>
      <header className="topbar">
        <button type="button" className="brandlink" onClick={() => navigate('')} aria-label="返回我的项目">
          <Brand />
        </button>
        <span className="divider" />
        <span className="crumb">{projectId ? '分镜工作台' : '项目空间'}</span>
        <span className="spacer" />
        <span className="account">{login.user.username}</span>
        <button type="button" className="inverse" onClick={logout}>
          退出
        </button>
      </header>
      {error && (
        <p role="alert" className="error global-error">
          {error}
        </p>
      )}
      {projectId ? (
        <Workspace
          key={login.user.userId + projectId}
          login={login}
          projectId={projectId}
          home={() => navigate('')}
        />
      ) : (
        <ProjectList key={login.user.userId} login={login} open={navigate} />
      )}
    </>
  );
}

function LoginPage({ notice, onLogin }: { notice: string; onLogin: (auth: Login) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      onLogin(await api<Login>('', '/auth/login', 'POST', Object.fromEntries(data)));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <section className="login-art">
        <Brand />
        <Slate />
        <div className="login-hero-copy">
          <span className="eyebrow-pill">AI SHORT DRAMA DIRECTOR STUDIO</span>
          <div className="login-title">
            一句话开拍，
            <br />
            分镜工作台<span>.</span>
          </div>
          <div className="login-pillars" aria-hidden="true">
            <span>01 剧本与分镜共创</span>
            <span>02 角色与场景资产库</span>
            <span>03 版本锁定与确认出片</span>
          </div>
        </div>
      </section>
      <section className="login-form">
        <div className="bezel-shell login-card-shell">
          <form className="bezel-core login-card" onSubmit={submit}>
            <div>
              <span className="eyebrow-pill">MEMBER ACCESS</span>
              <h1>登录短剧工坊</h1>
              <p className="muted">使用已有创作账号进入你的短剧制片空间。</p>
            </div>
            <label>
              用户名
              <input name="username" placeholder="输入账号用户名" autoComplete="username" required autoFocus />
            </label>
            <label>
              密码
              <input
                name="password"
                type="password"
                placeholder="输入登录密码"
                autoComplete="current-password"
                required
              />
            </label>
            {(error || notice) && (
              <p role="alert" className="error">
                {error || notice}
              </p>
            )}
            <button className="primary login-submit" disabled={busy}>
              {busy ? '正在登录…' : '登录'}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function ProjectList({ login, open }: { login: Login; open: (id: string) => void }) {
  const token = login.token;
  const [projects, setProjects] = useState<Project[]>([]);
  const [load, refresh] = useState(0);
  const [ready, setReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const [assetModal, setAssetModal] = useState(false);
  const [deletingTarget, setDeletingTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const c = new AbortController();
    setReady(false);
    setError('');
    api<Project[]>(token, '/projects/list', 'GET', undefined, c.signal)
      .then(setProjects)
      .catch((e) => {
        if (!c.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setReady(true);
      });
    return () => c.abort();
  }, [token, load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const project = await api<Project>(token, '/projects/create', 'POST', { name });
      open(project.projectId);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deletingTarget || deleting) return;
    setDeleting(true);
    setError('');
    try {
      await api<{ deleted: boolean }>(token, '/projects/delete', 'POST', {
        projectId: deletingTarget.projectId,
      });
      purgeProjectCache(login.user.userId, deletingTarget.projectId);
      setProjects((prev) => prev.filter((p) => p.projectId !== deletingTarget.projectId));
      setDeletingTarget(null);
    } catch (e) {
      setDeletingTarget(null);
      setError(errorText(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="projects">
      <section className="lobby-hero bezel-shell">
        <div className="bezel-core lobby-hero-inner">
          <div className="lobby-copy">
            <span className="eyebrow-pill">
              <IconSparkles size={12} /> CREATIVE STUDIO LOBBY
            </span>
            <h1>我的项目</h1>
            <p className="muted">
              每一部短剧拥有独立的剧本版本、16:9 故事板、多段导演对话与出片确认记录。
            </p>
          </div>
          <div className="lobby-actions">
            <button type="button" onClick={() => setAssetModal(true)}>
              <IconAssets size={16} /> 个人素材库
            </button>
            <button type="button" className="primary" onClick={() => setCreating(true)}>
              ＋ 新建项目
            </button>
          </div>
        </div>
      </section>

      {creating && (
        <div className="bezel-shell createbar-shell">
          <form className="bezel-core createbar" onSubmit={create}>
            <div className="createbar-main">
              <label>
                项目名称
                <input
                  autoFocus
                  maxLength={255}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：墨墨开场"
                  required
                />
              </label>
              <div className="sample-pills" aria-label="灵感剧名示例">
                <small>快捷剧名：</small>
                {sampleNames.map((sample) => (
                  <button key={sample} type="button" className="preset-pill" onClick={() => setName(sample)}>
                    {sample}
                  </button>
                ))}
              </div>
            </div>
            <div className="createbar-btns">
              <button className="primary" disabled={busy}>
                创建并打开
              </button>
              <button type="button" onClick={() => setCreating(false)}>
                取消
              </button>
            </div>
          </form>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}{' '}
          <button type="button" onClick={() => refresh((n) => n + 1)}>
            重试
          </button>
        </p>
      )}

      {!ready ? (
        <p className="muted loading-projects">正在读取短剧项目列表…</p>
      ) : projects.length ? (
        <div className="project-grid">
          {projects.map((p, i) => (
            <article className="bezel-shell project-card-shell" key={p.projectId}>
              <div className="bezel-core project-card">
                <button
                  type="button"
                  className="project-card-open"
                  onClick={() => open(p.projectId)}
                >
                  <span className={'poster tone' + (i % 3)} aria-hidden="true">
                    <i />
                    <b />
                    <em className="poster-reel">REEL {String(i + 1).padStart(2, '0')}</em>
                    <em className="poster-enter">
                      进入导播台 <IconChevron size={13} />
                    </em>
                  </span>
                  <span className="project-card-body">
                    <strong>{p.name}</strong>
                    <small>最近更新　{new Date(p.updatedAt).toLocaleString('zh-CN')}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="project-card-del"
                  aria-label={'删除项目 ' + p.name}
                  title="删除项目"
                  onClick={() => setDeletingTarget(p)}
                >
                  <IconTrash size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        !error && (
          <div className="bezel-shell">
            <div className="bezel-core empty-project">
              <div className="film-icon" aria-hidden="true">
                <IconClapper size={24} />
              </div>
              <h2>还没有项目</h2>
              <p>新建一部短剧项目，即可由 AI 导演协助编写剧本、管理角色参考图并拆解分镜。</p>
            </div>
          </div>
        )
      )}

      {assetModal && (
        <Dialog
          wide
          title="个人角色与场景素材库"
          subtitle="在此上传角色定妆照、场景设定图或检索已有资产，进入任意短剧项目后可直接绑定到分镜。"
          close={() => setAssetModal(false)}
        >
          <AssetLibraryView token={token} defaultOpenUpload />
        </Dialog>
      )}

      {deletingTarget && (
        <Dialog
          title="删除短剧项目"
          subtitle="此操作不可撤销，请确认是否清理该项目数据。"
          close={() => {
            if (!deleting) setDeletingTarget(null);
          }}
        >
          <div className="confirm-delete-body">
            <p>
              确定要删除项目 <strong>「{deletingTarget.name}」</strong> 吗？该项目下的所有剧本与分镜版本、对话记录及生成前确认将被永久删除；你个人素材库中的参考图和视频资产会保留。
            </p>
            <div className="row confirm-delete-actions">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeletingTarget(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="danger-solid"
                disabled={deleting}
                onClick={confirmDelete}
              >
                {deleting ? '正在删除…' : '确认删除'}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </main>
  );
}
