// supabase/functions/ask-prof-lakay/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Edge Function Supabase — Gid NS4
// Déploiement : supabase functions deploy ask-prof-lakay
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Client Supabase Admin (service_role) ─────────────────────────────────────
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;

// ─── Appel Gemini 1.5 Flash ───────────────────────────────────────────────────
async function callGemini(prompt: string, imageBase64?: string | null): Promise<string> {
  const parts: unknown[] = [{ text: prompt }];

  if (imageBase64) {
    parts.unshift({
      inline_data: { mime_type: "image/jpeg", data: imageBase64 },
    });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] }),
    }
  );

  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "Mwen pa ka reponn kounye a.";
}

// ─── Système haïtien de mentions ─────────────────────────────────────────────
function getMention(note20: number): string {
  if (note20 >= 16) return "Excellent";
  if (note20 >= 14) return "Bien";
  if (note20 >= 12) return "Assez Bien";
  if (note20 >= 10) return "Passable";
  return "Insuffisant";
}

// ─── Masquer numéro de téléphone ─────────────────────────────────────────────
function maskPhone(phone: string): string {
  if (phone.length <= 6) return "***";
  const start = phone.slice(0, 3);
  const end   = phone.slice(-4);
  return `${start}***${end}`;
}

// ─── Numéro de semaine (ex: "2025-W22") ──────────────────────────────────────
function getWeekKey(): string {
  const now  = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const week  = Math.ceil(((now.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// ─── ACTION : validate_code ───────────────────────────────────────────────────
export async function validateCode(
  db: ReturnType<typeof createClient>,
  body: { phone: string; schoolCode: string }
) {
  const { phone, schoolCode } = body;

  const { data: school, error } = await db
    .from("schools")
    .select("*")
    .eq("code", schoolCode)
    .single();

  if (error || !school) {
    return { valid: false, reason: "Kòd la pa valid." };
  }

  if (!school.active) {
    return { valid: false, reason: "Kòd sa a dezaktive. Kontakte direksyon lekòl ou." };
  }

  const now     = new Date();
  const expires = new Date(school.expires_at);
  if (now > expires) {
    const days = Math.floor((now.getTime() - expires.getTime()) / 86400000);
    return { valid: false, reason: `Kòd ou a ekspire depi ${days} jou.` };
  }

  const starts = new Date(school.starts_at);
  if (now < starts) {
    return { valid: false, reason: "Kòd sa a poko aktif. Kontakte lekòl ou." };
  }

  const { count: studentCount } = await db
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("school_code", schoolCode);

  const { data: existingProfile } = await db
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .eq("school_code", schoolCode)
    .maybeSingle();

  if (!existingProfile && (studentCount ?? 0) >= school.max_students) {
    return { valid: false, reason: `Limit ${school.max_students} elèv rive pou kòd sa a.` };
  }

  await db.from("profiles").upsert(
    { phone, school_code: schoolCode, last_seen: new Date().toISOString() },
    { onConflict: "phone,school_code" }
  );

  const today = new Date().toISOString().split("T")[0];
  const { count: scansToday } = await db
    .from("scans")
    .select("*", { count: "exact", head: true })
    .eq("phone", phone)
    .eq("school_code", schoolCode)
    .gte("created_at", `${today}T00:00:00Z`);

  const daysRemaining = Math.ceil((expires.getTime() - now.getTime()) / 86400000);

  return {
    valid: true,
    school: {
      name:         school.school_name,
      subjects:     school.subjects ?? [],
      dailyScans:   school.daily_scans ?? 5,
      daysRemaining,
      expiresAt:    school.expires_at,
      maxStudents:  school.max_students,
    },
    scansToday: scansToday ?? 0,
  };
}

// ─── ACTION : ask ─────────────────────────────────────────────────────────────
export async function processAsk(
  db: ReturnType<typeof createClient>,
  gemini: typeof callGemini,
  body: {
    phone: string;
    schoolCode: string;
    message: string;
    subject: string;
    imageBase64: string | null;
    history: Array<{ role: string; content: string }>;
  }
) {
  const { phone, schoolCode, message, subject, imageBase64, history } = body;

  const { data: school } = await db
    .from("schools")
    .select("subjects, daily_scans, active, expires_at")
    .eq("code", schoolCode)
    .single();

  if (!school || !school.active) {
    throw { status: 403, error: "Kòd la pa valid oswa dezaktive." };
  }

  if (new Date() > new Date(school.expires_at)) {
    throw { status: 403, error: "Kòd ou a ekspire. Kontakte direksyon lekòl ou." };
  }

  const allowedSubjects: string[] = school.subjects ?? [];
  if (subject !== "Général" && !allowedSubjects.includes(subject)) {
    throw {
      status: 403,
      error: `Matière ${subject} pa otorize ak kòd sa a. Matières disponib : ${allowedSubjects.join(", ")}.`,
    };
  }

  const today = new Date().toISOString().split("T")[0];
  const { count: scansToday } = await db
    .from("scans")
    .select("*", { count: "exact", head: true })
    .eq("phone", phone)
    .eq("school_code", schoolCode)
    .gte("created_at", `${today}T00:00:00Z`);

  const dailyLimit = school.daily_scans ?? 5;
  if ((scansToday ?? 0) >= dailyLimit) {
    throw {
      status: 429,
      quotaExceeded: true,
      error: `Ou rive nan limit ${dailyLimit} scan pou jodi a. Tounen demen !`,
    };
  }

  const systemPrompt = `Tu es Prof Lakay, un professeur haïtien bienveillant et expert pour les élèves de NS4 (Bac haïtien).
Tu réponds en français avec quelques mots créoles naturels (bonjou, dakò, ale, anpil...).
Tu es pédagogique : tu expliques étape par étape, tu encourages, tu cites les formules importantes.
Tu as accès à : ${allowedSubjects.join(", ")}.
Matière actuelle : ${subject}.
Si tu vois une image, analyse-la en détail comme un correcteur du BUNEXE.
Formate les formules mathématiques en LaTeX inline ($...$) ou display ($$...$$).
Sois concis et va à l'essentiel — les élèves lisent sur téléphone.`;

  const historyText = history
    .slice(-4)
    .map((m) => `${m.role === "user" ? "Élève" : "Prof Lakay"}: ${m.content}`)
    .join("\n");

  const fullPrompt = `${systemPrompt}\n\n${historyText ? `Contexte récent:\n${historyText}\n\n` : ""}Élève: ${message}`;

  const reply = await gemini(fullPrompt, imageBase64);

  await db.from("scans").insert({
    phone,
    school_code:  schoolCode,
    subject,
    has_image:    !!imageBase64,
    created_at:   new Date().toISOString(),
  });

  return {
    reply,
    scansUsed:  (scansToday ?? 0) + 1,
    dailyLimit,
  };
}

// ─── ACTION : save_quiz_score ─────────────────────────────────────────────────
// Sauvegarde le score d'un quiz dans Supabase pour le leaderboard
export async function saveQuizScore(
  db: ReturnType<typeof createClient>,
  body: {
    phone: string;
    schoolCode: string;
    subject: string;
    score: number;
    total: number;
    note20: number;
    streak: number;
  }
) {
  const { phone, schoolCode, subject, score, total, note20, streak } = body;

  await db.from("quiz_scores").insert({
    phone,
    school_code: schoolCode,
    subject,
    score,
    total,
    note20,
    streak,
    week: getWeekKey(),
    created_at: new Date().toISOString(),
  });

  return { saved: true };
}

// ─── ACTION : get_leaderboard ─────────────────────────────────────────────────
// Retourne les 3 classements pour une école donnée
export async function getLeaderboard(
  db: ReturnType<typeof createClient>,
  body: { schoolCode: string; phone: string }
) {
  const { schoolCode, phone } = body;

  // ── 1. Meilleure note /20 par élève (max de toutes ses notes) ──
  const { data: allScores } = await db
    .from("quiz_scores")
    .select("phone, note20, score, total, subject")
    .eq("school_code", schoolCode);

  // ── 2. Total bonnes réponses par élève ──
  const totalCorrectMap: Record<string, number> = {};
  const bestNoteMap: Record<string, number>     = {};

  (allScores ?? []).forEach((row: { phone: string; note20: number; score: number }) => {
    // Meilleure note
    if (!bestNoteMap[row.phone] || row.note20 > bestNoteMap[row.phone]) {
      bestNoteMap[row.phone] = row.note20;
    }
    // Total correct
    totalCorrectMap[row.phone] = (totalCorrectMap[row.phone] ?? 0) + row.score;
  });

  // ── 3. Points cette semaine ──
  const currentWeek = getWeekKey();
  const { data: weekScores } = await db
    .from("quiz_scores")
    .select("phone, score")
    .eq("school_code", schoolCode)
    .eq("week", currentWeek);

  const weekMap: Record<string, number> = {};
  (weekScores ?? []).forEach((row: { phone: string; score: number }) => {
    weekMap[row.phone] = (weekMap[row.phone] ?? 0) + row.score;
  });

  // ── Formater et trier les classements ──
  const formatBoard = (map: Record<string, number>, myPhone: string) =>
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([p, val], i) => ({
        rank:     i + 1,
        phone:    maskPhone(p),
        isMe:     p === myPhone,
        value:    val,
      }));

  return {
    bestNote:     formatBoard(bestNoteMap,     phone),
    totalCorrect: formatBoard(totalCorrectMap, phone),
    thisWeek:     formatBoard(weekMap,         phone),
    currentWeek,
  };
}

// ─── ACTION : dashboard ───────────────────────────────────────────────────────
export async function processDashboard(
  db: ReturnType<typeof createClient>,
  body: { schoolCode: string; directorCode: string }
) {
  const { schoolCode, directorCode } = body;

  const { data: school } = await db
    .from("schools")
    .select("*")
    .eq("code", schoolCode)
    .single();

  if (!school || school.director_code !== directorCode) {
    throw { status: 403, error: "Kòd direktè a pa kòrèk." };
  }

  const today = new Date().toISOString().split("T")[0];

  const [
    { count: totalStudents },
    { count: totalScans },
    { count: scansToday },
    { data: subjectData },
  ] = await Promise.all([
    db.from("profiles").select("*", { count: "exact", head: true }).eq("school_code", schoolCode),
    db.from("scans").select("*", { count: "exact", head: true }).eq("school_code", schoolCode),
    db.from("scans").select("*", { count: "exact", head: true }).eq("school_code", schoolCode).gte("created_at", `${today}T00:00:00Z`),
    db.from("scans").select("subject").eq("school_code", schoolCode),
  ]);

  const subjectBreakdown: Record<string, number> = {};
  (subjectData ?? []).forEach((s: { subject: string }) => {
    subjectBreakdown[s.subject] = (subjectBreakdown[s.subject] ?? 0) + 1;
  });

  const expires  = new Date(school.expires_at);
  const daysLeft = Math.ceil((expires.getTime() - Date.now()) / 86400000);

  return {
    school: {
      name:          school.school_name,
      subjects:      school.subjects ?? [],
      dailyScans:    school.daily_scans,
      daysRemaining: daysLeft,
      maxStudents:   school.max_students,
      expiresAt:     school.expires_at,
    },
    stats: {
      totalStudents:    totalStudents    ?? 0,
      totalScans:       totalScans       ?? 0,
      scansToday:       scansToday       ?? 0,
      subjectBreakdown,
    },
  };
}

// ─── ACTION : get_payment_numbers ─────────────────────────────────────────────
async function getPaymentNumbers(db: ReturnType<typeof createClient>) {
  const { data } = await db
    .from("payment_config")
    .select("method, number")
    .eq("active", true)
    .order("display_order");

  return {
    payments: data ?? [
      { method: "MonCash", number: "509-XXXX-XXXX" },
      { method: "NatCash", number: "509-XXXX-XXXX" },
    ],
  };
}

// ─── HANDLER PRINCIPAL ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    let result: unknown;

    switch (body.action) {
      case "validate_code":
        result = await validateCode(supabase, body);
        break;
      case "ask":
        result = await processAsk(supabase, callGemini, body);
        break;
      case "save_quiz_score":
        result = await saveQuizScore(supabase, body);
        break;
      case "get_leaderboard":
        result = await getLeaderboard(supabase, body);
        break;
      case "dashboard":
        result = await processDashboard(supabase, body);
        break;
      case "get_payment_numbers":
        result = await getPaymentNumbers(supabase);
        break;
      default:
        return new Response(
          JSON.stringify({ error: "Action inconnue" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    const e = err as { status?: number; error?: string; quotaExceeded?: boolean };
    const status = e.status ?? 500;
    const body = {
      error:         e.error  ?? "Koneksyon an pa bon, eseye ankò !",
      quotaExceeded: e.quotaExceeded ?? false,
    };

    return new Response(
      JSON.stringify(body),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
