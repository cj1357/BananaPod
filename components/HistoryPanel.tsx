import React from "react";
import { authLogout, historyDelete, historyList, type HistoryItem } from "../services/apiService";

type TimeFilter = 'all' | 'today' | 'yesterday' | '7days' | '30days';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (item: HistoryItem) => void;
  onLogout: () => void;
  t: (key: string) => string;
};

function mediaSrc(id: string): string {
  return `/api/media/${encodeURIComponent(id)}`;
}

function getStartOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function filterByTime(items: HistoryItem[], filter: TimeFilter): HistoryItem[] {
  if (filter === 'all') return items;

  const now = new Date();
  const todayStart = getStartOfDay(now);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const last7Start = new Date(todayStart);
  last7Start.setDate(last7Start.getDate() - 7);
  const last30Start = new Date(todayStart);
  last30Start.setDate(last30Start.getDate() - 30);

  return items.filter(item => {
    const itemDate = new Date(item.created_at);
    switch (filter) {
      case 'today':
        return itemDate >= todayStart;
      case 'yesterday':
        return itemDate >= yesterdayStart && itemDate < todayStart;
      case '7days':
        return itemDate >= last7Start;
      case '30days':
        return itemDate >= last30Start;
      default:
        return true;
    }
  });
}

function filterBySearch(items: HistoryItem[], query: string): HistoryItem[] {
  if (!query.trim()) return items;
  const lowerQuery = query.toLowerCase();
  return items.filter(item =>
    item.prompt && item.prompt.toLowerCase().includes(lowerQuery)
  );
}

export const HistoryPanel: React.FC<Props> = ({ isOpen, onClose, onInsert, onLogout, t }) => {
  const [items, setItems] = React.useState<HistoryItem[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // States for filtering and preview
  const [searchQuery, setSearchQuery] = React.useState("");
  const [timeFilter, setTimeFilter] = React.useState<TimeFilter>('all');
  const [previewItem, setPreviewItem] = React.useState<HistoryItem | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = React.useState(1);

  // Ref for infinite scroll
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  const loadFirstPage = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await historyList(24, null);
      setItems(res.items);
      setCursor(res.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMore = React.useCallback(async () => {
    if (!cursor || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await historyList(24, cursor);
      setItems((prev) => [...prev, ...res.items]);
      setCursor(res.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setIsLoading(false);
    }
  }, [cursor, isLoading]);

  React.useEffect(() => {
    if (isOpen) loadFirstPage();
  }, [isOpen, loadFirstPage]);

  // Infinite scroll with IntersectionObserver
  React.useEffect(() => {
    if (!isOpen || !cursor || isLoading) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && cursor && !isLoading) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isOpen, cursor, isLoading, loadMore]);

  React.useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (previewItem) {
          setPreviewItem(null);
          setPreviewZoom(1);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose, previewItem]);

  const handleDelete = async (id: string) => {
    if (!window.confirm(t("historyPanel.deleteConfirm"))) return;
    setIsLoading(true);
    setError(null);
    try {
      await historyDelete(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await authLogout();
    } catch {
      // ignore; still clear local storage in app
    } finally {
      onLogout();
    }
  };

  const handleCopyPrompt = async (item: HistoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.prompt) return;
    try {
      await navigator.clipboard.writeText(item.prompt);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = item.prompt;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1500);
    }
  };

  // Apply filters
  const filteredItems = React.useMemo(() => {
    let result = items;
    result = filterByTime(result, timeFilter);
    result = filterBySearch(result, searchQuery);
    return result;
  }, [items, timeFilter, searchQuery]);

  if (!isOpen) return null;

  const timeFilterOptions: { value: TimeFilter; labelKey: string }[] = [
    { value: 'all', labelKey: 'historyPanel.all' },
    { value: 'today', labelKey: 'historyPanel.today' },
    { value: 'yesterday', labelKey: 'historyPanel.yesterday' },
    { value: '7days', labelKey: 'historyPanel.last7days' },
    { value: '30days', labelKey: 'historyPanel.last30days' },
  ];

  return (
    <div className="fixed inset-0 z-50 text-white">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Fullscreen panel */}
      <div
        className="absolute inset-0 flex flex-col border border-white/10 shadow-2xl overflow-hidden"
        style={{ backgroundColor: "var(--ui-bg-color)" }}
        role="dialog"
        aria-modal="true"
        aria-label="History"
      >
        {/* Header - Single Row */}
        <div className="flex-shrink-0 sticky top-0 z-10 flex items-center gap-3 px-4 py-2 border-b border-white/10">
          {/* Title */}
          <h3 className="text-lg font-semibold whitespace-nowrap">History</h3>
          <span className="text-xs text-white/50 whitespace-nowrap">{filteredItems.length || ""}</span>

          {/* Search Input */}
          <div className="relative flex-1 max-w-xs">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40"
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("historyPanel.search")}
              className="w-full pl-8 pr-3 py-1.5 rounded-md bg-white/10 border border-white/10 text-sm text-white placeholder-white/40 focus:outline-none focus:border-white/30"
            />
          </div>

          {/* Time Filter */}
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
            className="px-2 py-1.5 rounded-md bg-white/10 border border-white/10 text-sm text-white focus:outline-none focus:border-white/30 cursor-pointer"
          >
            {timeFilterOptions.map(opt => (
              <option key={opt.value} value={opt.value} className="bg-gray-800">
                {t(opt.labelKey)}
              </option>
            ))}
          </select>

          {/* Action Buttons */}
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={loadFirstPage}
              className="text-gray-300 hover:text-white p-1.5 rounded-full hover:bg-white/10"
              title={t("toolbar.redo")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 12a9 9 0 1 1-3-6.7" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
            </button>
            <button
              onClick={handleLogout}
              className="text-gray-300 hover:text-white p-1.5 rounded-full hover:bg-white/10"
              title="切换密钥"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M10 17l1 1 7-7-7-7-1 1" />
                <path d="M14 11H3" />
                <path d="M21 12a9 9 0 0 0-9-9" />
                <path d="M12 21a9 9 0 0 0 9-9" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="text-gray-300 hover:text-white p-1.5 rounded-full hover:bg-white/10"
              title="关闭（Esc）"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        {error && <div className="px-4 py-2 text-sm text-red-300 border-b border-white/10">{error}</div>}

        {/* Masonry Grid */}
        <div ref={scrollContainerRef} className="flex-grow overflow-y-auto p-4">
          {filteredItems.length === 0 && !isLoading ? (
            <div className="flex items-center justify-center h-32 text-white/50">
              {t("historyPanel.noResults")}
            </div>
          ) : (
            <div className="columns-2 sm:columns-3 lg:columns-4 2xl:columns-5 gap-3 [column-fill:_balance]">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  className="group relative mb-3 break-inside-avoid rounded-xl overflow-hidden border border-white/10 bg-black/10"
                >
                  {/* Media Preview */}
                  <div className="relative">
                    {item.kind === "video" ? (
                      <video
                        src={mediaSrc(item.id)}
                        className="w-full h-auto bg-black/20"
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <img
                        src={mediaSrc(item.id)}
                        className="w-full h-auto bg-black/20"
                        loading="lazy"
                      />
                    )}

                    {/* Hover Overlay with Actions */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      {/* Preview Button */}
                      <button
                        onClick={() => setPreviewItem(item)}
                        className="p-2.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                        title={t("historyPanel.preview")}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>

                      {/* Insert to Canvas Button */}
                      <button
                        onClick={() => onInsert(item)}
                        className="p-2.5 rounded-full bg-white/20 hover:bg-green-500/60 transition-colors"
                        title={t("historyPanel.insertToCanvas")}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Prompt Area - Clickable to Copy */}
                  {item.prompt ? (
                    <button
                      onClick={(e) => handleCopyPrompt(item, e)}
                      className="block w-full text-left p-2 bg-black/80 hover:bg-black/90 transition-colors cursor-pointer"
                      title={t("historyPanel.copyPrompt")}
                    >
                      <div
                        className="text-[11px] text-white line-clamp-3"
                        style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
                      >
                        {copiedId === item.id ? (
                          <span className="text-green-400 font-medium">{t("historyPanel.copied")}</span>
                        ) : (
                          item.prompt
                        )}
                      </div>
                    </button>
                  ) : null}

                  {/* Delete Button */}
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/45 opacity-0 group-hover:opacity-100 hover:bg-red-500/60 transition-opacity"
                    title={t("historyPanel.delete")}
                    disabled={isLoading}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Sentinel for infinite scroll */}
          {cursor && <div ref={sentinelRef} className="h-4" />}
        </div>

        {/* Loading indicator at bottom */}
        {isLoading && (
          <div className="flex-shrink-0 p-3 border-t border-white/10 flex justify-center items-center bg-black/10">
            <span className="text-xs text-gray-300">{t("historyPanel.loading")}</span>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewItem && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-md"
          onClick={() => { setPreviewItem(null); setPreviewZoom(1); }}
        >
          {/* Main Container - Horizontal Layout */}
          <div className="flex items-start gap-6 max-w-[95vw] max-h-[90vh] p-4">
            {/* Left: Image with zoom */}
            <div
              className="relative flex-shrink-0 overflow-auto rounded-lg bg-black/40"
              style={{ maxWidth: '65vw', maxHeight: '85vh' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Zoom Controls */}
              <div className="absolute top-2 left-2 z-10 flex gap-1">
                <button
                  onClick={() => setPreviewZoom(z => Math.max(0.25, z - 0.25))}
                  className="p-1.5 rounded bg-black/60 hover:bg-black/80 text-white"
                  title="缩小"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                    <path d="M8 11h6" />
                  </svg>
                </button>
                <span className="px-2 py-1 rounded bg-black/60 text-white text-xs">{Math.round(previewZoom * 100)}%</span>
                <button
                  onClick={() => setPreviewZoom(z => Math.min(4, z + 0.25))}
                  className="p-1.5 rounded bg-black/60 hover:bg-black/80 text-white"
                  title="放大"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                    <path d="M11 8v6M8 11h6" />
                  </svg>
                </button>
                <button
                  onClick={() => setPreviewZoom(1)}
                  className="p-1.5 rounded bg-black/60 hover:bg-black/80 text-white text-xs"
                  title="重置"
                >
                  1:1
                </button>
              </div>

              {/* Media */}
              {previewItem.kind === "video" ? (
                <video
                  src={mediaSrc(previewItem.id)}
                  className="rounded-lg"
                  style={{ transform: `scale(${previewZoom})`, transformOrigin: 'top left' }}
                  controls
                  autoPlay
                  playsInline
                />
              ) : (
                <img
                  src={mediaSrc(previewItem.id)}
                  className="rounded-lg"
                  style={{ transform: `scale(${previewZoom})`, transformOrigin: 'top left' }}
                />
              )}
            </div>

            {/* Right: Prompt and Actions */}
            <div
              className="flex flex-col gap-4 w-80 flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Prompt */}
              {previewItem.prompt && (
                <button
                  onClick={(e) => handleCopyPrompt(previewItem, e)}
                  className="text-left p-4 rounded-lg bg-white/10 hover:bg-white/15 transition-colors"
                  title={t("historyPanel.copyPrompt")}
                >
                  <p className="text-sm text-white/90 leading-relaxed">
                    {copiedId === previewItem.id ? (
                      <span className="text-green-400 font-medium">{t("historyPanel.copied")}</span>
                    ) : (
                      previewItem.prompt
                    )}
                  </p>
                </button>
              )}

              {/* Insert Button */}
              <button
                onClick={() => {
                  onInsert(previewItem);
                  setPreviewItem(null);
                  setPreviewZoom(1);
                }}
                className="px-6 py-3 rounded-lg bg-green-600 hover:bg-green-500 text-white font-medium transition-colors flex items-center justify-center gap-2"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {t("historyPanel.insertToCanvas")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
