import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api, ApiError, errorText, streamTurn } from "~web/api";
import type { Message, Run, Session, StoryboardProposal } from "~web/types";
import {
  ChatUiBlockRenderer,
  cleanMessageTextForUiBlocks,
} from "~web/components/ChatUiBlocks";
import {
  IconChatBubble,
  IconEdit,
  IconMore,
  IconPin,
  IconSend,
  IconSidebar,
  IconSparkles,
  IconTrace,
  IconTrash,
} from "~web/components/Icons";

type Quote = { version: number; shotId: string; label: string };
export type ChatQuote = Quote & { sessionId: string };
type Props = {
  token: string;
  projectId: string;
  sessions: Session[];
  active: string;
  select: (id: string) => void;
  create: () => void;
  creating: boolean;
  renameSession: (id: string, name: string) => Promise<void>;
  pinSession: (id: string, pinned: boolean) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  syncSessionName: (id: string, name: string) => void;
  quote?: ChatQuote;
  clearQuote: (used: ChatQuote) => void;
  allowQuote: boolean;
  apply: (p: StoryboardProposal) => void;
};

type MenuState = { id: string; top: number; left: number };

const starterPrompts = [
  {
    tag: "一键拆镜",
    title: "生成三镜头短剧开场草案",
    prompt:
      "给主角写一个三镜头开场，包含场景、动作对白和视频提示词，请给我可编辑的分镜草案",
  },
  {
    tag: "资产检索",
    title: "查找已有角色与场景参考图",
    prompt: "帮我搜索个人素材库里可用的角色和场景图片",
  },
  {
    tag: "情绪冲突",
    title: "构思高张力反转对话片段",
    prompt: "帮我设计一段带悬念反转的四镜头对手戏，突出特写情绪与镜头推拉节奏",
  },
];

export function Chat({
  focusChat,
  toggleFocus,
  ...props
}: Props & {
  focusChat: boolean;
  toggleFocus: () => void;
}) {
  const {
    sessions,
    active,
    select,
    create,
    creating,
    renameSession,
    pinSession,
    deleteSession,
  } = props;
  const [visited, setVisited] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [runningIds, setRunningIds] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renamingId, setRenamingId] = useState("");
  const [renameText, setRenameText] = useState("");
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const renameCommitted = useRef(false);

  useEffect(() => {
    if (active)
      setVisited((ids) => (ids.includes(active) ? ids : [...ids, active]));
  }, [active]);

  useEffect(() => {
    const valid = new Set(sessions.map((s) => s.sessionId));
    setVisited((ids) => ids.filter((id) => valid.has(id)));
  }, [sessions]);

  useEffect(() => {
    if (!menu) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest(".session-popover, .session-more-btn")) return;
      setMenu(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  const handleBusyChange = useCallback((sessionId: string, isBusy: boolean) => {
    setRunningIds((prev) => {
      if (!!prev[sessionId] === isBusy) return prev;
      const next = { ...prev };
      if (isBusy) next[sessionId] = true;
      else delete next[sessionId];
      return next;
    });
  }, []);

  function openMenu(session: Session, btn: HTMLButtonElement) {
    if (menu?.id === session.sessionId) {
      setMenu(null);
      return;
    }
    const container = chatBodyRef.current?.getBoundingClientRect();
    const rect = btn.getBoundingClientRect();
    if (!container) return;
    setMenu({
      id: session.sessionId,
      top: Math.min(rect.bottom - container.top + 4, container.height - 132),
      left: Math.max(12, rect.left - container.left - 8),
    });
  }

  function startRename(session: Session) {
    renameCommitted.current = false;
    setMenu(null);
    setRenamingId(session.sessionId);
    setRenameText(session.name);
  }

  async function commitRename(session: Session) {
    if (renameCommitted.current) return;
    renameCommitted.current = true;
    const trimmed = renameText.trim();
    setRenamingId("");
    if (!trimmed || trimmed === session.name) return;
    await renameSession(session.sessionId, trimmed);
  }

  const menuSession = menu
    ? sessions.find((s) => s.sessionId === menu.id)
    : undefined;
  const mountedIds = [
    ...new Set([...visited, ...(active ? [active] : [])]),
  ].filter((id) => sessions.some((s) => s.sessionId === id));

  return (
    <aside className="chat">
      <header className="panel-head chat-head">
        <div className="chat-brand">
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={sidebarOpen ? "收起对话列表" : "展开对话列表"}
            aria-pressed={sidebarOpen}
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? "收起对话列表" : "展开对话列表"}
          >
            <IconSidebar size={15} />
          </button>
          <span className="director-dot" aria-hidden="true">
            <IconSparkles size={14} />
          </span>
          <div>
            <h2>创作对话</h2>
            <small className="director-sub">AI DIRECTOR COPILOT</small>
          </div>
        </div>
        <div className="chat-tools">
          <button type="button" disabled={creating} onClick={create}>
            ＋ 新建对话
          </button>
          <button
            type="button"
            className="chat-focus"
            onClick={toggleFocus}
            aria-pressed={focusChat}
          >
            {focusChat ? "恢复双栏" : "展开对话"}
          </button>
        </div>
      </header>

      <div className="chat-body" ref={chatBodyRef} data-sidebar={sidebarOpen}>
        <nav className="session-sidebar" aria-label="对话列表">
          <div className="session-sidebar-head">
            <span>对话</span>
            <button
              type="button"
              className="sidebar-plus"
              disabled={creating}
              onClick={create}
              aria-label="新建对话"
              title="新建对话"
            >
              ＋
            </button>
          </div>

          {!sessions.length ? (
            <p className="session-sidebar-empty">暂无历史对话</p>
          ) : (
            <ul className="session-list" onScroll={() => menu && setMenu(null)}>
              {sessions.map((s) => {
                const isActive = s.sessionId === active;
                const isRunning = !!runningIds[s.sessionId];
                const isMenuOpen = menu?.id === s.sessionId;
                const isRenaming = renamingId === s.sessionId;
                return (
                  <li
                    key={s.sessionId}
                    data-session-id={s.sessionId}
                    className={
                      "session-row" +
                      (isActive ? " is-active" : "") +
                      (isMenuOpen ? " is-menu-open" : "") +
                      (isRenaming ? " is-renaming" : "")
                    }
                  >
                    {isRenaming ? (
                      <div className="session-rename-wrap">
                        <span className="session-tile" aria-hidden="true">
                          <IconChatBubble size={13} />
                        </span>
                        <input
                          aria-label="重命名对话"
                          className="session-rename-input"
                          value={renameText}
                          maxLength={255}
                          autoFocus
                          onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) => setRenameText(e.target.value)}
                          onBlur={() => void commitRename(s)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void commitRename(s);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              renameCommitted.current = true;
                              setRenamingId("");
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="session-select-btn"
                          aria-current={isActive ? "true" : undefined}
                          onClick={() => select(s.sessionId)}
                          onDoubleClick={() => startRename(s)}
                          title={s.name}
                        >
                          <span className="session-tile" aria-hidden="true">
                            <IconChatBubble size={13} />
                          </span>
                          <span className="session-name">{s.name}</span>
                        </button>

                        <div className="session-tail">
                          {isRunning ? (
                            <span
                              className="session-spinner"
                              role="status"
                              aria-label="回答生成中"
                            />
                          ) : (
                            s.pinned && (
                              <span
                                className="session-pin-badge"
                                aria-label="已置顶"
                              >
                                <IconPin size={13} />
                              </span>
                            )
                          )}
                          <button
                            type="button"
                            className="session-more-btn"
                            aria-label={"对话操作 " + s.name}
                            aria-expanded={isMenuOpen}
                            onClick={(e) => {
                              e.stopPropagation();
                              openMenu(s, e.currentTarget);
                            }}
                          >
                            <IconMore size={15} />
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {menu && menuSession && (
          <div
            className="session-popover"
            role="menu"
            aria-label="对话操作菜单"
            style={{ top: menu.top, left: menu.left }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const target = menuSession;
                setMenu(null);
                void pinSession(target.sessionId, !target.pinned);
              }}
            >
              <IconPin size={14} />
              <span>{menuSession.pinned ? "取消置顶" : "置顶"}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => startRename(menuSession)}
            >
              <IconEdit size={14} />
              <span>重命名</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-danger"
              disabled={!!runningIds[menuSession.sessionId]}
              onClick={() => {
                const target = menuSession;
                setMenu(null);
                void deleteSession(target.sessionId);
              }}
            >
              <IconTrash size={14} />
              <span>删除对话</span>
            </button>
          </div>
        )}

        <div className="chat-stage">
          {!active ? (
            <div className="chat-empty">
              <div className="copilot-emblem" aria-hidden="true">
                <IconSparkles size={22} />
              </div>
              <h3>开启创作对话</h3>
              <p>
                像与驻组导演沟通一样：构思短剧剧本、检索角色资产、批量拆解分镜或定点重拍单镜。
              </p>
              <button
                type="button"
                className="primary"
                disabled={creating}
                onClick={create}
              >
                开启首段导演对话
              </button>
            </div>
          ) : (
            mountedIds.map((id) => (
              <div key={id} hidden={id !== active} className="thread-wrap">
                <Thread {...props} id={id} onBusyChange={handleBusyChange} />
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

/** 将同一轮多次模型调用的非空回答按段落合并，避免后续步骤覆盖前置说明。 */
function appendAssistantSegment(accumulated: string, segment: string): string {
  if (!segment.trim()) return accumulated;
  if (!accumulated.trim()) return segment;
  return `${accumulated.replace(/\s+$/, "")}\n\n${segment.replace(/^\s+/, "")}`;
}

function InlineBold({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          part
        ),
      )}
    </>
  );
}

function LinkedText({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
        return match ? (
          <a key={i} href={match[2]} target="_blank" rel="noreferrer">
            {match[1]}
          </a>
        ) : (
          <InlineBold key={i} text={part} />
        );
      })}
    </>
  );
}

function Thread({
  token,
  projectId,
  id,
  active,
  quote,
  clearQuote,
  allowQuote,
  apply,
  syncSessionName,
  onBusyChange,
}: Props & {
  id: string;
  onBusyChange: (sessionId: string, busy: boolean) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [load, retry] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<{ id: string; data: Run }>();
  const running = useRef<AbortController | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const followLatest = useRef(true);
  const citation = quote?.sessionId === id ? quote : undefined;

  useEffect(() => {
    onBusyChange(id, busy);
    return () => onBusyChange(id, false);
  }, [id, busy, onBusyChange]);

  useEffect(() => {
    const controller = new AbortController();
    setReady(false);
    setError("");
    const query =
      "?projectId=" +
      encodeURIComponent(projectId) +
      "&sessionId=" +
      encodeURIComponent(id);
    api<Message[]>(
      token,
      "/sessions/messages" + query,
      "GET",
      undefined,
      controller.signal,
    )
      .then((rows) => {
        if (!controller.signal.aborted) {
          setMessages(rows);
          setReady(true);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorText(e));
      });
    return () => {
      controller.abort();
      running.current?.abort();
    };
  }, [token, projectId, id, load]);

  useEffect(() => {
    if (id === active && followLatest.current && scroll.current) {
      scroll.current.scrollTop = scroll.current.scrollHeight;
    }
  }, [messages, id, active]);

  async function trace(runId: string) {
    if (run?.id === runId) {
      setRun(undefined);
      return;
    }
    try {
      const query =
        "?sessionId=" +
        encodeURIComponent(id) +
        "&runId=" +
        encodeURIComponent(runId);
      setRun({
        id: runId,
        data: await api<Run>(token, "/sessions/run" + query),
      });
    } catch (e) {
      setError(errorText(e));
    }
  }

  /** 每个会话拥有独立的请求、输入框和回答草稿，流结束时采用后端终态文字。 */
  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!ready || !text || running.current || (citation && !allowQuote)) return;
    const selectedShot = citation && {
      version: citation.version,
      shotId: citation.shotId,
    };
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    followLatest.current = true;
    setInput("");
    setError("");
    setMessages((old) => [
      ...old,
      { role: "user", content: text, selectedShot },
      { role: "assistant", content: "", status: "等待回答…" },
    ]);
    function update(transform: (last: Message) => Message) {
      setMessages((old) => [
        ...old.slice(0, -1),
        transform(old[old.length - 1]),
      ]);
    }
    let modelCall = 0;
    let previousCallsText = "";
    let currentCallText = "";
    function failed(message: string, status?: number) {
      const hint =
        status === 413 ? "这次提交的原文太长，请拆成几段提交。" : message;
      update((m) => ({ ...m, status: hint }));
      setInput(text);
    }
    try {
      await streamTurn(
        token,
        id,
        {
          message: text,
          selectedShot,
        },
        controller.signal,
        (event) => {
          switch (event.type) {
            case "started":
              update((m) => ({ ...m, runId: event.runId }));
              break;
            case "step_started":
            case "step_finished":
              if (event.step.kind === "tool") {
                const label =
                  event.step.name === "search_user_assets"
                    ? "搜索素材"
                    : event.step.name === "propose_storyboard"
                      ? "整理分镜建议"
                      : event.step.name;
                update((m) => ({
                  ...m,
                  status:
                    label +
                    (event.type === "step_started"
                      ? "中…"
                      : " · " + event.step.status),
                }));
              }
              break;
            case "ui_block":
              update((m) => ({
                ...m,
                uiBlocks: [
                  ...(m.uiBlocks || []).filter(
                    (b) => b.component !== event.block.component,
                  ),
                  event.block,
                ],
              }));
              break;
            case "text_delta": {
              if (modelCall !== event.modelCallNumber) {
                previousCallsText = appendAssistantSegment(
                  previousCallsText,
                  currentCallText,
                );
                currentCallText = "";
                modelCall = event.modelCallNumber;
              }
              currentCallText += event.text;
              const nextContent =
                appendAssistantSegment(previousCallsText, currentCallText) ||
                currentCallText;
              update((m) => ({
                ...m,
                content: nextContent,
                status: "回答中…",
              }));
              break;
            }
            case "completed":
              if (citation) clearQuote(citation);
              if (event.sessionName) syncSessionName(id, event.sessionName);
              update((m) => ({
                ...m,
                content: event.text,
                status: undefined,
                storyboardProposal: event.storyboardProposal,
                uiBlocks: event.uiBlocks ?? m.uiBlocks,
              }));
              break;
            case "stopped":
              if (citation) clearQuote(citation);
              if (event.sessionName) syncSessionName(id, event.sessionName);
              update((m) => ({
                ...m,
                content: event.text,
                status: "本轮已停止",
              }));
              break;
            case "failed":
              failed(event.message, event.statusCode);
              break;
          }
        },
      );
    } catch (e) {
      failed(
        controller.signal.aborted ? "已停止接收本轮回答" : errorText(e),
        e instanceof ApiError ? e.status : undefined,
      );
    } finally {
      running.current = null;
      setBusy(false);
    }
  }

  return (
    <div className="thread">
      <div
        className="messages"
        ref={scroll}
        aria-label="聊天记录"
        onScroll={(e) => {
          const list = e.currentTarget;
          if (list.clientHeight)
            followLatest.current =
              list.scrollHeight - list.scrollTop - list.clientHeight < 32;
        }}
      >
        {!ready && !error && (
          <p className="muted loading-chat">正在读取对话…</p>
        )}
        {ready && !messages.length && (
          <div className="chat-empty thread-welcome">
            <div className="copilot-emblem" aria-hidden="true">
              <IconSparkles size={20} />
            </div>
            <h3>这是一段新对话</h3>
            <p>可以从一句话故事创意开始，或选择下方导演快捷指令：</p>
            <div className="starter-grid">
              {starterPrompts.map((item) => (
                <button
                  key={item.tag}
                  type="button"
                  className="starter-card"
                  onClick={() => {
                    setInput(item.prompt);
                    inputRef.current?.focus();
                  }}
                >
                  <span className="starter-tag">{item.tag}</span>
                  <strong>{item.title}</strong>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const displayText =
            m.role === "assistant"
              ? cleanMessageTextForUiBlocks(m.content, m.uiBlocks)
              : m.content;
          return (
            <article
              className={"message " + m.role}
              key={m.sequence ?? "local-" + i}
            >
              {(m.role === "assistant" || m.selectedShot) && (
                <div className="message-meta">
                  {m.role === "assistant" && <small>工坊助手</small>}
                  {m.selectedShot && (
                    <span className="msg-quote-badge">
                      引用镜头 · 版本 {m.selectedShot.version}
                    </span>
                  )}
                </div>
              )}

              {displayText && (
                <p className="message-body">
                  <LinkedText text={displayText} />
                </p>
              )}

              {m.uiBlocks && m.uiBlocks.length > 0 && (
                <ChatUiBlockRenderer blocks={m.uiBlocks} />
              )}

              {m.status && (
                <div className="message-state" role="status">
                  <span className="pulse-dot" aria-hidden="true" />
                  {m.status}
                </div>
              )}

              {m.storyboardProposal && (
                <div className="bezel-shell proposal-shell">
                  <div className="bezel-core proposal">
                    <div className="proposal-head">
                      <div className="proposal-title-row">
                        <IconSparkles size={15} />
                        <strong>
                          {m.storyboardProposal.kind === "shot"
                            ? "单镜修改建议"
                            : m.storyboardProposal.storyboard.title}
                        </strong>
                      </div>
                      <small className="proposal-badge">
                        基于版本 {m.storyboardProposal.baseVersion} ·{" "}
                        {m.storyboardProposal.kind === "shot"
                          ? "1 镜"
                          : m.storyboardProposal.storyboard.shots.length +
                            " 镜"}
                      </small>
                    </div>

                    <details>
                      <summary>查看建议内容</summary>
                      <div className="proposal-preview">
                        {m.storyboardProposal.kind === "shot" ? (
                          <div className="proposal-shot-item">
                            {m.storyboardProposal.shot.scene && (
                              <strong>{m.storyboardProposal.shot.scene}</strong>
                            )}
                            <p>{m.storyboardProposal.shot.prompt}</p>
                          </div>
                        ) : (
                          <>
                            {m.storyboardProposal.storyboard.script && (
                              <p className="proposal-script">
                                {m.storyboardProposal.storyboard.script}
                              </p>
                            )}
                            {m.storyboardProposal.storyboard.shots.map(
                              (s, n) => (
                                <div className="proposal-shot-item" key={n}>
                                  <strong>
                                    SHOT {String(n + 1).padStart(2, "0")} ·{" "}
                                    {s.scene || "分镜"}
                                  </strong>
                                  <p>
                                    镜头 {n + 1} · {s.prompt}
                                  </p>
                                </div>
                              ),
                            )}
                          </>
                        )}
                      </div>
                    </details>

                    <button
                      type="button"
                      className="primary proposal-apply"
                      onClick={() => apply(m.storyboardProposal!)}
                    >
                      采用到编辑区
                    </button>
                  </div>
                </div>
              )}

              {m.runId && !busy && (
                <button
                  type="button"
                  className="text-btn trace-toggle"
                  onClick={() => trace(m.runId!)}
                >
                  <IconTrace size={13} /> 查看运行轨迹
                </button>
              )}

              {run && run.id === m.runId && (
                <ol className="trace">
                  {run.data.steps.map((s, n) => (
                    <li key={n}>
                      <span className="trace-name">{s.name}</span>
                      <span className="trace-meta">
                        {s.status} · {s.durationMs ?? 0} ms
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </article>
          );
        })}

        {error && (
          <p role="alert" className="error">
            {error}{" "}
            {!ready && (
              <button type="button" onClick={() => retry((n) => n + 1)}>
                重试
              </button>
            )}
          </p>
        )}
      </div>

      <form className="composer" onSubmit={send}>
        {citation && (
          <div className="quote">
            <span>
              引用{citation.label} · 版本 {citation.version}
            </span>
            <button
              type="button"
              aria-label="取消引用"
              onClick={() => clearQuote(citation)}
            >
              ×
            </button>
          </div>
        )}
        <textarea
          ref={inputRef}
          aria-label="对话消息"
          placeholder="描述剧情构想、搜索角色素材，或要求导演助手调整运镜…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }}
        />
        <div className="row composer-foot">
          <small>
            {citation && !allowQuote
              ? "请取消引用或重新选择已保存的镜头"
              : "Enter 发送 · Shift + Enter 换行"}
          </small>
          {busy ? (
            <button
              type="button"
              className="danger-subtle"
              onClick={() => running.current?.abort()}
            >
              停止接收
            </button>
          ) : (
            <button
              className="primary send-pill"
              disabled={!ready || !input.trim() || (!!citation && !allowQuote)}
            >
              <span>发送</span>
              <span className="btn-orb" aria-hidden="true">
                <IconSend size={13} />
              </span>
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
