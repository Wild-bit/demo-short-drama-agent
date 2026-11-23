import { useState, type CSSProperties, type ReactNode } from 'react';

const minEditorShare = 34;
const maxEditorShare = 62;

/** 两个面板始终挂载，调整宽度或切换视图时保留输入、滚动位置和正在接收的回答。 */
export function StudioSplit({
  focusChat,
  children: [editor, chat],
}: {
  focusChat: boolean;
  children: [ReactNode, ReactNode];
}) {
  const [share, setShare] = useState(50);
  function resize(value: number) {
    setShare(Math.max(minEditorShare, Math.min(maxEditorShare, Math.round(value))));
  }
  return (
    <div
      className="studio-layout"
      data-focus-chat={focusChat}
      style={{ '--editor-track': share + 'fr', '--chat-track': 100 - share + 'fr' } as CSSProperties}
    >
      {editor}
      <div
        className="pane-divider"
        role="separator"
        tabIndex={0}
        aria-label="调整分镜和对话宽度"
        aria-orientation="vertical"
        aria-controls="storyboard-pane chat-pane"
        aria-valuemin={minEditorShare}
        aria-valuemax={maxEditorShare}
        aria-valuenow={share}
        aria-valuetext={'分镜占 ' + share + '%'}
        title="拖动调整宽度，双击恢复均分"
        onDoubleClick={() => setShare(50)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') resize(share - 2);
          else if (e.key === 'ArrowRight') resize(share + 2);
          else if (e.key === 'Home') resize(minEditorShare);
          else if (e.key === 'End') resize(maxEditorShare);
          else return;
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          if (e.button === 0) e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const grip = e.currentTarget;
          if (!grip.hasPointerCapture(e.pointerId)) return;
          const left = grip.previousElementSibling!.getBoundingClientRect().left;
          const right = grip.nextElementSibling!.getBoundingClientRect().right;
          resize((100 * (e.clientX - left - grip.offsetWidth / 2)) / (right - left - grip.offsetWidth));
        }}
      />
      {chat}
    </div>
  );
}
