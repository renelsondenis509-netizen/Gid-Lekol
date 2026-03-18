import { useState, useRef, useEffect } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
const API = `${SUPABASE_URL}/functions/v1/ask-prof-lakay`;

// ─── APPEL EDGE FUNCTION ──────────────────────────────────────────────────────
async function callEdge(payload) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

// ─── GESTION D'ERREURS CENTRALISÉE ───────────────────────────────────────────
function parseApiError(err) {
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
}

// ─── COMPOSANT TOAST D'ERREUR ─────────────────────────────────────────────────
function ErrorToast({ error, onRetry, onDismiss }) {
  if (!error) return null;
  const canRetry = error.retry && onRetry;
  return (
    <div className="mx-3 mb-2 px-4 py-3 rounded-2xl flex gap-3 items-start"
      style={{ background: error.type === "quota" ? "#1e3a8a22" : "#7f1d1d33", border: `1px solid ${error.type === "quota" ? "#3b82f644" : "#ef444444"}`, animation: "fadeIn .3s ease both" }}>
      <span style={{ fontSize: 20, flexShrink: 0 }}>{error.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm" style={{ color: error.type === "quota" ? "#93c5fd" : "#fca5a5" }}>{error.message}</p>
        {error.detail && <p className="text-xs mt-0.5" style={{ color: error.type === "quota" ? "#6080c0" : "#f87171" }}>{error.detail}</p>}
        <div className="flex gap-2 mt-2">
          {canRetry && (
            <button onClick={onRetry} className="px-3 py-1 rounded-lg text-xs font-bold text-white"
              style={{ background: "linear-gradient(135deg,#d4002a,#ff6b35)" }}>🔄 Eseye Ankò</button>
          )}
          <button onClick={onDismiss} className="px-3 py-1 rounded-lg text-xs font-semibold"
            style={{ background: "#ffffff15", color: "#94a3b8" }}>Fèmen</button>
        </div>
      </div>
    </div>
  );
}

import { QUIZ_DATA } from "./quizData.js";

// ─── SHUFFLE ──────────────────────────────────────────────────────────────────
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── INDEXEDDB ────────────────────────────────────────────────────────────────
const DB_NAME = "GidNS4DB";
const DB_VERSION = 1;
const STORE_SCANS = "scans";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_SCANS)) {
        const store = db.createObjectStore(STORE_SCANS, { keyPath: "id", autoIncrement: true });
        store.createIndex("phone", "phone", { unique: false });
        store.createIndex("phone_date", ["phone", "scanDate"], { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbSaveScan(phone, entry) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SCANS, "readwrite");
      tx.objectStore(STORE_SCANS).add({ ...entry, phone });
      tx.oncomplete = () => resolve(true);
      tx.onerror    = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("IndexedDB indisponible, fallback localStorage", err);
    idbFallbackSave(phone, entry);
  }
}

async function idbGetScans(phone, limit = 50) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx      = db.transaction(STORE_SCANS, "readonly");
      const store   = tx.objectStore(STORE_SCANS);
      const results = [];
      // Curseur en ordre inverse (id décroissant = plus récent en premier)
      // On filtre par phone sans charger tout en mémoire
      const req = store.openCursor(null, "prev");
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor || results.length >= limit) { resolve(results); return; }
        if (cursor.value.phone === phone) results.push(cursor.value);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("IndexedDB lecture échouée, fallback localStorage", err);
    return idbFallbackGet(phone);
  }
}

async function idbDeleteScan(id) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SCANS, "readwrite");
      tx.objectStore(STORE_SCANS).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror    = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("IndexedDB suppression échouée", err);
  }
}

function idbFallbackSave(phone, entry) {
  try {
    const hist = idbFallbackGet(phone);
    hist.unshift({ ...entry, image: null, _fallback: true, id: Date.now() });
    localStorage.setItem(`history_${phone}`, JSON.stringify(hist.slice(0, 20)));
  } catch {}
}
function idbFallbackGet(phone) {
  try { return JSON.parse(localStorage.getItem(`history_${phone}`) || "[]"); } catch { return []; }
}

// ─── NOTES QUIZ /20 ───────────────────────────────────────────────────────────
function scoreToNote20(score, total) {
  if (total === 0) return 0;
  return Math.round((score / total) * 20 * 10) / 10;
}

function getMention(note20) {
  if (note20 >= 16) return { label: "Excellent",  color: "#22c55e", bg: "#14532d33", border: "#22c55e44", emoji: "🏆" };
  if (note20 >= 14) return { label: "Bien",        color: "#3b82f6", bg: "#1e3a8a33", border: "#3b82f644", emoji: "⭐" };
  if (note20 >= 12) return { label: "Assez Bien",  color: "#f59e0b", bg: "#78350f33", border: "#f59e0b44", emoji: "👍" };
  if (note20 >= 10) return { label: "Passable",    color: "#f97316", bg: "#7c2d1233", border: "#f9731644", emoji: "📖" };
  return               { label: "Insuffisant", color: "#ef4444", bg: "#7f1d1d33", border: "#ef444444", emoji: "📚" };
}

function getQuizGrades(phone) {
  try { return JSON.parse(localStorage.getItem(`grades_${phone}`) || "{}"); } catch { return {}; }
}

function saveQuizGrade(phone, subject, note20, score, total) {
  try {
    const grades = getQuizGrades(phone);
    if (!grades[subject]) grades[subject] = [];
    grades[subject].push({
      note20, score, total,
      date: new Date().toLocaleDateString("fr-HT", { timeZone: "America/Port-au-Prince" }),
      ts: Date.now(),
    });
    grades[subject] = grades[subject].slice(-10);
    localStorage.setItem(`grades_${phone}`, JSON.stringify(grades));
  } catch {}
}

// ─── COMPRESSION D'IMAGE ──────────────────────────────────────────────────────
function compressImage(base64, maxSize = 800, quality = 0.6) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxSize) { height = Math.round((height * maxSize) / width); width = maxSize; }
      else if (height > maxSize) { width = Math.round((width * maxSize) / height); height = maxSize; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(base64);
    img.src = base64;
  });
}

// ─── KATEX LOADER (CDN, chargé une seule fois) ────────────────────────────────
let katexReady = false;
let katexQueue = [];
function ensureKatex() {
  if (katexReady) return Promise.resolve();
  if (document.getElementById("katex-css")) {
    // CSS déjà injecté, attendre le script
    return new Promise(r => katexQueue.push(r));
  }
  // Injecter la CSS
  const link = document.createElement("link");
  link.id   = "katex-css";
  link.rel  = "stylesheet";
  link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css";
  document.head.appendChild(link);
  // Injecter le script
  const script = document.createElement("script");
  script.src   = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js";
  script.onload = () => {
    katexReady = true;
    katexQueue.forEach(r => r());
    katexQueue = [];
  };
  document.head.appendChild(script);
  return new Promise(r => katexQueue.push(r));
}

// ─── LATEX RENDERER ───────────────────────────────────────────────────────────
function LatexText({ content }) {
  const [html, setHtml] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Si pas de formule LaTeX → rendu simple
    if (!/\$/.test(content)) { setHtml(null); return; }
    ensureKatex().then(() => {
      if (cancelled) return;
      try {
        const result = content.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
          try { return window.katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false }); }
          catch { return `<code class="katex-fallback">${expr}</code>`; }
        }).replace(/\$([^$\n]+?)\$/g, (_, expr) => {
          try { return window.katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false }); }
          catch { return `<code class="katex-fallback">${expr}</code>`; }
        });
        setHtml(result);
      } catch { setHtml(null); }
    });
    return () => { cancelled = true; };
  }, [content]);

  // Rendu KaTeX disponible → HTML brut
  if (html) return (
    <span dangerouslySetInnerHTML={{ __html: html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") }}
      style={{ lineHeight: 1.7 }} />
  );

  // Fallback : rendu texte avec formatage minimal (pendant chargement ou sans formule)
  return (
    <span>
      {content.split("\n").map((line, i, arr) => (
        <span key={i}>
          <span dangerouslySetInnerHTML={{ __html:
            line
              .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
              .replace(/\$\$?([\s\S]+?)\$?\$/g, (_, e) =>
                `<code style="background:#0d2244;color:#93c5fd;padding:1px 4px;border-radius:4px;font-family:monospace;font-size:.85em">${e}</code>`)
          }} />
          {i < arr.length - 1 && <br />}
        </span>
      ))}
    </span>
  );
}
function MdText({ text }) {
  return (
    <>
      {text.split("\n").map((line, i, arr) => (
        <span key={i}>
          <span dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") }} />
          {i < arr.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

// ─── SPLASH ───────────────────────────────────────────────────────────────────
function SplashScreen({ onDone }) {
  useEffect(() => { setTimeout(onDone, 2000); }, []);
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center" style={{ background: "linear-gradient(160deg,#0a0f2e,#0d1b4b,#1a0505)" }}>
      <div style={{ animation: "popIn .6s cubic-bezier(.34,1.56,.64,1) both" }}>
        <div className="w-24 h-24 rounded-3xl flex items-center justify-center mb-5 mx-auto" style={{ background: "linear-gradient(135deg,#d4002a,#ff6b35)", boxShadow: "0 0 60px #d4002a55" }}>
          <span style={{ fontSize: 48 }}>📚</span>
        </div>
        <h1 className="text-center font-black text-white" style={{ fontSize: 36, fontFamily: "Georgia,serif" }}>
          Gid <span style={{ color: "#ff6b35" }}>NS4</span>
        </h1>
        <p className="text-center text-blue-300 mt-1 text-sm tracking-widest uppercase">Prof Lakay • NS4 Haïti</p>
      </div>
      <div className="absolute bottom-12 flex gap-2">
        {[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full bg-blue-400" style={{ animation: `pulse 1s ${i*0.2}s infinite` }} />)}
      </div>
      <style>{`
        @keyframes popIn{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}
        @keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}
        @keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
        @keyframes heartPop{0%{transform:scale(1)}50%{transform:scale(1.4)}100%{transform:scale(1)}}
      `}</style>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, onNavigate }) {
  const [phone, setPhone] = useState("");
  const [code, setCode]   = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError("");
    if (!phone.trim() || phone.length < 8) { setError("Antre yon nimewo telefòn valid."); return; }
    if (!code.trim()) { setError("Antre kòd lekòl ou a."); return; }
    setLoading(true);
    try {
      const result = await callEdge({ action: "validate_code", phone: phone.trim(), schoolCode: code.toUpperCase().trim() });
      if (!result.valid) { setError(result.reason || "Kòd la pa valid."); setLoading(false); return; }
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
  };

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "linear-gradient(160deg,#0a0f2e,#0d1b4b,#1a0505)" }}>
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: "linear-gradient(135deg,#d4002a,#ff6b35)", boxShadow: "0 0 40px #d4002a44" }}>
          <span style={{ fontSize: 32 }}>📚</span>
        </div>
        <h2 className="text-white font-black text-2xl mb-1" style={{ fontFamily: "Georgia,serif" }}>Gid <span style={{ color: "#ff6b35" }}>NS4</span></h2>
        <p className="text-blue-300 text-xs mb-6 tracking-wider">Asistan IA pou elèv NS4</p>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-6" style={{ background: "#14532d33", border: "1px solid #22c55e33" }}>
          <span>🔒</span>
          <span className="text-green-300 text-xs font-medium">Koneksyon sécurisé • Données protégées</span>
        </div>
        <div className="w-full max-w-sm space-y-4">
          <div>
            <label className="text-blue-300 text-xs font-semibold tracking-wider uppercase mb-1.5 block">📱 Nimewo Telefòn</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Ex: 50934567890"
              className="w-full rounded-xl px-4 py-3.5 text-white placeholder-blue-800 font-medium outline-none"
              style={{ background: "#ffffff0d", border: "1.5px solid #ffffff18" }} />
          </div>
          <div>
            <label className="text-blue-300 text-xs font-semibold tracking-wider uppercase mb-1.5 block">🔑 Kòd Etablisman</label>
            <input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Ex: DEMO-2026"
              className="w-full rounded-xl px-4 py-3.5 text-white placeholder-blue-800 font-mono font-bold outline-none tracking-widest"
              style={{ background: "#ffffff0d", border: "1.5px solid #ffffff18" }} />
          </div>
          {error && (
            <div className="rounded-xl px-4 py-3 text-sm font-medium" style={{ background: "#d4002a22", border: "1px solid #d4002a55", color: "#ff8080" }}>⚠️ {error}</div>
          )}
          <button onClick={handleLogin} disabled={loading}
            className="w-full rounded-xl py-4 font-black text-white flex items-center justify-center gap-2 active:scale-95 transition-transform"
            style={{ background: loading ? "#333" : "linear-gradient(135deg,#d4002a,#ff6b35)", boxShadow: loading ? "none" : "0 4px 24px #d4002a44" }}>
            {loading ? "⏳ Ap vérifier..." : "→ Konekte"}
          </button>
        </div>
        <p className="text-blue-900 text-xs mt-8 text-center">Pa gen kòd ? Pale ak direksyon lekòl ou a.</p>
      </div>
      <div className="px-6 pb-6 flex justify-center gap-6">
        <button onClick={() => onNavigate("payment")} className="text-blue-400 text-xs underline">Peman</button>
        <button onClick={() => onNavigate("partner")} className="text-blue-400 text-xs underline">Vin Patnè</button>
      </div>
    </div>
  );
}

// ─── BOTTOM NAV (5 tabs) ──────────────────────────────────────────────────────
function BottomNav({ active, onNavigate }) {
  const tabs = [
    { id: "chat",        icon: "💬", label: "Chat" },
    { id: "quiz",        icon: "🧠", label: "Quiz" },
    { id: "leaderboard", icon: "🏆", label: "Klasman" },
    { id: "history",     icon: "📋", label: "Istwa" },
    { id: "menu",        icon: "☰",  label: "Menu" },
  ];
  return (
    <div className="flex border-t" style={{ background: "#0a0f2e", borderColor: "#ffffff10" }}>
      {tabs.map(tab => (
        <button key={tab.id} onClick={() => onNavigate(tab.id)}
          className="flex-1 flex flex-col items-center py-2 gap-0.5 active:scale-90 transition-transform">
          <span style={{ fontSize: 18 }}>{tab.icon}</span>
          <span style={{ fontSize: 9, fontWeight: 600, color: active === tab.id ? "#ff6b35" : "#4b5ea8" }}>{tab.label}</span>
          {active === tab.id && <div className="w-3 h-0.5 rounded-full" style={{ background: "#ff6b35" }} />}
        </button>
      ))}
    </div>
  );
}

// ─── EXPIRY BANNER ────────────────────────────────────────────────────────────
function ExpiryBanner({ daysRemaining }) {
  if (!daysRemaining || daysRemaining > 7) return null;
  const isUrgent = daysRemaining <= 2;
  return (
    <div className="px-4 py-2 text-xs text-center font-semibold" style={{ background: isUrgent ? "#d4002a" : "#92400e", color: "white" }}>
      {isUrgent ? "🚨" : "⚠️"} Kòd ou a ekspire nan {daysRemaining} jou — Kontakte direksyon lekòl ou
    </div>
  );
}

// ─── CHAT ─────────────────────────────────────────────────────────────────────
function ChatScreen({ user, onNavigate }) {
  const [messages, setMessages] = useState([{
    role: "assistant",
    content: `Bonjou ! Mwen se **Prof Lakay** 👋\n\nJe suis ton assistant IA pour le **Bac NS4**.\n\n📚 Matières disponibles pour toi :\n${user.subjects.map(s => `• ${s}`).join("\n")}\n\n**An n al travay ! 💪**`
  }]);
  const [input, setInput]       = useState("");
  const [image, setImage]       = useState(null);
  const [loading, setLoading]   = useState(false);
  const [scans, setScans]       = useState(user.scansToday || 0);
  const [apiError, setApiError] = useState(null);
  const [lastPayload, setLastPayload] = useState(null);
  const [activeSubject, setActiveSubject] = useState(user.subjects[0] || null);
  const bottomRef = useRef(null);
  const fileRef   = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const detectSubject = (text) => {
    const t = text.toLowerCase();
    if (t.includes("bio") || t.includes("cellule") || t.includes("adn")) return "Biologie";
    if (t.includes("chim") || t.includes("molécule") || t.includes("acide")) return "Chimie";
    if (t.includes("physi") || t.includes("vitesse") || t.includes("force")) return "Physique";
    if (t.includes("philo") || t.includes("socrate")) return "Philosophie";
    if (t.includes("social") || t.includes("haïti")) return "Sciences Sociales";
    if (t.includes("littér") || t.includes("roman")) return "Littérature Haïtienne";
    return user.subjects[0] || "Général";
  };

  const sendMessage = async (retryPayload = null) => {
    const payload = retryPayload || { userMsg: { role: "user", content: input.trim() || "Analyse cet exercice.", image }, currentInput: input.trim() };
    if ((!payload.currentInput && !payload.userMsg.image) || loading || scans >= user.dailyScans) return;
    if (!retryPayload) { setMessages(p => [...p, payload.userMsg]); setInput(""); setImage(null); }
    setApiError(null); setLoading(true);
    try {
      const detectedSubject = activeSubject || detectSubject(payload.currentInput);
      const result = await callEdge({
        action: "ask", phone: user.phone, schoolCode: user.code,
        message: payload.userMsg.content,
        imageBase64: payload.userMsg.image ? payload.userMsg.image.split(",")[1] : null,
        history: messages.slice(-6), subject: detectedSubject,
      });
      setMessages(p => [...p, { role: "assistant", content: result.reply }]);
      setScans(result.scansUsed || scans + 1);
      setLastPayload(null);
      await idbSaveScan(user.phone, {
        date: new Date().toLocaleString("fr-HT", { timeZone: "America/Port-au-Prince" }),
        scanDate: new Date().toISOString().split("T")[0],
        subject: detectedSubject, image: payload.userMsg.image || null,
        response: result.reply, scansUsed: result.scansUsed, dailyLimit: user.dailyScans,
      });
    } catch (e) {
      const parsed = parseApiError(e);
      if (parsed.type === "quota") setScans(user.dailyScans);
      setApiError(parsed);
      if (parsed.retry) setLastPayload(payload);
    }
    setLoading(false);
  };

  const handleImage = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => { setImage(await compressImage(ev.target.result)); };
    reader.readAsDataURL(file);
  };

  const remaining = user.dailyScans - scans;

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "#070d1f" }}>
      <ExpiryBanner daysRemaining={user.daysRemaining} />
      <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ background: "#0a0f2e", borderColor: "#ffffff10" }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#d4002a,#ff6b35)" }}>
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
          <div className={`text-xs font-bold ${remaining <= 0 ? "text-red-400" : remaining === 1 ? "text-orange-300" : "text-green-400"}`}>
            {remaining} scan{remaining !== 1 ? "s" : ""} restant{remaining !== 1 ? "s" : ""}
          </div>
          <div className="text-blue-900 text-xs">/ {user.dailyScans} par jour</div>
        </div>
      </div>
      <div className="px-4 py-1.5 flex gap-1.5 overflow-x-auto" style={{ background: "#080e22", borderBottom: "1px solid #ffffff08" }}>
        {user.subjects.map((s, i) => (
          <button key={i} onClick={() => setActiveSubject(s)}
            className="flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium transition-all"
            style={{ background: activeSubject === s ? "#1a4fd6" : "#1e3a8a33", color: activeSubject === s ? "#ffffff" : "#93c5fd", border: activeSubject === s ? "1px solid #3b82f6" : "1px solid #1e3a8a44" }}>
            {s}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className="flex gap-2" style={{ justifyContent: msg.role === "user" ? "flex-end" : "flex-start", animation: "fadeIn .3s ease both" }}>
            {msg.role === "assistant" && (
              <div className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center mt-1" style={{ background: "linear-gradient(135deg,#d4002a,#ff6b35)" }}>
                <span style={{ fontSize: 16 }}>🧑‍🏫</span>
              </div>
            )}
            <div className="max-w-xs">
              {msg.image && <img src={msg.image} alt="scan" className="rounded-xl mb-2 max-h-40 object-contain" style={{ border: "1px solid #ffffff20" }} />}
              <div className="px-4 py-3 text-sm leading-relaxed"
                style={{
                  background: msg.role === "user" ? "linear-gradient(135deg,#1a4fd6,#2563eb)" : "#0f1e4a",
                  border: msg.role === "assistant" ? "1px solid #1e3a8a33" : "none",
                  color: "#e0e8ff",
                  borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                }}>
                <LatexText content={msg.content} />
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-2 items-start">
            <div className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: "linear-gradient(135deg,#d4002a,#ff6b35)" }}>
              <span style={{ fontSize: 16 }}>🧑‍🏫</span>
            </div>
            <div className="px-4 py-3 rounded-2xl" style={{ background: "#0f1e4a" }}>
              <div className="flex gap-1.5 items-center">
                {[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full bg-blue-400" style={{ animation: `bounce 1s ${i*0.2}s infinite` }} />)}
                <span className="text-blue-400 text-xs ml-2">Prof Lakay ap reflechi...</span>
              </div>
            </div>
          </div>
        )}
        {remaining <= 0 && (
          <div className="mx-2 px-4 py-3 rounded-2xl text-sm text-center" style={{ background: "#d4002a22", border: "1px solid #d4002a44", color: "#ff8080" }}>
            🔒 Ou rive nan limit {user.dailyScans} scan pou jodi a. Tounen demen !
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <ErrorToast error={apiError} onRetry={lastPayload ? () => sendMessage(lastPayload) : null} onDismiss={() => { setApiError(null); setLastPayload(null); }} />
      <div className="px-3 py-3 border-t" style={{ background: "#0a0f2e", borderColor: "#ffffff10" }}>
        {image && (
          <div className="flex items-center gap-2 mb-2 px-2">
            <img src={image} alt="" className="w-10 h-10 rounded-lg object-cover" />
            <span className="text-blue-300 text-xs flex-1">✅ Image compressée et prête</span>
            <button onClick={() => setImage(null)} className="text-red-400 text-lg">✕</button>
          </div>
        )}
        <div className="flex gap-2 items-end">
          <button onClick={() => fileRef.current?.click()}
            className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: "#1e3a8a" }}>
            <span>📷</span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleImage}
            style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }} />
          <textarea value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              // Sur mobile Android/iOS, isComposing = true pendant la saisie prédictive
              // → on ne déclenche pas l'envoi pendant la composition (suggestions clavier)
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={remaining <= 0 ? "Limit jou a rive..." : "Poze yon kesyon oswa analize yon egzèsis..."}
            rows={1} disabled={remaining <= 0}
            className="flex-1 rounded-xl px-4 py-3 text-sm outline-none resize-none"
            style={{ background: "#ffffff0d", border: "1.5px solid #ffffff15", maxHeight: 80, color: "#e0e8ff" }} />
          <button onClick={() => sendMessage()} disabled={loading || remaining <= 0}
            className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center"
            style={{ background: (loading || remaining <= 0) ? "#1a1a2e" : "linear-gradient(135deg,#d4002a,#ff6b35)" }}>
            <span>✈</span>
          </button>
        </div>
      </div>
      <BottomNav active="chat" onNavigate={onNavigate} />
    </div>
  );
}

// ─── QUIZ (Style Duolingo — cœurs + streak + mode infini) ────────────────────
function QuizScreen({ user, onNavigate }) {
  const [phase, setPhase]           = useState("select");
  const [subject, setSubject]       = useState(null);
  const [shuffledQs, setShuffledQs] = useState([]);
  const [qIndex, setQIndex]         = useState(0);
  const [selected, setSelected]     = useState(null);
  const [score, setScore]           = useState(0);
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [hearts, setHearts]         = useState(3);
  const [streak, setStreak]         = useState(0);
  const [maxStreak, setMaxStreak]   = useState(0);
  const [wrongAnswers, setWrongAnswers] = useState([]);
  const [shaking, setShaking]       = useState(false);
  const [round, setRound]           = useState(1);
  const [roundScore, setRoundScore] = useState(0);
  const [usedQKeys, setUsedQKeys]   = useState(new Set());
  const [openQ, setOpenQ]           = useState("");
  const [openAnswer, setOpenAnswer] = useState("");
  const [aiCorrection, setAiCorrection] = useState("");
  const [loadingAI, setLoadingAI]   = useState(false);

  const availableSubjects = Object.keys(QUIZ_DATA).filter(s => user.subjects.includes(s));
  const currentQ = shuffledQs[qIndex];

  const startQCM = (sub) => {
    const all = shuffleArray(QUIZ_DATA[sub]);
    const first10 = all.slice(0, 10);
    const used = new Set(first10.map(q => q.q));
    setSubject(sub);
    setShuffledQs(first10);
    setUsedQKeys(used);
    setPhase("qcm");
    setQIndex(0); setScore(0); setTotalAnswered(0); setRoundScore(0);
    setHearts(3); setStreak(0); setMaxStreak(0);
    setWrongAnswers([]); setSelected(null); setRound(1);
  };

  const saveScoreToSupabase = async (finalScore, finalTotal, finalStreak) => {
    if (finalTotal === 0 || !subject) return;
    const note20 = scoreToNote20(finalScore, finalTotal);
    saveQuizGrade(user.phone, subject, note20, finalScore, finalTotal);
    try {
      await callEdge({
        action: "save_quiz_score",
        phone: user.phone, schoolCode: user.code,
        subject, score: finalScore, total: finalTotal,
        note20, streak: finalStreak,
      });
    } catch (e) { console.warn("Score save failed", e); }
  };

  const handleChoice = (idx) => {
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
      // handleChoice décrémente hearts — handleNext lira la valeur déjà mise à jour
      setHearts(h => h - 1);
      setStreak(0);
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
      setWrongAnswers(p => [...p.slice(-4), {
        q: currentQ.q, selected: idx, correctIdx: currentQ.answer,
        choices: currentQ.choices, note: currentQ.note,
      }]);
    }
  };

  // handleNext utilise hearts tel qu'il est après handleChoice (valeur déjà décrémentée)
  const handleNext = async () => {
    // hearts est déjà à jour : si handleChoice a perdu le dernier cœur, hearts === 0 ici
    if (hearts <= 0) {
      await saveScoreToSupabase(score, totalAnswered, maxStreak);
      setPhase("gameover");
      return;
    }
    const next = qIndex + 1;
    // Fin du round de 10 questions → écran Bravo
    if (next >= shuffledQs.length) {
      await saveScoreToSupabase(score, totalAnswered, maxStreak);
      setPhase("bravo");
      return;
    }
    setQIndex(next);
    setSelected(null);
  };

  // Continuer avec 10 nouvelles questions différentes
  const continueQuiz = () => {
    const all = QUIZ_DATA[subject] || [];
    // Filtrer les questions déjà vues
    const unseen = all.filter(q => !usedQKeys.has(q.q));
    // Si toutes vues, repartir depuis zéro
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
  };

  const submitOpen = async () => {
    if (!openQ.trim() || !openAnswer.trim()) return;
    setLoadingAI(true); setAiCorrection("");
    try {
      const result = await callEdge({
        action: "ask", phone: user.phone, schoolCode: user.code,
        message: `Corrige la réponse de cet élève NS4.\n\nQuestion : ${openQ}\n\nRéponse de l'élève : ${openAnswer}\n\nDonne une note /10, identifie les erreurs et donne la bonne réponse complète.`,
        imageBase64: null, history: [], subject: user.subjects[0],
      });
      setAiCorrection(result.reply);
    } catch (e) {
      setAiCorrection(`${parseApiError(e).icon} ${parseApiError(e).message}`);
    }
    setLoadingAI(false);
  };

  const icons = ["📗","⚗️","⚡","📖","🌍","✍️","📚"];
  const allIcons = Object.keys(QUIZ_DATA).reduce((acc, s, i) => { acc[s] = icons[i % icons.length]; return acc; }, {});

  // ── SELECT ──
  if (phase === "select") return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "#070d1f" }}>
      <div className="px-4 py-4 border-b flex items-center gap-3" style={{ background: "#0a0f2e", borderColor: "#ffffff10" }}>
        <span style={{ fontSize: 24 }}>🧠</span>
        <div>
          <h2 className="text-white font-bold">Quiz NS4</h2>
          <p className="text-blue-400 text-xs">{availableSubjects.length} matière{availableSubjects.length > 1 ? "s" : ""} disponib</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Mode infini info */}
        <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: "#1a4fd622", border: "1px solid #1a4fd644" }}>
          <span style={{ fontSize: 20 }}>❤️❤️❤️</span>
          <div>
            <div className="text-white font-semibold text-xs">Mode Duolingo — 3 kè</div>
            <div className="text-blue-400 text-xs">Kesyon enfini • Jwe jouk ou pèdi 3 kè</div>
          </div>
        </div>
        <button onClick={() => setPhase("open")}
          className="w-full px-5 py-4 rounded-2xl text-left flex items-center gap-4 active:scale-95 transition-transform"
          style={{ background: "linear-gradient(135deg,#1a4fd6,#2563eb)", boxShadow: "0 4px 20px #1a4fd633" }}>
          <span style={{ fontSize: 28 }}>✍️</span>
          <div>
            <div className="text-white font-bold">Question Ouverte</div>
            <div className="text-blue-200 text-xs">Skriv repons ou, Prof Lakay ap korije l</div>
          </div>
          <span className="ml-auto text-blue-300 text-xl">›</span>
        </button>
        <p className="text-blue-600 text-xs text-center py-1">— oswa chwazi yon matière pou QCM —</p>
        {availableSubjects.map(sub => (
          <button key={sub} onClick={() => startQCM(sub)}
            className="w-full px-5 py-4 rounded-2xl text-left flex items-center gap-4 active:scale-95 transition-transform"
            style={{ background: "#0f1e4a", border: "1px solid #1e3a8a33" }}>
            <span style={{ fontSize: 26 }}>{allIcons[sub]}</span>
            <div className="flex-1">
              <div className="text-white font-semibold text-sm">{sub}</div>
              <div className="text-blue-500 text-xs">{QUIZ_DATA[sub].length} kesyon • Mode infini 🔄</div>
            </div>
            <span className="text-blue-600 text-xl">›</span>
          </button>
        ))}
        {Object.keys(QUIZ_DATA).filter(s => !user.subjects.includes(s)).map(sub => (
          <div key={sub} className="w-full px-5 py-4 rounded-2xl flex items-center gap-4 opacity-30"
            style={{ background: "#0f1e4a", border: "1px solid #1e3a8a22" }}>
            <span style={{ fontSize: 26 }}>{allIcons[sub]}</span>
            <div className="flex-1">
              <div className="text-white font-semibold text-sm">{sub}</div>
              <div className="text-blue-700 text-xs">Pa disponib ak kòd lekòl ou</div>
            </div>
            <span className="text-blue-800">🔒</span>
          </div>
        ))}
      </div>
      <BottomNav active="quiz" onNavigate={onNavigate} />
    </div>
  );

  // ── OPEN QUESTION ──
  if (phase === "open") return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "#070d1f" }}>
      <div className="px-4 py-4 border-b flex items-center gap-3" style={{ background: "#0a0f2e", borderColor: "#ffffff10" }}>
        <button onClick={() => { setPhase("select"); setAiCorrection(""); setOpenQ(""); setOpenAnswer(""); }} className="text-blue-400 text-xl">←</button>
        <h2 className="text-white font-bold">Question Ouverte ✍️</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
        <div>
          <label className="text-blue-300 text-xs font-semibold tracking-wider uppercase mb-2 block">Ta Kesyon</label>
          <textarea value={openQ} onChange={e => setOpenQ(e.target.value)} rows={3}
            placeholder="Ex: Expliquez le cycle de Krebs..."
            className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none"
            style={{ background: "#0f1e4a", border: "1.5px solid #1e3a8a44", color: "#e0e8ff" }} />
        </div>
        <div>
          <label className="text-blue-300 text-xs font-semibold tracking-wider uppercase mb-2 block">Repons Ou</label>
          <textarea value={openAnswer} onChange={e => setOpenAnswer(e.target.value)} rows={5}
            placeholder="Ekri repons ou isit..."
            className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none"
            style={{ background: "#0f1e4a", border: "1.5px solid #1e3a8a44", color: "#e0e8ff" }} />
        </div>
        <button onClick={submitOpen} disabled={loadingAI || !openQ.trim() || !openAnswer.trim()}
          className="w-full py-4 rounded-xl font-bold text-white flex items-center justify-center gap-2"
          style={{ background: loadingAI ? "#333" : "linear-gradient(135deg,#d4002a,#ff6b35)" }}>
          {loadingAI ? <><span className="animate-spin">⏳</span> Prof Lakay ap korije...</> : "🧑‍🏫 Voye bay Prof Lakay"}
        </button>
        {aiCorrection && (
          <div className="rounded-2xl p-4" style={{ background: "#0f1e4a", border: "1px solid #1e3a8a33", animation: "fadeIn .4s ease both" }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#d4002a,#ff6b35)" }}>
                <span style={{ fontSize: 14 }}>🧑‍🏫</span>
              </div>
              <span className="text-white font-bold text-sm">Kòreksyon Prof Lakay</span>
            </div>
            <div className="text-sm leading-relaxed" style={{ color: "#e0e8ff" }}>
              <LatexText content={aiCorrection} />
            </div>
          </div>
        )}
      </div>
      <BottomNav active="quiz" onNavigate={onNavigate} />
    </div>
  );

  // ── QCM (Mode Duolingo) ──
  if (phase === "qcm" && currentQ) return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "#070d1f" }}>
      {/* Header avec cœurs + streak */}
      <div className="px-4 py-3 border-b" style={{ background: "#0a0f2e", borderColor: "#ffffff10" }}>
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => setPhase("select")} className="text-blue-400 text-xl">←</button>
          <h2 className="text-white font-bold flex-1 text-sm">{subject}</h2>
          {/* Streak */}
          {streak >= 2 && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: "#f97316" + "33", border: "1px solid #f9731644" }}>
              <span style={{ fontSize: 14 }}>🔥</span>
              <span className="text-orange-400 font-black text-sm">{streak}</span>
            </div>
          )}
          {/* Cœurs */}
          <div className="flex gap-1" style={{ animation: shaking ? "shake .4s ease" : "none" }}>
            {[0,1,2].map(i => (
              <span key={i} style={{ fontSize: 20, opacity: i < hearts ? 1 : 0.15, filter: i < hearts ? "none" : "grayscale(1)" }}>❤️</span>
            ))}
          </div>
        </div>
        {/* Score compact */}
        <div className="flex items-center justify-between">
          <span className="text-blue-500 text-xs">Wònn {round} • {totalAnswered} kesyon</span>
          <span className="text-green-400 text-xs font-bold">{score} ✅</span>
        </div>
        {/* Barre de progression de la session (score/total) */}
        <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "#0f1e4a" }}>
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: totalAnswered > 0 ? `${(score / totalAnswered) * 100}%` : "0%", background: "linear-gradient(90deg,#22c55e,#86efac)" }} />
        </div>
      </div>

      <div className="flex-1 px-4 py-5 flex flex-col gap-4 overflow-y-auto">
        <div className="rounded-2xl px-5 py-5" style={{ background: "#0f1e4a", border: "1px solid #1e3a8a33" }}>
          <p className="text-white font-semibold text-base leading-relaxed">{currentQ.q}</p>
        </div>
        <div className="space-y-3">
          {currentQ.choices.map((choice, idx) => {
            let bg = "#0f1e4a", border = "#1e3a8a33", color = "#e0e8ff";
            if (selected !== null) {
              if (idx === currentQ.answer) { bg = "#14532d33"; border = "#22c55e66"; color = "#86efac"; }
              else if (idx === selected) { bg = "#7f1d1d33"; border = "#ef444466"; color = "#fca5a5"; }
            }
            return (
              <button key={idx} onClick={() => handleChoice(idx)}
                className="w-full px-5 py-4 rounded-2xl text-left font-medium text-sm flex items-center gap-3 active:scale-95 transition-all"
                style={{ background: bg, border: `1.5px solid ${border}`, color }}>
                <span className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0"
                  style={{ background: selected !== null && idx === currentQ.answer ? "#22c55e" : selected === idx ? "#ef4444" : "#1e3a8a", color: "white" }}>
                  {["A","B","C","D"][idx]}
                </span>
                {choice}
                {selected !== null && idx === currentQ.answer && <span className="ml-auto">✅</span>}
                {selected !== null && idx === selected && idx !== currentQ.answer && <span className="ml-auto">❌</span>}
              </button>
            );
          })}
        </div>

        {/* Explication + bouton suivant */}
        {selected !== null && (
          <div style={{ animation: "fadeIn .3s ease both" }}>
            {currentQ.note && (
              <div className="rounded-2xl px-4 py-3 mb-3" style={{ background: selected === currentQ.answer ? "#14532d33" : "#7f1d1d22", border: `1px solid ${selected === currentQ.answer ? "#22c55e33" : "#ef444433"}` }}>
                <p className="text-xs leading-relaxed" style={{ color: selected === currentQ.answer ? "#86efac" : "#fca5a5" }}>
                  💡 {currentQ.note}
                </p>
              </div>
            )}
            <button onClick={handleNext}
              className="w-full py-4 rounded-2xl font-bold text-white active:scale-95 transition-transform"
              style={{ background: hearts <= 0 ? "linear-gradient(135deg,#d4002a,#ef4444)" : "linear-gradient(135deg,#1a4fd6,#2563eb)" }}>
              {hearts <= 0 ? "💔 Wè Rezilta" : "Kesyon Suivant →"}
            </button>
          </div>
        )}
      </div>
      <BottomNav active="quiz" onNavigate={onNavigate} />
    </div>
  );

  // ── GAME OVER ──
  // ── BRAVO (fin d'un round de 10 questions) ──
  if (phase === "bravo") {
    const note20 = scoreToNote20(roundScore, 10);
    const mention = getMention(note20);
    const allCount = (QUIZ_DATA[subject] || []).length;
    const seenCount = usedQKeys.size;
    const hasMore = (allCount - seenCount) >= 5;
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center px-6" style={{ background: "linear-gradient(160deg,#0a0f2e,#0d1b4b,#1a0505)" }}>
        <div className="w-full max-w-sm space-y-5" style={{ animation: "popIn .5s cubic-bezier(.34,1.56,.64,1) both" }}>
          {/* Emoji + titre */}
          <div className="text-center">
            <div style={{ fontSize: 64 }}>🎉</div>
            <h2 className="text-white font-black text-3xl mt-2">Bravo !</h2>
            <p className="text-blue-300 text-sm mt-1">{subject} • Wònn {round}</p>
          </div>

          {/* Score du round */}
          <div className="rounded-3xl px-5 py-5 text-center" style={{ background: mention.bg, border: `2px solid ${mention.border}` }}>
            <div style={{ fontSize: 40 }}>{mention.emoji}</div>
            <div className="font-black mt-1" style={{ fontSize: 48, color: mention.color, lineHeight: 1 }}>
              {note20}<span className="text-xl" style={{ color: mention.color + "99" }}>/20</span>
            </div>
            <div className="text-white font-bold text-lg mt-1">{mention.label}</div>
            <div className="text-blue-300 text-sm mt-1">{roundScore}/10 kòrèk • {streak > 0 ? `🔥 Streak ${streak}` : ""}</div>
          </div>

          {/* Stats globales */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: "✅", val: score,     label: "Total kòrèk" },
              { icon: "🔥", val: maxStreak, label: "Max streak" },
              { icon: "📚", val: `${seenCount}/${allCount}`, label: "Kesyon vues" },
            ].map((s, i) => (
              <div key={i} className="rounded-2xl p-3 text-center" style={{ background: "#0f1e4a", border: "1px solid #1e3a8a33" }}>
                <div style={{ fontSize: 18 }}>{s.icon}</div>
                <div className="text-white font-black text-base">{s.val}</div>
                <div className="text-blue-500 text-xs">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Question */}
          <p className="text-white font-bold text-center text-lg">Veux-tu kontinye ?</p>

          {/* Boutons */}
          <div className="flex gap-3">
            <button onClick={continueQuiz} disabled={!hasMore && seenCount >= allCount}
              className="flex-1 py-4 rounded-2xl font-black text-white text-lg active:scale-95 transition-transform"
              style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", boxShadow: "0 4px 20px #22c55e44" }}>
              ✅ Wi
            </button>
            <button onClick={() => setPhase("select")}
              className="flex-1 py-4 rounded-2xl font-black text-lg active:scale-95 transition-transform"
              style={{ background: "#0f1e4a", color: "#93c5fd", border: "1px solid #1e3a8a33" }}>
              ❌ Non
            </button>
          </div>

          {!hasMore && seenCount >= allCount && (
            <p className="text-yellow-400 text-xs text-center">🏆 Ou fini tout {allCount} kesyon yo ! Bravo !</p>
          )}
        </div>
      </div>
    );
  }

  if (phase === "gameover") {
    const note20  = scoreToNote20(score, totalAnswered);
    const mention = getMention(note20);
    return (
      <div className="fixed inset-0 flex flex-col" style={{ background: "#070d1f" }}>
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
          {/* Header Game Over */}
          <div className="text-center" style={{ animation: "popIn .5s cubic-bezier(.34,1.56,.64,1) both" }}>
            <div style={{ fontSize: 64 }}>💔</div>
            <h2 className="text-white font-black text-3xl mt-2">Game Over</h2>
            <p className="text-blue-400 text-sm mt-1">{subject}</p>
          </div>

          {/* Note principale */}
          <div className="rounded-3xl px-5 py-5 text-center"
            style={{ background: mention.bg, border: `2px solid ${mention.border}` }}>
            <div style={{ fontSize: mention.emoji === "🏆" ? 40 : 36 }}>{mention.emoji}</div>
            <div className="font-black mt-1" style={{ fontSize: 52, color: mention.color, lineHeight: 1 }}>
              {note20}<span className="text-xl font-bold" style={{ color: mention.color + "99" }}>/20</span>
            </div>
            <div className="text-white font-bold text-lg mt-1">{mention.label}</div>
            <div className="text-blue-300 text-sm mt-1">{score}/{totalAnswered} kòrèk • {subject}</div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: "🔥", val: maxStreak, label: "Max Streak" },
              { icon: "✅", val: score,     label: "Kòrèk" },
              { icon: "❓", val: totalAnswered, label: "Total" },
            ].map((stat, i) => (
              <div key={i} className="rounded-2xl p-3 text-center" style={{ background: "#0f1e4a", border: "1px solid #1e3a8a33" }}>
                <div style={{ fontSize: 22 }}>{stat.icon}</div>
                <div className="text-white font-black text-xl">{stat.val}</div>
                <div className="text-blue-500 text-xs">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Dernières erreurs */}
          {wrongAnswers.length > 0 && (
            <div className="rounded-2xl p-4" style={{ background: "#0f1e4a", border: "1px solid #1e3a8a33" }}>
              <h3 className="text-white font-bold text-sm mb-3">📝 Dènye Erè Ou :</h3>
              <div className="space-y-3">
                {wrongAnswers.slice(-3).map((a, i) => (
                  <div key={i} className="rounded-xl px-3 py-2" style={{ background: "#7f1d1d22", border: "1px solid #ef444433" }}>
                    <p className="text-white text-xs font-medium mb-1">{a.q}</p>
                    <p className="text-xs" style={{ color: "#fca5a5" }}>❌ {a.choices[a.selected]}</p>
                    <p className="text-xs text-green-400">✅ {a.choices[a.correctIdx]}</p>
                    {a.note && <p className="text-xs mt-1" style={{ color: "#93c5fd" }}>💡 {a.note}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <button onClick={() => startQCM(subject)} className="w-full py-4 rounded-2xl font-bold text-white"
            style={{ background: "linear-gradient(135deg,#d4002a,#ff6b35)" }}>🔄 Eseye Ankò</button>
          <button onClick={() => setPhase("select")} className="w-full py-4 rounded-2xl font-bold"
            style={{ background: "#0f1e4a", color: "#93c5fd", border: "1px solid #1e3a8a33" }}>← Chwazi lòt matière</button>
        </div>
        <BottomNav active="quiz" onNavigate={onNavigate} />
      </div>
    );
  }

  return null;
}

// ─── LEADERBOARD ──────────────────────────────────────────────────────────────
function LeaderboardScreen({ user, onNavigate }) {
  const [tab, setTab]       = useState("bestNote");
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    callEdge({ action: "get_leaderboard", phone: user.phone, schoolCode: user.code })
      .then(d => setData(d))
      .catch(e => setError(parseApiError(e).message))
      .finally(() => setLoading(false));
  }, []);

  const tabs = [
    { id: "bestNote",     icon: "🏆", label: "Meilleure Note",  valueLabel: "/20" },
    { id: "totalCorrect", icon: "🔥", label: "Total Kòrèk",     valueLabel: " pts" },
    { id: "thisWeek",     icon: "📅", label: "Semèn Sa",        valueLabel: " pts" },
  ];

  const currentTab = tabs.find(t => t.id === tab);
  const board = data ? data[tab] : [];
  const colors = ["#fbbf24","#94a3b8","#cd7c32","#3b82f6","#22c55e","#a855f7","#f97316","#14b8a6","#ec4899","#6366f1"];
  const medalEmojis = ["🥇","🥈","🥉"];

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "#070d1f" }}>
      {/* Header */}
      <div className="px-4 py-4 border-b" style={{ background: "#0a0f2e", borderColor: "#ffffff10" }}>
        <div className="flex items-center gap-3 mb-3">
          <span style={{ fontSize: 24 }}>🏆</span>
          <div>
            <h2 className="text-white font-bold">Klasman</h2>
            <p className="text-blue-400 text-xs">{user.school}</p>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex gap-2">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
              style={{
                background: tab === t.id ? "linear-gradient(135deg,#d4002a,#ff6b35)" : "#0f1e4a",
                color: tab === t.id ? "white" : "#4b5ea8",
                border: tab === t.id ? "none" : "1px solid #1e3a8a33",
              }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="flex gap-2">
              {[0,1,2].map(i => <div key={i} className="w-2.5 h-2.5 rounded-full bg-blue-400" style={{ animation: `bounce 1s ${i*0.2}s infinite` }} />)}
            </div>
            <p className="text-blue-500 text-sm">Chajman klasman an...</p>
          </div>
        )}

        {error && (
          <div className="rounded-2xl px-4 py-4 text-center" style={{ background: "#7f1d1d22", border: "1px solid #ef444433" }}>
            <p className="text-red-400 text-sm">⚠️ {error}</p>
            <button onClick={() => { setLoading(true); setError(null); callEdge({ action: "get_leaderboard", phone: user.phone, schoolCode: user.code }).then(d => setData(d)).catch(e => setError(parseApiError(e).message)).finally(() => setLoading(false)); }}
              className="mt-3 px-4 py-2 rounded-xl text-xs font-bold text-white"
              style={{ background: "linear-gradient(135deg,#d4002a,#ff6b35)" }}>
              🔄 Eseye Ankò
            </button>
          </div>
        )}

        {!loading && !error && board?.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 space-y-3">
            <span style={{ fontSize: 56 }}>📊</span>
            <p className="text-blue-400 text-center text-sm">Pa gen done encore.<br />Fè kèk quiz pou parèt nan klasman an !</p>
            <button onClick={() => onNavigate("quiz")} className="px-6 py-3 rounded-xl font-bold text-white text-sm"
              style={{ background: "linear-gradient(135deg,#d4002a,#ff6b35)" }}>→ Ale nan Quiz</button>
          </div>
        )}

        {!loading && !error && board?.length > 0 && (
          <>
            {/* Top 3 podium */}
            {board.length >= 3 && (
              <div className="flex items-end justify-center gap-3 py-4" style={{ animation: "fadeIn .5s ease both" }}>
                {/* 2nd */}
                <div className="flex flex-col items-center flex-1">
                  <div className="text-2xl mb-1">🥈</div>
                  <div className="w-full rounded-t-2xl flex flex-col items-center py-3 px-2"
                    style={{ background: "#94a3b822", border: "1px solid #94a3b844", height: 80 }}>
                    <div className="text-white font-bold text-xs text-center">{board[1].phone}</div>
                    <div className="font-black mt-1" style={{ color: "#94a3b8" }}>{board[1].value}{currentTab.valueLabel}</div>
                  </div>
                </div>
                {/* 1st */}
                <div className="flex flex-col items-center flex-1">
                  <div className="text-3xl mb-1">🥇</div>
                  <div className="w-full rounded-t-2xl flex flex-col items-center py-3 px-2"
                    style={{ background: "#fbbf2422", border: "1px solid #fbbf2444", height: 100 }}>
                    <div className="text-white font-bold text-xs text-center">{board[0].phone}</div>
                    <div className="font-black text-lg mt-1" style={{ color: "#fbbf24" }}>{board[0].value}{currentTab.valueLabel}</div>
                    {board[0].isMe && <div className="text-xs mt-1" style={{ color: "#fbbf24" }}>← Ou</div>}
                  </div>
                </div>
                {/* 3rd */}
                <div className="flex flex-col items-center flex-1">
                  <div className="text-2xl mb-1">🥉</div>
                  <div className="w-full rounded-t-2xl flex flex-col items-center py-3 px-2"
                    style={{ background: "#cd7c3222", border: "1px solid #cd7c3244", height: 65 }}>
                    <div className="text-white font-bold text-xs text-center">{board[2].phone}</div>
                    <div className="font-black mt-1" style={{ color: "#cd7c32" }}>{board[2].value}{currentTab.valueLabel}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Liste complète */}
            <div className="space-y-2">
              {board.map((entry, i) => (
                <div key={i}
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                  style={{
                    background: entry.isMe ? "#1a4fd633" : "#0f1e4a",
                    border: entry.isMe ? "1.5px solid #3b82f6" : "1px solid #1e3a8a33",
                    animation: `fadeIn .3s ${i * 0.05}s ease both`,
                  }}>
                  {/* Rang */}
                  <div className="w-8 h-8 rounded-full flex items-center justify-center font-black text-sm flex-shrink-0"
                    style={{ background: colors[i % colors.length] + "33", color: colors[i % colors.length] }}>
                    {i < 3 ? medalEmojis[i] : `#${entry.rank}`}
                  </div>
                  {/* Téléphone masqué */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-semibold text-sm font-mono">{entry.phone}</span>
                      {entry.isMe && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold"
                          style={{ background: "#1a4fd6", color: "white" }}>Ou</span>
                      )}
                    </div>
                  </div>
                  {/* Valeur */}
                  <div className="font-black text-lg" style={{ color: colors[i % colors.length] }}>
                    {entry.value}<span className="text-xs font-normal" style={{ color: colors[i % colors.length] + "99" }}>{currentTab.valueLabel}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Ma position si pas dans top 10 */}
            {data && !board.find(e => e.isMe) && (
              <div className="rounded-2xl px-4 py-3 text-center" style={{ background: "#1a4fd622", border: "1px solid #3b82f633" }}>
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
}

// ─── HISTORY ──────────────────────────────────────────────────────────────────
function HistoryScreen({ user, onNavigate }) {
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    idbGetScans(user.phone).then(data => setHistory(data)).finally(() => setLoading(false));
  }, []);

  const handleDelete = async (entry) => {
    setDeleting(entry.id);
    await idbDeleteScan(entry.id);
    setHistory(h => h.filter(x => x.id !== entry.id));
    if (selected?.id === entry.id) setSelected(null);
    setDeleting(null);
  };

  const dailyMap = {};
  history.forEach(h => {
    const day = h.scanDate || h.date?.split(",")[0] || "?";
    if (!dailyMap[day]) dailyMap[day] = 0;
    dailyMap[day]++;
  });

  if (selected) return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "#070d1f" }}>
      <div className="px-4 py-4 border-b flex items-center gap-3" style={{ background: "#0a0f2e", borderColor: "#ffffff10" }}>
        <button onClick={() => setSelected(null)} className="text-blue-400 text-xl">←</button>
        <div className="flex-1">
          <h2 className="text-white font-bold">Detay Scan</h2>
          <p className="text-blue-400 text-xs">{selected.subject} • {selected.date}</p>
        </div>
        <button onClick={() => handleDelete(selected)} disabled={deleting === selected.id}
          className="px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1"
          style={{ background: "#d4002a22", color: "#ff8080", border: "1px solid #d4002a33" }}>
          {deleting === selected.id ? "⏳" : "🗑️"} Efase
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {!selected._fallback ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "#14532d22", border: "1px solid #22c55e22" }}>
            <span>🗄️</span>
            <span className="text-green-300 text-xs">Stocké dans IndexedDB • Image disponible hors-ligne</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "#78350f22", border: "1px solid #f59e0b22" }}>
            <span>⚠️</span>
            <span className="text-yellow-300 text-xs">Mode fallback — image non disponible hors-ligne</span>
          </div>
        )}
        {selected.image ? (
          <div>
            <p className="text-blue-400 text-xs font-semibold uppercase tracking-wider mb-2">📷 Imaj Scannée</p>
            <img src={selected.image} alt="scan" className="w-full rounded-2xl object-contain max-h-56" style={{ border: "1px solid #1e3a8a44" }} />
          </div>
        ) : (
          <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: "#1e3a8a11", border: "1px solid #1e3a8a22" }}>
            <span>💬</span>
            <span className="text-blue-600 text-xs">Kesyon tèks — pa gen imaj</span>
          </div>
        )}
        <div className="rounded-2xl p-4" style={{ background: "#0f1e4a", border: "1px solid #1e3a8a33" }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#d4002a,#ff6b35)" }}>
              <span style={{ fontSize: 14 }}>🧑‍🏫</span>
            </div>
            <span className="text-white font-bold text-sm">Repons Prof Lakay</span>
          </div>
          <div className="text-sm leading-relaxed" style={{ color: "#e0e8ff" }}>
            <LatexText content={selected.response} />
          </div>
        </div>
        <div className="rounded-2xl px-4 py-3 flex justify-between" style={{ background: "#0f1e4a", border: "1px solid #1e3a8a22" }}>
          <span className="text-blue-400 text-xs">Scan itilize jou sa</span>
          <span className="text-orange-300 font-bold text-xs">{selected.scansUsed}/{selected.dailyLimit || user.dailyScans}</span>
        </div>
      </div>
      <BottomNav active="history" onNavigate={onNavigate} />
    </div>
  );

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "#070d1f" }}>
      <div className="px-4 py-4 border-b" style={{ background: "#0a0f2e", borderColor: "#ffffff10" }}>
        <h2 className="text-white font-bold">📋 Istwa Scan Ou</h2>
        <div className="flex items-center gap-3 mt-0.5">
          <p className="text-blue-400 text-xs">{history.length} scan{history.length !== 1 ? "s" : ""} total</p>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "#14532d22", color: "#86efac", border: "1px solid #22c55e22" }}>
            🗄️ IndexedDB • hors-ligne
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="flex gap-2">
              {[0,1,2].map(i => <div key={i} className="w-2.5 h-2.5 rounded-full bg-blue-400" style={{ animation: `bounce 1s ${i*0.2}s infinite` }} />)}
            </div>
            <p className="text-blue-500 text-sm">Chajman istwa ou depi IndexedDB...</p>
          </div>
        )}
        {!loading && Object.keys(dailyMap).length > 0 && (
          <div className="rounded-2xl p-4" style={{ background: "#0f1e4a", border: "1px solid #1e3a8a33" }}>
            <h3 className="text-white font-bold text-sm mb-3">📊 Scan pa Jou</h3>
            <div className="space-y-2">
              {Object.entries(dailyMap).slice(0, 7).map(([day, count]) => (
                <div key={day} className="flex items-center gap-3">
                  <span className="text-blue-400 text-xs w-24 flex-shrink-0">{day}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "#1e3a8a44" }}>
                    <div className="h-full rounded-full" style={{ width: `${(count / user.dailyScans) * 100}%`, background: count >= user.dailyScans ? "#ef4444" : "linear-gradient(90deg,#d4002a,#ff6b35)" }} />
                  </div>
                  <span className="text-orange-300 text-xs font-bold w-10 text-right">{count}/{user.dailyScans}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {!loading && history.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 space-y-3">
            <span style={{ fontSize: 56 }}>📭</span>
            <p className="text-blue-400 text-center text-sm">Pa gen istwa encore.<br />Fè premye scan ou nan Chat !</p>
            <button onClick={() => onNavigate("chat")} className="px-6 py-3 rounded-xl font-bold text-white text-sm"
              style={{ background: "linear-gradient(135deg,#d4002a,#ff6b35)" }}>→ Ale nan Chat</button>
          </div>
        )}
        {!loading && history.length > 0 && (
          <>
            <h3 className="text-blue-400 text-xs font-semibold uppercase tracking-wider">Tout Scan Ou Yo</h3>
            {history.map(h => (
              <div key={h.id} className="rounded-2xl overflow-hidden" style={{ background: "#0f1e4a", border: "1px solid #1e3a8a33" }}>
                <button onClick={() => setSelected(h)} className="w-full text-left active:scale-95 transition-transform">
                  <div className="flex gap-3 p-4">
                    {h.image ? (
                      <img src={h.image} alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0" style={{ border: "1px solid #1e3a8a44" }} />
                    ) : (
                      <div className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "#1e3a8a33" }}>
                        <span style={{ fontSize: 24 }}>💬</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: "#d4002a22", color: "#ff8080" }}>{h.subject}</span>
                        {h.image && <span className="text-green-700 text-xs">🗄️</span>}
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: "#93c5fd", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {h.response?.slice(0, 100)}...
                      </p>
                      <p className="text-blue-800 text-xs mt-1">{h.date}</p>
                    </div>
                    <span className="text-blue-700 text-lg self-center">›</span>
                  </div>
                </button>
                <div className="px-4 pb-3 flex justify-end">
                  <button onClick={() => handleDelete(h)} disabled={deleting === h.id}
                    className="px-3 py-1 rounded-lg text-xs font-semibold"
                    style={{ background: "#d4002a15", color: "#ff8080", border: "1px solid #d4002a22" }}>
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
}

// ─── MENU ─────────────────────────────────────────────────────────────────────
function MenuScreen({ user, onNavigate, onLogout }) {
  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "linear-gradient(160deg,#0a0f2e,#0d1b4b)" }}>
      <div className="px-6 pt-10 pb-6 border-b" style={{ borderColor: "#ffffff10" }}>
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#d4002a,#ff6b35)" }}>
            <span style={{ fontSize: 28 }}>👤</span>
          </div>
          <div>
            <div className="text-white font-bold">{user.phone}</div>
            <div className="text-blue-300 text-xs">{user.school}</div>
            <div className="text-orange-300 text-xs mt-0.5">🔑 {user.code}</div>
          </div>
        </div>
        <div className="mt-4 rounded-xl px-4 py-3 flex justify-between items-center"
          style={{ background: user.daysRemaining <= 7 ? "#d4002a22" : "#14532d22", border: `1px solid ${user.daysRemaining <= 7 ? "#d4002a44" : "#22c55e33"}` }}>
          <div>
            <div className="text-xs font-bold" style={{ color: user.daysRemaining <= 7 ? "#ff8080" : "#86efac" }}>
              {user.daysRemaining <= 7 ? "⚠️ Ekspire byento" : "✅ Kòd Aktif"}
            </div>
            <div className="text-xs mt-0.5" style={{ color: user.daysRemaining <= 7 ? "#ff6060" : "#6ee7b7" }}>
              {user.daysRemaining} jou rete • {user.dailyScans} scan/jou
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-blue-400">{user.subjects.length} matière{user.subjects.length > 1 ? "s" : ""}</div>
          </div>
        </div>
      </div>
      <div className="flex-1 px-4 py-4 space-y-2">
        {[
          { icon: "📊", label: "Dashboard Direction", screen: "dashboard" },
          { icon: "💳", label: "Peman", screen: "payment" },
          { icon: "🤝", label: "Vin Patnè", screen: "partner" },
        ].map(item => (
          <button key={item.screen} onClick={() => onNavigate(item.screen)}
            className="w-full flex items-center gap-4 px-5 py-4 rounded-2xl text-left active:scale-95 transition-transform"
            style={{ background: "#ffffff08", border: "1px solid #ffffff10" }}>
            <span style={{ fontSize: 24 }}>{item.icon}</span>
            <span className="text-white font-medium">{item.label}</span>
            <span className="ml-auto text-blue-600">›</span>
          </button>
        ))}
        <div className="flex items-center gap-3 px-5 py-4 rounded-2xl" style={{ background: "#14532d15", border: "1px solid #22c55e22" }}>
          <span>🔒</span>
          <div>
            <div className="text-green-300 text-sm font-semibold">Koneksyon Sécurisé</div>
            <div className="text-green-800 text-xs">Clé API protégée via Supabase</div>
          </div>
        </div>
      </div>
      <div className="px-4 pb-4">
        <button onClick={onLogout} className="w-full py-4 rounded-2xl text-red-400 font-semibold"
          style={{ background: "#d4002a15", border: "1px solid #d4002a30" }}>Dekonekte</button>
      </div>
      <BottomNav active="menu" onNavigate={onNavigate} />
    </div>
  );
}

// ─── PAYMENT ──────────────────────────────────────────────────────────────────
function PaymentScreen({ onBack }) {
  const [payments, setPayments] = useState([]);
  const [copied, setCopied]     = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    callEdge({ action: "get_payment_numbers" })
      .then(d => setPayments(d.payments || []))
      .catch(() => setPayments([{ method: "MonCash", number: "509-XXXX-XXXX" }, { method: "NatCash", number: "509-XXXX-XXXX" }]))
      .finally(() => setLoading(false));
  }, []);

  const copy = (num, key) => {
    navigator.clipboard?.writeText(num).catch(() => {});
    setCopied(key); setTimeout(() => setCopied(null), 2500);
  };

  const cardStyle = {
    MonCash: { grad: "linear-gradient(135deg,#c0392b,#e74c3c)", icon: "💳", sub: "Digicel Haiti" },
    NatCash: { grad: "linear-gradient(135deg,#e67e22,#f39c12)", icon: "🏦", sub: "Natcom Haiti" },
  };

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "linear-gradient(160deg,#0a0f2e,#0d1b4b)" }}>
      <div className="flex items-center gap-3 px-4 py-4 border-b" style={{ borderColor: "#ffffff10" }}>
        <button onClick={onBack} className="text-blue-400 text-xl">←</button>
        <h2 className="text-white font-bold text-lg">Peman & Aktivasyon</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="flex gap-2">{[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full bg-blue-400" style={{ animation: `bounce 1s ${i*0.2}s infinite` }} />)}</div>
          </div>
        ) : payments.map(p => {
          const style = cardStyle[p.method] || { grad: "linear-gradient(135deg,#333,#555)", icon: "💳", sub: "" };
          return (
            <div key={p.method} className="rounded-3xl" style={{ background: style.grad }}>
              <div className="px-5 py-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center"><span style={{ fontSize: 24 }}>{style.icon}</span></div>
                  <div><div className="text-white font-black text-xl">{p.method}</div><div className="text-white/70 text-xs">{style.sub}</div></div>
                </div>
                <div className="bg-white/15 rounded-2xl px-4 py-3 mb-4">
                  <div className="text-white/70 text-xs mb-1">Nimewo {p.method}</div>
                  <div className="text-white font-black text-2xl tracking-widest">{p.number}</div>
                </div>
                <button onClick={() => copy(p.number, p.method)}
                  className="w-full py-3.5 rounded-2xl font-bold text-sm text-white flex items-center justify-center gap-2"
                  style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)" }}>
                  {copied === p.method ? "✅ Copié !" : "📋 Kopye Nimewo a"}
                </button>
                <p className="text-white/60 text-xs text-center mt-3">⚡ Aktivasyon garanti an mwens 30 minit</p>
              </div>
            </div>
          );
        })}
        <button onClick={() => window.open("https://wa.me/50900000000?text=Bonjou%2C%20mwen%20vle%20aktive%20Gid%20NS4.", "_blank")}
          className="w-full py-4 rounded-2xl font-bold text-white flex items-center justify-center gap-3"
          style={{ background: "linear-gradient(135deg,#25d366,#128c7e)" }}>
          <span style={{ fontSize: 22 }}>💬</span> Konfime Peman via WhatsApp
        </button>
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function DashboardScreen({ onBack, userCode }) {
  const [dirCode, setDirCode]       = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [error, setError]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [stats, setStats]           = useState(null);

  const handleAuth = async () => {
    setLoading(true); setError("");
    try {
      const result = await callEdge({ action: "dashboard", schoolCode: userCode, directorCode: dirCode.trim() });
      setStats(result); setAuthorized(true);
    } catch (e) { setError(parseApiError(e).message); }
    setLoading(false);
  };

  if (!authorized) return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "linear-gradient(160deg,#0a0f2e,#0d1b4b)" }}>
      <div className="flex items-center gap-3 px-4 py-4 border-b" style={{ borderColor: "#ffffff10" }}>
        <button onClick={onBack} className="text-blue-400 text-xl">←</button>
        <h2 className="text-white font-bold">Dashboard Direction</h2>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <span style={{ fontSize: 56 }}>🔐</span>
        <h3 className="text-white font-bold text-xl mt-4 mb-2">Accès Direction Sèlman</h3>
        <p className="text-blue-400 text-sm text-center mb-6">Antre kòd espesyal direktè a pou wè rapò a</p>
        <input type="text" value={dirCode} onChange={e => setDirCode(e.target.value.toUpperCase())}
          placeholder="Kòd Direktè"
          className="w-full max-w-xs rounded-xl px-4 py-3.5 text-white placeholder-blue-800 font-mono font-bold outline-none tracking-widest mb-3"
          style={{ background: "#ffffff0d", border: "1.5px solid #ffffff18" }} />
        {error && <p className="text-red-400 text-sm mb-3">⚠️ {error}</p>}
        <button onClick={handleAuth} disabled={loading}
          className="w-full max-w-xs py-4 rounded-xl font-bold text-white"
          style={{ background: loading ? "#333" : "linear-gradient(135deg,#1a4fd6,#2563eb)" }}>
          {loading ? "⏳ Ap vérifier..." : "Valide"}
        </button>
      </div>
    </div>
  );

  const { school, stats: s } = stats;
  const subjectEntries = Object.entries(s.subjectBreakdown || {}).sort((a, b) => b[1] - a[1]);
  const maxScans = Math.max(...subjectEntries.map(e => e[1]), 1);
  const colors = ["#22c55e","#3b82f6","#f59e0b","#a855f7","#ec4899","#14b8a6","#f97316"];

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "linear-gradient(160deg,#0a0f2e,#0d1b4b)" }}>
      <div className="flex items-center gap-3 px-4 py-4 border-b" style={{ borderColor: "#ffffff10" }}>
        <button onClick={onBack} className="text-blue-400 text-xl">←</button>
        <div className="flex-1">
          <h2 className="text-white font-bold">Dashboard</h2>
          <p className="text-blue-400 text-xs">{school.name}</p>
        </div>
        <button className="px-3 py-2 rounded-xl text-xs font-bold text-white" style={{ background: "linear-gradient(135deg,#d4002a,#ff6b35)" }}>📄 PDF</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="rounded-2xl px-4 py-3 flex justify-between items-center"
          style={{ background: school.daysRemaining <= 7 ? "#d4002a22" : "#14532d22", border: `1px solid ${school.daysRemaining <= 7 ? "#d4002a44" : "#22c55e33"}` }}>
          <div>
            <div className="font-bold text-sm" style={{ color: school.daysRemaining <= 7 ? "#ff8080" : "#86efac" }}>
              {school.daysRemaining <= 0 ? "🔴 Kòd Ekspire" : school.daysRemaining <= 7 ? "⚠️ Ekspire byento" : "✅ Kòd Aktif"}
            </div>
            <div className="text-xs mt-0.5" style={{ color: "#93c5fd" }}>
              {school.daysRemaining} jou rete • {school.dailyScans} scan/jou • max {school.maxStudents} elèv
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Scan Total", val: s.totalScans,    icon: "🔍", color: "#3b82f6" },
            { label: "Elèv Aktif", val: s.totalStudents, icon: "👥", color: "#22c55e" },
            { label: "Scan Jodi",  val: s.scansToday,    icon: "📅", color: "#f59e0b" },
            { label: "Matières",   val: school.subjects.length, icon: "📚", color: "#a855f7" },
          ].map((item, i) => (
            <div key={i} className="rounded-2xl p-4" style={{ background: "#ffffff08", border: "1px solid #ffffff10" }}>
              <div style={{ fontSize: 24 }}>{item.icon}</div>
              <div className="font-black text-2xl mt-1" style={{ color: item.color }}>{item.val}</div>
              <div className="text-blue-400 text-xs mt-0.5">{item.label}</div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl p-4" style={{ background: "#ffffff08", border: "1px solid #ffffff10" }}>
          <h3 className="text-white font-bold text-sm mb-3">📚 Matières Autorisées</h3>
          <div className="flex flex-wrap gap-2">
            {school.subjects.map((s, i) => (
              <span key={i} className="px-3 py-1 rounded-full text-xs font-semibold"
                style={{ background: colors[i % colors.length] + "33", color: colors[i % colors.length], border: `1px solid ${colors[i % colors.length]}44` }}>
                {s}
              </span>
            ))}
          </div>
        </div>
        {subjectEntries.length > 0 && (
          <div className="rounded-2xl p-5" style={{ background: "#ffffff08", border: "1px solid #ffffff10" }}>
            <h3 className="text-white font-bold mb-4">📊 Matières les Plus Scannées</h3>
            <div className="space-y-3">
              {subjectEntries.map(([sub, count], i) => (
                <div key={sub}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-blue-200">{sub}</span>
                    <span className="text-blue-400 font-bold">{count} scan{count > 1 ? "s" : ""}</span>
                  </div>
                  <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "#ffffff10" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${(count/maxScans)*100}%`, background: colors[i % colors.length] }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <button className="w-full py-4 rounded-2xl font-bold text-white flex items-center justify-center gap-3"
          style={{ background: "linear-gradient(135deg,#25d366,#128c7e)" }}>
          <span>💬</span> Pataje Rapò PDF sou WhatsApp
        </button>
      </div>
    </div>
  );
}

// ─── PARTNER ──────────────────────────────────────────────────────────────────
function PartnerScreen({ onBack }) {
  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "linear-gradient(160deg,#0a0f2e,#0d1b4b)" }}>
      <div className="flex items-center gap-3 px-4 py-4 border-b" style={{ borderColor: "#ffffff10" }}>
        <button onClick={onBack} className="text-blue-400 text-xl">←</button>
        <h2 className="text-white font-bold">Vin Patnè</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        <div className="rounded-3xl px-6 py-6" style={{ background: "linear-gradient(135deg,#1a1a5e,#2a2a8e)", border: "1px solid #3b82f633" }}>
          <div className="text-5xl mb-4">🏫</div>
          <h3 className="text-white font-black text-xl mb-2">Ofri Aksè Ilimite a Elèv Ou Yo</h3>
          <p className="text-blue-300 text-sm leading-relaxed">Gid NS4 bay chak elèv yon asistan IA pèsonèl 24h/24 pou prepare Bak NS4 yo.</p>
        </div>
        {[
          { icon:"✅", title:"Kòd ak Dat Ekspirasyon", desc:"Kontwole dire aksè — 30, 90, 180 jou" },
          { icon:"🎛️", title:"Quota Modifyab", desc:"Chwazi 3, 5 oswa 10 scan pa jou" },
          { icon:"👥", title:"Limit Elèv", desc:"Defini kantite maksimòm elèv pa kòd" },
          { icon:"📚", title:"Matières Seleksyone", desc:"Aktive sèlman matières ou peye a" },
          { icon:"🏆", title:"Klasman Reyèl", desc:"Elèv wè pwogresyon yo pa rapò a lòt yo" },
          { icon:"🔒", title:"Sékirité Maximum", desc:"Clé API pwoteje, jamè nan APK" },
        ].map((f, i) => (
          <div key={i} className="flex gap-4 px-5 py-4 rounded-2xl" style={{ background: "#ffffff08", border: "1px solid #ffffff10" }}>
            <span style={{ fontSize: 26 }}>{f.icon}</span>
            <div>
              <div className="text-white font-bold text-sm">{f.title}</div>
              <div className="text-blue-400 text-xs mt-0.5">{f.desc}</div>
            </div>
          </div>
        ))}
        <button onClick={() => window.open("https://wa.me/50900000000?text=Bonjou%2C%20mwen%20vle%20vin%20patnè%20Gid%20NS4.", "_blank")}
          className="w-full py-4 rounded-2xl font-bold text-white flex items-center justify-center gap-3"
          style={{ background: "linear-gradient(135deg,#25d366,#128c7e)" }}>
          <span style={{ fontSize: 22 }}>💬</span> Kontakte Nou sou WhatsApp
        </button>
      </div>
    </div>
  );
}

// ─── SESSION HELPERS ──────────────────────────────────────────────────────────
const SESSION_KEY = "gid_ns4_session";
function sessionSave(u)   { try { localStorage.setItem(SESSION_KEY, JSON.stringify(u)); } catch {} }
function sessionLoad()    { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; } }
function sessionClear()   { try { localStorage.removeItem(SESSION_KEY); } catch {} }

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("splash");
  const [user, setUser]     = useState(null);
  const nav = (s) => setScreen(s);

  // ── Restaure la session au démarrage (évite déconnexion après refresh) ──
  useEffect(() => {
    const saved = sessionLoad();
    if (saved?.phone && saved?.code) {
      setUser(saved);
      // Splash toujours visible brièvement, puis → chat directement
      setTimeout(() => setScreen("chat"), 1800);
    }
  }, []);

  const handleLogin = (u) => {
    sessionSave(u);
    setUser(u);
    setScreen("chat");
  };

  const handleLogout = () => {
    sessionClear();
    setUser(null);
    setScreen("login");
  };

  if (screen === "splash")      return <SplashScreen onDone={() => setScreen(user ? "chat" : "login")} />;
  if (screen === "login")       return <LoginScreen onLogin={handleLogin} onNavigate={nav} />;
  if (screen === "chat")        return <ChatScreen user={user} onNavigate={nav} />;
  if (screen === "quiz")        return <QuizScreen user={user} onNavigate={nav} />;
  if (screen === "leaderboard") return <LeaderboardScreen user={user} onNavigate={nav} />;
  if (screen === "history")     return <HistoryScreen user={user} onNavigate={nav} />;
  if (screen === "menu")        return <MenuScreen user={user} onNavigate={nav} onLogout={handleLogout} />;
  if (screen === "payment")     return <PaymentScreen onBack={() => nav(user ? "menu" : "login")} />;
  if (screen === "dashboard")   return <DashboardScreen onBack={() => nav("menu")} userCode={user?.code} />;
  if (screen === "partner")     return <PartnerScreen onBack={() => nav(user ? "menu" : "login")} />;
}

// ─── EXPORTS NOMMÉS — utilisés par les tests ─────────────────────────────────
export {
  parseApiError,
  scoreToNote20,
  getMention,
  getQuizGrades,
  saveQuizGrade,
  idbSaveScan,
  idbGetScans,
  idbDeleteScan,
  LoginScreen,
  ChatScreen,
  QuizScreen,
};
