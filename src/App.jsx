import React, { useState, useEffect, useRef, useCallback, createContext, useContext, useReducer, memo } from "react";

// ─── CONFIGURATION & CONSTANTES ──────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
const API = `${SUPABASE_URL}/functions/v1/ask-prof-lakay`;

const COLORS = {
  primary: "linear-gradient(135deg, #d4002a, #ff6b35)",
  bg: "#070d1f",
  surface: "#0a0f2e",
  accent: "#1a4fd6",
  text: "#e0e8ff",
  success: "#22c55e",
  error: "#ef4444"
};

const SUBJECT_ICONS = {
  Biologie: "📗", Chimie: "⚗️", Physique: "⚡", Philosophie: "📖",
  "Sciences Sociales": "🌍", "Littérature Haïtienne": "✍️", Général: "📚"
};

// ─── SERVICES API & UTILS ────────────────────────────────────────────────────
async function callEdge(payload, timeout = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_ANON}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(id);
    const data = await res.json();
    if (!res.ok) throw { status: res.status, ...data };
    return data;
  } catch (err) {
    throw err.name === "AbortError" ? { type: "timeout", message: "Koneksyon an pran twòp tan." } : err;
  }
}

const compressImage = (base64, maxSize = 800) => new Promise((resolve) => {
  const img = new Image();
  img.src = base64;
  img.onload = () => {
    const canvas = document.createElement("canvas");
    let { width: w, height: h } = img;
    if (w > h && w > maxSize) { h *= maxSize / w; w = maxSize; }
    else if (h > maxSize) { w *= maxSize / h; h = maxSize; }
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    resolve(canvas.toDataURL("image/jpeg", 0.6));
  };
});

const shuffle = (a) => [...a].sort(() => Math.random() - 0.5);

// ─── GESTION DU STOCKAGE (IndexedDB) ─────────────────────────────────────────
const useHistoryDB = () => {
  const openDB = () => new Promise((resolve, reject) => {
    const req = indexedDB.open("GidNS4_DB", 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore("scans", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const save = async (phone, data) => {
    const db = await openDB();
    const tx = db.transaction("scans", "readwrite");
    tx.objectStore("scans").add({ ...data, phone, id: Date.now() });
  };

  const getAll = async (phone) => {
    const db = await openDB();
    return new Promise((res) => {
      const req = db.transaction("scans").objectStore("scans").getAll();
      req.onsuccess = () => res(req.result.filter(s => s.phone === phone).sort((a,b) => b.id - a.id));
    });
  };

  return { save, getAll };
};

// ─── LOGIQUE DE RENDU TEXTE (KaTeX & Markdown) ──────────────────────────────
const FormattedText = memo(({ content }) => {
  const [html, setHtml] = useState("");

  useEffect(() => {
    const render = async () => {
      if (!window.katex) {
        const link = document.createElement("link");
        link.rel = "stylesheet"; link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css";
        document.head.appendChild(link);
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js";
        await new Promise(r => script.onload = r); document.head.appendChild(script);
      }
      
      let res = content
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\$\$(.*?)\$\$/gs, (_, e) => window.katex.renderToString(e, { displayMode: true, throwOnError: false }))
        .replace(/\$(.*?)\$/g, (_, e) => window.katex.renderToString(e, { displayMode: false, throwOnError: false }));
      setHtml(res.replace(/\n/g, "<br/>"));
    };
    render();
  }, [content]);

  return <span className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: html || content }} />;
});

// ─── CONTEXTE AUTHENTIFICATION ───────────────────────────────────────────────
const AuthContext = createContext();
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem("ns4_session")));

  const login = async (phone, code) => {
    const res = await callEdge({ action: "validate_code", phone, schoolCode: code });
    if (!res.valid) throw new Error(res.reason);
    const data = { ...res.school, phone, code, scansToday: res.scansToday };
    setUser(data);
    localStorage.setItem("ns4_session", JSON.stringify(data));
  };

  const logout = () => { setUser(null); localStorage.removeItem("ns4_session"); };

  return <AuthContext.Provider value={{ user, setUser, login, logout }}>{children}</AuthContext.Provider>;
};

// ─── COMPOSANTS UI RÉUTILISABLES ─────────────────────────────────────────────
const Nav = ({ active, onNav }) => (
  <div className="flex border-t border-white/10 bg-[#0a0f2e] pb-safe">
    {[
      { id: "chat", i: "💬", l: "Chat" },
      { id: "quiz", i: "🧠", l: "Quiz" },
      { id: "leader", i: "🏆", l: "Klasman" },
      { id: "hist", i: "📋", l: "Istwa" },
      { id: "menu", i: "☰", l: "Menu" }
    ].map(t => (
      <button key={t.id} onClick={() => onNav(t.id)} className="flex-1 py-3 flex flex-col items-center gap-1 transition-transform active:scale-90">
        <span className="text-xl">{t.i}</span>
        <span className={`text-[10px] font-bold ${active === t.id ? "text-[#ff6b35]" : "text-slate-500"}`}>{t.l}</span>
      </button>
    ))}
  </div>
);

const Header = ({ title, sub, extra }) => (
  <div className="px-4 py-4 border-b border-white/10 bg-[#0a0f2e] flex items-center gap-3">
    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#d4002a] to-[#ff6b35] flex items-center justify-center text-xl">🎓</div>
    <div className="flex-1">
      <h1 className="text-white font-bold text-sm leading-none">{title}</h1>
      <p className="text-blue-400 text-[11px] mt-1">{sub}</p>
    </div>
    {extra}
  </div>
);

// ─── ÉCRAN : CHAT ────────────────────────────────────────────────────────────
const ChatScreen = ({ onNav }) => {
  const { user, setUser } = useContext(AuthContext);
  const [msgs, setMsgs] = useState([{ role: "assistant", content: `Bonjou! Mwen se **Prof Lakay**. Ki sa n ap etidye jodi a?` }]);
  const [input, setInput] = useState("");
  const [img, setImg] = useState(null);
  const [loading, setLoading] = useState(false);
  const db = useHistoryDB();
  const bottomRef = useRef();

  const handleSend = async () => {
    if ((!input && !img) || loading || user.scansToday >= user.dailyScans) return;
    const userMsg = { role: "user", content: input || "Analize imaj sa a", image: img };
    setMsgs(prev => [...prev, userMsg]);
    setInput(""); setImg(null); setLoading(true);

    try {
      const res = await callEdge({
        action: "ask", phone: user.phone, schoolCode: user.code, 
        message: userMsg.content, imageBase64: img?.split(",")[1],
        history: msgs.slice(-4), subject: "Général"
      });
      setMsgs(prev => [...prev, { role: "assistant", content: res.reply }]);
      setUser(u => ({ ...u, scansToday: res.scansUsed }));
      db.save(user.phone, { date: new Date().toLocaleString(), response: res.reply, image: userMsg.image, subject: "Général" });
    } catch (e) {
      setMsgs(prev => [...prev, { role: "assistant", content: "⚠️ Erè koneksyon. Eseye ankò." }]);
    } finally { setLoading(false); }
  };

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), [msgs]);

  return (
    <div className="fixed inset-0 flex flex-col bg-[#070d1f]">
      <Header title="Prof Lakay" sub={`${user.dailyScans - user.scansToday} scan disponib`} 
        extra={<div className="text-[10px] font-bold text-green-500 bg-green-500/10 px-2 py-1 rounded-full">● ONLINE</div>} />
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] p-3 rounded-2xl ${m.role === "user" ? "bg-[#1a4fd6] text-white rounded-tr-none" : "bg-[#0a0f2e] border border-white/5 text-slate-200 rounded-tl-none"}`}>
              {m.image && <img src={m.image} className="rounded-lg mb-2 max-h-40" alt="scan" />}
              <FormattedText content={m.content} />
            </div>
          </div>
        ))}
        {loading && <div className="text-blue-400 text-xs animate-pulse italic">Prof Lakay ap ekri...</div>}
        <div ref={bottomRef} />
      </div>

      <div className="p-3 bg-[#0a0f2e] border-t border-white/10">
        {img && (
          <div className="flex items-center gap-2 mb-2 bg-white/5 p-2 rounded-lg text-[10px] text-blue-300">
            <img src={img} className="w-8 h-8 rounded" alt="preview" /> Imaj prè pou voye <button onClick={() => setImg(null)} className="ml-auto text-red-500">Efase</button>
          </div>
        )}
        <div className="flex gap-2">
          <label className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-xl cursor-pointer active:scale-90">
            📷 <input type="file" hidden accept="image/*" onChange={async e => setImg(await compressImage(URL.createObjectURL(e.target.files[0])))} />
          </label>
          <textarea value={input} onChange={e => setInput(e.target.value)} placeholder="Poze kesyon ou..." className="flex-1 bg-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none resize-none" rows={1} />
          <button onClick={handleSend} disabled={loading} className="w-12 h-12 rounded-xl bg-gradient-to-r from-[#d4002a] to-[#ff6b35] flex items-center justify-center text-white active:scale-95 transition-all">✈</button>
        </div>
      </div>
      <Nav active="chat" onNav={onNav} />
    </div>
  );
};

// ─── ÉCRAN : QUIZ (Logic centralisée avec useReducer) ────────────────────────
const quizReducer = (state, action) => {
  switch (action.type) {
    case "START": return { ...state, phase: "play", sub: action.sub, qs: shuffle(action.data), idx: 0, score: 0, lives: 3, done: [] };
    case "ANSWER": 
      const correct = action.choice === state.qs[state.idx].answer;
      return { 
        ...state, 
        selected: action.choice,
        score: correct ? state.score + 1 : state.score,
        lives: !correct ? state.lives - 1 : state.lives,
        phase: !correct && state.lives <= 1 ? "result" : state.phase
      };
    case "NEXT": return { ...state, idx: state.idx + 1, selected: null, phase: state.idx + 1 >= state.qs.length ? "result" : "play" };
    case "EXIT": return { phase: "select" };
    default: return state;
  }
};

const QuizScreen = ({ onNav, quizData }) => {
  const [state, dispatch] = useReducer(quizReducer, { phase: "select" });
  const { user } = useContext(AuthContext);

  if (state.phase === "play") {
    const q = state.qs[state.idx];
    return (
      <div className="fixed inset-0 bg-[#070d1f] flex flex-col p-4">
        <div className="flex justify-between items-center mb-6">
          <button onClick={() => dispatch({ type: "EXIT" })} className="text-white">✕</button>
          <div className="flex gap-1">{"❤️".repeat(state.lives)}</div>
          <div className="text-blue-400 font-bold">{state.score} pts</div>
        </div>
        <div className="bg-[#0a0f2e] p-6 rounded-3xl border border-white/10 mb-6">
          <h2 className="text-white font-bold text-lg text-center">{q.q}</h2>
        </div>
        <div className="space-y-3">
          {q.choices.map((c, i) => (
            <button key={i} onClick={() => state.selected === null && dispatch({ type: "ANSWER", choice: i })}
              className={`w-full p-4 rounded-2xl text-left border transition-all ${state.selected === i ? (i === q.answer ? "bg-green-500/20 border-green-500 text-green-300" : "bg-red-500/20 border-red-500 text-red-300") : "bg-white/5 border-white/10 text-white"}`}>
              {c}
            </button>
          ))}
        </div>
        {state.selected !== null && (
          <button onClick={() => dispatch({ type: "NEXT" })} className="mt-auto w-full py-4 bg-[#1a4fd6] text-white font-bold rounded-2xl">Kontinye →</button>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#070d1f] flex flex-col">
      <Header title="Quiz NS4" sub="Pratike pou Bak la" />
      <div className="flex-1 p-4 space-y-3 overflow-y-auto">
        {state.phase === "result" && (
          <div className="bg-gradient-to-br from-[#1a4fd6] to-[#0a0f2e] p-6 rounded-3xl text-center mb-6 border border-white/20">
            <div className="text-4xl mb-2">🎉</div>
            <h2 className="text-white font-black text-2xl">Reziltat: {Math.round((state.score / state.qs.length) * 20)}/20</h2>
            <button onClick={() => dispatch({ type: "EXIT" })} className="mt-4 px-6 py-2 bg-white text-[#1a4fd6] font-bold rounded-full">OK</button>
          </div>
        )}
        {Object.keys(quizData).map(sub => (
          <button key={sub} onClick={() => dispatch({ type: "START", sub, data: quizData[sub] })}
            className="w-full p-5 bg-[#0a0f2e] border border-white/10 rounded-2xl flex items-center gap-4 active:scale-95 transition-all">
            <span className="text-2xl">{SUBJECT_ICONS[sub] || "📚"}</span>
            <div className="text-left">
              <div className="text-white font-bold text-sm">{sub}</div>
              <div className="text-slate-500 text-[10px]">{quizData[sub].length} kesyon disponib</div>
            </div>
          </button>
        ))}
      </div>
      <Nav active="quiz" onNav={onNav} />
    </div>
  );
};

// ─── POINT D'ENTRÉE : APP ────────────────────────────────────────────────────
const AppContent = () => {
  const { user, login } = useContext(AuthContext);
  const [screen, setScreen] = useState("chat");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  if (!user) {
    return (
      <div className="fixed inset-0 bg-[#070d1f] flex flex-col items-center justify-center p-8 text-center">
        <div className="w-20 h-20 bg-gradient-to-br from-[#d4002a] to-[#ff6b35] rounded-[30%] flex items-center justify-center text-4xl mb-6 shadow-2xl shadow-[#d4002a]/20">📚</div>
        <h1 className="text-white text-3xl font-black mb-1">Gid <span className="text-[#ff6b35]">NS4</span></h1>
        <p className="text-slate-500 text-xs mb-8">Asistan IA pou elèv NS4 an Ayiti</p>
        
        <div className="w-full space-y-4">
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Nimewo Telefòn" className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl text-white outline-none focus:border-[#ff6b35] transition-all" />
          <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Kòd Etablisman" className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl text-white outline-none focus:border-[#ff6b35] font-mono" />
          <button onClick={async () => { setLoading(true); try { await login(phone, code); } catch(e) { alert(e.message); } finally { setLoading(false); } }}
            className="w-full bg-gradient-to-r from-[#d4002a] to-[#ff6b35] p-4 rounded-2xl text-white font-black shadow-lg shadow-[#d4002a]/30 active:scale-95 transition-all">
            {loading ? "Ap verifye..." : "Konekte"}
          </button>
        </div>
      </div>
    );
  }

  switch(screen) {
    case "chat": return <ChatScreen onNav={setScreen} />;
    case "quiz": return <QuizScreen onNav={setScreen} quizData={{Biologie: [], Chimie: []}} />; // Injecter QUIZ_DATA ici
    default: return <div className="fixed inset-0 bg-[#070d1f] text-white flex flex-col"><Header title="Coming Soon" /><div className="flex-1"></div><Nav active={screen} onNav={setScreen} /></div>;
  }
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
