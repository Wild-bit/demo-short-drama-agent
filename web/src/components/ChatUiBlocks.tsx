import { useState } from 'react';
import type { ChatAssetCardItem, ChatUiBlock } from '~web/types';
import { Dialog } from '~web/components/Dialog';
import { IconAssets, IconClapper } from '~web/components/Icons';

/** 当消息已挂载素材卡片组件时，清理正文中重复刷屏的同一批原始链接，保留可读名称。 */
export function cleanMessageTextForUiBlocks(content: string, uiBlocks?: ChatUiBlock[]): string {
  if (!content || !uiBlocks?.length) return content;
  const urls = new Set<string>();
  for (const block of uiBlocks) {
    if (block.component === 'asset_gallery') {
      for (const item of block.assets) {
        if (item.url) urls.add(item.url);
      }
    }
  }
  if (!urls.size) return content;

  let cleaned = content.replace(/!?\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (full, label: string, url: string) =>
    urls.has(url) ? label : full,
  );
  cleaned = cleaned.replace(/([ \t]*[–—\-:：][ \t]*)(https?:\/\/[^\s)\n]+)/g, (full, _sep: string, url: string) =>
    urls.has(url) ? '' : full,
  );
  cleaned = cleaned.replace(/https?:\/\/[^\s)\n]+/g, (url) => (urls.has(url) ? '' : url));
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

/** A2UI 风格受控组件分发器：按后端下发的 component 标识渲染对应对话卡片。 */
export function ChatUiBlockRenderer({ blocks }: { blocks: ChatUiBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.component) {
          case 'asset_gallery':
            return <ChatAssetGallery key={'gallery-' + index} assets={block.assets} />;
          default:
            return null;
        }
      })}
    </>
  );
}

function GalleryCard({
  item,
  index,
  onPreview,
}: {
  item: ChatAssetCardItem;
  index: number;
  onPreview: (asset: ChatAssetCardItem) => void;
}) {
  const [failed, setFailed] = useState(false);
  const canPreview = Boolean(item.url) && !failed;

  return (
    <button
      type="button"
      className={'chat-asset-card' + (canPreview ? ' is-previewable' : ' is-fallback')}
      onClick={() => {
        if (canPreview) onPreview(item);
      }}
      disabled={!canPreview}
      aria-label={canPreview ? `预览素材 ${item.name}` : `${item.name}（暂无预览文件）`}
    >
      <div className="chat-asset-media">
        <span className="chat-asset-index">#{String(index + 1).padStart(2, '0')}</span>
        <span className={'chat-asset-kind ' + item.type}>{item.type === 'video' ? 'VIDEO' : 'IMAGE'}</span>
        {canPreview ? (
          item.type === 'video' ? (
            <video
              src={item.url}
              muted
              playsInline
              preload="metadata"
              onError={() => setFailed(true)}
            />
          ) : (
            <img
              loading="lazy"
              src={item.url}
              alt={item.name}
              onError={() => setFailed(true)}
            />
          )
        ) : (
          <div className="chat-asset-placeholder" aria-hidden="true">
            {item.type === 'video' ? <IconClapper size={20} /> : <IconAssets size={20} />}
            <span>暂无实体预览文件</span>
          </div>
        )}
      </div>

      <div className="chat-asset-meta">
        <strong title={item.name}>{item.name}</strong>
        {item.tags && item.tags.length > 0 ? (
          <div className="chat-asset-tags">
            {item.tags.slice(0, 3).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : (
          item.description && <small title={item.description}>{item.description}</small>
        )}
      </div>
    </button>
  );
}

/** 对话内专属素材画廊组件：网格展示命中的角色/场景图片与视频，支持点击灯箱放大预览。 */
export function ChatAssetGallery({ assets }: { assets: ChatAssetCardItem[] }) {
  const [preview, setPreview] = useState<ChatAssetCardItem | null>(null);
  if (!assets.length) return null;

  const imageCount = assets.filter((a) => a.type === 'image').length;
  const videoCount = assets.filter((a) => a.type === 'video').length;
  const summaryParts: string[] = [];
  if (imageCount) summaryParts.push(`${imageCount} 张图片`);
  if (videoCount) summaryParts.push(`${videoCount} 段视频`);

  return (
    <section className="bezel-shell chat-gallery-shell" aria-label="匹配素材卡片">
      <div className="bezel-core chat-gallery">
        <header className="chat-gallery-head">
          <div className="chat-gallery-title">
            <IconAssets size={15} />
            <strong>素材库命中结果</strong>
          </div>
          <small className="proposal-badge">{summaryParts.join(' · ')}</small>
        </header>

        <div className="chat-gallery-grid">
          {assets.map((item, idx) => (
            <GalleryCard key={item.id} item={item} index={idx} onPreview={setPreview} />
          ))}
        </div>
      </div>

      {preview && (
        <Dialog
          wide
          title={preview.name}
          subtitle={preview.description || (preview.type === 'video' ? '视频素材预览' : '参考图片高清预览')}
          close={() => setPreview(null)}
        >
          <div className="chat-lightbox">
            <div className="chat-lightbox-stage">
              {preview.type === 'video' ? (
                <video src={preview.url} controls autoPlay playsInline />
              ) : (
                <img src={preview.url} alt={preview.name} />
              )}
            </div>
            {preview.tags && preview.tags.length > 0 && (
              <div className="chat-lightbox-tags">
                {preview.tags.map((tag) => (
                  <span key={tag} className="meta-pill">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}
