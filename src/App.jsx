import { useState, useRef, useEffect, useMemo, useCallback, createContext, useContext } from "react";
import React from "react";

// ─────────────────────────────────────────────────────────────────────────────
//  CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  SUPABASE_ANON: import.meta.env.VITE_SUPABASE_ANON_KEY,
  KATEX_VERSION: "0.16.9",
  SESSION_KEY: "gid_ns4_session",
  DB_NAME: "GidNS4DB",
  DB_VERSION: 1,
  STORE_SCANS: "scans",
  MAX_IMAGE_SIZE: 800,
  IMAGE_QUALITY: 0.6,
  MAX_HISTORY_ENTRIES: 50,
  SPLASH_DURATION: 1800,
  QUIZ_ROUND_SIZE: 10,
  MAX_HEARTS: 3,
  COLORS: {
    primary: "linear-gradient(135deg,#d4002a,#ff6b35)",
    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4444",
    info: "#3b82f6",
    background: "#070d1f",
    surface: "#0a0f2e",
    surfaceLight: "#0f1e4a",
    text: "#e0e8ff",
    textMuted: "#93c5fd",
  },
  MENTIONS: [
    { min: 16, label: "Excellent", color: "#22c55e", bg: "#14532d33", border: "#22c55e44", emoji: "🏆" },
    { min: 14, label: "Bien", color: "#3b82f6", bg: "#1e3a8a33", border: "#3b82f644", emoji: "⭐" },
    { min: 12, label: "Assez Bien", color: "#f59e0b", bg: "#78350f33", border: "#f59e0b44", emoji: "👍" },
    { min: 10, label: "Passable", color: "#f97316", bg: "#7c2d1233", border: "#f9731644", emoji: "📖" },
    { min: 0, label: "Insuffisant", color: "#ef4444", bg: "#7f1d1d33", border: "#ef444444", emoji: "📚" },
  ],
};

const API = `${CONFIG.SUPABASE_URL}/functions/v1/ask-prof-lakay`;

// ─────────────────────────────────────────────────────────────────────────────
//  CONTEXTS
// ─────────────────────────────────────────────────────────────────────────────

const UserContext = createContext(null);
const ThemeContext = createContext(CONFIG.COLORS);

// ─────────────────────────────────────────────────────────────────────────────
//  HOOKS PERSONNALISÉS
// ─────────────────────────────────────────────────────────────────────────────

function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback((value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.warn(`Error setting localStorage key "${key}":`, error);
    }
  }, [key, storedValue]);

  return [storedValue, setValue];
}

function useIndexedDB() {
  const openDB = useCallback(() => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(CONFIG.STORE_SCANS)) {
          const store = db.createObjectStore(CONFIG.STORE_SCANS, { keyPath: "id", autoIncrement: true });
          store.createIndex("phone", "phone", { unique: false });
          store.createIndex("phone_date", ["phone", "scanDate"], { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }, []);

  const saveScan = useCallback(async (phone, entry) => {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.STORE_SCANS, "readwrite");
        tx.objectStore(CONFIG.STORE_SCANS).add({ ...entry, phone, id: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn("IndexedDB indisponible, fallback localStorage", err);
      return fallbackSave(phone, entry);
    }
  }, [openDB]);

  const getScans = useCallback(async (phone, limit = CONFIG.MAX_HISTORY_ENTRIES) => {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.STORE_SCANS, "readonly");
        const store = tx.objectStore(CONFIG.STORE_SCANS);
        const results = [];
        const req = store.openCursor(null, "prev");
        
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor || results.length >= limit) {
            resolve(results);
            return;
          }
          if (cursor.value.phone === phone) results.push(cursor.value);
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn("IndexedDB lecture échouée, fallback localStorage", err);
      return fallbackGet(phone);
    }
  }, [openDB]);

  const deleteScan = useCallback(async (id) => {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.STORE_SCANS, "readwrite");
        tx.objectStore(CONFIG.STORE_SCANS).delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn("IndexedDB suppression échouée", err);
      return false;
    }
  }, [openDB]);

  const fallbackSave = useCallback((phone, entry) => {
    try {
      const hist = fallbackGet(phone);
      hist.unshift({ ...entry, image: null, _fallback: true, id: Date.now() });
      localStorage.setItem(`history_${phone}`, JSON.stringify(hist.slice(0, 20)));
      return true;
    } catch {
      return false;
    }
  }, []);

  const fallbackGet = useCallback((phone) => {
    try {
      return JSON.parse(localStorage.getItem(`history_${phone}`) || "[]");
    } catch {
      return [];
    }
  }, []);

  return { saveScan, getScans, deleteScan };
}

function useApi() {
  const callEdge = useCallback(async (payload) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch(API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${CONFIG.SUPABASE_ANON}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      const data = await res.json();
      
      if (!res.ok) {
        throw { status: res.status, ...data };
      }
      
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        throw { name: "AbortError" };
      }
      throw err;
    }
  }, []);

  return { callEdge };
}

function useQuiz(user) {
  const [grades, setGrades] = useLocalStorage(`grades_${user?.phone}`, {});

  const saveGrade = useCallback((subject, note20, score, total) => {
    if (!user?.phone) return;
    
    setGrades(prev => {
      const newGrades = { ...prev };
      if (!newGrades[subject]) newGrades[subject] = [];
      newGrades[subject].push({
        note20, score, total,
        date: new Date().toLocaleDateString("fr-HT", { timeZone: "America/Port-au-Prince" }),
        ts: Date.now(),
      });
      newGrades[subject] = newGrades[subject].slice(-10);
      return newGrades;
    });
  }, [user?.phone, setGrades]);

  const getMention = useCallback((note20) => {
    return CONFIG.MENTIONS.find(m => note20 >= m.min) || CONFIG.MENTIONS[CONFIG.MENTIONS.length - 1];
  }, []);

  const scoreToNote20 = useCallback((score, total) => {
    if (total === 0) return 0;
    return Math.round((score / total) * 20 * 10) / 10;
  }, []);

  return { grades, saveGrade, getMention, scoreToNote20 };
}

function useImageCompression() {
  const compressImage = useCallback((base64, maxSize = CONFIG.MAX_IMAGE_SIZE, quality = CONFIG.IMAGE_QUALITY) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => resolve(base64);
      img.src = base64;
    });
  }, []);

  return { compressImage };
}

// ─────────────────────────────────────────────────────────────────────────────
//  GESTION D'ERREURS
// ─────────────────────────────────────────────────────────────────────────────

function useErrorHandler() {
  const parseApiError = useCallback((err) => {
    if (err instanceof TypeError && err.message.includes("fetch")) {
      return { type: "network", message: "Koneksyon an pa bon, eseye ankò !", detail: "Verifye entènèt ou epi eseye ankò.", icon: "📶", retry: true };
    }
    if (err?.status === 429 || err?.quotaExceeded) {
      return { type: "quota", message: "Ou rive nan limit scan ou pou jodi a !", detail: "Tounen demen pou kontinye.", icon: "🔒", retry: false };
    }
    if (err?.status === 403) {
      return { type: "auth", message: err?.error || "Aksè refize. Kontakte direksyon lekòl ou.", detail: null, icon: "🚫", retry: false };
    }
    if (err?.status >= 500) {
      return { type: "server", message: "Koneksyon an pa bon, eseye ankò !", detail: "Sèvè a gen yon pwoblèm. Eseye nan kèk minit.", icon: "🔧", retry: true };
    }
    if (err?.name === "AbortError") {
      return { type: "timeout", message: "Koneksyon an pa bon, eseye ankò !", detail: "Demann an pran twò lontan. Verifye entènèt ou.", icon: "⏱️", retry: true };
    }
    if (err?.error) {
      return { type: "api", message: err.error, detail: null, icon: "⚠️", retry: false };
    }
    return { type: "unknown", message: "Koneksyon an pa bon, eseye ankò !", detail: null, icon: "⚠️", retry: true };
  }, []);

  return { parseApiError };
}

// ─────────────────────────────────────────────────────────────────────────────
//  COMPOSANTS RÉUTILISABLES
// ─────────────────────────────────────────────────────────────────────────────

const LoadingDots = React.memo(({ color = "#3b82f6" }) => (
  <div className="flex gap-1.5 items-center">
    {[0, 1, 2].map(i => (
      <div
        key={i}
        className="w-2 h-2 rounded-full"
        style={{
          backgroundColor: color,
          animation: `bounce 1s ${i * 0.2}s infinite`
        }}
      />
    ))}
  </div>
));

const BottomNav = React.memo(({ active, onNavigate }) => {
  const tabs = useMemo(() => [
    { id: "chat", icon: "💬", label: "Chat" },
    { id: "quiz", icon: "🧠", label: "Quiz" },
    { id: "leaderboard", icon: "🏆", label: "Klasman" },
    { id: "history", icon: "📋", label: "Istwa" },
    { id: "menu", icon: "☰", label: "Menu" },
  ], []);

  return (
    <nav className="flex border-t" style={{ background: CONFIG.COLORS.surface, borderColor: "#ffffff10" }}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onNavigate(tab.id)}
          className="flex-1 flex flex-col items-center py-2 gap-0.5 active:scale-90 transition-transform"
          aria-label={tab.label}
          aria-current={active === tab.id ? "page" : undefined}
        >
          <span style={{ fontSize: 18 }}>{tab.icon}</span>
          <span style={{ fontSize: 9, fontWeight: 600, color: active === tab.id ? "#ff6b35" : "#4b5ea8" }}>
            {tab.label}
          </span>
          {active === tab.id && (
            <div className="w-3 h-0.5 rounded-full" style={{ background: "#ff6b35" }} />
          )}
        </button>
      ))}
    </nav>
  );
});

const ExpiryBanner = React.memo(({ daysRemaining }) => {
  if (!daysRemaining || daysRemaining > 7) return null;
  const isUrgent = daysRemaining <= 2;
  
  return (
    <div
      className="px-4 py-2 text-xs text-center font-semibold"
      style={{
        background: isUrgent ? CONFIG.COLORS.primary : "#92400e",
        color: "white"
      }}
      role="alert"
    >
      {isUrgent ? "🚨" : "⚠️"} Kòd ou a ekspire nan {daysRemaining} jou — Kontakte direksyon lekòl ou
    </div>
  );
});

const ErrorToast = React.memo(({ error, onRetry, onDismiss }) => {
  if (!error) return null;
  const canRetry = error.retry && onRetry;
  const isQuota = error.type === "quota";

  return (
    <div
      className="mx-3 mb-2 px-4 py-3 rounded-2xl flex gap-3 items-start"
      style={{
        background: isQuota ? "#1e3a8a22" : "#7f1d1d33",
        border: `1px solid ${isQuota ? "#3b82f644" : "#ef444444"}`,
        animation: "fadeIn .3s ease both"
      }}
      role="alert"
    >
      <span style={{ fontSize: 20, flexShrink: 0 }}>{error.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm" style={{ color: isQuota ? "#93c5fd" : "#fca5a5" }}>
          {error.message}
        </p>
        {error.detail && (
          <p className="text-xs mt-0.5" style={{ color: isQuota ? "#6080c0" : "#f87171" }}>
            {error.detail}
          </p>
        )}
        <div className="flex gap-2 mt-2">
          {canRetry && (
            <button
              onClick={onRetry}
              className="px-3 py-1 rounded-lg text-xs font-bold text-white"
              style={{ background: CONFIG.COLORS.primary }}
            >
              🔄 Eseye Ankò
            </button>
          )}
          <button
            onClick={onDismiss}
            className="px-3 py-1 rounded-lg text-xs font-semibold"
            style={{ background: "#ffffff15", color: "#94a3b8" }}
          >
            Fèmen
          </button>
        </div>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  KATEX
// ─────────────────────────────────────────────────────────────────────────────

let katexReady = false;
let katexQueue = [];

function ensureKatex() {
  if (katexReady) return Promise.resolve();
  if (document.getElementById("katex-css")) {
    return new Promise(r => katexQueue.push(r));
  }

  const link = document.createElement("link");
  link.id = "katex-css";
  link.rel = "stylesheet";
  link.href = `https://cdn.jsdelivr.net/npm/katex@${CONFIG.KATEX_VERSION}/dist/katex.min.css`;
  document.head.appendChild(link);

  const script = document.createElement("script");
  script.src = `https://cdn.jsdelivr.net/npm/katex@${CONFIG.KATEX_VERSION}/dist/katex.min.js`;
  script.onload = () => {
    katexReady = true;
    katexQueue.forEach(r => r());
    katexQueue = [];
  };
  document.head.appendChild(script);

  return new Promise(r => katexQueue.push(r));
}

const LatexText = React.memo(({ content }) => {
  const [html, setHtml] = useState(null);
  const hasLatex = useMemo(() => /\$/.test(content), [content]);

  useEffect(() => {
    if (!hasLatex) {
      setHtml(null);
      return;
    }

    let cancelled = false;

    ensureKatex().then(() => {
      if (cancelled) return;
      try {
        const result = content
          .replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
            try {
              return window.katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false });
            } catch {
              return `<code class="katex-fallback">${expr}</code>`;
            }
          })
          .replace(/\$([^$\n]+?)\$/g, (_, expr) => {
            try {
              return window.katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false });
            } catch {
              return `<code class="katex-fallback">${expr}</code>`;
            }
          });
        setHtml(result);
      } catch {
        setHtml(null);
      }
    });

    return () => { cancelled = true; };
  }, [content, hasLatex]);

  if (html) {
    return (
      <span
        dangerouslySetInnerHTML={{ __html: html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") }}
        style={{ lineHeight: 1.7 }}
      />
    );
  }

  return (
    <span>
      {content.split("\n").map((line, i, arr) => (
        <span key={i}>
          <span
            dangerouslySetInnerHTML={{
              __html: line
                .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                .replace(/\$\$?([\s\S]+?)\$?\$/g, (_, e) =>
                  `<code style="background:#0d2244;color:#93c5fd;padding:1px 4px;border-radius:4px;font-family:monospace;font-size:.85em">${e}</code>`
                ),
            }}
          />
          {i < arr.length - 1 && <br />}
        </span>
      ))}
    </span>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  SPLASH SCREEN
// ─────────────────────────────────────────────────────────────────────────────

const SplashScreen = React.memo(({ onDone }) => {
  useEffect(() => {
    const timer = setTimeout(onDone, CONFIG.SPLASH_DURATION);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center"
      style={{ background: "linear-gradient(160deg,#0a0f2e,#0d1b4b,#1a0505)" }}
    >
      <div style={{ animation: "popIn .6s cubic-bezier(.34,1.56,.64,1) both" }}>
        <div
          className="w-24 h-24 rounded-3xl flex items-center justify-center mb-5 mx-auto"
          style={{ background: CONFIG.COLORS.primary, boxShadow: "0 0 60px #d4002a55" }}
        >
          <span style={{ fontSize: 48 }}>📚</span>
        </div>
        <h1 className="text-center font-black text-white" style={{ fontSize: 36, fontFamily: "Georgia,serif" }}>
          Gid <span style={{ color: "#ff6b35" }}>NS4</span>
        </h1>
        <p className="text-center text-blue-300 mt-1 text-sm tracking-widest uppercase">
          Prof Lakay • NS4 Haïti
        </p>
      </div>
      <div className="absolute bottom-12 flex gap-2">
        <LoadingDots />
      </div>
      <style>{`
        @keyframes popIn{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}
        @keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
      `}</style>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  LOGIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

const LoginScreen = React.memo(({ onLogin, onNavigate }) => {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { callEdge } = useApi();
  const { parseApiError } = useErrorHandler();

  const handleLogin = useCallback(async () => {
    setError("");
    
    if (!phone.trim() || phone.length < 8) {
      setError("Antre yon nimewo telefòn valid.");
      return;
    }
    if (!code.trim()) {
      setError("Antre kòd lekòl ou a.");
      return;
    }

    setLoading(true);
    try {
      const result = await callEdge({
        action: "validate_code",
        phone: phone.trim(),
        schoolCode: code.toUpperCase().trim(),
      });

      if (!result.valid) {
        setError(result.reason || "Kòd la pa valid.");
        setLoading(false);
        return;
      }

      onLogin({
        phone: phone.trim(),
        code: code.toUpperCase().trim(),
        school: result.school.name,
        subjects: result.school.subjects,
        dailyScans: result.school.dailyScans,
        daysRemaining: result.school.daysRemaining,
        expiresAt: result.school.expiresAt,
        scansToday: result.scansToday,
      });
    } catch (e) {
      setError(parseApiError(e).message);
    }
    setLoading(false);
  }, [phone, code, callEdge, parseApiError, onLogin]);

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ background: "linear-gradient(160deg,#0a0f2e,#0d1b4b,#1a0505)" }}
    >
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: CONFIG.COLORS.primary, boxShadow: "0 0 40px #d4002a44" }}
        >
          <span style={{ fontSize: 32 }}>📚</span>
        </div>
        <h2 className="text-white font-black text-2xl mb-1" style={{ fontFamily: "Georgia,serif" }}>
          Gid <span style={{ color: "#ff6b35" }}>NS4</span>
        </h2>
        <p className="text-blue-300 text-xs mb-6 tracking-wider">Asistan IA pou elèv NS4</p>
        
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl mb-6"
          style={{ background: "#14532d33", border: "1px solid #22c55e33" }}
        >
          <span>🔒</span>
          <span className="text-green-300 text-xs font-medium">Koneksyon sécurisé • Données protégées</span>
        </div>

        <div className="w-full max-w-sm space-y-4">
          <div>
            <label htmlFor="phone" className="text-blue-300 text-xs font-semibold tracking-wider uppercase mb-1.5 block">
              📱 Nimewo Telefòn
            </label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="Ex: 50934567890"
              className="w-full rounded-xl px-4 py-3.5 text-white placeholder-blue-800 font-medium outline-none"
              style={{ background: "#ffffff0d", border: "1.5px solid #ffffff18" }}
              aria-label="Numéro de téléphone"
            />
          </div>
          
          <div>
            <label htmlFor="code" className="text-blue-300 text-xs font-semibold tracking-wider uppercase mb-1.5 block">
              🔑 Kòd Etablisman
            </label>
            <input
              id="code"
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="Ex: DEMO-2026"
              className="w-full rounded-xl px-4 py-3.5 text-white placeholder-blue-800 font-mono font-bold outline-none tracking-widest"
              style={{ background: "#ffffff0d", border: "1.5px solid #ffffff18" }}
              aria-label="Code d'établissement"
            />
          </div>

          {error && (
            <div
              className="rounded-xl px-4 py-3 text-sm font-medium"
              style={{ background: "#d4002a22", border: "1px solid #d4002a55", color: "#ff8080" }}
              role="alert"
            >
              ⚠️ {error}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full rounded-xl py-4 font-black text-white flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: loading ? "#333" : CONFIG.COLORS.primary,
              boxShadow: loading ? "none" : "0 4px 24px #d4002a44",
            }}
          >
            {loading ? "⏳ Ap vérifier..." : "→ Konekte"}
          </button>
        </div>

        <p className="text-blue-900 text-xs mt-8 text-center">
          Pa gen kòd ? Pale ak direksyon lekòl ou a.
        </p>
      </div>

      <div className="px-6 pb-6 flex justify-center gap-6">
        <button onClick={() => onNavigate("payment")} className="text-blue-400 text-xs underline">
          Peman
        </button>
        <button onClick={() => onNavigate("partner")} className="text-blue-400 text-xs underline">
          Vin Patnè
        </button>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  CHAT SCREEN
// ─────────────────────────────────────────────────────────────────────────────

const ChatMessage = React.memo(({ msg, isUser }) => {
  const colors = useContext(ThemeContext);

  return (
    <div
      className="flex gap-2"
      style={{ justifyContent: isUser ? "flex-end" : "flex-start", animation: "fadeIn .3s ease both" }}
    >
      {!isUser && (
        <div
          className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center mt-1"
          style={{ background: colors.primary }}
        >
          <span style={{ fontSize: 16 }}>🧑‍🏫</span>
        </div>
      )}
      <div className="max-w-xs">
        {msg.image && (
          <img
            src={msg.image}
            alt="scan"
            className="rounded-xl mb-2 max-h-40 object-contain"
            style={{ border: "1px solid #ffffff20" }}
            loading="lazy"
          />
        )}
        <div
          className="px-4 py-3 text-sm leading-relaxed"
          style={{
            background: isUser ? "linear-gradient(135deg,#1a4fd6,#2563eb)" : colors.surfaceLight,
            border: !isUser ? "1px solid #1e3a8a33" : "none",
            color: colors.text,
            borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
          }}
        >
          <LatexText content={msg.content} />
        </div>
      </div>
    </div>
  );
});

const ChatScreen = React.memo(({ user, onNavigate }) => {
  const [messages, setMessages] = useState([{
    role: "assistant",
    content: `Bonjou ! Mwen se **Prof Lakay** 👋\n\nJe suis ton assistant IA pour le **Bac NS4**.\n\n📚 Matières disponibles pour toi :\n${user.subjects.map(s => `• ${s}`).join("\n")}\n\n**An n al travay ! 💪**`
  }]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scans, setScans] = useState(user.scansToday || 0);
  const [apiError, setApiError] = useState(null);
  const [lastPayload, setLastPayload] = useState(null);
  const [activeSubject, setActiveSubject] = useState(user.subjects[0] || null);
  
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const textareaRef = useRef(null);
  
  const { callEdge } = useApi();
  const { parseApiError } = useErrorHandler();
  const { saveScan } = useIndexedDB();
  const { compressImage } = useImageCompression();

  const remaining = useMemo(() => user.dailyScans - scans, [user.dailyScans, scans]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const detectSubject = useCallback((text) => {
    const t = text.toLowerCase();
    if (t.includes("bio") || t.includes("cellule") || t.includes("adn")) return "Biologie";
    if (t.includes("chim") || t.includes("molécule") || t.includes("acide")) return "Chimie";
    if (t.includes("physi") || t.includes("vitesse") || t.includes("force")) return "Physique";
    if (t.includes("philo") || t.includes("socrate")) return "Philosophie";
    if (t.includes("social") || t.includes("haïti")) return "Sciences Sociales";
    if (t.includes("littér") || t.includes("roman")) return "Littérature Haïtienne";
    return user.subjects[0] || "Général";
  }, [user.subjects]);

  const sendMessage = useCallback(async (retryPayload = null) => {
    const payload = retryPayload || {
      userMsg: { role: "user", content: input.trim() || "Analyse cet exercice.", image },
      currentInput: input.trim()
    };

    if ((!payload.currentInput && !payload.userMsg.image) || loading || remaining <= 0) return;

    if (!retryPayload) {
      setMessages(p => [...p, payload.userMsg]);
      setInput("");
      setImage(null);
      
      // Auto-resize textarea
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }

    setApiError(null);
    setLoading(true);

    try {
      const detectedSubject = activeSubject || detectSubject(payload.currentInput);
      const result = await callEdge({
        action: "ask",
        phone: user.phone,
        schoolCode: user.code,
        message: payload.userMsg.content,
        imageBase64: payload.userMsg.image ? payload.userMsg.image.split(",")[1] : null,
        history: messages.slice(-6),
        subject: detectedSubject,
      });

      setMessages(p => [...p, { role: "assistant", content: result.reply }]);
      setScans(result.scansUsed || scans + 1);
      setLastPayload(null);

      await saveScan(user.phone, {
        date: new Date().toLocaleString("fr-HT", { timeZone: "America/Port-au-Prince" }),
        scanDate: new Date().toISOString().split("T")[0],
        subject: detectedSubject,
        image: payload.userMsg.image || null,
        response: result.reply,
        scansUsed: result.scansUsed,
        dailyLimit: user.dailyScans,
      });
    } catch (e) {
      const parsed = parseApiError(e);
      if (parsed.type === "quota") setScans(user.dailyScans);
      setApiError(parsed);
      if (parsed.retry) setLastPayload(payload);
    }
    setLoading(false);
  }, [input, image, loading, remaining, activeSubject, user, callEdge, detectSubject, messages, parseApiError, saveScan, scans]);

  const handleImage = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const compressed = await compressImage(ev.target.result);
      setImage(compressed);
    };
    reader.readAsDataURL(file);
  }, [compressImage]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  const handleTextareaChange = useCallback((e) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 80)}px`;
  }, []);

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: CONFIG.COLORS.background }}>
      <ExpiryBanner daysRemaining={user.daysRemaining} />
      
      <header
        className="flex items-center gap-3 px-4 py-3 border-b"
        style={{ background: CONFIG.COLORS.surface, borderColor: "#ffffff10" }}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: CONFIG.COLORS.primary }}
        >
          <span style={{ fontSize: 20 }}>🧑‍🏫</span>
        </div>
        <div className="flex-1">
          <div className="text-white font-bold text-sm">Prof Lakay</div>
          <div className="flex items-center gap-1.5">
            <span className="text-green-400 text-xs">● En ligne</span>
            <span className="text-green-600 text-xs">• 🔒 Sécurisé</span>
          </div>
        </div>
        <div className="text-right">
          <div
            className={`text-xs font-bold ${
              remaining <= 0 ? "text-red-400" : remaining === 1 ? "text-orange-300" : "text-green-400"
            }`}
          >
            {remaining} scan{remaining !== 1 ? "s" : ""} restant{remaining !== 1 ? "s" : ""}
          </div>
          <div className="text-blue-900 text-xs">/ {user.dailyScans} par jour</div>
        </div>
      </header>

      <div
        className="px-4 py-1.5 flex gap-1.5 overflow-x-auto"
        style={{ background: "#080e22", borderBottom: "1px solid #ffffff08" }}
      >
        {user.subjects.map((s, i) => (
          <button
            key={i}
            onClick={() => setActiveSubject(s)}
            className="flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium transition-all"
            style={{
              background: activeSubject === s ? "#1a4fd6" : "#1e3a8a33",
              color: activeSubject === s ? "#ffffff" : "#93c5fd",
              border: activeSubject === s ? "1px solid #3b82f6" : "1px solid #1e3a8a44",
            }}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {messages.map((msg, i) => (
          <ChatMessage key={i} msg={msg} isUser={msg.role === "user"} />
        ))}
        
        {loading && (
          <div className="flex gap-2 items-start">
            <div
              className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center"
              style={{ background: CONFIG.COLORS.primary }}
            >
              <span style={{ fontSize: 16 }}>🧑‍🏫</span>
            </div>
            <div className="px-4 py-3 rounded-2xl" style={{ background: CONFIG.COLORS.surfaceLight }}>
              <div className="flex gap-1.5 items-center">
                <LoadingDots />
                <span className="text-blue-400 text-xs ml-2">Prof Lakay ap reflechi...</span>
              </div>
            </div>
          </div>
        )}

        {remaining <= 0 && (
          <div
            className="mx-2 px-4 py-3 rounded-2xl text-sm text-center"
            style={{ background: "#d4002a22", border: "1px solid #d4002a44", color: "#ff8080" }}
          >
            🔒 Ou rive nan limit {user.dailyScans} scan pou jodi a. Tounen demen !
          </div>
        )}
        
        <div ref={bottomRef} />
      </div>

      <ErrorToast
        error={apiError}
        onRetry={lastPayload ? () => sendMessage(lastPayload) : null}
        onDismiss={() => { setApiError(null); setLastPayload(null); }}
      />

      <footer
        className="px-3 py-3 border-t"
        style={{ background: CONFIG.COLORS.surface, borderColor: "#ffffff10" }}
      >
        {image && (
          <div className="flex items-center gap-2 mb-2 px-2">
            <img src={image} alt="" className="w-10 h-10 rounded-lg object-cover" />
            <span className="text-blue-300 text-xs flex-1">✅ Image compressée et prête</span>
            <button
              onClick={() => setImage(null)}
              className="text-red-400 text-lg"
              aria-label="Supprimer l'image"
            >
              ✕
            </button>
          </div>
        )}

        <div className="flex gap-2 items-end">
          <button
            onClick={() => fileRef.current?.click()}
            className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center"
            style={{ background: "#1e3a8a" }}
            aria-label="Ajouter une image"
          >
            <span>📷</span>
          </button>
          
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleImage}
            className="hidden"
            aria-hidden="true"
          />

          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={remaining <= 0 ? "Limit jou a rive..." : "Poze yon kesyon oswa analize yon egzèsis..."}
            rows={1}
            disabled={remaining <= 0}
            className="flex-1 rounded-xl px-4 py-3 text-sm outline-none resize-none"
            style={{
              background: "#ffffff0d",
              border: "1.5px solid #ffffff15",
              maxHeight: 80,
              color: CONFIG.COLORS.text,
            }}
          />

          <button
            onClick={() => sendMessage()}
            disabled={loading || remaining <= 0}
            className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center disabled:opacity-50"
            style={{
              background: (loading || remaining <= 0) ? "#1a1a2e" : CONFIG.COLORS.primary,
            }}
            aria-label="Envoyer le message"
          >
            <span>✈</span>
          </button>
        </div>
      </footer>

      <BottomNav active="chat" onNavigate={onNavigate} />
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  QUIZ SCREEN (version optimisée)
// ─────────────────────────────────────────────────────────────────────────────

import { QUIZ_DATA } from "./quizData.js";

const QuizSelect = React.memo(({ availableSubjects, onStartQCM, onOpenQuestion }) => {
  const icons = useMemo(() => ["📗", "⚗️", "⚡", "📖", "🌍", "✍️", "📚"], []);
  const subjectIcons = useMemo(() => {
    return availableSubjects.reduce((acc, s, i) => {
      acc[s] = icons[i % icons.length];
      return acc;
    }, {});
  }, [availableSubjects, icons]);

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: CONFIG.COLORS.background }}>
      <div
        className="px-4 py-4 border-b flex items-center gap-3"
        style={{ background: CONFIG.COLORS.surface, borderColor: "#ffffff10" }}
      >
        <span style={{ fontSize: 24 }}>🧠</span>
        <div>
          <h2 className="text-white font-bold">Quiz NS4</h2>
          <p className="text-blue-400 text-xs">
            {availableSubjects.length} matière{availableSubjects.length > 1 ? "s" : ""} disponib
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <div
          className="rounded-2xl px-4 py-3 flex items-center gap-3"
          style={{ background: "#1a4fd622", border: "1px solid #1a4fd644" }}
        >
          <span style={{ fontSize: 20 }}>❤️❤️❤️</span>
          <div>
            <div className="text-white font-semibold text-xs">Mode Duolingo — 3 kè</div>
            <div className="text-blue-400 text-xs">Kesyon enfini • Jwe jouk ou pèdi 3 kè</div>
          </div>
        </div>

        <button
          onClick={onOpenQuestion}
          className="w-full px-5 py-4 rounded-2xl text-left flex items-center gap-4 active:scale-95 transition-transform"
          style={{ background: "linear-gradient(135deg,#1a4fd6,#2563eb)", boxShadow: "0 4px 20px #1a4fd633" }}
        >
          <span style={{ fontSize: 28 }}>✍️</span>
          <div>
            <div className="text-white font-bold">Question Ouverte</div>
            <div className="text-blue-200 text-xs">Skriv repons ou, Prof Lakay ap korije l</div>
          </div>
          <span className="ml-auto text-blue-300 text-xl">›</span>
        </button>

        <p className="text-blue-600 text-xs text-center py-1">— oswa chwazi yon matière pou QCM —</p>

        {availableSubjects.map(sub => (
          <button
            key={sub}
            onClick={() => onStartQCM(sub)}
            className="w-full px-5 py-4 rounded-2xl text-left flex items-center gap-4 active:scale-95 transition-transform"
            style={{ background: CONFIG.COLORS.surfaceLight, border: "1px solid #1e3a8a33" }}
          >
            <span style={{ fontSize: 26 }}>{subjectIcons[sub]}</span>
            <div className="flex-1">
              <div className="text-white font-semibold text-sm">{sub}</div>
              <div className="text-blue-500 text-xs">{QUIZ_DATA[sub].length} kesyon • Mode infini 🔄</div>
            </div>
            <span className="text-blue-600 text-xl">›</span>
          </button>
        ))}
      </div>
    </div>
  );
});

const QuizOpenQuestion = React.memo(({ onBack }) => {
  const [openQ, setOpenQ] = useState("");
  const [openAnswer, setOpenAnswer] = useState("");
  const [aiCorrection, setAiCorrection] = useState("");
  const [loadingAI, setLoadingAI] = useState(false);
  const { callEdge } = useApi();
  const { parseApiError } = useErrorHandler();

  const submitOpen = useCallback(async () => {
    if (!openQ.trim() || !openAnswer.trim()) return;
    
    setLoadingAI(true);
    setAiCorrection("");
    
    try {
      const result = await callEdge({
        action: "ask",
        phone: "quiz-user",
        schoolCode: "QUIZ",
        message: `Corrige la réponse de cet élève NS4.\n\nQuestion : ${openQ}\n\nRéponse de l'élève : ${openAnswer}\n\nDonne une note /10, identifie les erreurs et donne la bonne réponse complète.`,
        imageBase64: null,
        history: [],
        subject: "Général",
      });
      setAiCorrection(result.reply);
    } catch (e) {
      setAiCorrection(`${parseApiError(e).icon} ${parseApiError(e).message}`);
    }
    setLoadingAI(false);
  }, [openQ, openAnswer, callEdge, parseApiError]);

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: CONFIG.COLORS.background }}>
      <div
        className="px-4 py-4 border-b flex items-center gap-3"
        style={{ background: CONFIG.COLORS.surface, borderColor: "#ffffff10" }}
      >
        <button onClick={onBack} className="text-blue-400 text-xl">
          ←
        </button>
        <h2 className="text-white font-bold">Question Ouverte ✍️</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
        <div>
          <label htmlFor="question" className="text-blue-300 text-xs font-semibold tracking-wider uppercase mb-2 block">
            Ta Kesyon
          </label>
          <textarea
            id="question"
            value={openQ}
            onChange={e => setOpenQ(e.target.value)}
            rows={3}
            placeholder="Ex: Expliquez le cycle de Krebs..."
            className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none"
            style={{ background: CONFIG.COLORS.surfaceLight, border: "1.5px solid #1e3a8a44", color: CONFIG.COLORS.text }}
          />
        </div>

        <div>
          <label htmlFor="answer" className="text-blue-300 text-xs font-semibold tracking-wider uppercase mb-2 block">
            Repons Ou
          </label>
          <textarea
            id="answer"
            value={openAnswer}
            onChange={e => setOpenAnswer(e.target.value)}
            rows={5}
            placeholder="Ekri repons ou isit..."
            className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none"
            style={{ background: CONFIG.COLORS.surfaceLight, border: "1.5px solid #1e3a8a44", color: CONFIG.COLORS.text }}
          />
        </div>

        <button
          onClick={submitOpen}
          disabled={loadingAI || !openQ.trim() || !openAnswer.trim()}
          className="w-full py-4 rounded-xl font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: loadingAI ? "#333" : CONFIG.COLORS.primary }}
        >
          {loadingAI ? (
            <>
              <span className="animate-spin">⏳</span> Prof Lakay ap korije...
            </>
          ) : (
            "🧑‍🏫 Voye bay Prof Lakay"
          )}
        </button>

        {aiCorrection && (
          <div
            className="rounded-2xl p-4"
            style={{ background: CONFIG.COLORS.surfaceLight, border: "1px solid #1e3a8a33", animation: "fadeIn .4s ease both" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-7 h-7 rounded-xl flex items-center justify-center"
                style={{ background: CONFIG.COLORS.primary }}
              >
                <span style={{ fontSize: 14 }}>🧑‍🏫</span>
              </div>
              <span className="text-white font-bold text-sm">Kòreksyon Prof Lakay</span>
            </div>
            <div className="text-sm leading-relaxed" style={{ color: CONFIG.COLORS.text }}>
              <LatexText content={aiCorrection} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

const QuizQCM = React.memo(({
  subject,
  currentQ,
  qIndex,
  totalQs,
  selected,
  hearts,
  streak,
  round,
  totalAnswered,
  score,
  onChoice,
  onNext,
  onBack
}) => {
  const [shaking, setShaking] = useState(false);

  const handleChoice = useCallback((idx) => {
    if (selected !== null) return;
    onChoice(idx);
    if (idx !== currentQ.answer) {
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
    }
  }, [selected, currentQ?.answer, onChoice]);

  if (!currentQ) return null;

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: CONFIG.COLORS.background }}>
      <header
        className="px-4 py-3 border-b"
        style={{ background: CONFIG.COLORS.surface, borderColor: "#ffffff10" }}
      >
        <div className="flex items-center gap-3 mb-2">
          <button onClick={onBack} className="text-blue-400 text-xl">
            ←
          </button>
          <h2 className="text-white font-bold flex-1 text-sm">{subject}</h2>
          
          {streak >= 2 && (
            <div
              className="flex items-center gap-1 px-2 py-0.5 rounded-full"
              style={{ background: "#f9731633", border: "1px solid #f9731644" }}
            >
              <span style={{ fontSize: 14 }}>🔥</span>
              <span className="text-orange-400 font-black text-sm">{streak}</span>
            </div>
          )}

          <div className="flex gap-1" style={{ animation: shaking ? "shake .4s ease" : "none" }}>
            {[0, 1, 2].map(i => (
              <span
                key={i}
                style={{
                  fontSize: 20,
                  opacity: i < hearts ? 1 : 0.15,
                  filter: i < hearts ? "none" : "grayscale(1)",
                }}
              >
                ❤️
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-blue-500 text-xs">Wònn {round} • {totalAnswered} kesyon</span>
          <span className="text-green-400 text-xs font-bold">{score} ✅</span>
        </div>

        <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: CONFIG.COLORS.surfaceLight }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: totalAnswered > 0 ? `${(score / totalAnswered) * 100}%` : "0%",
              background: "linear-gradient(90deg,#22c55e,#86efac)",
            }}
          />
        </div>
      </header>

      <div className="flex-1 px-4 py-5 flex flex-col gap-4 overflow-y-auto">
        <div
          className="rounded-2xl px-5 py-5"
          style={{ background: CONFIG.COLORS.surfaceLight, border: "1px solid #1e3a8a33" }}
        >
          <p className="text-white font-semibold text-base leading-relaxed">{currentQ.q}</p>
        </div>

        <div className="space-y-3">
          {currentQ.choices.map((choice, idx) => {
            let bg = CONFIG.COLORS.surfaceLight;
            let border = "#1e3a8a33";
            let color = CONFIG.COLORS.text;

            if (selected !== null) {
              if (idx === currentQ.answer) {
                bg = "#14532d33";
                border = "#22c55e66";
                color = "#86efac";
              } else if (idx === selected) {
                bg = "#7f1d1d33";
                border = "#ef444466";
                color = "#fca5a5";
              }
            }

            return (
              <button
                key={idx}
                onClick={() => handleChoice(idx)}
                className="w-full px-5 py-4 rounded-2xl text-left font-medium text-sm flex items-center gap-3 active:scale-95 transition-all disabled:opacity-50"
                style={{ background: bg, border: `1.5px solid ${border}`, color }}
                disabled={selected !== null}
              >
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0"
                  style={{
                    background: selected !== null && idx === currentQ.answer
                      ? "#22c55e"
                      : selected === idx
                      ? "#ef4444"
                      : "#1e3a8a",
                    color: "white",
                  }}
                >
                  {["A", "B", "C", "D"][idx]}
                </span>
                {choice}
                {selected !== null && idx === currentQ.answer && (
                  <span className="ml-auto">✅</span>
                )}
                {selected !== null && idx === selected && idx !== currentQ.answer && (
                  <span className="ml-auto">❌</span>
                )}
              </button>
            );
          })}
        </div>

        {selected !== null && (
          <div style={{ animation: "fadeIn .3s ease both" }}>
            {currentQ.note && (
              <div
                className="rounded-2xl px-4 py-3 mb-3"
                style={{
                  background: selected === currentQ.answer ? "#14532d33" : "#7f1d1d22",
                  border: `1px solid ${selected === currentQ.answer ? "#22c55e33" : "#ef444433"}`,
                }}
              >
                <p
                  className="text-xs leading-relaxed"
                  style={{ color: selected === currentQ.answer ? "#86efac" : "#fca5a5" }}
                >
                  💡 {currentQ.note}
                </p>
              </div>
            )}
            <button
              onClick={onNext}
              className="w-full py-4 rounded-2xl font-bold text-white active:scale-95 transition-transform"
              style={{
                background: hearts <= 0
                  ? "linear-gradient(135deg,#d4002a,#ef4444)"
                  : "linear-gradient(135deg,#1a4fd6,#2563eb)",
              }}
            >
              {hearts <= 0 ? "💔 Wè Rezilta" : "Kesyon Suivant →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

const QuizBravo = React.memo(({
  subject,
  round,
  roundScore,
  score,
  totalAnswered,
  maxStreak,
  streak,
  seenCount,
  allCount,
  hasMore,
  onContinue,
  onBack
}) => {
  const { getMention, scoreToNote20 } = useQuiz();
  const note20 = scoreToNote20(roundScore, 10);
  const mention = getMention(note20);

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center px-6"
      style={{ background: "linear-gradient(160deg,#0a0f2e,#0d1b4b,#1a0505)" }}
    >
      <div className="w-full max-w-sm space-y-5" style={{ animation: "popIn .5s cubic-bezier(.34,1.56,.64,1) both" }}>
        <div className="text-center">
          <div style={{ fontSize: 64 }}>🎉</div>
          <h2 className="text-white font-black text-3xl mt-2">Bravo !</h2>
          <p className="text-blue-300 text-sm mt-1">{subject} • Wònn {round}</p>
        </div>

        <div
          className="rounded-3xl px-5 py-5 text-center"
          style={{ background: mention.bg, border: `2px solid ${mention.border}` }}
        >
          <div style={{ fontSize: 40 }}>{mention.emoji}</div>
          <div className="font-black mt-1" style={{ fontSize: 48, color: mention.color, lineHeight: 1 }}>
            {note20}<span className="text-xl" style={{ color: mention.color + "99" }}>/20</span>
          </div>
          <div className="text-white font-bold text-lg mt-1">{mention.label}</div>
          <div className="text-blue-300 text-sm mt-1">
            {roundScore}/10 kòrèk • {streak > 0 ? `🔥 Streak ${streak}` : ""}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { icon: "✅", val: score, label: "Total kòrèk" },
            { icon: "🔥", val: maxStreak, label: "Max streak" },
            { icon: "📚", val: `${seenCount}/${allCount}`, label: "Kesyon vues" },
          ].map((s, i) => (
            <div
              key={i}
              className="rounded-2xl p-3 text-center"
              style={{ background: CONFIG.COLORS.surfaceLight, border: "1px solid #1e3a8a33" }}
            >
              <div style={{ fontSize: 18 }}>{s.icon}</div>
              <div className="text-white font-black text-base">{s.val}</div>
              <div className="text-blue-500 text-xs">{s.label}</div>
            </div>
          ))}
        </div>

        <p className="text-white font-bold text-center text-lg">Veux-tu kontinye ?</p>

        <div className="flex gap-3">
          <button
            onClick={onContinue}
            disabled={!hasMore && seenCount >= allCount}
            className="flex-1 py-4 rounded-2xl font-black text-white text-lg active:scale-95 transition-transform disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", boxShadow: "0 4px 20px #22c55e44" }}
          >
            ✅ Wi
          </button>
          <button
            onClick={onBack}
            className="flex-1 py-4 rounded-2xl font-black text-lg active:scale-95 transition-transform"
            style={{ background: CONFIG.COLORS.surfaceLight, color: "#93c5fd", border: "1px solid #1e3a8a33" }}
          >
            ❌ Non
          </button>
        </div>

        {!hasMore && seenCount >= allCount && (
          <p className="text-yellow-400 text-xs text-center">
            🏆 Ou fini tout {allCount} kesyon yo ! Bravo !
          </p>
        )}
      </div>
    </div>
  );
});

const QuizGameOver = React.memo(({
  subject,
  score,
  totalAnswered,
  maxStreak,
  wrongAnswers,
  onRestart,
  onBack
}) => {
  const { getMention, scoreToNote20 } = useQuiz();
  const note20 = scoreToNote20(score, totalAnswered);
  const mention = getMention(note20);

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: CONFIG.COLORS.background }}>
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        <div className="text-center" style={{ animation: "popIn .5s cubic-bezier(.34,1.56,.64,1) both" }}>
          <div style={{ fontSize: 64 }}>💔</div>
          <h2 className="text-white font-black text-3xl mt-2">Game Over</h2>
          <p className="text-blue-400 text-sm mt-1">{subject}</p>
        </div>

        <div
          className="rounded-3xl px-5 py-5 text-center"
          style={{ background: mention.bg, border: `2px solid ${mention.border}` }}
        >
          <div style={{ fontSize: mention.emoji === "🏆" ? 40 : 36 }}>{mention.emoji}</div>
          <div className="font-black mt-1" style={{ fontSize: 52, color: mention.color, lineHeight: 1 }}>
            {note20}<span className="text-xl font-bold" style={{ color: mention.color + "99" }}>/20</span>
          </div>
          <div className="text-white font-bold text-lg mt-1">{mention.label}</div>
          <div className="text-blue-300 text-sm mt-1">{score}/{totalAnswered} kòrèk • {subject}</div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: "🔥", val: maxStreak, label: "Max Streak" },
            { icon: "✅", val: score, label: "Kòrèk" },
            { icon: "❓", val: totalAnswered, label: "Total" },
          ].map((stat, i) => (
            <div
              key={i}
              className="rounded-2xl p-3 text-center"
              style={{ background: CONFIG.COLORS.surfaceLight, border: "1px solid #1e3a8a33" }}
            >
              <div style={{ fontSize: 22 }}>{stat.icon}</div>
              <div className="text-white font-black text-xl">{stat.val}</div>
              <div className="text-blue-500 text-xs">{stat.label}</div>
            </div>
          ))}
        </div>

        {wrongAnswers.length > 0 && (
          <div
            className="rounded-2xl p-4"
            style={{ background: CONFIG.COLORS.surfaceLight, border: "1px solid #1e3a8a33" }}
          >
            <h3 className="text-white font-bold text-sm mb-3">📝 Dènye Erè Ou :</h3>
            <div className="space-y-3">
              {wrongAnswers.slice(-3).map((a, i) => (
                <div
                  key={i}
                  className="rounded-xl px-3 py-2"
                  style={{ background: "#7f1d1d22", border: "1px solid #ef444433" }}
                >
                  <p className="text-white text-xs font-medium mb-1">{a.q}</p>
                  <p className="text-xs" style={{ color: "#fca5a5" }}>❌ {a.choices[a.selected]}</p>
                  <p className="text-xs text-green-400">✅ {a.choices[a.correctIdx]}</p>
                  {a.note && (
                    <p className="text-xs mt-1" style={{ color: "#93c5fd" }}>💡 {a.note}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={onRestart}
          className="w-full py-4 rounded-2xl font-bold text-white"
          style={{ background: CONFIG.COLORS.primary }}
        >
          🔄 Eseye Ankò
        </button>
        <button
          onClick={onBack}
          className="w-full py-4 rounded-2xl font-bold"
          style={{ background: CONFIG.COLORS.surfaceLight, color: "#93c5fd", border: "1px solid #1e3a8a33" }}
        >
          ← Chwazi lòt matière
        </button>
      </div>
    </div>
  );
});

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function QuizScreen({ user, onNavigate }) {
  const [phase, setPhase] = useState("select");
  const [subject, setSubject] = useState(null);
  const [shuffledQs, setShuffledQs] = useState([]);
  const [qIndex, setQIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [score, setScore] = useState(0);
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [hearts, setHearts] = useState(CONFIG.MAX_HEARTS);
  const [streak, setStreak] = useState(0);
  const [maxStreak, setMaxStreak] = useState(0);
  const [wrongAnswers, setWrongAnswers] = useState([]);
  const [round, setRound] = useState(1);
  const [roundScore, setRoundScore] = useState(0);
  const [usedQKeys, setUsedQKeys] = useState(new Set());

  const { callEdge } = useApi();
  const { saveGrade } = useQuiz(user);

  const availableSubjects = useMemo(() => 
    Object.keys(QUIZ_DATA).filter(s => user.subjects.includes(s)),
    [user.subjects]
  );

  const currentQ = shuffledQs[qIndex];
  const allCount = useMemo(() => subject ? (QUIZ_DATA[subject] || []).length : 0, [subject]);
  const seenCount = usedQKeys.size;
  const hasMore = useMemo(() => allCount - seenCount >= 5, [allCount, seenCount]);

  const saveScoreToSupabase = useCallback(async (finalScore, finalTotal, finalStreak) => {
    if (finalTotal === 0 || !subject) return;
    const note20 = Math.round((finalScore / finalTotal) * 20 * 10) / 10;
    saveGrade(subject, note20, finalScore, finalTotal);
    
    try {
      await callEdge({
        action: "save_quiz_score",
        phone: user.phone,
        schoolCode: user.code,
        subject,
        score: finalScore,
        total: finalTotal,
        note20,
        streak: finalStreak,
      });
    } catch (e) {
      console.warn("Score save failed", e);
    }
  }, [subject, user, callEdge, saveGrade]);

  const startQCM = useCallback((sub) => {
    const all = shuffleArray(QUIZ_DATA[sub]);
    const first10 = all.slice(0, CONFIG.QUIZ_ROUND_SIZE);
    const used = new Set(first10.map(q => q.q));
    
    setSubject(sub);
    setShuffledQs(first10);
    setUsedQKeys(used);
    setPhase("qcm");
    setQIndex(0);
    setScore(0);
    setTotalAnswered(0);
    setRoundScore(0);
    setHearts(CONFIG.MAX_HEARTS);
    setStreak(0);
    setMaxStreak(0);
    setWrongAnswers([]);
    setSelected(null);
    setRound(1);
  }, []);

  const handleChoice = useCallback((idx) => {
    if (selected !== null) return;
    
    setSelected(idx);
    const correct = idx === currentQ.answer;
    setTotalAnswered(t => t + 1);
    
    if (correct) {
      setScore(s => s + 1);
      setRoundScore(r => r + 1);
      setStreak(s => {
        const ns = s + 1;
        setMaxStreak(m => Math.max(m, ns));
        return ns;
      });
    } else {
      setHearts(h => h - 1);
      setStreak(0);
      setWrongAnswers(p => [...p.slice(-4), {
        q: currentQ.q,
        selected: idx,
        correctIdx: currentQ.answer,
        choices: currentQ.choices,
        note: currentQ.note,
      }]);
    }
  }, [selected, currentQ]);

  const handleNext = useCallback(async () => {
    if (hearts <= 0) {
      await saveScoreToSupabase(score, totalAnswered, maxStreak);
      setPhase("gameover");
      return;
    }

    const next = qIndex + 1;
    if (next >= shuffledQs.length) {
      await saveScoreToSupabase(score, totalAnswered, maxStreak);
      setPhase("bravo");
      return;
    }

    setQIndex(next);
    setSelected(null);
  }, [hearts, score, totalAnswered, maxStreak, qIndex, shuffledQs.length, saveScoreToSupabase]);

  const continueQuiz = useCallback(() => {
    const all = QUIZ_DATA[subject] || [];
    const unseen = all.filter(q => !usedQKeys.has(q.q));
    const pool = unseen.length >= 10 ? unseen : shuffleArray(all);
    const next10 = shuffleArray(pool).slice(0, 10);
    const newUsed = new Set([...usedQKeys, ...next10.map(q => q.q)]);
    
    setShuffledQs(next10);
    setUsedQKeys(newUsed);
    setQIndex(0);
    setSelected(null);
    setRoundScore(0);
    setRound(r => r + 1);
    setPhase("qcm");
  }, [subject, usedQKeys]);

  if (phase === "select") {
    return (
      <>
        <QuizSelect
          availableSubjects={availableSubjects}
          onStartQCM={startQCM}
          onOpenQuestion={() => setPhase("open")}
        />
        <BottomNav active="quiz" onNavigate={onNavigate} />
      </>
    );
  }

  if (phase === "open") {
    return (
      <>
        <QuizOpenQuestion onBack={() => setPhase("select")} />
        <BottomNav active="quiz" onNavigate={onNavigate} />
      </>
    );
  }

  if (phase === "qcm" && currentQ) {
    return (
      <>
        <QuizQCM
          subject={subject}
          currentQ={currentQ}
          qIndex={qIndex}
          totalQs={shuffledQs.length}
          selected={selected}
          hearts={hearts}
          streak={streak}
          round={round}
          totalAnswered={totalAnswered}
          score={score}
          onChoice={handleChoice}
          onNext={handleNext}
          onBack={() => setPhase("select")}
        />
        <BottomNav active="quiz" onNavigate={onNavigate} />
      </>
    );
  }

  if (phase === "bravo") {
    return (
      <>
        <QuizBravo
          subject={subject}
          round={round}
          roundScore={roundScore}
          score={score}
          totalAnswered={totalAnswered}
          maxStreak={maxStreak}
          streak={streak}
          seenCount={seenCount}
          allCount={allCount}
          hasMore={hasMore}
          onContinue={continueQuiz}
          onBack={() => setPhase("select")}
        />
        <BottomNav active="quiz" onNavigate={onNavigate} />
      </>
    );
  }

  if (phase === "gameover") {
    return (
      <>
        <QuizGameOver
          subject={subject}
          score={score}
          totalAnswered={totalAnswered}
          maxStreak={maxStreak}
          wrongAnswers={wrongAnswers}
          onRestart={() => startQCM(subject)}
          onBack={() => setPhase("select")}
        />
        <BottomNav active="quiz" onNavigate={onNavigate} />
      </>
    );
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  LEADERBOARD SCREEN
// ─────────────────────────────────────────────────────────────────────────────

const LeaderboardScreen = React.memo(({ user, onNavigate }) => {
  const [tab, setTab] = useState("bestNote");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { callEdge } = useApi();
  const { parseApiError } = useErrorHandler();

  const tabs = useMemo(() => [
    { id: "bestNote", icon: "🏆", label: "Meilleure Note", valueLabel: "/20" },
    { id: "totalCorrect", icon: "🔥", label: "Total Kòrèk", valueLabel: " pts" },
    { id: "thisWeek", icon: "📅", label: "Semèn Sa", valueLabel: " pts" },
  ], []);

  const colors = useMemo(() => 
    ["#fbbf24", "#94a3b8", "#cd7c32", "#3b82f6", "#22c55e", "#a855f7", "#f97316", "#14b8a6", "#ec4899", "#6366f1"],
    []
  );
  const medalEmojis = useMemo(() => ["🥇", "🥈", "🥉"], []);

  useEffect(() => {
    let mounted = true;

    const fetchData = async () => {
      try {
        const result = await callEdge({
          action: "get_leaderboard",
          phone: user.phone,
          schoolCode: user.code,
        });
        if (mounted) setData(result);
      } catch (e) {
        if (mounted) setError(parseApiError(e).message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchData();
    return () => { mounted = false; };
  }, [user, callEdge, parseApiError]);

  const currentTab = tabs.find(t => t.id === tab);
  const board = data ? data[tab] : [];

  const handleRetry = useCallback(() => {
    setLoading(true);
    setError(null);
    callEdge({
      action: "get_leaderboard",
      phone: user.phone,
      schoolCode: user.code,
    })
      .then(d => setData(d))
      .catch(e => setError(parseApiError(e).message))
      .finally(() => setLoading(false));
  }, [user, callEdge, parseApiError]);

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: CONFIG.COLORS.background }}>
      <div
        className="px-4 py-4 border-b"
        style={{ background: CONFIG.COLORS.surface, borderColor: "#ffffff10" }}
      >
        <div className="flex items-center gap-3 mb-3">
          <span style={{ fontSize: 24 }}>🏆</span>
          <div>
            <h2 className="text-white font-bold">Klasman</h2>
            <p className="text-blue-400 text-xs">{user.school}</p>
          </div>
        </div>

        <div className="flex gap-2">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
              style={{
                background: tab === t.id ? CONFIG.COLORS.primary : CONFIG.COLORS.surfaceLight,
                color: tab === t.id ? "white" : "#4b5ea8",
                border: tab === t.id ? "none" : "1px solid #1e3a8a33",
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <LoadingDots />
            <p className="text-blue-500 text-sm">Chajman klasman an...</p>
          </div>
        )}

        {error && (
          <div
            className="rounded-2xl px-4 py-4 text-center"
            style={{ background: "#7f1d1d22", border: "1px solid #ef444433" }}
          >
            <p className="text-red-400 text-sm">⚠️ {error}</p>
            <button
              onClick={handleRetry}
              className="mt-3 px-4 py-2 rounded-xl text-xs font-bold text-white"
              style={{ background: CONFIG.COLORS.primary }}
            >
              🔄 Eseye Ankò
            </button>
          </div>
        )}

        {!loading && !error && board?.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 space-y-3">
            <span style={{ fontSize: 56 }}>📊</span>
            <p className="text-blue-400 text-center text-sm">
              Pa gen done encore.<br />Fè kèk quiz pou parèt nan klasman an !
            </p>
            <button
              onClick={() => onNavigate("quiz")}
              className="px-6 py-3 rounded-xl font-bold text-white text-sm"
              style={{ background: CONFIG.COLORS.primary }}
            >
              → Ale nan Quiz
            </button>
          </div>
        )}

        {!loading && !error && board?.length > 0 && (
          <>
            {board.length >= 3 && (
              <div className="flex items-end justify-center gap-3 py-4" style={{ animation: "fadeIn .5s ease both" }}>
                <div className="flex flex-col items-center flex-1">
                  <div className="text-2xl mb-1">🥈</div>
                  <div
                    className="w-full rounded-t-2xl flex flex-col items-center py-3 px-2"
                    style={{ background: "#94a3b822", border: "1px solid #94a3b844", height: 80 }}
                  >
                    <div className="text-white font-bold text-xs text-center">{board[1].phone}</div>
                    <div className="font-black mt-1" style={{ color: "#94a3b8" }}>
                      {board[1].value}{currentTab.valueLabel}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-center flex-1">
                  <div className="text-3xl mb-1">🥇</div>
                  <div
                    className="w-full rounded-t-2xl flex flex-col items-center py-3 px-2"
                    style={{ background: "#fbbf2422", border: "1px solid #fbbf2444", height: 100 }}
                  >
                    <div className="text-white font-bold text-xs text-center">{board[0].phone}</div>
                    <div className="font-black text-lg mt-1" style={{ color: "#fbbf24" }}>
                      {board[0].value}{currentTab.valueLabel}
                    </div>
                    {board[0].isMe && <div className="text-xs mt-1" style={{ color: "#fbbf24" }}>← Ou</div>}
                  </div>
                </div>

                <div className="flex flex-col items-center flex-1">
                  <div className="text-2xl mb-1">🥉</div>
                  <div
                    className="w-full rounded-t-2xl flex flex-col items-center py-3 px-2"
                    style={{ background: "#cd7c3222", border: "1px solid #cd7c3244", height: 65 }}
                  >
                    <div className="text-white font-bold text-xs text-center">{board[2].phone}</div>
                    <div className="font-black mt-1" style={{ color: "#cd7c32" }}>
                      {board[2].value}{currentTab.valueLabel}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {board.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                  style={{
                    background: entry.isMe ? "#1a4fd633" : CONFIG.COLORS.surfaceLight,
                    border: entry.isMe ? "1.5px solid #3b82f6" : "1px solid #1e3a8a33",
                    animation: `fadeIn .3s ${i * 0.05}s ease both`,
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-black text-sm flex-shrink-0"
                    style={{ background: colors[i % colors.length] + "33", color: colors[i % colors.length] }}
                  >
                    {i < 3 ? medalEmojis[i] : `#${entry.rank}`}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-semibold text-sm font-mono">{entry.phone}</span>
                      {entry.isMe && (
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-bold"
                          style={{ background: "#1a4fd6", color: "white" }}
                        >
                          Ou
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="font-black text-lg" style={{ color: colors[i % colors.length] }}>
                    {entry.value}
                    <span className="text-xs font-normal" style={{ color: colors[i % colors.length] + "99" }}>
                      {currentTab.valueLabel}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {data && !board.find(e => e.isMe) && (
              <div
                className="rounded-2xl px-4 py-3 text-center"
                style={{ background: "#1a4fd622", border: "1px solid #3b82f633" }}
              >
                <p className="text-blue-300 text-xs">Fè plis quiz pou parèt nan top 10 ! 💪</p>
              </div>
            )}

            {data?.currentWeek && tab === "thisWeek" && (
              <p className="text-blue-800 text-xs text-center">Semèn : {data.currentWeek}</p>
            )}
          </>
        )}
      </div>

      <BottomNav active="leaderboard" onNavigate={onNavigate} />
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  HISTORY SCREEN
// ─────────────────────────────────────────────────────────────────────────────

const HistoryScreen = React.memo(({ user, onNavigate }) => {
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const { getScans, deleteScan } = useIndexedDB();

  useEffect(() => {
    let mounted = true;

    const loadHistory = async () => {
      const data = await getScans(user.phone);
      if (mounted) setHistory(data);
      if (mounted) setLoading(false);
    };

    loadHistory();
    return () => { mounted = false; };
  }, [user.phone, getScans]);

  const handleDelete = useCallback(async (entry) => {
    setDeleting(entry.id);
    await deleteScan(entry.id);
    setHistory(h => h.filter(x => x.id !== entry.id));
    if (selected?.id === entry.id) setSelected(null);
    setDeleting(null);
  }, [deleteScan, selected]);

  const dailyMap = useMemo(() => {
    const map = {};
    history.forEach(h => {
      const day = h.scanDate || h.date?.split(",")[0] || "?";
      map[day] = (map[day] || 0) + 1;
    });
    return map;
  }, [history]);

  if (selected) {
    return (
      <div className="fixed inset-0 flex flex-col" style={{ background: CONFIG.COLORS.background }}>
        <div
          className="px-4 py-4 border-b flex items-center gap-3"
          style={{ background: CONFIG.COLORS.surface, borderColor: "#ffffff10" }}
        >
          <button onClick={() => setSelected(null)} className="text-blue-400 text-xl">
            ←
          </button>
          <div className="flex-1">
            <h2 className="text-white font-bold">Detay Scan</h2>
            <p className="text-blue-400 text-xs">
              {selected.subject} • {selected.date}
            </p>
          </div>
          <button
            onClick={() => handleDelete(selected)}
            disabled={deleting === selected.id}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1 disabled:opacity-50"
            style={{ background: "#d4002a22", color: "#ff8080", border: "1px solid #d4002a33" }}
          >
            {deleting === selected.id ? "⏳" : "🗑️"} Efase
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {!selected._fallback ? (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{ background: "#14532d22", border: "1px solid #22c55e22" }}
            >
              <span>🗄️</span>
              <span className="text-green-300 text-xs">
                Stocké dans IndexedDB • Image disponible hors-ligne
              </span>
            </div>
          ) : (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{ background: "#78350f22", border: "1px solid #f59e0b22" }}
            >
              <span>⚠️</span>
              <span className="text-yellow-300 text-xs">
                Mode fallback — image non disponible hors-ligne
              </span>
            </div>
          )}

          {selected.image ? (
            <div>
              <p className="text-blue-400 text-xs font-semibold uppercase tracking-wider mb-2">
                📷 Imaj Scannée
              </p>
              <img
                src={selected.image}
                alt="scan"
                className="w-full rounded-2xl object-contain max-h-56"
                style={{ border: "1px solid #1e3a8a44" }}
                loading="lazy"
              />
            </div>
          ) : (
            <div
              className="rounded-2xl px-4 py-3 flex items-center gap-3"
              style={{ background: "#1e3a8a11", border: "1px solid #1e3a8a22" }}
            >
              <span>💬</span>
              <span className="text-blue-600 text-xs">Kesyon tèks — pa gen imaj</span>
            </div>
          )}

          <div
            className="rounded-2xl p-4"
            style={{ background: CONFIG.COLORS.surfaceLight, border: "1px solid #1e3a8a33" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-7 h-7 rounded-xl flex items-center justify-center"
                style={{ background: CONFIG.COLORS.primary }}
              >
                <span style={{ fontSize: 14 }}>🧑‍🏫</span>
              </div>
              <span className="text-white font-bold text-sm">Repons Prof Lakay</span>
            </div>
            <div className="text-sm leading-relaxed" style={{ color: CONFIG.COLORS.text }}>
              <LatexText content={selected.response} />
            </div>
          </div>

          <div
            className="rounded-2xl px-4 py-3 flex justify-between"
            style={{ background: CONFIG.COLORS.surfaceLight, border: "1px solid #1e3a8a22" }}
          >
            <span className="text-blue-400 text-xs">Scan itilize jou sa</span>
            <span className="text-orange-300 font-bold text-xs">
              {selected.scansUsed}/{selected.dailyLimit || user.dailyScans}
            </span>
          </div>
        </div>

        <BottomNav active="history" onNavigate={onNavigate} />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: CONFIG.COLORS.background }}>
      <div
        className="px-4 py-4 border-b"
        style={{ background: CONFIG.COLORS.surface, borderColor: "#ffffff10" }}
      >
        <h2 className="text-white font-bold">📋 Istwa Scan Ou</h2>
        <div className="flex items-center gap-3 mt-0.5">
          <p className="text-blue-400 text-xs">
            {history.length} scan{history.length !== 1 ? "s" : ""} total
          </p>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: "#14532d22", color: "#86efac", border: "1px solid #22c55e22" }}
          >
            🗄️ IndexedDB • hors-ligne
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <LoadingDots />
            <p className="text-blue-500 text-sm">Chajman istwa ou depi IndexedDB...</p>
          </div>
        )}

        {!loading && Object.keys(dailyMap).length > 0 && (
          <div
            className="rounded-2xl p-4"
            style={{ background: CONFIG.COLORS.surfaceLight, border: "1px solid #1e3a8a33" }}
          >
            <h3 className="text-white font-bold text-sm mb-3">📊 Scan pa Jou</h3>
            <div className="space-y-2">
              {Object.entries(dailyMap).slice(0, 7).map(([day, count]) => (
                <div key={day} className="flex items-center gap-3">
                  <span className="text-blue-400 text-xs w-24 flex-shrink-0">{day}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "#1e3a8a44" }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(count / user.dailyScans) * 100}%`,
                        background: count >= user.dailyScans ? "#ef4444" : "linear-gradient(90deg,#d4002a,#ff6b35)",
                      }}
                    />
                  </div>
                  <span className="text-orange-300 text-xs font-bold w-10 text-right">
                    {count}/{user.dailyScans}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && history.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 space-y-3">
            <span style={{ fontSize: 56 }}>📭</span>
            <p className="text-blue-400 text-center text-sm">
              Pa gen istwa encore.<br />Fè premye scan ou nan Chat !
            </p>
            <button
              onClick={() => onNavigate("chat")}
              className="px-6 py-3 rounded-xl font-bold text-white text-sm"
              style={{ background: CONFIG.COLORS.primary }}
            >
              → Ale nan Chat
            </button>
          </div>
        )}

        {!loading && history.length > 0 && (
          <>
            <h3 className="text-blue-400 text-xs font-semibold uppercase tracking-wider">
              Tout Scan Ou Yo
            </h3>
            {history.map(h => (
              <div
                key={h.id}
                className="rounded-2xl overflow-hidden"
                style={{ background: CONFIG.COLORS.surfaceLight, border: "1px solid #1e3a8a33" }}
              >
                <button
                  onClick={() => setSelected(h)}
                  className="w-full text-left active:scale-95 transition-transform"
                >
                  <div className="flex gap-3 p-4">
                    {h.image ? (
                      <img
                        src={h.image}
                        alt=""
                        className="w-14 h-14 rounded-xl object-cover flex-shrink-0"
                        style={{ border: "1px solid #1e3a8a44" }}
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: "#1e3a8a33" }}
                      >
                        <span style={{ fontSize: 24 }}>💬</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-bold"
                          style={{ background: "#d4002a22", color: "#ff8080" }}
                        >
                          {h.subject}
                        </span>
                        {h.image && <span className="text-green-700 text-xs">🗄️</span>}
                      </div>
                      <p
                        className="text-xs leading-relaxed"
                        style={{
                          color: "#93c5fd",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {h.response?.slice(0, 100)}...
                      </p>
                      <p className="text-blue-800 text-xs mt-1">{h.date}</p>
                    </div>
                    <span className="text-blue-700 text-lg self-center">›</span>
                  </div>
                </button>
                <div className="px-4 pb-3 flex justify-end">
                  <button
                    onClick={() => handleDelete(h)}
                    disabled={deleting === h.id}
                    className="px-3 py-1 rounded-lg text-xs font-semibold disabled:opacity-50"
                    style={{ background: "#d4002a15", color: "#ff8080", border: "1px solid #d4002a22" }}
                  >
                    {deleting === h.id ? "⏳" : "🗑️ Efase"}
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <BottomNav active="history" onNavigate={onNavigate} />
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  MENU SCREEN
// ─────────────────────────────────────────────────────────────────────────────

const MenuScreen = React.memo(({ user, onNavigate, onLogout }) => {
  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ background: "linear-gradient(160deg,#0a0f2e,#0d1b4b)" }}
    >
      <div className="px-6 pt-10 pb-6 border-b" style={{ borderColor: "#ffffff10" }}>
        <div className="flex items-center gap-3">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: CONFIG.COLORS.primary }}
          >
            <span style={{ fontSize: 28 }}>👤</span>
          </div>
          <div>
            <div className="text-white font-bold">{user.phone}</div>
            <div className="text-blue-300 text-xs">{user.school}</div>
            <div className="text-orange-300 text-xs mt-0.5">🔑 {user.code}</div>
          </div>
        </div>

        <div
          className="mt-4 rounded-xl px-4 py-3 flex justify-between items-center"
          style={{
            background: user.daysRemaining <= 7 ? "#d4002a22" : "#14532d22",
            border: `1px solid ${user.daysRemaining <= 7 ? "#d4002a44" : "#22c55e33"}`,
          }}
        >
          <div>
            <div
              className="text-xs font-bold"
              style={{ color: user.daysRemaining <= 7 ? "#ff8080" : "#86efac" }}
            >
              {user.daysRemaining <= 7 ? "⚠️ Ekspire byento" : "✅ Kòd Aktif"}
            </div>
            <div
              className="text-xs mt-0.5"
              style={{ color: user.daysRemaining <= 7 ? "#ff6060" : "#6ee7b7" }}
            >
              {user.daysRemaining} jou rete • {user.dailyScans} scan/jou
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-blue-400">
              {user.subjects.length} matière{user.subjects.length > 1 ? "s" : ""}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-4 space-y-2">
        {[
          { icon: "📊", label: "Dashboard Direction", screen: "dashboard" },
          { icon: "💳", label: "Peman", screen: "payment" },
          { icon: "🤝", label: "Vin Patnè", screen: "partner" },
        ].map(item => (
          <button
            key={item.screen}
            onClick={() => onNavigate(item.screen)}
            className="w-full flex items-center gap-4 px-5 py-4 rounded-2xl text-left active:scale-95 transition-transform"
            style={{ background: "#ffffff08", border: "1px solid #ffffff10" }}
          >
            <span style={{ fontSize: 24 }}>{item.icon}</span>
            <span className="text-white font-medium">{item.label}</span>
            <span className="ml-auto text-blue-600">›</span>
          </button>
        ))}

        <div
          className="flex items-center gap-3 px-5 py-4 rounded-2xl"
          style={{ background: "#14532d15", border: "1px solid #22c55e22" }}
        >
          <span>🔒</span>
          <div>
            <div className="text-green-300 text-sm font-semibold">Koneksyon Sécurisé</div>
            <div className="text-green-800 text-xs">Clé API protégée via Supabase</div>
          </div>
        </div>
      </div>

      <div className="px-4 pb-4">
        <button
          onClick={onLogout}
          className="w-full py-4 rounded-2xl text-red-400 font-semibold"
          style={{ background: "#d4002a15", border: "1px solid #d4002a30" }}
        >
          Dekonekte
        </button>
      </div>

      <BottomNav active="menu" onNavigate={onNavigate} />
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  PAYMENT SCREEN
// ─────────────────────────────────────────────────────────────────────────────

const PaymentScreen = React.memo(({ onBack }) => {
  const [payments, setPayments] = useState([]);
  const [copied, setCopied] = useState(null);
  const [loading, setLoading] = useState(true);
  const { callEdge } = useApi();

  const cardStyle = useMemo(() => ({
    MonCash: { grad: "linear-gradient(135deg,#c0392b,#e74c3c)", icon: "💳", sub: "Digicel Haiti" },
    NatCash: { grad: "linear-gradient(135deg,#e67e22,#f39c12)", icon: "🏦", sub: "Natcom Haiti" },
  }), []);

  useEffect(() => {
    let mounted = true;

    const fetchPayments = async () => {
      try {
        const result = await callEdge({ action: "get_payment_numbers" });
        if (mounted) setPayments(result.payments || []);
      } catch {
        if (mounted) {
          setPayments([
            { method: "MonCash", number: "509-4869-5079" },
            { method: "NatCash", number: "509-4066-9105" },
          ]);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchPayments();
    return () => { mounted = false; };
  }, [callEdge]);

  const copy = useCallback((num, key) => {
    navigator.clipboard?.writeText(num).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 2500);
  }, []);

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ background: "linear-gradient(160deg,#0a0f2e,#0d1b4b)" }}
    >
      <div
        className="flex items-center gap-3 px-4 py-4 border-b"
        style={{ borderColor: "#ffffff10" }}
      >
        <button onClick={onBack} className="text-blue-400 text-xl">
          ←
        </button>
        <h2 className="text-white font-bold text-lg">Peman & Aktivasyon</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <LoadingDots />
          </div>
        ) : (
          payments.map(p => {
            const style = cardStyle[p.method] || {
              grad: "linear-gradient(135deg,#333,#555)",
              icon: "💳",
              sub: "",
            };
            return (
              <div key={p.method} className="rounded-3xl" style={{ background: style.grad }}>
                <div className="px-5 py-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center">
                      <span style={{ fontSize: 24 }}>{style.icon}</span>
                    </div>
                    <div>
                      <div className="text-white font-black text-xl">{p.method}</div>
                      <div className="text-white/70 text-xs">{style.sub}</div>
                    </div>
                  </div>

                  <div className="bg-white/15 rounded-2xl px-4 py-3 mb-4">
                    <div className="text-white/70 text-xs mb-1">Nimewo {p.method}</div>
                    <div className="text-white font-black text-2xl tracking-widest">{p.number}</div>
                  </div>

                  <button
                    onClick={() => copy(p.number, p.method)}
                    className="w-full py-3.5 rounded-2xl font-bold text-sm text-white flex items-center justify-center gap-2"
                    style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)" }}
                  >
                    {copied === p.method ? "✅ Copié !" : "📋 Kopye Nimewo a"}
                  </button>

                  <p className="text-white/60 text-xs text-center mt-3">
                    ⚡ Aktivasyon garanti an mwens 30 minit
                  </p>
                </div>
              </div>
            );
          })
        )}

        <button
          onClick={() => window.open("https://wa.me/50900000000?text=Bonjou%2C%20mwen%20vle%20aktive%20Gid%20NS4.", "_blank")}
          className="w-full py-4 rounded-2xl font-bold text-white flex items-center justify-center gap-3"
          style={{ background: "linear-gradient(135deg,#25d366,#128c7e)" }}
        >
          <span style={{ fontSize: 22 }}>💬</span> Konfime Peman via WhatsApp
        </button>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  DASHBOARD SCREEN
// ─────────────────────────────────────────────────────────────────────────────

const DashboardScreen = React.memo(({ onBack, userCode }) => {
  const [dirCode, setDirCode] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const { callEdge } = useApi();
  const { parseApiError } = useErrorHandler();

  const colors = useMemo(() => 
    ["#22c55e", "#3b82f6", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#f97316"],
    []
  );

  const handleAuth = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await callEdge({
        action: "dashboard",
        schoolCode: userCode,
        directorCode: dirCode.trim(),
      });
      setStats(result);
      setAuthorized(true);
    } catch (e) {
      setError(parseApiError(e).message);
    }
    setLoading(false);
  }, [userCode, dirCode, callEdge, parseApiError]);

  if (!authorized) {
    return (
      <div
        className="fixed inset-0 flex flex-col"
        style={{ background: "linear-gradient(160deg,#0a0f2e,#0d1b4b)" }}
      >
        <div
          className="flex items-center gap-3 px-4 py-4 border-b"
          style={{ borderColor: "#ffffff10" }}
        >
          <button onClick={onBack} className="text-blue-400 text-xl">
            ←
          </button>
          <h2 className="text-white font-bold">Dashboard Direction</h2>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <span style={{ fontSize: 56 }}>🔐</span>
          <h3 className="text-white font-bold text-xl mt-4 mb-2">Accès Direction Sèlman</h3>
          <p className="text-blue-400 text-sm text-center mb-6">
            Antre kòd espesyal direktè a pou wè rapò a
          </p>

          <input
            type="text"
            value={dirCode}
            onChange={e => setDirCode(e.target.value.toUpperCase())}
            placeholder="Kòd Direktè"
            className="w-full max-w-xs rounded-xl px-4 py-3.5 text-white placeholder-blue-800 font-mono font-bold outline-none tracking-widest mb-3"
            style={{ background: "#ffffff0d", border: "1.5px solid #ffffff18" }}
          />

          {error && <p className="text-red-400 text-sm mb-3">⚠️ {error}</p>}

          <button
            onClick={handleAuth}
            disabled={loading}
            className="w-full max-w-xs py-4 rounded-xl font-bold text-white disabled:opacity-50"
            style={{ background: loading ? "#333" : "linear-gradient(135deg,#1a4fd6,#2563eb)" }}
          >
            {loading ? "⏳ Ap vérifier..." : "Valide"}
          </button>
        </div>
      </div>
    );
  }

  const { school, stats: s } = stats;
  const subjectEntries = Object.entries(s.subjectBreakdown || {}).sort((a, b) => b[1] - a[1]);
  const maxScans = Math.max(...subjectEntries.map(e => e[1]), 1);

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ background: "linear-gradient(160deg,#0a0f2e,#0d1b4b)" }}
    >
      <div
        className="flex items-center gap-3 px-4 py-4 border-b"
        style={{ borderColor: "#ffffff10" }}
      >
        <button onClick={onBack} className="text-blue-400 text-xl">
          ←
        </button>
        <div className="flex-1">
          <h2 className="text-white font-bold">Dashboard</h2>
          <p className="text-blue-400 text-xs">{school.name}</p>
        </div>
        <button
          className="px-3 py-2 rounded-xl text-xs font-bold text-white"
          style={{ background: CONFIG.COLORS.primary }}
        >
          📄 PDF
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div
          className="rounded-2xl px-4 py-3 flex justify-between items-center"
          style={{
            background: school.daysRemaining <= 7 ? "#d4002a22" : "#14532d22",
            border: `1px solid ${school.daysRemaining <= 7 ? "#d4002a44" : "#22c55e33"}`,
          }}
        >
          <div>
            <div
              className="font-bold text-sm"
              style={{ color: school.daysRemaining <= 7 ? "#ff8080" : "#86efac" }}
            >
              {school.daysRemaining <= 0
                ? "🔴 Kòd Ekspire"
                : school.daysRemaining <= 7
                ? "⚠️ Ekspire byento"
                : "✅ Kòd Aktif"}
            </div>
            <div className="text-xs mt-0.5" style={{ color: "#93c5fd" }}>
              {school.daysRemaining} jou rete • {school.dailyScans} scan/jou • max{" "}
              {school.maxStudents} elèv
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Scan Total", val: s.totalScans, icon: "🔍", color: "#3b82f6" },
            { label: "Elèv Aktif", val: s.totalStudents, icon: "👥", color: "#22c55e" },
            { label: "Scan Jodi", val: s.scansToday, icon: "📅", color: "#f59e0b" },
            { label: "Matières", val: school.subjects.length, icon: "📚", color: "#a855f7" },
          ].map((item, i) => (
            <div
              key={i}
              className="rounded-2xl p-4"
              style={{ background: "#ffffff08", border: "1px solid #ffffff10" }}
            >
              <div style={{ fontSize: 24 }}>{item.icon}</div>
              <div className="font-black text-2xl mt-1" style={{ color: item.color }}>
                {item.val}
              </div>
              <div className="text-blue-400 text-xs mt-0.5">{item.label}</div>
            </div>
          ))}
        </div>

        <div
          className="rounded-2xl p-4"
          style={{ background: "#ffffff08", border: "1px solid #ffffff10" }}
        >
          <h3 className="text-white font-bold text-sm mb-3">📚 Matières Autorisées</h3>
          <div className="flex flex-wrap gap-2">
            {school.subjects.map((s, i) => (
              <span
                key={i}
                className="px-3 py-1 rounded-full text-xs font-semibold"
                style={{
                  background: colors[i % colors.length] + "33",
                  color: colors[i % colors.length],
                  border: `1px solid ${colors[i % colors.length]}44`,
                }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>

        {subjectEntries.length > 0 && (
          <div
            className="rounded-2xl p-5"
            style={{ background: "#ffffff08", border: "1px solid #ffffff10" }}
          >
            <h3 className="text-white font-bold mb-4">📊 Matières les Plus Scannées</h3>
            <div className="space-y-3">
              {subjectEntries.map(([sub, count], i) => (
                <div key={sub}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-blue-200">{sub}</span>
                    <span className="text-blue-400 font-bold">
                      {count} scan{count > 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "#ffffff10" }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(count / maxScans) * 100}%`,
                        background: colors[i % colors.length],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          className="w-full py-4 rounded-2xl font-bold text-white flex items-center justify-center gap-3"
          style={{ background: "linear-gradient(135deg,#25d366,#128c7e)" }}
        >
          <span>💬</span> Pataje Rapò PDF sou WhatsApp
        </button>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  PARTNER SCREEN
// ─────────────────────────────────────────────────────────────────────────────

const PartnerScreen = React.memo(({ onBack }) => {
  const features = useMemo(() => [
    { icon: "✅", title: "Kòd ak Dat Ekspirasyon", desc: "Kontwole dire aksè — 30, 90, 180 jou" },
    { icon: "🎛️", title: "Quota Modifyab", desc: "Chwazi 3, 5 oswa 10 scan pa jou" },
    { icon: "👥", title: "Limit Elèv", desc: "Defini kantite maksimòm elèv pa kòd" },
    { icon: "📚", title: "Matières Seleksyone", desc: "Aktive sèlman matières ou peye a" },
    { icon: "🏆", title: "Klasman Reyèl", desc: "Elèv wè pwogresyon yo pa rapò a lòt yo" },
    { icon: "🔒", title: "Sékirité Maximum", desc: "Clé API pwoteje, jamè nan APK" },
  ], []);

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ background: "linear-gradient(160deg,#0a0f2e,#0d1b4b)" }}
    >
      <div
        className="flex items-center gap-3 px-4 py-4 border-b"
        style={{ borderColor: "#ffffff10" }}
      >
        <button onClick={onBack} className="text-blue-400 text-xl">
          ←
        </button>
        <h2 className="text-white font-bold">Vin Patnè</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        <div
          className="rounded-3xl px-6 py-6"
          style={{ background: "linear-gradient(135deg,#1a1a5e,#2a2a8e)", border: "1px solid #3b82f633" }}
        >
          <div className="text-5xl mb-4">🏫</div>
          <h3 className="text-white font-black text-xl mb-2">Ofri Aksè Ilimite a Elèv Ou Yo</h3>
          <p className="text-blue-300 text-sm leading-relaxed">
            Gid NS4 bay chak elèv yon asistan IA pèsonèl 24h/24 pou prepare Bak NS4 yo.
          </p>
        </div>

        {features.map((f, i) => (
          <div
            key={i}
            className="flex gap-4 px-5 py-4 rounded-2xl"
            style={{ background: "#ffffff08", border: "1px solid #ffffff10" }}
          >
            <span style={{ fontSize: 26 }}>{f.icon}</span>
            <div>
              <div className="text-white font-bold text-sm">{f.title}</div>
              <div className="text-blue-400 text-xs mt-0.5">{f.desc}</div>
            </div>
          </div>
        ))}

        <button
          onClick={() =>
            window.open(
              "https://wa.me/50900000000?text=Bonjou%2C%20mwen%20vle%20vin%20patnè%20Gid%20NS4.",
              "_blank"
            )
          }
          className="w-full py-4 rounded-2xl font-bold text-white flex items-center justify-center gap-3"
          style={{ background: "linear-gradient(135deg,#25d366,#128c7e)" }}
        >
          <span style={{ fontSize: 22 }}>💬</span> Kontakte Nou sou WhatsApp
        </button>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  APP ROOT
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState("splash");
  const [user, setUser] = useLocalStorage(CONFIG.SESSION_KEY, null);

  const navigate = useCallback((s) => setScreen(s), []);

  useEffect(() => {
    if (user?.phone && user?.code && screen === "splash") {
      const timer = setTimeout(() => setScreen("chat"), 1800);
      return () => clearTimeout(timer);
    }
  }, [user, screen]);

  const handleLogin = useCallback((u) => {
    setUser(u);
    setScreen("chat");
  }, [setUser]);

  const handleLogout = useCallback(() => {
    setUser(null);
    setScreen("login");
  }, [setUser]);

  const handleSplashDone = useCallback(() => {
    setScreen(user ? "chat" : "login");
  }, [user]);

  const handleBack = useCallback((target) => {
    navigate(target);
  }, [navigate]);

  return (
    <UserContext.Provider value={user}>
      <ThemeContext.Provider value={CONFIG.COLORS}>
        {screen === "splash" && <SplashScreen onDone={handleSplashDone} />}
        {screen === "login" && <LoginScreen onLogin={handleLogin} onNavigate={navigate} />}
        {screen === "chat" && user && <ChatScreen user={user} onNavigate={navigate} />}
        {screen === "quiz" && user && <QuizScreen user={user} onNavigate={navigate} />}
        {screen === "leaderboard" && user && <LeaderboardScreen user={user} onNavigate={navigate} />}
        {screen === "history" && user && <HistoryScreen user={user} onNavigate={navigate} />}
        {screen === "menu" && user && (
          <MenuScreen user={user} onNavigate={navigate} onLogout={handleLogout} />
        )}
        {screen === "payment" && (
          <PaymentScreen onBack={() => navigate(user ? "menu" : "login")} />
        )}
        {screen === "dashboard" && user && (
          <DashboardScreen onBack={() => navigate("menu")} userCode={user?.code} />
        )}
        {screen === "partner" && (
          <PartnerScreen onBack={() => navigate(user ? "menu" : "login")} />
        )}
      </ThemeContext.Provider>
    </UserContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  parseApiError,
  useQuiz,
  useIndexedDB,
  useApi,
  useErrorHandler,
  useImageCompression,
  LoginScreen,
  ChatScreen,
  QuizScreen,
};