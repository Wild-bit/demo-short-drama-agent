import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { api, errorText, uploadAsset } from '~web/api';
import type { Asset } from '~web/types';
import { Dialog } from '~web/components/Dialog';
import { IconAssets, IconSearch, IconUpload } from '~web/components/Icons';

function Preview({ asset }: { asset: Asset }) {
  const [failed, setFailed] = useState(false);
  return asset.url && asset.type === 'image' && !failed ? (
    <img loading="lazy" alt="" src={asset.url} onError={() => setFailed(true)} />
  ) : (
    <span className="filetype">{asset.type === 'video' ? 'VIDEO' : 'IMAGE'}</span>
  );
}

/** 分镜卡片 16:9 取景框：展示首个绑定的参考图与总数量角标。 */
export function ShotFramePreview({
  assetIds,
  token,
  shotNumber,
  onOpenPicker,
}: {
  assetIds: string[];
  token: string;
  shotNumber: number;
  onOpenPicker: () => void;
}) {
  const primaryId = assetIds[0];
  const [asset, setAsset] = useState<Asset>();
  const [failed, setFailed] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    setFailed(false);
    setPreviewing(false);
    if (!primaryId) {
      setAsset(undefined);
      return;
    }
    const c = new AbortController();
    api<Asset>(token, '/assets/detail?assetId=' + encodeURIComponent(primaryId), 'GET', undefined, c.signal)
      .then(setAsset)
      .catch(() => {
        if (!c.signal.aborted) setAsset(undefined);
      });
    return () => c.abort();
  }, [primaryId, token]);

  const hasImage = asset?.url && asset.type === 'image' && !failed;
  return (
    <>
      {/* 有图时点击放大预览，换图走右上角按钮；没图时点击直接绑定素材。 */}
      <div
        className={'shot-frame' + (hasImage ? ' has-media' : '')}
        title={hasImage ? '点击放大预览' : undefined}
        onClick={hasImage ? () => setPreviewing(true) : onOpenPicker}
      >
        <span className="reticle tl" aria-hidden="true" />
        <span className="reticle tr" aria-hidden="true" />
        <span className="reticle bl" aria-hidden="true" />
        <span className="reticle br" aria-hidden="true" />
        {hasImage ? (
          <>
            <img
              loading="lazy"
              alt=""
              src={asset.url}
              onError={() => setFailed(true)}
              className="shot-frame-img"
            />
            <button
              type="button"
              className="shot-frame-swap"
              onClick={(e) => {
                e.stopPropagation();
                onOpenPicker();
              }}
            >
              更换参考图
            </button>
          </>
        ) : (
          <div className="shot-frame-placeholder" aria-hidden="true">
            <IconAssets size={22} />
            <span>点击绑定角色 / 场景参考图</span>
          </div>
        )}
        <div className="shot-frame-hud" aria-hidden="true">
          <span className="hud-tag">FRAME {String(shotNumber).padStart(2, '0')} · 16:9</span>
          {assetIds.length > 0 && (
            <span className="hud-count">
              {asset?.name ? asset.name : '参考图'}
              {assetIds.length > 1 ? ` +${assetIds.length - 1}` : ''}
            </span>
          )}
        </div>
      </div>

      {previewing && hasImage && (
        <Dialog wide title={asset.name} subtitle="参考图片高清预览" close={() => setPreviewing(false)}>
          <div className="chat-lightbox">
            <div className="chat-lightbox-stage">
              <img src={asset.url} alt={asset.name} />
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

export function AssetChip({ id, token, remove }: { id: string; token: string; remove: () => void }) {
  const [asset, setAsset] = useState<Asset>();
  const [error, setError] = useState('');
  useEffect(() => {
    const c = new AbortController();
    api<Asset>(token, '/assets/detail?assetId=' + encodeURIComponent(id), 'GET', undefined, c.signal)
      .then(setAsset)
      .catch((e) => {
        if (!c.signal.aborted) setError(errorText(e));
      });
    return () => c.abort();
  }, [id, token]);
  return (
    <span className="chip">
      {asset && <Preview asset={asset} />}
      <span className="chip-name">{asset?.name || error || '读取素材…'}</span>
      <button type="button" aria-label={'移除参考素材 ' + (asset?.name || id)} onClick={remove}>
        ×
      </button>
    </span>
  );
}

/** 素材库分页接口 `GET /assets` 的返回结构。 */
type AssetPage = { items: Asset[]; total: number; page: number; pageSize: number };

/** 素材检索与直传工作区：同时复用于分镜选图弹窗与左侧「素材库」工位。 */
export function AssetLibraryView({
  token,
  selectedIds = [],
  onSelect,
  defaultOpenUpload = false,
  pageSize = 24,
}: {
  token: string;
  selectedIds?: string[];
  onSelect?: (id: string) => void;
  defaultOpenUpload?: boolean;
  /** 每页条数，随请求传给服务端。 */
  pageSize?: number;
}) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  // 选素材弹窗只绑定参考图，固定为图片；素材库工位可以在图片和视频之间切换。
  const [type, setType] = useState<Asset['type']>('image');
  const [page, setPage] = useState(1);
  const [reloadNumber, reload] = useState(0);
  const [items, setItems] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const [showUpload, setShowUpload] = useState(defaultOpenUpload);
  const [file, setFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState('');

  // 类型、页码、关键词任一变化都重新读取当前页；没有关键词时就是按更新时间倒序的全部素材。
  useEffect(() => {
    const c = new AbortController();
    setBusy(true);
    setError('');
    const params = new URLSearchParams({ type, page: String(page), pageSize: String(pageSize) });
    if (query) params.set('query', query);
    api<AssetPage>(token, '/assets?' + params.toString(), 'GET', undefined, c.signal)
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((e) => {
        if (c.signal.aborted) return;
        setItems([]);
        setTotal(0);
        setError(errorText(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setBusy(false);
      });
    return () => c.abort();
  }, [token, type, page, pageSize, query, reloadNumber]);

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] || null;
    setFile(picked);
    setUploadNotice('');
    setError('');
    if (picked && !uploadName.trim()) {
      setUploadName(picked.name.replace(/\.[^.]+$/, '').slice(0, 80));
    }
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!file || !uploadName.trim() || uploading) return;
    setUploading(true);
    setError('');
    setUploadNotice('');
    try {
      const created = await uploadAsset(token, uploadName.trim(), file);
      // 新素材按更新时间排在图片第一页最前，回到那里并重新读取。
      setInput('');
      setQuery('');
      setType('image');
      setPage(1);
      reload((n) => n + 1);
      setFile(null);
      setUploadName('');
      setUploadNotice(`已上传「${created.name}」至个人素材库`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setUploading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="asset-studio">
      <div className="asset-toolbar">
        <form
          className="asset-search-bar"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(input.trim());
            setPage(1);
            reload((n) => n + 1);
          }}
        >
          <span className="search-icon" aria-hidden="true">
            <IconSearch size={15} />
          </span>
          <input
            aria-label="素材关键词"
            placeholder="按角色、场景名称或描述搜索，例如：墨墨"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus={!defaultOpenUpload}
          />
          {/* 已有关键词时允许提交空输入，用来清除搜索回到全部素材。 */}
          <button className="primary" disabled={!input.trim() && !query}>
            搜索
          </button>
        </form>
        <button
          type="button"
          className={showUpload ? 'ghost-active' : undefined}
          onClick={() => setShowUpload((v) => !v)}
        >
          <IconUpload size={15} />
          {showUpload ? '收起上传' : '上传参考图'}
        </button>
      </div>

      {!onSelect && (
        <div className="seg-toggle asset-tabs" role="group" aria-label="素材类型">
          {(['image', 'video'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={type === value}
              onClick={() => {
                setType(value);
                setPage(1);
              }}
            >
              {value === 'image' ? '图片' : '视频'}
            </button>
          ))}
        </div>
      )}

      {showUpload && (
        <form className="upload-pod" onSubmit={handleUpload}>
          <div className="upload-pod-head">
            <strong>上传角色 / 场景设定图</strong>
            <small>支持 PNG、JPEG、WebP、GIF（最大 20MB），自动归档至腾讯云 COS</small>
          </div>
          <div className="upload-pod-fields">
            <label>
              选择图片文件
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={onFileChange}
              />
            </label>
            <label>
              新素材名称
              <input
                maxLength={255}
                placeholder="例如：墨墨-舞台正装"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
              />
            </label>
            <button className="primary" disabled={!file || !uploadName.trim() || uploading}>
              {uploading ? '上传中…' : '上传入库'}
            </button>
          </div>
        </form>
      )}

      {uploadNotice && (
        <p className="notice" role="status">
          {uploadNotice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="asset-list">
        {busy ? (
          <p className="muted asset-status">正在读取个人素材库…</p>
        ) : !items.length && !error ? (
          <div className="asset-empty">
            <IconAssets size={24} />
            <p>
              {query
                ? '没有找到匹配的素材，可换个关键词或直接上传新参考图'
                : type === 'video'
                  ? '还没有视频素材，生成成功的视频会归档到这里'
                  : '还没有图片素材，点击右上角上传本地图片'}
            </p>
          </div>
        ) : (
          <div className="asset-grid">
            {items.map((a) => {
              const chosen = selectedIds.includes(a.id);
              return onSelect ? (
                <button
                  type="button"
                  className={'asset-card' + (chosen ? ' is-chosen' : '')}
                  key={a.id}
                  disabled={chosen}
                  onClick={() => onSelect(a.id)}
                >
                  <div className="asset-thumb">
                    <Preview asset={a} />
                  </div>
                  <div className="asset-card-meta">
                    <span className="asset-card-name">{a.name}</span>
                    <small className="asset-card-action">{chosen ? '已选' : '选择'}</small>
                  </div>
                </button>
              ) : (
                <div className="asset-card static" key={a.id}>
                  <div className="asset-thumb">
                    <Preview asset={a} />
                  </div>
                  <div className="asset-card-meta">
                    <span className="asset-card-name">{a.name}</span>
                    <small className="asset-card-action">{a.type === 'video' ? '视频产物' : '参考图片'}</small>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {total > 0 && (
          <nav className="asset-pager" aria-label="素材分页">
            <button type="button" disabled={busy || page <= 1} onClick={() => setPage(page - 1)}>
              上一页
            </button>
            <span className="muted">
              第 {page} / {totalPages} 页 · 共 {total} 项
            </span>
            <button type="button" disabled={busy || page >= totalPages} onClick={() => setPage(page + 1)}>
              下一页
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}

export function AssetPicker({
  token,
  ids,
  add,
  close,
}: {
  token: string;
  ids: string[];
  add: (id: string) => void;
  close: () => void;
}) {
  return (
    <Dialog
      wide
      title="选择参考素材"
      subtitle="从个人资产库检索角色与场景图，或直接上传新设定图绑定至当前分镜。"
      close={close}
    >
      <AssetLibraryView token={token} selectedIds={ids} onSelect={add} />
    </Dialog>
  );
}
