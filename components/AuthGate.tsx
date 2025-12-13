import React from "react";

const STORAGE_KEY = "BANANAPOD_USER_KEY";

export function getStoredUserKey(): string {
  try {
    return (localStorage.getItem(STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function setStoredUserKey(userKey: string): void {
  localStorage.setItem(STORAGE_KEY, userKey);
}

export function clearStoredUserKey(): void {
  localStorage.removeItem(STORAGE_KEY);
}

async function authCheck(userKey: string): Promise<void> {
  const res = await fetch("/api/auth/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userKey }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Auth failed (${res.status})`);
  }
}

export const AuthGate: React.FC<{
  title?: string;
  onAuthed: () => void;
}> = ({ title = "请输入访问密钥", onAuthed }) => {
  const [userKey, setUserKey] = React.useState<string>(() => getStoredUserKey());
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    const key = userKey.trim();
    if (!key) {
      setError("请输入密钥");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await authCheck(key);
      setStoredUserKey(key);
      onAuthed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "鉴权失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        className="w-[420px] max-w-[92vw] p-6 rounded-2xl border border-white/10 shadow-2xl text-white"
        style={{ backgroundColor: "var(--ui-bg-color)" }}
      >
        <div className="text-lg font-semibold mb-2">{title}</div>
        <div className="text-sm text-gray-300 mb-4">
          输入后会保存在本地浏览器中（localStorage），下次自动登录。
        </div>

        <input
          type="password"
          value={userKey}
          onChange={(e) => setUserKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="User Key"
          className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-md text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          disabled={isLoading}
          autoFocus
        />

        {error && <div className="text-sm text-red-300 mt-3">{error}</div>}

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            onClick={() => {
              clearStoredUserKey();
              setUserKey("");
            }}
            className="px-3 py-2 text-sm rounded-md bg-white/10 hover:bg-white/15 border border-white/10"
            disabled={isLoading}
          >
            清除本地密钥
          </button>
          <button
            onClick={submit}
            className="px-4 py-2 text-sm rounded-md bg-blue-500 hover:bg-blue-600 disabled:opacity-60"
            disabled={isLoading}
          >
            {isLoading ? "验证中..." : "进入"}
          </button>
        </div>
      </div>
    </div>
  );
};


