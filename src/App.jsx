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
// ─── LOGO ────────────────────────────────────────────────────────────────────
const APP_LOGO = "data:image/webp;base64,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";


// ─── SHUFFLE ──────────────────────────────────────────────────────────────────
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Mélange les choix d'une question et retourne la nouvelle position de la bonne réponse
function shuffleChoices(q) {
  const indexed = q.choices.map((c, i) => ({ c, correct: i === q.answer }));
  for (let i = indexed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
  }
  return {
    ...q,
    choices: indexed.map(x => x.c),
    answer: indexed.findIndex(x => x.correct),
  };
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
    <div className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden"
      style={{ background: "linear-gradient(145deg,#04081A 0%,#080E24 50%,#0D0A1E 100%)" }}>
      {/* Ambient glows */}
      <div style={{ position:"absolute", width:320, height:320, borderRadius:"50%", background:"radial-gradient(circle,#2563EB18,transparent 70%)", top:"15%", left:"10%", pointerEvents:"none" }} />
      <div style={{ position:"absolute", width:240, height:240, borderRadius:"50%", background:"radial-gradient(circle,#E8002A14,transparent 70%)", bottom:"20%", right:"5%", pointerEvents:"none" }} />
      
      <div style={{ animation: "popIn .7s cubic-bezier(.34,1.56,.64,1) both", display:"flex", flexDirection:"column", alignItems:"center" }}>
        {/* Logo avec ring animé */}
        <div style={{ position:"relative", marginBottom:24 }}>
          <div style={{
            position:"absolute", inset:-8,
            borderRadius:34, border:"2px solid #2563EB44",
            animation:"ringPulse 2s 1s ease-out infinite"
          }} />
          <div style={{
            width:120, height:120, borderRadius:26,
            background:"#fff",
            boxShadow:"0 0 0 1px #2563EB33, 0 8px 40px #000c, 0 0 60px #2563EB22",
            overflow:"hidden",
          }}>
            <img src={APP_LOGO} alt="Gid NS4" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
          </div>
        </div>
        <p style={{ color:"#5B7ADB", fontSize:11, letterSpacing:"0.2em", textTransform:"uppercase", animation:"fadeUp .5s .5s both" }}>
          Prof Lakay • NS4 Haïti
        </p>
      </div>

      {/* Loader elegant */}
      <div style={{ position:"absolute", bottom:52, display:"flex", gap:6, alignItems:"center" }}>
        {[0,1,2,3,4].map(i => (
          <div key={i} style={{
            width: i === 2 ? 20 : 6, height:6, borderRadius:3,
            background: i === 2 ? "linear-gradient(90deg,#E8002A,#FF5C35)" : "#1E3A8A",
            animation:`pulse 1.2s ${i*0.15}s ease-in-out infinite`,
            transition:"width .3s"
          }} />
        ))}
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
  const [name, setName]   = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode]   = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError("");
    if (!name.trim() || name.trim().length < 2) { setError("Antre non ou ki valid (omwen 2 lèt)."); return; }
    if (!phone.trim() || phone.length < 8) { setError("Antre yon nimewo telefòn valid."); return; }
    if (!code.trim()) { setError("Antre kòd lekòl ou a."); return; }
    setLoading(true);
    try {
      const result = await callEdge({ action: "validate_code", phone: phone.trim(), schoolCode: code.toUpperCase().trim() });
      if (!result.valid) { setError(result.reason || "Kòd la pa valid."); setLoading(false); return; }
      onLogin({
        name: name.trim(),
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
    <div className="fixed inset-0 flex flex-col overflow-hidden"
      style={{ background: "linear-gradient(145deg,#04081A 0%,#080E24 60%,#0D0A1E 100%)" }}>
      {/* Background glows */}
      <div style={{ position:"absolute", width:400, height:400, borderRadius:"50%", background:"radial-gradient(circle,#2563EB0F,transparent 65%)", top:"-10%", right:"-20%", pointerEvents:"none" }} />
      <div style={{ position:"absolute", width:300, height:300, borderRadius:"50%", background:"radial-gradient(circle,#E8002A0A,transparent 65%)", bottom:"0%", left:"-15%", pointerEvents:"none" }} />

      <div className="flex-1 flex flex-col items-center justify-center px-5" style={{ animation:"fadeUp .5s ease both" }}>
        {/* Logo */}
        <div style={{ width:80, height:80, borderRadius:20, background:"#fff", overflow:"hidden", boxShadow:"0 0 0 1px #2563EB22, 0 12px 40px #00000055", marginBottom:14 }}>
          <img src={APP_LOGO} alt="Gid NS4" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
        </div>
        <p style={{ color:"#4B6ABA", fontSize:11, letterSpacing:"0.18em", textTransform:"uppercase", marginBottom:24 }}>Asistan IA pou elèv NS4</p>

        {/* Glass Card */}
        <div className="w-full" style={{
          maxWidth:380,
          background:"rgba(12,21,48,0.8)",
          backdropFilter:"blur(20px)",
          border:"1px solid rgba(255,255,255,0.08)",
          borderRadius:24,
          padding:"28px 24px",
          boxShadow:"0 24px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)"
        }}>
          {/* Inputs */}
          {[
            { label:"Non Konplè", type:"text", val:name, fn:e=>setName(e.target.value), ph:"Marie Joseph", extra:{} },
            { label:"Nimewo Telefòn", type:"tel", val:phone, fn:e=>setPhone(e.target.value), ph:"50934567890", extra:{} },
            { label:"Kòd Etablisman", type:"text", val:code, fn:e=>setCode(e.target.value.toUpperCase()), ph:"DEMO-2026", extra:{fontFamily:"monospace", letterSpacing:"0.12em", fontWeight:700} },
          ].map(({label, type, val, fn, ph, extra}, i) => (
            <div key={i} style={{ marginBottom:16 }}>
              <label style={{ display:"block", color:"#5B7ADB", fontSize:11, fontWeight:600, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:8 }}>{label}</label>
              <input type={type} value={val} onChange={fn} placeholder={ph}
                style={{
                  width:"100%", background:"rgba(255,255,255,0.04)",
                  border:"1px solid rgba(255,255,255,0.1)",
                  borderRadius:12, padding:"13px 16px",
                  color:"#E8EEFF", fontSize:15, outline:"none",
                  transition:"border-color .2s, box-shadow .2s",
                  boxSizing:"border-box",
                  ...extra
                }}
                onFocus={e => { e.target.style.borderColor="#2563EB66"; e.target.style.boxShadow="0 0 0 3px #2563EB18"; }}
                onBlur={e => { e.target.style.borderColor="rgba(255,255,255,0.1)"; e.target.style.boxShadow="none"; }}
              />
            </div>
          ))}

          {error && (
            <div style={{ background:"#E8002A15", border:"1px solid #E8002A33", borderRadius:10, padding:"10px 14px", marginBottom:16, color:"#FF7070", fontSize:13 }}>
              ⚠️ {error}
            </div>
          )}

          <button onClick={handleLogin} disabled={loading}
            style={{
              width:"100%", padding:"15px", borderRadius:14,
              background: loading ? "#1E2A4A" : "linear-gradient(135deg,#E8002A,#FF5C35)",
              color:"white", fontWeight:800, fontSize:15, border:"none",
              boxShadow: loading ? "none" : "0 6px 24px #E8002A33",
              transition:"all .2s", cursor: loading ? "not-allowed" : "pointer",
              letterSpacing:"0.02em"
            }}>
            {loading ? "⏳  Ap verifye..." : "Konekte  →"}
          </button>

          <div style={{ textAlign:"center", marginTop:16 }}>
            <span style={{ color:"#2A3A6A", fontSize:12 }}>Pa gen kòd ? </span>
            <span style={{ color:"#4B6ABA", fontSize:12 }}>Pale ak direksyon lekòl ou a.</span>
          </div>
        </div>
      </div>

      <div style={{ paddingBottom:24, display:"flex", justifyContent:"center", gap:24 }}>
        <button onClick={() => onNavigate("payment")} style={{ color:"#3B5BA8", fontSize:12, background:"none", border:"none" }}>Peman</button>
        <span style={{ color:"#1E2A4A", fontSize:12 }}>·</span>
        <button onClick={() => onNavigate("partner")} style={{ color:"#3B5BA8", fontSize:12, background:"none", border:"none" }}>Vin Patnè</button>
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
    <div style={{
      display:"flex",
      background:"rgba(4,8,26,0.92)",
      backdropFilter:"blur(20px)",
      borderTop:"1px solid rgba(255,255,255,0.06)",
      paddingBottom:"env(safe-area-inset-bottom, 0px)",
    }}>
      {tabs.map(tab => {
        const isActive = active === tab.id;
        return (
          <button key={tab.id} onClick={() => onNavigate(tab.id)}
            style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", padding:"10px 0 8px", border:"none", background:"none", position:"relative", transition:"transform .15s" }}
            onTouchStart={e => e.currentTarget.style.transform="scale(0.88)"}
            onTouchEnd={e => e.currentTarget.style.transform="scale(1)"}>
            {isActive && (
              <div style={{
                position:"absolute", top:0, left:"50%", transform:"translateX(-50%)",
                width:32, height:2, borderRadius:2,
                background:"linear-gradient(90deg,#E8002A,#FF5C35)",
              }} />
            )}
            <span style={{ fontSize:18, filter: isActive ? "none" : "grayscale(0.3) opacity(0.5)" }}>{tab.icon}</span>
            <span style={{
              fontSize:9, fontWeight: isActive ? 700 : 500,
              color: isActive ? "#FF5C35" : "#2E4080",
              marginTop:2, letterSpacing:"0.03em"
            }}>{tab.label}</span>
          </button>
        );
      })}
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
    content: `Bonjou **${user.name || ""}** ! Mwen se **Prof Lakay** 👋\n\nJe suis ton assistant IA pour le **Bac NS4**.\n\n📚 Matières disponibles pour toi :\n${user.subjects.map(s => `• ${s}`).join("\n")}\n\n**An n al travay ! 💪**`
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
    <div className="fixed inset-0 flex flex-col" style={{ background: "var(--bg-deep,#04081A)" }}>
      <ExpiryBanner daysRemaining={user.daysRemaining} />
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", background:"rgba(4,8,26,0.95)", backdropFilter:"blur(20px)", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ width:40, height:40, borderRadius:10, overflow:"hidden", flexShrink:0, background:"#fff", boxShadow:"0 2px 12px #00000044" }}>
          <img src={APP_LOGO} alt="Gid NS4" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
        </div>
        <div style={{ flex:1 }}>
          <div style={{ color:"#E8EEFF", fontWeight:700, fontSize:14, letterSpacing:"0.01em" }}>Prof Lakay</div>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:1 }}>
            <span style={{ width:6, height:6, borderRadius:"50%", background:"#22C55E", display:"inline-block", boxShadow:"0 0 6px #22C55E" }} />
            <span style={{ color:"#22C55E", fontSize:11, fontWeight:500 }}>En ligne</span>
          </div>
        </div>
        <div style={{
          padding:"5px 12px", borderRadius:20,
          background: remaining <= 0 ? "#E8002A22" : remaining === 1 ? "#F59E0B22" : "#22C55E18",
          border: `1px solid ${remaining <= 0 ? "#E8002A44" : remaining === 1 ? "#F59E0B44" : "#22C55E33"}`,
        }}>
          <span style={{ fontSize:12, fontWeight:700, color: remaining <= 0 ? "#FF6B6B" : remaining === 1 ? "#FBD04A" : "#4ADE80" }}>
            {remaining}/{user.dailyScans}
          </span>
          <span style={{ fontSize:10, color:"#2E4080", marginLeft:3 }}>scans</span>
        </div>
      </div>
      <div style={{ padding:"8px 14px", display:"flex", gap:8, overflowX:"auto", background:"rgba(4,8,26,0.85)", borderBottom:"1px solid rgba(255,255,255,0.05)", scrollbarWidth:"none" }}>
        {user.subjects.map((s, i) => (
          <button key={i} onClick={() => setActiveSubject(s)}
            style={{
              flexShrink:0, padding:"4px 11px", borderRadius:20,
              background: activeSubject === s ? "linear-gradient(135deg,#2563EB,#3B82F6)" : "rgba(37,99,235,0.08)",
              color: activeSubject === s ? "#fff" : "#4B6ABA",
              border: activeSubject === s ? "none" : "1px solid rgba(37,99,235,0.2)",
              fontSize:11, fontWeight: activeSubject === s ? 700 : 500,
              boxShadow: activeSubject === s ? "0 3px 12px #2563EB33" : "none",
              transition:"all .2s", whiteSpace:"nowrap"
            }}>
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
            <div style={{ maxWidth:"82%" }}>
              {msg.image && <img src={msg.image} alt="scan" style={{ borderRadius:14, marginBottom:6, maxHeight:140, objectFit:"contain", border:"1px solid rgba(255,255,255,0.1)" }} />}
              <div style={{
                padding:"11px 15px", fontSize:14, lineHeight:1.65,
                background: msg.role === "user"
                  ? "linear-gradient(135deg,#2563EB,#1D4ED8)"
                  : "rgba(12,21,48,0.95)",
                border: msg.role === "assistant" ? "1px solid rgba(37,99,235,0.15)" : "none",
                color:"#E8EEFF",
                borderRadius: msg.role === "user" ? "18px 18px 5px 18px" : "5px 18px 18px 18px",
                boxShadow: msg.role === "user" ? "0 4px 20px #2563EB33" : "0 2px 12px rgba(0,0,0,0.3)",
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
      <div style={{ padding:"10px 12px", background:"rgba(4,8,26,0.95)", backdropFilter:"blur(20px)", borderTop:"1px solid rgba(255,255,255,0.06)" }}>
        {image && (
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, padding:"6px 8px", background:"rgba(37,99,235,0.1)", borderRadius:10, border:"1px solid rgba(37,99,235,0.2)" }}>
            <img src={image} alt="" style={{ width:36, height:36, borderRadius:8, objectFit:"cover" }} />
            <span style={{ color:"#6B8ADB", fontSize:11, flex:1 }}>✅ Image prête</span>
            <button onClick={() => setImage(null)} style={{ color:"#E8002A", background:"none", border:"none", fontSize:16, cursor:"pointer" }}>✕</button>
          </div>
        )}
        <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
          <button onClick={() => fileRef.current?.click()}
            style={{ width:40, height:40, borderRadius:12, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(37,99,235,0.15)", border:"1px solid rgba(37,99,235,0.25)", cursor:"pointer" }}>
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
            style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", maxHeight:80, color:"#E8EEFF", borderRadius:12, transition:"border-color .2s" }}
            onFocus={e => e.target.style.borderColor="rgba(37,99,235,0.4)"}
            onBlur={e => e.target.style.borderColor="rgba(255,255,255,0.08)"} />
          <button onClick={() => sendMessage()} disabled={loading || remaining <= 0}
            style={{
              width:40, height:40, borderRadius:12, flexShrink:0,
              display:"flex", alignItems:"center", justifyContent:"center",
              background: (loading || remaining <= 0) ? "rgba(30,42,74,0.5)" : "linear-gradient(135deg,#E8002A,#FF5C35)",
              border:"none", cursor: (loading || remaining <= 0) ? "not-allowed" : "pointer",
              boxShadow: (loading || remaining <= 0) ? "none" : "0 4px 16px #E8002A33",
              transition:"all .2s"
            }}>
            <span style={{ fontSize:16 }}>✈</span>
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


  const availableSubjects = Object.keys(QUIZ_DATA).filter(s => user.subjects.includes(s));
  const currentQ = shuffledQs[qIndex];

  const startQCM = (sub) => {
    const all = shuffleArray(QUIZ_DATA[sub]);
    const first10 = all.slice(0, 10).map(shuffleChoices);
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
        name: user.name || user.phone,
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
    const next10 = shuffleArray(pool).slice(0, 10).map(shuffleChoices);
    const newUsed = new Set([...usedQKeys, ...next10.map(q => q.q)]);
    setShuffledQs(next10);
    setUsedQKeys(newUsed);
    setQIndex(0);
    setSelected(null);
    setRoundScore(0);
    setRound(r => r + 1);
    setPhase("qcm");
  };



  const allIcons = {
    "SVT (Sciences de la Vie et de la Terre)": "🧬",
    "Physique":                                "⚡",
    "Chimie":                                  "⚗️",
    "Philosophie & Dissertation":              "🧠",
    "Sciences Sociales & Citoyenneté":         "🌍",
    "Littérature Haïtienne":                   "🇭🇹",
    "Littérature Française":                   "🗼",
    "Mathématiques":                           "📐",
    "Kreyòl Ayisyen":                          "🗣️",
    "Art & Mizik Ayisyen":                     "🎵",
    "Anglais":                                 "🇬🇧",
    "Espagnol":                                "🇪🇸",
    "Entrepreneuriat Scolaire":                "💼",
    "Informatique, Technologie & Arts":        "💻",
  };

  // ── SELECT ──
  if (phase === "select") return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "var(--bg-deep,#04081A)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 16px", background:"rgba(4,8,26,0.95)", backdropFilter:"blur(20px)", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ width:38, height:38, borderRadius:9, overflow:"hidden", flexShrink:0, background:"#fff", boxShadow:"0 2px 10px #00000044" }}>
          <img src={APP_LOGO} alt="Gid NS4" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
        </div>
        <div>
          <h2 style={{ color:"#E8EEFF", fontWeight:800, fontSize:15, margin:0 }}>Quiz NS4</h2>
          <p style={{ color:"#4B6ABA", fontSize:11, margin:0, marginTop:1 }}>{availableSubjects.length} matière{availableSubjects.length > 1 ? "s" : ""} disponib</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Mode infini info */}
        <div style={{ background:"linear-gradient(135deg,rgba(232,0,42,0.12),rgba(255,92,53,0.08))", border:"1px solid rgba(232,0,42,0.2)", borderRadius:16, padding:"12px 16px", display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:22 }}>❤️❤️❤️</span>
          <div>
            <div style={{ color:"#E8EEFF", fontWeight:700, fontSize:12 }}>Mode Duolingo — 3 kè</div>
            <div style={{ color:"#5B7ADB", fontSize:11, marginTop:2 }}>Kesyon enfini • Jwe jouk ou pèdi 3 kè</div>
          </div>
        </div>
        <p style={{ color:"#2E4080", fontSize:11, textAlign:"center", padding:"4px 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>— Chwazi yon matière —</p>
        {availableSubjects.map(sub => (
          <button key={sub} onClick={() => startQCM(sub)}
            style={{
              width:"100%", padding:"14px 16px", borderRadius:16, textAlign:"left",
              display:"flex", alignItems:"center", gap:14, border:"none",
              background:"rgba(12,21,48,0.9)", border:"1px solid rgba(37,99,235,0.12)",
              boxShadow:"0 2px 12px rgba(0,0,0,0.2)", cursor:"pointer",
              transition:"all .2s", animation:"slideIn .3s ease both",
            }}
            onTouchStart={e => { e.currentTarget.style.transform="scale(0.97)"; e.currentTarget.style.borderColor="rgba(37,99,235,0.4)"; }}
            onTouchEnd={e => { e.currentTarget.style.transform="scale(1)"; e.currentTarget.style.borderColor="rgba(37,99,235,0.12)"; }}>
            <div style={{ width:44, height:44, borderRadius:12, background:"rgba(37,99,235,0.12)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <span style={{ fontSize:24 }}>{allIcons[sub]}</span>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ color:"#E8EEFF", fontWeight:700, fontSize:13 }}>{sub}</div>
              <div style={{ color:"#2E4080", fontSize:11, marginTop:3 }}>{QUIZ_DATA[sub].length} kesyon • Mode infini 🔄</div>
            </div>
            <span style={{ color:"#2E4080", fontSize:18 }}>›</span>
          </button>
        ))}
        {Object.keys(QUIZ_DATA).filter(s => !user.subjects.includes(s)).map(sub => (
          <div key={sub} style={{
            width:"100%", padding:"14px 16px", borderRadius:16,
            display:"flex", alignItems:"center", gap:14,
            background:"rgba(12,21,48,0.4)", border:"1px solid rgba(37,99,235,0.05)",
            opacity:0.3, boxSizing:"border-box"
          }}>
            <div style={{ width:44, height:44, borderRadius:12, background:"rgba(37,99,235,0.06)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <span style={{ fontSize:22 }}>{allIcons[sub]}</span>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ color:"#E8EEFF", fontWeight:600, fontSize:13 }}>{sub}</div>
              <div style={{ color:"#2E4080", fontSize:11, marginTop:2 }}>Pa disponib ak kòd lekòl ou</div>
            </div>
            <span style={{ fontSize:14 }}>🔒</span>
          </div>
        ))}
      </div>
      <BottomNav active="quiz" onNavigate={onNavigate} />
    </div>
  );



  // ── QCM (Mode Duolingo) ──
  if (phase === "qcm" && currentQ) return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "var(--bg-deep,#04081A)" }}>
      {/* Header avec cœurs + streak */}
      <div className="px-4 py-3 border-b" style={{ background: "rgba(4,8,26,0.95)", borderColor: "#ffffff10" }}>
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
        <div style={{ background:"rgba(12,21,48,0.95)", border:"1px solid rgba(37,99,235,0.15)", borderRadius:18, padding:"18px 18px", boxShadow:"0 4px 24px rgba(0,0,0,0.3)" }}>
          <p style={{ color:"#E8EEFF", fontWeight:600, fontSize:15, lineHeight:1.6, margin:0 }}>{currentQ.q}</p>
        </div>
        <div className="space-y-3">
          {currentQ.choices.map((choice, idx) => {
            const isCorrect = selected !== null && idx === currentQ.answer;
            const isWrong   = selected !== null && idx === selected && idx !== currentQ.answer;
            const isNeutral = selected === null;
            const letters   = ["A","B","C","D"];
            const letterColors = ["#2563EB","#7C3AED","#059669","#D97706"];
            return (
              <button key={idx} onClick={() => handleChoice(idx)}
                style={{
                  width:"100%", padding:"14px 16px", borderRadius:14, textAlign:"left",
                  display:"flex", alignItems:"center", gap:12,
                  background: isCorrect ? "rgba(34,197,94,0.12)" : isWrong ? "rgba(239,68,68,0.1)" : "rgba(12,21,48,0.9)",
                  border: `1.5px solid ${isCorrect ? "rgba(34,197,94,0.5)" : isWrong ? "rgba(239,68,68,0.4)" : "rgba(37,99,235,0.12)"}`,
                  color: isCorrect ? "#4ADE80" : isWrong ? "#FC8181" : "#E8EEFF",
                  cursor: selected !== null ? "default" : "pointer",
                  transform: isNeutral ? "none" : "none",
                  transition:"all .2s",
                  animation: `fadeIn .2s ${idx*0.05}s ease both`,
                  fontSize:14, fontWeight:500,
                  boxShadow: isCorrect ? "0 4px 20px rgba(34,197,94,0.15)" : isWrong ? "0 4px 20px rgba(239,68,68,0.1)" : "none"
                }}
                onTouchStart={e => { if(selected===null) e.currentTarget.style.transform="scale(0.97)"; }}
                onTouchEnd={e => { e.currentTarget.style.transform="scale(1)"; }}>
                <span style={{
                  width:28, height:28, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center",
                  fontWeight:800, fontSize:12, flexShrink:0,
                  background: isCorrect ? "#22C55E" : isWrong ? "#EF4444" : `${letterColors[idx]}22`,
                  color: isCorrect || isWrong ? "white" : letterColors[idx],
                  border: `1px solid ${isCorrect ? "#22C55E" : isWrong ? "#EF4444" : `${letterColors[idx]}44`}`
                }}>
                  {letters[idx]}
                </span>
                <span style={{ flex:1, lineHeight:1.4 }}>{choice}</span>
                {isCorrect && <span style={{ fontSize:16, flexShrink:0 }}>✅</span>}
                {isWrong && <span style={{ fontSize:16, flexShrink:0 }}>❌</span>}
              </button>
            );
          })}
        </div>

        {/* Explication + bouton suivant */}
        {selected !== null && (
          <div style={{ animation: "fadeIn .3s ease both" }}>
            {currentQ.note && (
              <div style={{
                background: selected === currentQ.answer ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.07)",
                border: `1px solid ${selected === currentQ.answer ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.2)"}`,
                borderRadius:14, padding:"12px 14px", marginBottom:12
              }}>
                <p style={{ color: selected === currentQ.answer ? "#86EFAC" : "#FCA5A5", fontSize:12, lineHeight:1.6, margin:0 }}>
                  💡 {currentQ.note}
                </p>
              </div>
            )}
            <button onClick={handleNext}
              className="w-full py-4 rounded-2xl font-bold text-white active:scale-95 transition-transform"
              style={{
              background: hearts <= 0 ? "linear-gradient(135deg,#E8002A,#EF4444)" : "linear-gradient(135deg,#2563EB,#3B82F6)",
              boxShadow: hearts <= 0 ? "0 4px 20px rgba(232,0,42,0.3)" : "0 4px 20px rgba(37,99,235,0.3)",
              borderRadius:14, border:"none"
            }}>
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
          <p className="text-white font-bold text-center text-lg">Ou vle kontinye ?</p>

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
      <div className="fixed inset-0 flex flex-col" style={{ background: "var(--bg-deep,#04081A)" }}>
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
    <div className="fixed inset-0 flex flex-col" style={{ background: "var(--bg-deep,#04081A)" }}>
      {/* Header */}
      <div className="px-4 py-4 border-b" style={{ background: "rgba(4,8,26,0.95)", borderColor: "#ffffff10" }}>
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
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flex:1 }}>
                  <div style={{ fontSize:28, marginBottom:6 }}>🥈</div>
                  <div style={{
                    width:"100%", borderRadius:"14px 14px 0 0", display:"flex", flexDirection:"column", alignItems:"center",
                    padding:"12px 8px", height:80, background:"linear-gradient(180deg,rgba(148,163,184,0.15),rgba(148,163,184,0.05))",
                    border:"1px solid rgba(148,163,184,0.25)", borderBottom:"none"
                  }}>
                    <div style={{ color:"#E8EEFF", fontWeight:700, fontSize:11, textAlign:"center", lineHeight:1.3 }}>{board[1].name || board[1].phone}</div>
                    <div style={{ fontWeight:900, marginTop:6, color:"#94A3B8", fontSize:15 }}>{board[1].value}{currentTab.valueLabel}</div>
                  </div>
                </div>
                {/* 1st */}
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flex:1 }}>
                  <div style={{ fontSize:36, marginBottom:6, filter:"drop-shadow(0 0 12px #F59E0B)" }}>🥇</div>
                  <div style={{
                    width:"100%", borderRadius:"14px 14px 0 0", display:"flex", flexDirection:"column", alignItems:"center",
                    padding:"14px 8px", height:100, background:"linear-gradient(180deg,rgba(251,191,36,0.2),rgba(251,191,36,0.05))",
                    border:"1px solid rgba(251,191,36,0.35)", borderBottom:"none",
                    boxShadow:"0 -4px 20px rgba(251,191,36,0.15)"
                  }}>
                    <div style={{ color:"#FDE68A", fontWeight:800, fontSize:11, textAlign:"center", lineHeight:1.3 }}>{board[0].name || board[0].phone}</div>
                    <div style={{ fontWeight:900, marginTop:6, color:"#FBD04A", fontSize:20 }}>{board[0].value}{currentTab.valueLabel}</div>
                    {board[0].isMe && <div style={{ color:"#F59E0B", fontSize:10, marginTop:4 }}>← Ou</div>}
                  </div>
                </div>
                {/* 3rd */}
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flex:1 }}>
                  <div style={{ fontSize:26, marginBottom:6 }}>🥉</div>
                  <div style={{
                    width:"100%", borderRadius:"14px 14px 0 0", display:"flex", flexDirection:"column", alignItems:"center",
                    padding:"10px 6px", height:65, background:"linear-gradient(180deg,rgba(205,124,50,0.15),rgba(205,124,50,0.05))",
                    border:"1px solid rgba(205,124,50,0.25)", borderBottom:"none"
                  }}>
                    <div style={{ color:"#E8EEFF", fontWeight:700, fontSize:10, textAlign:"center", lineHeight:1.3 }}>{board[2].name || board[2].phone}</div>
                    <div style={{ fontWeight:900, marginTop:5, color:"#CD7C32", fontSize:14 }}>{board[2].value}{currentTab.valueLabel}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Liste complète */}
            <div className="space-y-2">
              {board.map((entry, i) => (
                <div key={i} style={{
                    display:"flex", alignItems:"center", gap:12, padding:"12px 14px", borderRadius:14,
                    background: entry.isMe ? "rgba(37,99,235,0.15)" : "rgba(12,21,48,0.8)",
                    border: entry.isMe ? "1.5px solid rgba(37,99,235,0.5)" : "1px solid rgba(255,255,255,0.06)",
                    animation: `slideIn .3s ${i * 0.04}s ease both`,
                    boxShadow: entry.isMe ? "0 4px 20px rgba(37,99,235,0.15)" : "0 2px 8px rgba(0,0,0,0.15)"
                  }}>
                  <div style={{
                    width:32, height:32, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center",
                    fontWeight:900, fontSize:12, flexShrink:0,
                    background:`${colors[i % colors.length]}20`, color:colors[i % colors.length]
                  }}>
                    {i < 3 ? medalEmojis[i] : `#${entry.rank}`}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <span style={{ color:"#E8EEFF", fontWeight:700, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{entry.name || entry.phone}</span>
                      {entry.isMe && (
                        <span style={{ padding:"2px 7px", borderRadius:20, fontSize:10, fontWeight:700, background:"#2563EB", color:"white", flexShrink:0 }}>Ou</span>
                      )}
                    </div>
                  </div>
                  <div style={{ fontWeight:900, fontSize:17, color:colors[i % colors.length], flexShrink:0 }}>
                    {entry.value}<span style={{ fontSize:10, fontWeight:400, opacity:0.6 }}>{currentTab.valueLabel}</span>
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
    <div className="fixed inset-0 flex flex-col" style={{ background: "var(--bg-deep,#04081A)" }}>
      <div className="px-4 py-4 border-b flex items-center gap-3" style={{ background: "rgba(4,8,26,0.95)", borderColor: "#ffffff10" }}>
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
    <div className="fixed inset-0 flex flex-col" style={{ background: "var(--bg-deep,#04081A)" }}>
      <div className="px-4 py-4 border-b" style={{ background: "rgba(4,8,26,0.95)", borderColor: "#ffffff10" }}>
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
    <div className="fixed inset-0 flex flex-col" style={{ background: "linear-gradient(145deg,#04081A,#080E24)" }}>
      <div style={{ padding:"32px 20px 20px", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
        {/* Profile Card */}
        <div style={{
          background:"rgba(12,21,48,0.8)", backdropFilter:"blur(20px)",
          border:"1px solid rgba(255,255,255,0.08)", borderRadius:20,
          padding:"16px", display:"flex", alignItems:"center", gap:14,
          boxShadow:"0 8px 32px rgba(0,0,0,0.3)"
        }}>
          <div style={{ width:52, height:52, borderRadius:14, overflow:"hidden", flexShrink:0, background:"#fff", boxShadow:"0 4px 16px rgba(0,0,0,0.3)" }}>
            <img src={APP_LOGO} alt="Gid NS4" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ color:"#E8EEFF", fontWeight:800, fontSize:15, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.name || user.phone}</div>
            <div style={{ color:"#4B6ABA", fontSize:11, marginTop:2 }}>{user.phone}</div>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:4 }}>
              <span style={{ background:"rgba(37,99,235,0.15)", border:"1px solid rgba(37,99,235,0.25)", borderRadius:20, padding:"2px 8px", color:"#6B8ADB", fontSize:10, fontWeight:600 }}>
                🔑 {user.code}
              </span>
            </div>
          </div>
        </div>
        <div style={{ color:"#3B5BA8", fontSize:11, textAlign:"center", marginTop:10 }}>{user.school}</div>
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
      .catch(() => setPayments([{ method: "MonCash", number: "50948695079" }, { method: "NatCash", number: "50940669105" }]))
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
    <div className="fixed inset-0 flex flex-col" style={{ background: "linear-gradient(145deg,#04081A,#080E24)" }}>
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


// ─── GÉNÉRATION PDF RAPPORT ───────────────────────────────────────────────────
async function generateAndSharePDF(school, stats) {
  // Charger jsPDF dynamiquement depuis CDN
  if (!window.jspdf) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const date = new Date().toLocaleDateString("fr-HT", { timeZone: "America/Port-au-Prince", day: "2-digit", month: "long", year: "numeric" });
  const W = 210, margin = 18;

  // ── Fond header ──
  doc.setFillColor(10, 15, 46);
  doc.rect(0, 0, W, 50, "F");

  // ── Titre ──
  doc.setTextColor(255, 107, 53);
  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.text("GID NS4", margin, 22);

  doc.setTextColor(147, 197, 253);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text("Rapò Pèfòmans Etablisman", margin, 30);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(school.name, margin, 40);

  doc.setTextColor(147, 197, 253);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Dat rapò : ${date}`, margin, 47);

  // ── Section statistiques ──
  let y = 62;
  doc.setTextColor(30, 58, 138);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("STATISTIQUES GLOBALES", margin, y);
  y += 2;
  doc.setDrawColor(212, 0, 42);
  doc.setLineWidth(0.8);
  doc.line(margin, y, W - margin, y);
  y += 8;

  const statItems = [
    { label: "Total Scans Réalisés",   val: String(stats.totalScans || 0) },
    { label: "Élèves Actifs",           val: String(stats.totalStudents || 0) },
    { label: "Scans Aujourd'hui",       val: String(stats.scansToday || 0) },
    { label: "Quota Journalier",        val: `${school.dailyScans} scan/jour` },
    { label: "Abonnement",             val: `${school.daysRemaining} jours restants` },
    { label: "Matières Autorisées",     val: String(school.subjects.length) },
    { label: "Limite Élèves",           val: String(school.maxStudents || "—") },
  ];

  statItems.forEach(({ label, val }, i) => {
    const rowY = y + i * 9;
    if (i % 2 === 0) {
      doc.setFillColor(241, 245, 249);
      doc.rect(margin - 2, rowY - 5, W - 2 * margin + 4, 8, "F");
    }
    doc.setTextColor(30, 30, 60);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(label, margin, rowY);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(212, 0, 42);
    doc.text(val, W - margin, rowY, { align: "right" });
  });

  y += statItems.length * 9 + 10;

  // ── Section matières scannées ──
  const subjectEntries = Object.entries(stats.subjectBreakdown || {}).sort((a, b) => b[1] - a[1]);
  if (subjectEntries.length > 0) {
    doc.setTextColor(30, 58, 138);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("MATIÈRES LES PLUS UTILISÉES", margin, y);
    y += 2;
    doc.setDrawColor(212, 0, 42);
    doc.line(margin, y, W - margin, y);
    y += 8;

    const maxCount = Math.max(...subjectEntries.map(e => e[1]), 1);
    const barW = W - 2 * margin - 40;
    const colors = [[34,197,94],[59,130,246],[245,158,11],[168,85,247],[236,72,153],[20,184,166]];

    subjectEntries.slice(0, 10).forEach(([sub, count], i) => {
      const rowY = y + i * 11;
      const pct = count / maxCount;
      const [r, g, b] = colors[i % colors.length];
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(30, 30, 60);
      doc.text(sub.length > 30 ? sub.slice(0,28)+"…" : sub, margin, rowY);
      // Barre
      doc.setFillColor(220, 230, 245);
      doc.roundedRect(margin, rowY + 1.5, barW, 4, 1, 1, "F");
      doc.setFillColor(r, g, b);
      doc.roundedRect(margin, rowY + 1.5, barW * pct, 4, 1, 1, "F");
      // Valeur
      doc.setFont("helvetica", "bold");
      doc.setTextColor(r, g, b);
      doc.text(`${count}`, W - margin, rowY + 4.5, { align: "right" });
    });

    y += subjectEntries.slice(0,10).length * 11 + 8;
  }

  // ── Section matières autorisées ──
  if (school.subjects && school.subjects.length > 0) {
    doc.setTextColor(30, 58, 138);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("MATIÈRES AUTORISÉES", margin, y);
    y += 2;
    doc.setDrawColor(212, 0, 42);
    doc.line(margin, y, W - margin, y);
    y += 8;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 30, 60);
    school.subjects.forEach((sub, i) => {
      doc.text(`• ${sub}`, margin + 3, y + i * 7);
    });
    y += school.subjects.length * 7 + 8;
  }

  // ── Pied de page ──
  const footerY = 285;
  doc.setFillColor(10, 15, 46);
  doc.rect(0, footerY - 6, W, 20, "F");
  doc.setTextColor(147, 197, 253);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Gid NS4 — Asistan IA pou Elèv NS4 Haïti", W / 2, footerY, { align: "center" });
  doc.setTextColor(255, 107, 53);
  doc.text(`Généré le ${date}`, W / 2, footerY + 5, { align: "center" });

  // ── Téléchargement ──
  const filename = `GidNS4_Rapport_${school.name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0,10)}.pdf`;
  doc.save(filename);

  // ── Partage WhatsApp ──
  const msg = encodeURIComponent(
    `📊 *Rapò Gid NS4 — ${school.name}*\n` +
    `📅 ${date}\n\n` +
    `🔍 Total scans : ${stats.totalScans || 0}\n` +
    `👥 Élèves actifs : ${stats.totalStudents || 0}\n` +
    `📅 Scans jodi : ${stats.scansToday || 0}\n` +
    `⏳ ${school.daysRemaining} jou rete\n\n` +
    `_Rapò PDF téléchargé — Gid NS4_`
  );
  window.open(`https://wa.me/?text=${msg}`, "_blank");
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
    <div className="fixed inset-0 flex flex-col" style={{ background: "linear-gradient(145deg,#04081A,#080E24)" }}>
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
    <div className="fixed inset-0 flex flex-col" style={{ background: "linear-gradient(145deg,#04081A,#080E24)" }}>
      <div className="flex items-center gap-3 px-4 py-4 border-b" style={{ borderColor: "#ffffff10" }}>
        <button onClick={onBack} className="text-blue-400 text-xl">←</button>
        <div className="flex-1">
          <h2 className="text-white font-bold">Dashboard</h2>
          <p className="text-blue-400 text-xs">{school.name}</p>
        </div>
        <button onClick={() => generateAndSharePDF(school, s)} className="px-3 py-2 rounded-xl text-xs font-bold text-white active:scale-95 transition-transform" style={{ background: "linear-gradient(135deg,#d4002a,#ff6b35)" }}>📄 PDF</button>
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
            { label: "Elèves Actifs", val: s.totalStudents, icon: "👥", color: "#22c55e" },
            { label: "Scan d'aujourd'hui",  val: s.scansToday,    icon: "📅", color: "#f59e0b" },
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
        <button onClick={() => generateAndSharePDF(school, s)}
          className="w-full py-4 rounded-2xl font-bold text-white flex items-center justify-center gap-3 active:scale-95 transition-transform"
          style={{ background: "linear-gradient(135deg,#25d366,#128c7e)" }}>
          <span style={{ fontSize: 22 }}>💬</span> Pataje Rapò PDF sou WhatsApp
        </button>
      </div>
    </div>
  );
}

// ─── PARTNER ──────────────────────────────────────────────────────────────────
function PartnerScreen({ onBack }) {
  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "linear-gradient(145deg,#04081A,#080E24)" }}>
      <div className="flex items-center gap-3 px-4 py-4 border-b" style={{ borderColor: "#ffffff10" }}>
        <button onClick={onBack} className="text-blue-400 text-xl">←</button>
        <h2 className="text-white font-bold">Vin Patnè</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        <div className="rounded-3xl px-6 py-6" style={{ background: "linear-gradient(135deg,#1a1a5e,#2a2a8e)", border: "1px solid #3b82f633" }}>
          <div className="text-5xl mb-4">🏫</div>
          <h3 className="text-white font-black text-xl mb-2">Ofri Aksè Ilimite a Elèv Ou Yo</h3>
          <p className="text-blue-300 text-sm leading-relaxed">Gid NS4 bay chak elèv yon asistan IA pèsonèl 24h/24 pou prepare egzamen NS4 yo.</p>
        </div>
        {[
          { icon:"✅", title:"Kòd ak Dat Ekspirasyon", desc:"Kontwole dire kòd la" },
          { icon:"🎛️", title:"Quota Modifyab", desc:"Chwazi 3, 5 oswa 10 scan pa jou" },
          { icon:"👥", title:"Limit Elèv", desc:"Defini kantite maksimòm elèv pa kòd" },
          { icon:"📚", title:"Matyè Seleksyone", desc:"Aktive matyè yo" },
          { icon:"🏆", title:"Klasman Reyèl", desc:"Elèv yo wè pwogresyon yo pa rapò a lòt yo" },
          { icon:"🔒", title:"Sekirite Maksimòm", desc:"Kle API pwoteje" },
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
    if (saved?.phone && saved?.code) setUser(saved);
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

  // onDone lit sessionLoad() directement — évite le stale closure sur user
  if (screen === "splash") return <SplashScreen onDone={() => {
    const saved = sessionLoad();
    setScreen(saved?.phone && saved?.code ? "chat" : "login");
  }} />;
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
