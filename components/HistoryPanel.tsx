import React from "react";
import { authLogout, historyDelete, historyList, type HistoryItem } from "../services/apiService";

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

export const HistoryPanel: React.FC<Props> = ({ isOpen, onClose, onInsert, onLogout, t }) => {
  const [items, setItems] = React.useState<HistoryItem[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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
    if (!cursor) return;
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
  }, [cursor]);

  React.useEffect(() => {
    if (isOpen) loadFirstPage();
  }, [isOpen, loadFirstPage]);

  const handleDelete = async (id: string) => {
    if (!window.confirm("确定删除这条历史记录吗？")) return;
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

  if (!isOpen) return null;

  return (
    <div
      className="absolute top-4 right-4 z-30 flex flex-col w-80 h-[calc(100vh-2rem)] backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl text-white overflow-hidden"
      style={{ backgroundColor: "var(--ui-bg-color)" }}
    >
      <div className="flex-shrink-0 flex justify-between items-center p-3 border-b border-white/10">
        <h3 className="text-base font-semibold">History</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={loadFirstPage}
            className="text-gray-300 hover:text-white p-1.5 rounded-full hover:bg-white/10"
            title={t("toolbar.redo")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <polyline points="21 3 21 9 15 9" />
            </svg>
          </button>
          <button
            onClick={handleLogout}
            className="text-gray-300 hover:text-white p-1.5 rounded-full hover:bg-white/10"
            title="切换密钥"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M10 17l1 1 7-7-7-7-1 1" />
              <path d="M14 11H3" />
              <path d="M21 12a9 9 0 0 0-9-9" />
              <path d="M12 21a9 9 0 0 0 9-9" />
            </svg>
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded-full">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      {error && <div className="px-3 py-2 text-sm text-red-300 border-b border-white/10">{error}</div>}

      <div className="flex-grow p-2 overflow-y-auto grid grid-cols-2 gap-2 content-start">
        {items.map((item) => (
          <div key={item.id} className="group relative rounded-lg overflow-hidden border border-white/10 bg-black/10">
            <button
              onClick={() => onInsert(item)}
              className="block w-full aspect-[3/2] overflow-hidden"
              title="插入到画布"
            >
              {item.kind === "video" ? (
                <video
                  src={mediaSrc(item.id)}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                />
              ) : (
                <img src={mediaSrc(item.id)} className="w-full h-full object-cover" />
              )}
            </button>

            <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
              <div className="text-[11px] text-white/80 line-clamp-2">{item.prompt}</div>
            </div>

            <button
              onClick={() => handleDelete(item.id)}
              className="absolute top-1 right-1 p-1 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 hover:bg-red-500/60 transition-opacity"
              title="删除"
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

      <div className="flex-shrink-0 p-2 border-t border-white/10 flex justify-between items-center">
        <button
          onClick={loadMore}
          disabled={!cursor || isLoading}
          className="px-3 py-2 text-sm rounded-md bg-white/10 hover:bg-white/15 disabled:opacity-50"
        >
          {cursor ? "加载更多" : "没有更多了"}
        </button>
        {isLoading && <span className="text-xs text-gray-400">加载中...</span>}
      </div>
    </div>
  );
};


