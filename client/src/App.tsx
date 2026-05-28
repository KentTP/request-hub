import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import paLogoUrl from "@assets/pa-logo.jpg";
import { motion, AnimatePresence } from "framer-motion";
import {
  AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis,
  PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";
import {
  Zap, Clock, CheckCircle2, AlertTriangle, ChevronRight, X,
  Send, Sparkles, Trash2, ArrowRight,
  TrendingUp, TrendingDown, Minus, Calendar,
  User, Tag, ChevronDown, RefreshCw, Target, CalendarDays,
  Layers, GitMerge, Lightbulb, BarChart3,
  Plus, FileText, Timer, BookOpen, FolderOpen, Search,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Request = {
  id: string;
  project_name: string | null;
  title: string;
  person: string | null;
  type: string;
  priority: string;
  deadline: string | null;
  status: string;
  notes: string | null;
  description: string | null;
  entry_date: string | null;   // user-editable "when did this happen" date
  assignee: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function rowToRequest(row: any): Request {
  return {
    id: row.id,
    project_name: row.project_name ?? null,
    title: row.title,
    person: row.person ?? null,
    type: row.type,
    priority: row.priority,
    deadline: row.deadline ?? null,
    status: row.status,
    notes: row.notes ?? null,
    description: row.description ?? null,
    entry_date: row.entry_date ?? null,
    assignee: row.assignee ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at ?? null,
  };
}

// Effective date: entry_date if set, otherwise fall back to created_at date
function effectiveDate(item: Request): string {
  return item.entry_date ?? item.created_at.split("T")[0];
}

// ─── Work Log type ──────────────────────────────────────────────────────────

type WorkLog = {
  id: string;
  project_name: string;
  log_date: string;        // YYYY-MM-DD
  description: string;
  duration_mins: number | null;
  created_at: string;
};

function rowToWorkLog(row: any): WorkLog {
  return {
    id: row.id,
    project_name: row.project_name,
    log_date: row.log_date,
    description: row.description,
    duration_mins: row.duration_mins ?? null,
    created_at: row.created_at,
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { label: string; cls: string }> = {
  Review:   { label: "Review",   cls: "type-review" },
  Proposal: { label: "Proposal", cls: "type-proposal" },
  Project:  { label: "Project",  cls: "type-project" },
  Task:     { label: "Task",     cls: "type-task" },
  BD:       { label: "BD",       cls: "type-bd" },
};

const PRIORITY_ORDER: Record<string, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

const SENSE_BLUE = "hsl(207 85% 52%)";
const SENSE_RED  = "hsl(5 80% 50%)";
const AMBER      = "hsl(38 92% 55%)";
const SLATE_DIM  = "hsl(215 12% 42%)";

const TYPE_COLORS: Record<string, string> = {
  Review:   "#3b9fd4",
  Proposal: "#f59e0b",
  Project:  "#60a5fa",
  Task:     "#94a3b8",
  BD:       "#34d399",
};
const PRIORITY_COLORS: Record<string, string> = {
  Urgent: "#ef4444",
  High:   "#f59e0b",
  Normal: "#3b9fd4",
  Low:    "#64748b",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

// 24 perceptually distinct colours — large enough that hash collisions are rare
const PROJECT_PALETTE = [
  "#3b9fd4", // sense blue
  "#f59e0b", // amber
  "#a78bfa", // violet
  "#38bdf8", // sky
  "#fb923c", // orange
  "#34d399", // emerald
  "#f472b6", // pink
  "#818cf8", // indigo
  "#fbbf24", // yellow
  "#2dd4bf", // teal
  "#c084fc", // purple
  "#4ade80", // green
  "#e879f9", // fuchsia
  "#60a5fa", // blue-400
  "#facc15", // yellow-400
  "#f97316", // orange-500
  "#22d3ee", // cyan
  "#a3e635", // lime
  "#e2e8f0", // slate-200 (light grey)
  "#d946ef", // fuchsia-500
  "#0ea5e9", // sky-500
  "#84cc16", // lime-500
  "#6366f1", // indigo-500
  "#fb7185", // rose-400
];

// RFP/generic category names that always get Sense Red
const RED_PROJECT_NAMES = new Set(["rfp", "rfi", "rfq", "tender"]);

// Cache: project name → palette index. Seeded deterministically from sorted project list.
const _projectColorCache = new Map<string, number>();

// Call this whenever the full item list changes — assigns palette indices by
// sorted project name so the mapping is stable across reloads.
function seedProjectColors(projectNames: string[]): void {
  const sorted = [...new Set(
    projectNames
      .map(n => n.toLowerCase().trim())
      .filter(n => n && !RED_PROJECT_NAMES.has(n))
  )].sort();
  sorted.forEach((name, i) => {
    if (!_projectColorCache.has(name)) {
      _projectColorCache.set(name, i % PROJECT_PALETTE.length);
    }
  });
}

function avatarColor(name: string): string {
  const key = name.toLowerCase().trim();
  // Hard-coded overrides
  if (RED_PROJECT_NAMES.has(key)) return SENSE_RED;
  // Return cached colour (seeded from full project list on mount/update)
  if (_projectColorCache.has(key)) return PROJECT_PALETTE[_projectColorCache.get(key)!];
  // Fallback: hash-based (new project not yet seeded)
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffff;
  return PROJECT_PALETTE[h % PROJECT_PALETTE.length];
}
function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return (p.length >= 2 ? p[0][0] + p[1][0] : name.slice(0, 2)).toUpperCase();
}

function deadlineInfo(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  const fmt = d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  if (diff < 0)   return { text: `${Math.abs(diff)}d overdue`, cls: "dl-overdue", diff };
  if (diff === 0) return { text: "Due today",    cls: "dl-today",   diff };
  if (diff === 1) return { text: "Due tomorrow", cls: "dl-soon",    diff };
  if (diff <= 5)  return { text: `${diff}d · ${fmt}`, cls: "dl-soon", diff };
  if (diff <= 14) return { text: fmt,            cls: "dl-week",    diff };
  return              { text: fmt,               cls: "dl-later",   diff };
}

function workloadScore(items: Request[]): number {
  const active = items.filter(i => i.status !== "done");
  if (!active.length) return 0;
  let score = 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  active.forEach(i => {
    let s = i.priority === "Urgent" ? 25 : i.priority === "High" ? 15 : i.priority === "Normal" ? 8 : 4;
    if (i.deadline) {
      const diff = Math.round((new Date(i.deadline + "T00:00:00").getTime() - today.getTime()) / 86400000);
      if (diff < 0) s += 20; else if (diff <= 2) s += 12; else if (diff <= 7) s += 5;
    }
    score += s;
  });
  return Math.min(100, score);
}

// ─── Smart NLP ───────────────────────────────────────────────────────────────

const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
const MONTH_NAMES = new Set(["january","february","march","april","may","june","july","august","september","october","november","december","jan","feb","mar","apr","jun","jul","aug","sep","oct","nov","dec"]);

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function titleSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().trim(), nb = b.toLowerCase().trim();
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  const levScore = 1 - levenshtein(na, nb) / maxLen;
  const wordsA = new Set(na.split(/\s+/).filter(w => w.length > 2));
  const wordsB = nb.split(/\s+/).filter(w => w.length > 2);
  const overlap = wordsB.filter(w => wordsA.has(w)).length;
  const tokenScore = wordsB.length > 0 ? overlap / Math.max(wordsA.size, wordsB.length) : 0;
  return Math.max(levScore, tokenScore * 0.9);
}

// Match against both project_name and title
function findSimilarItem(projectName: string, items: Request[], threshold = 0.72): { item: Request; score: number } | null {
  let best: { item: Request; score: number } | null = null;
  for (const item of items) {
    const scoreVsProject = item.project_name ? titleSimilarity(projectName, item.project_name) : 0;
    const scoreVsTitle   = titleSimilarity(projectName, item.title);
    const score = Math.max(scoreVsProject, scoreVsTitle);
    if (score >= threshold && (!best || score > best.score)) best = { item, score };
  }
  return best;
}

function parseDeadline(text: string): string | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const l = text.toLowerCase();
  const addD = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return d.toISOString().split("T")[0]; };
  const nextWd = (t: number) => { const d = new Date(today); const diff = ((t - d.getDay()) + 7) % 7 || 7; d.setDate(d.getDate() + diff); return d.toISOString().split("T")[0]; };
  if (/\btoday\b|\btonight\b/.test(l)) return addD(0);
  if (/\btomorrow\b/.test(l)) return addD(1);
  if (/\b(end of (this )?week|by friday|eow)\b/.test(l)) return nextWd(5);
  if (/\bnext week\b/.test(l)) return addD(7);
  if (/\bin (\d+) days?\b/.test(l)) { const m = l.match(/\bin (\d+) days?\b/); if (m) return addD(parseInt(m[1])); }
  const wdays: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5 };
  for (const [n, d] of Object.entries(wdays)) if (new RegExp(`\\b${n}\\b`).test(l)) return nextWd(d);
  if (/\bend of month\b/.test(l)) { const d = new Date(today.getFullYear(), today.getMonth() + 1, 0); return d.toISOString().split("T")[0]; }
  const mPat = MONTHS.join("|");
  const mM = text.match(new RegExp(`(\\d{1,2})\\s+(${mPat})\\w*|(${mPat})\\w*\\s+(\\d{1,2})`, "i"));
  if (mM) {
    const day = parseInt(mM[1] || mM[4]);
    const mStr = (mM[2] || mM[3]).slice(0, 3).toLowerCase();
    const mon = MONTHS.indexOf(mStr);
    const d = new Date(today.getFullYear(), mon, day);
    if (d < today) d.setFullYear(today.getFullYear() + 1);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  const nM = text.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (nM) {
    const day = parseInt(nM[1]), mon = parseInt(nM[2]) - 1;
    const raw = nM[3]; const yr = raw ? (raw.length === 2 ? 2000 + parseInt(raw) : parseInt(raw)) : today.getFullYear();
    if (day >= 1 && day <= 31 && mon >= 0 && mon <= 11) { const d = new Date(yr, mon, day); if (!isNaN(d.getTime())) return d.toISOString().split("T")[0]; }
  }
  return null;
}

function extractPerson(text: string): string | null {
  const patterns = [
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:asked|wants|needs|has asked|sent)\b/,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)'s\s+(?:review|proposal|project|tender|doc|report)/i,
    /\bfor\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
    /\bfrom\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) { const name = m[1].trim(); if (!MONTH_NAMES.has(name.toLowerCase())) return name; }
  }
  return null;
}

function extractType(text: string): string {
  const l = text.toLowerCase();
  if (/\b(review|look at|evaluate|assess|give feedback|read through|proofread)\b/.test(l)) return "Review";
  if (/\b(proposal|tender|bid|rfp|rfq|pitch|quote)\b/.test(l)) return "Proposal";
  if (/^bd$|\b(bd|business dev|business development)\b/.test(l)) return "BD";
  if (/\b(project|help with|assist|work on|develop|build|implement|design)\b/.test(l)) return "Project";
  return "Task";
}

function extractPriority(text: string): string {
  const l = text.toLowerCase();
  if (/\b(urgent|asap|immediately|critical|emergency)\b/.test(l)) return "Urgent";
  if (/\b(important|high priority|high|pressing|soon)\b/.test(l)) return "High";
  if (/\b(low priority|no rush|whenever|not urgent|can wait)\b/.test(l)) return "Low";
  return "Normal";
}

function cleanTitle(text: string, person: string | null): string {
  let c = text;
  if (person) {
    const e = person.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    c = c.replace(new RegExp(`^${e}(?:'s?)?\\s+(?:asked me to|wants me to|needs|asked|wants)\\s*`, "i"), "");
    c = c.replace(new RegExp(`\\b${e}(?:'s)?\\s+`, "i"), "");
    c = c.replace(new RegExp(`\\s+(?:for|from|by)\\s+${e}\\b`, "ig"), "");
  }
  c = c.replace(/^(?:to\s+)?(?:review|check|look at|help with|evaluate|read through|give feedback on)\s*/i, "");
  const mPat = MONTHS.join("|");
  c = c.replace(new RegExp(`[,\\s]*(?:by|before|due in?|due)\\s+(?:end of\\s+)?(?:this\\s+)?(?:week|month|today|tomorrow|monday|tuesday|wednesday|thursday|friday|eow)\\b`, "ig"), "");
  c = c.replace(new RegExp(`[,\\s]*(?:by|before|due)\\s+\\d{1,2}\\s+(?:${mPat})\\w*`, "ig"), "");
  c = c.replace(new RegExp(`[,\\s]*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\\w*)\\s+\\d{1,2}\\b`, "ig"), "");
  c = c.replace(/[,\s]*(?:by|before|due)\s+\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?/ig, "");
  c = c.replace(/[,\s]*(?:by|before|due)\s+\d{1,2}\b/ig, "");
  c = c.replace(/[,\s]*\bin\s+\d+\s+days?\b/ig, "");
  c = c.replace(/[,\s]*\bnext\s+week\b/ig, "");
  c = c.replace(/\bdue\b\s*/ig, "");
  c = c.replace(/[,\s]*(?:urgent|asap|high priority|high|low priority|no rush|not urgent|can wait|important)\b/ig, "");
  c = c.replace(/\s+/g, " ").replace(/^[,.\-–\s]+|[,.\-–\s]+$/g, "").trim();
  return c;
}

// 3-line parse: line1=project, line2=task, line3=notes
// Generic category words on line 1 — skip dedup when these are used as project names.
// Each RFP / Tender / EIA is a fresh independent item.
const GENERIC_PROJECT_TRIGGERS = new Set([
  "rfp", "rfi", "rfq", "tender", "eia", "eia review", "proposal",
  "bid", "quote", "review", "task", "misc", "general",
  "bd", "business dev", "business development",
]);

function isGenericProjectName(name: string): boolean {
  return GENERIC_PROJECT_TRIGGERS.has(name.toLowerCase().trim());
}

function parseInput(text: string): Omit<Request, "id" | "created_at" | "updated_at" | "completed_at"> & { _skipDedup?: boolean } {
  const lines = text.trim().split("\n").map(l => l.trim()).filter(Boolean);
  const line1 = lines[0] || "";
  const line2 = lines[1] || "";
  const line3 = lines.slice(2).join(" ") || "";

  // Project name = first line verbatim (cleaned of punctuation edges)
  const project_name = line1.replace(/^[,.\-–\s]+|[,.\-–\s]+$/g, "").trim() || null;

  // Detect if line1 is a generic category (RFP, Tender, EIA, etc.)
  const genericCategory = project_name ? isGenericProjectName(project_name) : false;

  // Task context = line2 (or line1 if only one line)
  const taskText = line2 || line1;
  const person   = extractPerson(taskText);

  // If line1 is a known type keyword, honour it for type detection; otherwise extract from task text
  const typeFromLine1 = genericCategory ? extractType(line1) : null;
  const type     = typeFromLine1 || extractType(line2 ? taskText : text);
  const priority = extractPriority(text);
  const deadline = parseDeadline(text);

  const rawTitle = cleanTitle(taskText, person);
  const title = rawTitle.length > 2
    ? rawTitle[0].toUpperCase() + rawTitle.slice(1)
    : project_name || "Task request";

  const notes = line3 || "";

  return {
    project_name,
    title,
    person: person || null,
    type,
    priority,
    deadline: deadline || null,
    entry_date: null,
    assignee: null,
    status: "inbox",
    notes,
    description: text.trim(),
    _skipDedup: genericCategory,
  };
}

function fuzzyMatch(target: string, keyword: string): boolean {
  const t = target.toLowerCase();
  const words = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  return words.length > 0 && words.every(w => t.includes(w));
}

// ─── Smart Insight Generator ─────────────────────────────────────────────────

function generateInsights(items: Request[]): string[] {
  const insights: string[] = [];
  const active      = items.filter(i => i.status !== "done");
  const overdue     = active.filter(i => i.deadline && (deadlineInfo(i.deadline)?.diff ?? 0) < 0);
  const urgent      = active.filter(i => i.priority === "Urgent");
  const today       = new Date(); today.setHours(0, 0, 0, 0);
  const todayKey    = today.toISOString().split("T")[0];
  const thisWeekMs  = 7 * 86400000;

  // ── Critical alerts first ──
  if (overdue.length > 0) {
    const names = overdue.slice(0, 2).map(i => i.project_name || i.title).join(", ");
    insights.push(`⚠ ${overdue.length} overdue — ${names}${overdue.length > 2 ? " +more" : ""}.`);
  }
  if (urgent.length > 0) {
    const urgentNames = urgent.slice(0, 2).map(i => i.project_name || i.title).join(", ");
    insights.push(`🔴 Urgent: ${urgentNames}${urgent.length > 2 ? ` (+${urgent.length - 2} more)` : ""}.`);
  }

  // ── Deadlines within 48 hrs ──
  const dueToday = active.filter(i => { const dl = deadlineInfo(i.deadline); return dl && dl.diff !== undefined && dl.diff === 0; });
  const dueTomorrow = active.filter(i => { const dl = deadlineInfo(i.deadline); return dl && dl.diff !== undefined && dl.diff === 1; });
  if (dueToday.length > 0) insights.push(`📅 Due today: ${dueToday.map(i => i.project_name || i.title).join(", ")}.`);
  else if (dueTomorrow.length > 0) insights.push(`📅 Due tomorrow: ${dueTomorrow.map(i => i.project_name || i.title).join(", ")}.`);

  // ── Stalled in-progress ──
  const stalled = items.filter(i => i.status === "in-progress" &&
    (today.getTime() - new Date(i.updated_at).getTime()) > 3 * 86400000);
  if (stalled.length > 0) {
    insights.push(`⏸ ${stalled.length} task${stalled.length > 1 ? "s" : ""} stalled (no update in 3+ days) — ${stalled.slice(0,1).map(i => i.project_name || i.title).join(", ")}.`);
  }

  // ── Today's activity ──
  const addedToday = items.filter(x => effectiveDate(x) === todayKey);
  const completedToday = items.filter(x => x.completed_at?.startsWith(todayKey));
  if (addedToday.length > 0 || completedToday.length > 0) {
    const parts: string[] = [];
    if (addedToday.length > 0)     parts.push(`${addedToday.length} logged`);
    if (completedToday.length > 0) parts.push(`${completedToday.length} completed`);
    insights.push(`📋 Today: ${parts.join(", ")}.`);
  }

  // ── Inbox pile-up ──
  const inbox = active.filter(i => i.status === "inbox");
  if (inbox.length >= 4) {
    const oldest = [...inbox].sort((a, b) => effectiveDate(a).localeCompare(effectiveDate(b)))[0];
    const oldestAge = Math.round((today.getTime() - new Date(effectiveDate(oldest) + "T00:00:00").getTime()) / 86400000);
    insights.push(`📥 ${inbox.length} in Inbox — oldest is ${oldestAge}d old. Worth a triage.`);
  }

  // ── Busiest project ──
  const byProject: Record<string, number> = {};
  active.forEach(i => { if (i.project_name) byProject[i.project_name] = (byProject[i.project_name] || 0) + 1; });
  const topProject = Object.entries(byProject).sort((a, b) => b[1] - a[1])[0];
  if (topProject && topProject[1] >= 2) {
    insights.push(`📁 "${topProject[0]}" has ${topProject[1]} open items — most active project.`);
  }

  // ── Requester with most open items ──
  const byPerson: Record<string, number> = {};
  active.forEach(i => { if (i.person) byPerson[i.person] = (byPerson[i.person] || 0) + 1; });
  const topPerson = Object.entries(byPerson).sort((a, b) => b[1] - a[1])[0];
  if (topPerson && topPerson[1] >= 2) {
    insights.push(`👤 ${topPerson[0]} has ${topPerson[1]} open requests.`);
  }

  // ── Weekly velocity ──
  const doneThisWk = items.filter(x => x.completed_at && (today.getTime() - new Date(x.completed_at).getTime()) < thisWeekMs).length;
  const doneLastWk = items.filter(x => {
    if (!x.completed_at) return false;
    const ms = today.getTime() - new Date(x.completed_at).getTime();
    return ms >= thisWeekMs && ms < 2 * thisWeekMs;
  }).length;
  const velocity = doneThisWk - doneLastWk;
  if (doneThisWk > 0) {
    const trend = velocity > 0 ? `↑ up ${velocity} from last wk` : velocity < 0 ? `↓ down ${Math.abs(velocity)} from last wk` : "same pace as last wk";
    insights.push(`✅ ${doneThisWk} completed this week — ${trend}.`);
  }

  // ── Proposal pipeline ──
  const proposals = active.filter(i => i.type === "Proposal");
  if (proposals.length >= 2) {
    insights.push(`📄 ${proposals.length} proposals in flight — review for follow-up needed.`);
  }

  // ── All-clear ──
  if (overdue.length === 0 && urgent.length === 0 && stalled.length === 0 && active.length > 0) {
    insights.push("✨ No overdue, nothing urgent, nothing stalled. Clean slate.");
  }

  return insights.slice(0, 5); // show max 5
}

// ─── Components ──────────────────────────────────────────────────────────────

function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const color = avatarColor(name);
  return (
    <div style={{ background: color, width: size, height: size, fontSize: size * 0.38 }}
      className="rounded-full flex items-center justify-center text-white font-bold shrink-0 select-none">
      {initials(name)}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const meta = TYPE_META[type] || { label: type, cls: "type-task" };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function WorkloadMeter({ score }: { score: number }) {
  const label = score < 30 ? "Clear" : score < 60 ? "Moderate" : score < 85 ? "Heavy" : "Critical";
  const color = score < 30 ? SENSE_BLUE : score < 60 ? AMBER : score < 85 ? "hsl(25 95% 55%)" : SENSE_RED;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1 w-[60px] rounded-full bg-white/10 overflow-hidden">
        <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: color }}
          initial={{ width: 0 }} animate={{ width: `${score}%` }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} />
      </div>
      <span className="text-[11px] font-semibold tabular" style={{ color }}>{label}</span>
    </div>
  );
}

// ─── Match Banner ─────────────────────────────────────────────────────────────

function MatchBanner({ match, onOpen, onCreateNew, onDismiss }: {
  match: { item: Request; score: number };
  onOpen: () => void;
  onCreateNew: () => void;
  onDismiss: () => void;
}) {
  const pct = Math.round(match.score * 100);
  const displayName = match.item.project_name || match.item.title;
  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.15 }}
      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] text-[11px] mt-2">
      <GitMerge size={11} className="text-amber-400 shrink-0" />
      <span className="flex-1 min-w-0 text-amber-200/80">
        <span className="font-semibold text-amber-300">{pct}% match</span> — "{displayName}"
        {" "}· <span className="font-medium">{match.item.status}</span>
      </span>
      <button onClick={onOpen}
        className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/35 text-amber-300 font-semibold text-[10px] transition-colors shrink-0">
        Open existing
      </button>
      <button onClick={onCreateNew}
        className="px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 font-semibold text-[10px] transition-colors shrink-0">
        Create new
      </button>
      <button onClick={onDismiss} className="text-slate-500 hover:text-slate-300 transition-colors"><X size={11} /></button>
    </motion.div>
  );
}

// ─── Request Card ─────────────────────────────────────────────────────────────

function RequestCard({ item, onMove, onDelete, onClick }: {
  item: Request;
  onMove: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onClick: (item: Request) => void;
}) {
  const dl = deadlineInfo(item.deadline);
  const isOverdue = dl && dl.diff !== undefined && dl.diff < 0 && item.status !== "done";
  const borderColor = isOverdue
    ? "hsl(5 80% 50% / 0.7)"
    : item.priority === "Urgent" ? "hsl(5 80% 50% / 0.5)"
    : item.priority === "High"   ? "hsl(38 92% 55% / 0.5)"
    : "transparent";

  return (
    <motion.div layout
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, y: 6 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className={`group relative rounded-lg border border-white/[0.07] bg-surface-1 cursor-pointer
        hover:border-white/[0.14] hover:bg-surface-3 transition-all duration-150
        ${item.status === "done" ? "opacity-45 hover:opacity-65" : ""}
      `}
      style={{ borderLeftColor: borderColor, borderLeftWidth: 2 }}
      onClick={() => onClick(item)}
    >
      {/* Project name header stripe */}
      {item.project_name && (
        <div className="px-3 pt-2.5 pb-1.5 border-b border-white/[0.05] flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: avatarColor(item.project_name) }} />
          <span className="text-[10.5px] font-bold text-foreground/70 truncate tracking-wide uppercase">
            {item.project_name}
          </span>
          {/* Hover actions */}
          <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {item.status === "inbox" && (
              <button onClick={e => { e.stopPropagation(); onMove(item.id, "in-progress"); }}
                className="p-1 rounded hover:bg-blue-500/15 text-blue-400/60 hover:text-blue-400 transition-colors" title="Start">
                <ChevronRight size={11} />
              </button>
            )}
            {item.status !== "done" && (
              <button onClick={e => { e.stopPropagation(); onMove(item.id, "done"); }}
                className="p-1 rounded hover:bg-blue-500/15 text-blue-400/60 hover:text-blue-400 transition-colors" title="Done">
                <CheckCircle2 size={11} />
              </button>
            )}
            {item.status === "done" && (
              <button onClick={e => { e.stopPropagation(); onMove(item.id, "inbox"); }}
                className="p-1 rounded hover:bg-white/10 text-muted-foreground transition-colors" title="Reopen">
                <RefreshCw size={11} />
              </button>
            )}
            <button onClick={e => { e.stopPropagation(); onDelete(item.id); }}
              className="p-1 rounded hover:bg-red-500/15 text-red-400/40 hover:text-red-400 transition-colors" title="Delete">
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      )}

      <div className={`px-3 ${item.project_name ? "pt-2 pb-2.5" : "pt-3 pb-2.5"}`}>
        {/* Badges row (only shown when no project name header) */}
        {!item.project_name && (
          <div className="flex items-center gap-1.5 mb-2">
            <TypeBadge type={item.type} />
            {item.priority !== "Normal" && (
              <span className={`text-[9.5px] font-bold uppercase tracking-wide ${
                item.priority === "Urgent" ? "priority-urgent" : item.priority === "High" ? "priority-high" : "priority-low"
              }`}>{item.priority}</span>
            )}
            {isOverdue && <span className="text-[9.5px] font-bold uppercase text-red-400">overdue</span>}
            {/* Hover actions when no project header */}
            <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {item.status === "inbox" && (
                <button onClick={e => { e.stopPropagation(); onMove(item.id, "in-progress"); }}
                  className="p-1 rounded hover:bg-blue-500/15 text-blue-400/60 hover:text-blue-400 transition-colors">
                  <ChevronRight size={11} />
                </button>
              )}
              {item.status !== "done" && (
                <button onClick={e => { e.stopPropagation(); onMove(item.id, "done"); }}
                  className="p-1 rounded hover:bg-blue-500/15 text-blue-400/60 hover:text-blue-400 transition-colors">
                  <CheckCircle2 size={11} />
                </button>
              )}
              {item.status === "done" && (
                <button onClick={e => { e.stopPropagation(); onMove(item.id, "inbox"); }}
                  className="p-1 rounded hover:bg-white/10 text-muted-foreground transition-colors">
                  <RefreshCw size={11} />
                </button>
              )}
              <button onClick={e => { e.stopPropagation(); onDelete(item.id); }}
                className="p-1 rounded hover:bg-red-500/15 text-red-400/40 hover:text-red-400 transition-colors">
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        )}

        {/* Task title */}
        <p className={`text-[12.5px] font-semibold text-foreground leading-snug ${item.project_name ? "" : ""}`}>
          {item.title}
        </p>

        {/* Notes preview */}
        {item.notes && (
          <p className="text-[11px] text-muted-foreground/70 mt-1 leading-snug line-clamp-2">
            {item.notes}
          </p>
        )}

        {/* Meta: badges (when project shown), person, deadline */}
        <div className="flex items-center gap-2 mt-2">
          {item.project_name && (
            <TypeBadge type={item.type} />
          )}
          {item.project_name && item.priority !== "Normal" && (
            <span className={`text-[9.5px] font-bold uppercase tracking-wide ${
              item.priority === "Urgent" ? "priority-urgent" : item.priority === "High" ? "priority-high" : "priority-low"
            }`}>{item.priority}</span>
          )}
          {item.project_name && isOverdue && <span className="text-[9.5px] font-bold uppercase text-red-400">overdue</span>}
          {item.person && (
            <div className="flex items-center gap-1">
              <Avatar name={item.person} size={14} />
              <span className="text-[10.5px] text-muted-foreground">{item.person}</span>
            </div>
          )}
          {item.assignee && (
            <div className="flex items-center gap-1 bg-blue-500/10 border border-blue-500/20 rounded-full px-2 py-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400/70 shrink-0" />
              <span className="text-[9.5px] font-medium text-blue-300/80">{item.assignee}</span>
            </div>
          )}
          {dl && (
            <div className={`flex items-center gap-1 text-[10px] font-medium ${!item.person && !item.assignee ? "ml-auto" : ""} ${dl.cls}`}>
              <Clock size={9} /><span>{dl.text}</span>
            </div>
          )}
          {/* Entry date badge — only when backdated (not today) */}
          {(() => {
            const edate = effectiveDate(item);
            const todayKey = new Date().toISOString().split("T")[0];
            if (edate === todayKey) return null;
            const d = new Date(edate + "T00:00:00");
            const fmt = d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
            return (
              <div className="flex items-center gap-1 text-[9.5px] text-muted-foreground/50 ml-auto">
                <CalendarDays size={8.5} /><span>{fmt}</span>
              </div>
            );
          })()}
        </div>
      </div>
    </motion.div>
  );
}

function Column({ status, label, items, onMove, onDelete, onClick, icon, accentColor }: {
  status: string; label: string; items: Request[];
  onMove: (id: string, s: string) => void;
  onDelete: (id: string) => void;
  onClick: (item: Request) => void;
  icon: React.ReactNode; accentColor: string;
}) {
  const [over, setOver] = useState(false);
  const sorted = [...items].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  return (
    <div className={`flex flex-col rounded-xl border flex-1 min-w-[220px] transition-all duration-150
        ${over ? "border-white/20 bg-white/[0.015]" : "border-white/[0.07] bg-[hsl(222_18%_10%)]"}`}
      style={{ borderTopColor: over ? accentColor : undefined, borderTopWidth: over ? 2 : undefined }}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData("id"); if (id) onMove(id, status); }}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] shrink-0"
        style={{ borderTopColor: accentColor, borderTopWidth: 2, borderTopLeftRadius: "0.75rem", borderTopRightRadius: "0.75rem" }}>
        <span style={{ color: accentColor }}>{icon}</span>
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
        <span className="ml-auto flex items-center justify-center w-5 h-5 rounded bg-white/[0.06] text-[10px] font-bold text-muted-foreground tabular">
          {items.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto styled-scroll p-3 flex flex-col gap-2">
        <AnimatePresence mode="popLayout">
          {sorted.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-14 gap-2 text-center">
              <div className="w-9 h-9 rounded-full bg-white/[0.04] flex items-center justify-center">
                <span style={{ color: accentColor, opacity: 0.35 }}>{icon}</span>
              </div>
              <p className="text-[11.5px] text-muted-foreground/50">Nothing here</p>
            </motion.div>
          ) : sorted.map(item => (
            <div key={item.id} draggable onDragStart={e => e.dataTransfer.setData("id", item.id)}>
              <RequestCard item={item} onMove={onMove} onDelete={onDelete} onClick={onClick} />
            </div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Focus Board View ───────────────────────────────────────────────────────

function FocusBoardView({
  filter, items, workLogs, onMove, onDelete, onOpenItem, onOpenProject,
}: {
  filter: string;
  items: Request[];
  workLogs: WorkLog[];
  onMove: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onOpenItem: (item: Request) => void;
  onOpenProject: (name: string) => void;
}) {
  const [activeBucket, setActiveBucket] = useState<string>("in-progress");
  const formatMins = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 > 0 ? ` ${m % 60}m` : ""}` : `${m}m`;

  // Projects that belong to this type
  const filtered = items.filter(i => i.type === filter);
  // For Proposal/BD: the title IS the unique name; project_name is just "RFP"/"BD"
  const isNamedByTitle = filter === "Proposal" || filter === "BD";
  const typeProjects = new Set(
    filtered.map(i => isNamedByTitle ? i.title : i.project_name).filter(Boolean) as string[]
  );

  // Work logs that belong to projects of this type
  // For Proposal/BD, logs are keyed by title (stored as project_name in work_logs)
  const typeLogs = workLogs.filter(l => typeProjects.has(l.project_name));
  const totalLogMins = typeLogs.reduce((s, l) => s + (l.duration_mins ?? 0), 0);

  // Sorted logs: newest first
  const sortedLogs = [...typeLogs].sort((a, b) => b.log_date.localeCompare(a.log_date));

  // Group logs by date for display
  const logsByDate = useMemo(() => {
    const groups: Record<string, WorkLog[]> = {};
    sortedLogs.forEach(l => {
      if (!groups[l.log_date]) groups[l.log_date] = [];
      groups[l.log_date].push(l);
    });
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [sortedLogs]);

  const BUCKETS = [
    { status: "inbox",       label: "Inbox",       icon: <Clock size={13} />,        color: SENSE_BLUE },
    { status: "in-progress", label: "In Progress",  icon: <Zap size={13} />,          color: AMBER },
    { status: "done",        label: "Done",         icon: <CheckCircle2 size={13} />, color: "hsl(142 70% 45%)" },
    { status: "logs",        label: "Work Logs",    icon: <FileText size={13} />,     color: "hsl(38 92% 55%)" },
  ];

  const isLogsActive = activeBucket === "logs";
  const bucketItems = filtered.filter(i => i.status === activeBucket);
  const sorted = [...bucketItems].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  const activeBucketCfg = BUCKETS.find(b => b.status === activeBucket)!;

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: stacked buckets ── */}
      <div className="w-[200px] shrink-0 flex flex-col gap-1 p-3 border-r border-white/[0.06]">
        {BUCKETS.map((b, idx) => {
          const count = b.status === "logs" ? typeLogs.length : filtered.filter(i => i.status === b.status).length;
          const isActive = activeBucket === b.status;
          // Divider before Work Logs
          return (
            <div key={b.status}>
              {idx === 3 && <div className="my-1.5 border-t border-white/[0.06]" />}
              <button onClick={() => setActiveBucket(b.status)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all ${
                  isActive
                    ? "bg-white/[0.08] border border-white/[0.12]"
                    : "hover:bg-white/[0.04] border border-transparent"
                }`}>
                <span style={{ color: isActive ? b.color : "hsl(215 15% 50%)" }}>{b.icon}</span>
                <span className={`text-[11.5px] font-semibold flex-1 ${
                  isActive ? "text-foreground" : "text-muted-foreground"
                }`}>{b.label}</span>
                <span className="text-[10px] font-bold tabular px-1.5 py-0.5 rounded-md bg-white/[0.05] text-muted-foreground"
                  style={isActive ? { color: b.color } : {}}>{count}</span>
              </button>
            </div>
          );
        })}

        <div className="mt-auto pt-3 border-t border-white/[0.06]">
          <div className="flex flex-col gap-1.5 px-1">
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">Total tasks</span>
              <span className="font-bold text-foreground">{filtered.length}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">Active</span>
              <span className="font-bold" style={{ color: SENSE_BLUE }}>{filtered.filter(i => i.status !== "done").length}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">Log entries</span>
              <span className="font-bold" style={{ color: AMBER }}>{typeLogs.length}</span>
            </div>
            {totalLogMins > 0 && (
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">Time logged</span>
                <span className="font-bold" style={{ color: AMBER }}>{formatMins(totalLogMins)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Right: task list OR work logs ── */}
      <div className="flex-1 overflow-y-auto styled-scroll p-4 min-w-0">
        <div className="flex items-center gap-2 mb-3">
          <span style={{ color: activeBucketCfg.color }}>{activeBucketCfg.icon}</span>
          <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{activeBucketCfg.label}</span>
          {isLogsActive ? (
            <>
              <span className="text-[10px] text-muted-foreground/60 ml-1">{typeLogs.length} entr{typeLogs.length !== 1 ? "ies" : "y"}</span>
              {totalLogMins > 0 && (
                <span className="ml-auto text-[10px] font-semibold flex items-center gap-1" style={{ color: AMBER }}>
                  <Timer size={10} />{formatMins(totalLogMins)} total
                </span>
              )}
            </>
          ) : (
            <span className="text-[10px] text-muted-foreground/60 ml-1">{sorted.length} item{sorted.length !== 1 ? "s" : ""}</span>
          )}
        </div>

        {isLogsActive ? (
          // ── Work Logs view ──
          <AnimatePresence mode="popLayout">
            {logsByDate.length === 0 ? (
              <motion.div key="empty-logs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-20 gap-2 text-center">
                <div className="w-10 h-10 rounded-full bg-white/[0.04] flex items-center justify-center">
                  <FileText size={16} style={{ color: AMBER, opacity: 0.35 }} />
                </div>
                <p className="text-[12px] text-muted-foreground/50">No work logs yet for this type</p>
                <p className="text-[10.5px] text-muted-foreground/40">Open a project card to add logs</p>
              </motion.div>
            ) : (
              <div className="flex flex-col gap-4 max-w-2xl">
                {logsByDate.map(([date, logs]) => {
                  const dayMins = logs.reduce((s, l) => s + (l.duration_mins ?? 0), 0);
                  const dayLabel = (() => {
                    const today = new Date(); today.setHours(0,0,0,0);
                    const d = new Date(date + "T00:00:00");
                    const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
                    if (diff === 0) return "Today";
                    if (diff === 1) return "Yesterday";
                    return d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
                  })();
                  return (
                    <motion.div key={date} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
                      {/* Date header */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{dayLabel}</span>
                        <div className="flex-1 h-px bg-white/[0.05]" />
                        {dayMins > 0 && (
                          <span className="text-[9.5px] font-semibold flex items-center gap-1" style={{ color: AMBER }}>
                            <Timer size={9} />{formatMins(dayMins)}
                          </span>
                        )}
                      </div>
                      {/* Log entries for this day */}
                      <div className="flex flex-col gap-1.5">
                        {logs.map(log => (
                          <div key={log.id}
                            className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-[hsl(222_18%_11%)] border border-white/[0.06] hover:border-white/[0.1] transition-colors group">
                            <FileText size={12} style={{ color: AMBER }} className="shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[11.5px] text-foreground leading-snug">{log.description}</p>
                              <button onClick={() => onOpenProject(log.project_name)}
                                className="text-[10px] text-muted-foreground/60 hover:text-blue-400 transition-colors mt-0.5 truncate max-w-full text-left">
                                {log.project_name}
                              </button>
                            </div>
                            {log.duration_mins != null && log.duration_mins > 0 && (
                              <span className="text-[10px] font-semibold shrink-0 flex items-center gap-1 mt-0.5" style={{ color: AMBER }}>
                                <Timer size={9} />{formatMins(log.duration_mins)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </AnimatePresence>
        ) : (
          // ── Task list view ──
          <AnimatePresence mode="popLayout">
            {sorted.length === 0 ? (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-20 gap-2 text-center">
                <div className="w-10 h-10 rounded-full bg-white/[0.04] flex items-center justify-center">
                  <span style={{ color: activeBucketCfg.color, opacity: 0.35 }}>{activeBucketCfg.icon}</span>
                </div>
                <p className="text-[12px] text-muted-foreground/50">Nothing here</p>
              </motion.div>
            ) : (
              <div className="grid grid-cols-1 gap-2 max-w-2xl">
                {sorted.map(item => (
                  <motion.div key={item.id}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    draggable onDragStart={e => e.dataTransfer.setData("id", item.id)}>
                    <RequestCard item={item} onMove={onMove} onDelete={onDelete} onClick={i => onOpenItem(i)} />
                  </motion.div>
                ))}
              </div>
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

// ─── Insights Panel (always visible right column) ─────────────────────────────

function InsightsPanel({ items, workLogs, onOpenItem }: { items: Request[]; workLogs: WorkLog[]; onOpenItem: (item: Request) => void }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const days14 = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today); d.setDate(d.getDate() - (13 - i));
    const key = d.toISOString().split("T")[0];
    return {
      label: d.toLocaleDateString("en-CA", { month: "short", day: "numeric" }),
      added: items.filter(x => effectiveDate(x) === key).length,
      done:  items.filter(x => x.completed_at?.startsWith(key)).length,
    };
  }), [items]);

  const active   = items.filter(i => i.status !== "done");
  const urgent   = active.filter(i => i.priority === "Urgent");
  const overdue  = active.filter(i => i.deadline && (deadlineInfo(i.deadline)?.diff ?? 0) < 0);
  const doneAll  = items.filter(i => i.status === "done").length;
  const compRate = items.length > 0 ? Math.round((doneAll / items.length) * 100) : 0;

  const doneThisWeek = items.filter(x => {
    if (x.status !== "done" || !x.completed_at) return false;
    const wk = new Date(today); wk.setDate(wk.getDate() - 7);
    return new Date(x.completed_at) >= wk;
  }).length;
  const doneLastWeek = items.filter(x => {
    if (x.status !== "done" || !x.completed_at) return false;
    const s = new Date(today); s.setDate(s.getDate() - 14);
    const e = new Date(today); e.setDate(e.getDate() - 7);
    return new Date(x.completed_at) >= s && new Date(x.completed_at) < e;
  }).length;
  const velocity = doneThisWeek - doneLastWeek;

  const priorityData = ["Urgent","High","Normal","Low"].map(p => ({
    name: p, value: active.filter(i => i.priority === p).length, color: PRIORITY_COLORS[p],
  })).filter(d => d.value > 0);

  const typeData = ["Review","Proposal","BD","Project","Task"].map(t => ({
    name: t, count: items.filter(i => i.type === t).length, color: TYPE_COLORS[t],
  })).filter(d => d.count > 0);

  const byPerson: Record<string, number> = {};
  items.forEach(i => { if (i.person) byPerson[i.person] = (byPerson[i.person] || 0) + 1; });
  const topPeople = Object.entries(byPerson).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const insights = useMemo(() => generateInsights(items), [items]);

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto styled-scroll h-full">

      {/* ── Smart Insights text ── */}
      {insights.length > 0 && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.04] p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Lightbulb size={11} className="text-blue-400" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-blue-400/80">Smart Insights</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {insights.map((insight, i) => (
              <p key={i} className="text-[11px] text-foreground/80 leading-snug">{insight}</p>
            ))}
          </div>
        </div>
      )}

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-1.5">
        {[
          { label: "Active",    value: active.length,  icon: <Target size={11} />,       color: SENSE_BLUE },
          { label: "Urgent",    value: urgent.length,  icon: <Zap size={11} />,           color: urgent.length  ? SENSE_RED : SENSE_BLUE },
          { label: "Done / wk", value: doneThisWeek,   icon: <CheckCircle2 size={11} />, color: SENSE_BLUE },
          { label: "Overdue",   value: overdue.length, icon: <AlertTriangle size={11} />, color: overdue.length ? SENSE_RED : SENSE_BLUE },
        ].map(kpi => (
          <div key={kpi.label} className="rounded-lg border border-white/[0.06] bg-[hsl(222_18%_12%)] p-2.5">
            <div className="flex items-center gap-1 mb-0.5" style={{ color: kpi.color }}>
              {kpi.icon}
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{kpi.label}</span>
            </div>
            <div className="text-2xl font-display font-bold tabular leading-none" style={{ color: kpi.color }}>{kpi.value}</div>
          </div>
        ))}
      </div>



      {/* ── Type donut: BD vs Proposal vs Review vs Project/Task ── */}
      {typeData.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-[hsl(222_18%_12%)] p-3">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">Type Mix</span>
          <div className="flex items-center gap-3">
            <PieChart width={64} height={64}>
              <Pie data={typeData} dataKey="count" cx={28} cy={28} innerRadius={17} outerRadius={30} strokeWidth={0}>
                {typeData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "hsl(222 18% 14%)", border: "1px solid hsl(222 15% 22%)", borderRadius: 8, fontSize: 10, padding: "3px 8px" }}
                formatter={(v: number, n: string) => [v, n]} />
            </PieChart>
            <div className="flex flex-col gap-1 flex-1">
              {typeData.map(d => (
                <div key={d.name} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-sm shrink-0" style={{ background: d.color }} />
                  <span className="text-[10px] text-foreground flex-1">{d.name}</span>
                  <span className="text-[10px] font-bold tabular text-muted-foreground">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── 14-day sparkline ── */}
      <div className="rounded-lg border border-white/[0.06] bg-[hsl(222_18%_12%)] p-3">
        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">Activity · 14 days</span>
        <div className="h-[50px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={days14} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
              <defs>
                <linearGradient id="gD" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b9fd4" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#3b9fd4" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" hide />
              <Tooltip contentStyle={{ background: "hsl(222 18% 14%)", border: "1px solid hsl(222 15% 22%)", borderRadius: 8, fontSize: 10, padding: "3px 8px" }}
                labelStyle={{ color: "hsl(210 20% 80%)" }} itemStyle={{ color: "hsl(210 15% 65%)" }} />
              <Area type="monotone" dataKey="added" stroke="#94a3b8" strokeWidth={1.5} fill="url(#gA)" name="Added" dot={false} />
              <Area type="monotone" dataKey="done"  stroke="#3b9fd4" strokeWidth={1.5} fill="url(#gD)" name="Done" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-3 mt-1">
          <div className="flex items-center gap-1"><div className="w-2 h-0.5 rounded bg-blue-400" /><span className="text-[9px] text-muted-foreground">Done</span></div>
          <div className="flex items-center gap-1"><div className="w-2 h-0.5 rounded bg-slate-400/60" /><span className="text-[9px] text-muted-foreground">Added</span></div>
        </div>
      </div>

      {/* ── BD / Proposal / Project+Task breakdown ── */}
      {(() => {
        const buckets = [
          { label: "BD",       color: TYPE_COLORS.BD,       total: items.filter(i => i.type === "BD").length,       active: items.filter(i => i.type === "BD" && i.status !== "done").length },
          { label: "Proposal", color: TYPE_COLORS.Proposal,  total: items.filter(i => i.type === "Proposal").length,  active: items.filter(i => i.type === "Proposal" && i.status !== "done").length },
          { label: "Review",   color: TYPE_COLORS.Review,    total: items.filter(i => i.type === "Review").length,    active: items.filter(i => i.type === "Review" && i.status !== "done").length },
          { label: "Project",  color: TYPE_COLORS.Project,   total: items.filter(i => i.type === "Project").length,   active: items.filter(i => i.type === "Project" && i.status !== "done").length },
          { label: "Task",     color: TYPE_COLORS.Task,      total: items.filter(i => i.type === "Task").length,      active: items.filter(i => i.type === "Task" && i.status !== "done").length },
        ].filter(b => b.total > 0);
        const maxTotal = Math.max(...buckets.map(b => b.total), 1);
        if (buckets.length === 0) return null;
        return (
          <div className="rounded-lg border border-white/[0.06] bg-[hsl(222_18%_12%)] p-3">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Workload Mix</span>
              <span className="text-[9px] text-muted-foreground/50">{items.length} total</span>
            </div>
            <div className="flex flex-col gap-2">
              {buckets.map(b => (
                <div key={b.label}>
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: b.color }} />
                      <span className="text-[10.5px] text-foreground font-medium">{b.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {b.active > 0 && <span className="text-[9px] font-semibold" style={{ color: b.color }}>{b.active} active</span>}
                      <span className="text-[9px] font-bold tabular text-muted-foreground">{b.total}</span>
                    </div>
                  </div>
                  <div className="h-[4px] rounded-full bg-white/[0.05] overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${(b.total / maxTotal) * 100}%`, background: b.color + "cc" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}


      {/* ── Top requesters ── */}
      {topPeople.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-[hsl(222_18%_12%)] p-3">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">Top Requesters</span>
          <div className="flex flex-col gap-2">
            {topPeople.map(([name, count]) => {
              const max = topPeople[0][1];
              return (
                <div key={name} className="flex items-center gap-2">
                  <Avatar name={name} size={16} />
                  <span className="text-[10.5px] text-foreground flex-1 truncate">{name}</span>
                  <div className="w-12 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className="h-full rounded-full bg-blue-500/60" style={{ width: `${(count/max)*100}%` }} />
                  </div>
                  <span className="text-[10px] font-bold tabular text-muted-foreground w-3 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Overdue ── */}
      {overdue.length > 0 && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/[0.04] p-3">
          <span className="text-[9px] font-bold uppercase tracking-wider text-red-400/80 block mb-2">Overdue · {overdue.length}</span>
          <div className="flex flex-col gap-1.5">
            {overdue.slice(0, 5).map(item => {
              const dl = deadlineInfo(item.deadline);
              return (
                <button key={item.id} onClick={() => onOpenItem(item)}
                  className="flex items-center gap-2 text-left hover:bg-red-500/[0.06] rounded px-1 py-0.5 transition-colors w-full">
                  <div className="w-1 h-1 rounded-full bg-red-500 shrink-0" />
                  <span className="text-[11px] text-foreground flex-1 truncate">{item.project_name || item.title}</span>
                  <span className="text-[10px] text-red-400 shrink-0">{dl?.text}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Type Focus Panel ───────────────────────────────────────────────────────

type FocusType = "Review" | "Proposal" | "BD" | "Project" | "Task";

const TYPE_FOCUS_CONFIG: Record<FocusType, {
  color: string;
  icon: React.ReactNode;
  description: string;
  emptyMsg: string;
}> = {
  Review:   { color: TYPE_COLORS.Review,   icon: <Search size={13} />,       description: "Technical & document reviews",  emptyMsg: "No reviews on record" },
  Proposal: { color: TYPE_COLORS.Proposal, icon: <FileText size={13} />,     description: "Proposal & tender pipeline",     emptyMsg: "No proposals yet" },
  BD:       { color: TYPE_COLORS.BD,       icon: <TrendingUp size={13} />,   description: "Business development activity",  emptyMsg: "No BD items yet" },
  Project:  { color: TYPE_COLORS.Project,  icon: <Layers size={13} />,       description: "Active project work",            emptyMsg: "No projects on record" },
  Task:     { color: TYPE_COLORS.Task,     icon: <CheckCircle2 size={13} />, description: "Standalone tasks",               emptyMsg: "No tasks on record" },
};

function generateTypeFocusInsights(type: FocusType, items: Request[]): string[] {
  const all    = items.filter(i => i.type === type);
  const active = all.filter(i => i.status !== "done");
  const done   = all.filter(i => i.status === "done");
  const overdue = active.filter(i => i.deadline && (deadlineInfo(i.deadline)?.diff ?? 0) < 0);
  const urgent  = active.filter(i => i.priority === "Urgent");
  const inbox   = active.filter(i => i.status === "inbox");
  const inProg  = active.filter(i => i.status === "in-progress");
  const today   = new Date(); today.setHours(0, 0, 0, 0);
  const todayKey = today.toISOString().split("T")[0];
  const insights: string[] = [];

  if (all.length === 0) return ["Nothing here yet — start logging to see insights."];

  // Critical
  if (overdue.length > 0) {
    insights.push(`⚠ ${overdue.length} overdue ${type.toLowerCase()}${overdue.length > 1 ? "s" : ""} — ${overdue.slice(0,2).map(i => i.project_name || i.title).join(", ")}.`);
  }
  if (urgent.length > 0) {
    insights.push(`🔴 ${urgent.length} urgent — ${urgent.slice(0,2).map(i => i.project_name || i.title).join(", ")}.`);
  }

  // Status summary
  const compRate = all.length > 0 ? Math.round((done.length / all.length) * 100) : 0;
  if (compRate >= 70 && done.length >= 3) {
    insights.push(`✅ Strong completion — ${compRate}% done (${done.length} of ${all.length}).`);
  } else if (compRate < 30 && all.length >= 3) {
    insights.push(`📋 ${active.length} open, ${done.length} done — ${compRate}% complete.`);
  } else if (all.length > 0) {
    insights.push(`📋 ${active.length} active, ${done.length} done (${compRate}% completion rate).`);
  }

  // In-progress
  if (inProg.length > 0) {
    insights.push(`⚡ ${inProg.length} in progress — ${inProg.slice(0,2).map(i => i.project_name || i.title).join(", ")}${inProg.length > 2 ? " +more" : ""}.`);
  }

  // Inbox pile-up
  if (inbox.length >= 3) {
    insights.push(`📥 ${inbox.length} in Inbox — worth a quick triage.`);
  }

  // Added today
  const addedToday = all.filter(x => effectiveDate(x) === todayKey);
  if (addedToday.length > 0) insights.push(`📋 ${addedToday.length} logged today.`);

  // Top project by count
  const byProj: Record<string, number> = {};
  active.forEach(i => { if (i.project_name) byProj[i.project_name] = (byProj[i.project_name] || 0) + 1; });
  const topProj = Object.entries(byProj).sort((a, b) => b[1] - a[1])[0];
  if (topProj && topProj[1] >= 2) {
    insights.push(`📁 "${topProj[0]}" has ${topProj[1]} open ${type.toLowerCase()} items.`);
  }

  // Type-specific
  if (type === "BD") {
    const byPerson: Record<string, number> = {};
    active.forEach(i => { if (i.person) byPerson[i.person] = (byPerson[i.person] || 0) + 1; });
    const topPerson = Object.entries(byPerson).sort((a, b) => b[1] - a[1])[0];
    if (topPerson) insights.push(`👤 Most BD contact: ${topPerson[0]} (${topPerson[1]} open).`);
  }
  if (type === "Proposal") {
    const dueThis30 = active.filter(i => { const dl = deadlineInfo(i.deadline); return dl && (dl.diff ?? 99) <= 30 && (dl.diff ?? -1) >= 0; });
    if (dueThis30.length > 0) insights.push(`📅 ${dueThis30.length} proposal${dueThis30.length > 1 ? "s" : ""} due within 30 days.`);
  }

  // All-clear
  if (overdue.length === 0 && urgent.length === 0 && active.length > 0) {
    insights.push("✨ No overdue, nothing urgent — all on track.");
  }

  return insights.slice(0, 5);
}

function TypeFocusPanel({
  type, items, workLogs, onOpenItem,
}: {
  type: FocusType;
  items: Request[];
  workLogs: WorkLog[];
  onOpenItem: (item: Request) => void;
}) {
  const cfg    = TYPE_FOCUS_CONFIG[type];
  const all    = items.filter(i => i.type === type);
  const active = all.filter(i => i.status !== "done");
  const done   = all.filter(i => i.status === "done");
  const overdue = active.filter(i => i.deadline && (deadlineInfo(i.deadline)?.diff ?? 0) < 0);
  const urgent  = active.filter(i => i.priority === "Urgent");
  const compRate = all.length > 0 ? Math.round((done.length / all.length) * 100) : 0;
  const today   = new Date(); today.setHours(0, 0, 0, 0);

  // 14-day sparkline scoped to this type
  const days14 = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today); d.setDate(d.getDate() - (13 - i));
    const key = d.toISOString().split("T")[0];
    return {
      label: d.toLocaleDateString("en-CA", { month: "short", day: "numeric" }),
      added: all.filter(x => effectiveDate(x) === key).length,
      done:  all.filter(x => x.completed_at?.startsWith(key)).length,
    };
  }), [all]);

  // Top projects for this type
  const byProject: Record<string, { total: number; active: number }> = {};
  all.forEach(i => {
    const k = i.project_name || i.title;
    if (!byProject[k]) byProject[k] = { total: 0, active: 0 };
    byProject[k].total++;
    if (i.status !== "done") byProject[k].active++;
  });
  const topProjects = Object.entries(byProject).sort((a, b) => b[1].total - a[1].total).slice(0, 5);

  // Assignee breakdown
  const byAssignee: Record<string, number> = {};
  all.forEach(i => { if (i.assignee) byAssignee[i.assignee] = (byAssignee[i.assignee] || 0) + 1; });
  const assignees = Object.entries(byAssignee).sort((a, b) => b[1] - a[1]).slice(0, 4);

  // Recent items (latest 6)
  const recent = [...all].sort((a, b) => effectiveDate(b).localeCompare(effectiveDate(a))).slice(0, 6);

  const insights = useMemo(() => generateTypeFocusInsights(type, items), [type, items]);

  const accentBorder = cfg.color + "40";
  const accentBg     = cfg.color + "08";

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto styled-scroll h-full">

      {/* ── Header ── */}
      <div className="rounded-lg border p-3" style={{ borderColor: accentBorder, background: accentBg }}>
        <div className="flex items-center gap-2 mb-0.5" style={{ color: cfg.color }}>
          {cfg.icon}
          <span className="text-[12px] font-bold tracking-tight">{type}</span>
        </div>
        <p className="text-[10px] text-muted-foreground">{cfg.description}</p>
      </div>

      {/* ── Smart Insights ── */}
      {insights.length > 0 && (
        <div className="rounded-lg border border-white/[0.07] bg-[hsl(222_18%_12%)] p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Lightbulb size={10} style={{ color: cfg.color }} />
            <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: cfg.color }}>Insights</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {insights.map((ins, i) => (
              <p key={i} className="text-[10.5px] text-foreground/80 leading-snug">{ins}</p>
            ))}
          </div>
        </div>
      )}

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-1.5">
        {[
          { label: "Total",   value: all.length,    color: cfg.color },
          { label: "Active",  value: active.length, color: cfg.color },
          { label: "Done",    value: done.length,   color: "hsl(142 70% 45%)" },
          { label: "Overdue", value: overdue.length, color: overdue.length > 0 ? SENSE_RED : cfg.color },
        ].map(kpi => (
          <div key={kpi.label} className="rounded-lg border border-white/[0.06] bg-[hsl(222_18%_12%)] p-2.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block mb-0.5">{kpi.label}</span>
            <span className="text-2xl font-display font-bold tabular leading-none" style={{ color: kpi.color }}>{kpi.value}</span>
          </div>
        ))}
      </div>

      {/* ── Completion ring ── */}
      <div className="rounded-lg border border-white/[0.06] bg-[hsl(222_18%_12%)] p-3 flex items-center gap-3">
        <div className="relative w-[52px] h-[52px] shrink-0">
          <PieChart width={52} height={52}>
            <Pie data={[{v:compRate},{v:100-compRate}]} dataKey="v" cx={22} cy={22} innerRadius={15} outerRadius={24} startAngle={90} endAngle={-270} strokeWidth={0}>
              <Cell fill={cfg.color} />
              <Cell fill="hsl(222 15% 18%)" />
            </Pie>
          </PieChart>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[11px] font-bold tabular" style={{ color: cfg.color }}>{compRate}%</span>
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-bold text-foreground">Completion</span>
          <span className="text-[10px] text-muted-foreground">{done.length} of {all.length} done</span>
          {urgent.length > 0 && (
            <span className="text-[9.5px] text-red-400 flex items-center gap-1 mt-0.5">
              <Zap size={9} />{urgent.length} urgent
            </span>
          )}
        </div>
      </div>

      {/* ── Type donut: BD vs Proposal vs Review vs Project/Task ── */}
      {typeData.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-[hsl(222_18%_12%)] p-3">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">Type Mix</span>
          <div className="flex items-center gap-3">
            <PieChart width={64} height={64}>
              <Pie data={typeData} dataKey="count" cx={28} cy={28} innerRadius={17} outerRadius={30} strokeWidth={0}>
                {typeData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "hsl(222 18% 14%)", border: "1px solid hsl(222 15% 22%)", borderRadius: 8, fontSize: 10, padding: "3px 8px" }}
                formatter={(v: number, n: string) => [v, n]} />
            </PieChart>
            <div className="flex flex-col gap-1 flex-1">
              {typeData.map(d => (
                <div key={d.name} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-sm shrink-0" style={{ background: d.color }} />
                  <span className="text-[10px] text-foreground flex-1">{d.name}</span>
                  <span className="text-[10px] font-bold tabular text-muted-foreground">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── 14-day sparkline ── */}
      <div className="rounded-lg border border-white/[0.06] bg-[hsl(222_18%_12%)] p-3">
        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">Activity · 14 days</span>
        <div className="h-[46px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={days14} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
              <defs>
                <linearGradient id={`gFocus-${type}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={cfg.color} stopOpacity={0.45} />
                  <stop offset="95%" stopColor={cfg.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" hide />
              <Tooltip contentStyle={{ background: "hsl(222 18% 14%)", border: "1px solid hsl(222 15% 22%)", borderRadius: 8, fontSize: 10, padding: "3px 8px" }}
                labelStyle={{ color: "hsl(210 20% 80%)" }} itemStyle={{ color: "hsl(210 15% 65%)" }} />
              <Area type="monotone" dataKey="added" stroke={cfg.color} strokeWidth={1.5} fill={`url(#gFocus-${type})`} name="Added" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Top Projects ── */}
      {topProjects.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-[hsl(222_18%_12%)] p-3">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">Top Projects</span>
          <div className="flex flex-col gap-2">
            {topProjects.map(([name, counts]) => {
              const max = topProjects[0][1].total;
              return (
                <div key={name}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10.5px] text-foreground truncate flex-1 pr-2">{name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {counts.active > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-medium" style={{ background: cfg.color + "20", color: cfg.color }}>{counts.active} open</span>}
                      <span className="text-[10px] font-bold tabular text-muted-foreground">{counts.total}</span>
                    </div>
                  </div>
                  <div className="h-[3px] rounded-full bg-white/[0.05] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(counts.total / max) * 100}%`, background: cfg.color + "80" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Assignees ── */}
      {assignees.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-[hsl(222_18%_12%)] p-3">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">Team</span>
          <div className="flex flex-col gap-1.5">
            {assignees.map(([name, count]) => {
              const max = assignees[0][1];
              return (
                <div key={name} className="flex items-center gap-2">
                  <Avatar name={name} size={16} />
                  <span className="text-[10.5px] text-foreground flex-1 truncate">{name}</span>
                  <div className="w-10 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(count / max) * 100}%`, background: cfg.color + "99" }} />
                  </div>
                  <span className="text-[10px] font-bold tabular text-muted-foreground w-3 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Recent Items ── */}
      {recent.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-[hsl(222_18%_12%)] p-3">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">Recent</span>
          <div className="flex flex-col gap-1">
            {recent.map(item => {
              const statusColor = item.status === "done" ? "hsl(142 70% 45%)" : item.status === "in-progress" ? AMBER : SLATE_DIM;
              return (
                <button key={item.id} onClick={() => onOpenItem(item)}
                  className="flex items-start gap-2 text-left hover:bg-white/[0.03] rounded px-1 py-1 transition-colors w-full group">
                  <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: statusColor }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10.5px] text-foreground leading-snug truncate group-hover:text-blue-300 transition-colors">{item.project_name || item.title}</p>
                    {item.project_name && item.title !== item.project_name && (
                      <p className="text-[9.5px] text-muted-foreground truncate">{item.title}</p>
                    )}
                  </div>
                  <span className="text-[9px] text-muted-foreground/60 shrink-0 mt-0.5">{effectiveDate(item).slice(5)}</span>
                </button>
              );
            })}
          </div>
          {all.length > 6 && (
            <p className="text-[9.5px] text-muted-foreground/50 mt-2 text-center">+{all.length - 6} more</p>
          )}
        </div>
      )}

      {all.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="opacity-30 mb-2" style={{ color: cfg.color }}>{cfg.icon}</div>
          <p className="text-[11px] text-muted-foreground">{cfg.emptyMsg}</p>
        </div>
      )}
    </div>
  );
}

// ─── Weekly Review ────────────────────────────────────────────────────────────

function WeeklyReview({ items, workLogs, onOpenItem, onOpenProject }: {
  items: Request[];
  workLogs: WorkLog[];
  onOpenItem: (item: Request) => void;
  onOpenProject: (projectName: string) => void;
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const formatMins = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 > 0 ? ` ${m % 60}m` : ""}` : `${m}m`;

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today); d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().split("T")[0];
    const isToday = i === 6;
    const dayLogs = workLogs.filter(l => l.log_date === key);
    return {
      key, d, isToday,
      added:     items.filter(x => effectiveDate(x) === key),
      completed: items.filter(x => x.completed_at?.startsWith(key)),
      updated:   items.filter(x => x.updated_at?.startsWith(key) && effectiveDate(x) !== key && !x.completed_at?.startsWith(key)),
      logs:      dayLogs,
      logMins:   dayLogs.reduce((s, l) => s + (l.duration_mins ?? 0), 0),
      label: isToday ? "Today" : d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" }),
    };
  }), [items, workLogs]);

  const weekAdded     = days.reduce((s, d) => s + d.added.length, 0);
  const weekCompleted = days.reduce((s, d) => s + d.completed.length, 0);
  const busiest       = [...days].sort((a, b) => (b.added.length + b.completed.length + b.logs.length) - (a.added.length + a.completed.length + a.logs.length))[0];
  const activePeople  = new Set(items.flatMap(i => i.person ? [i.person] : [])).size;
  const totalLogMins  = days.reduce((s, d) => s + d.logMins, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-5 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays size={13} className="text-blue-400" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Week in Review</span>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {days[0].d.toLocaleDateString("en-CA", { month: "short", day: "numeric" })} – {days[6].d.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Added",     value: weekAdded,       color: SENSE_BLUE },
            { label: "Completed", value: weekCompleted,   color: "#4ade80" },
            { label: "Logged",    value: totalLogMins > 0 ? formatMins(totalLogMins) : workLogs.length > 0 ? `${workLogs.length}` : "—", color: AMBER },
            { label: "People",    value: activePeople,    color: "#a78bfa" },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-white/[0.06] bg-[hsl(222_18%_11%)] px-3 py-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{s.label}</div>
              <div className="text-[17px] font-display font-bold tabular leading-none" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto styled-scroll px-5 py-3 flex flex-col gap-2.5">
        {[...days].reverse().map(day => {
          const total = day.added.length + day.completed.length + day.updated.length;
          const hasActivity = total > 0 || day.logs.length > 0;
          const dayNarrative = (() => {
            const parts: string[] = [];
            const taskProjects = new Set([...day.added, ...day.completed].map(i => i.project_name).filter(Boolean) as string[]);
            const logProjects  = new Set(day.logs.map(l => l.project_name));
            const allProjects  = new Set([...taskProjects, ...logProjects]);
            if (day.added.length > 0) parts.push(`${day.added.length} task${day.added.length > 1 ? "s" : ""} logged`);
            if (day.completed.length > 0) parts.push(`${day.completed.length} closed out`);
            if (day.logs.length > 0) parts.push(`${day.logs.length} work log${day.logs.length > 1 ? "s" : ""}${day.logMins > 0 ? ` (${formatMins(day.logMins)})` : ""}`);
            if (allProjects.size > 0) parts.push(`on ${[...allProjects].slice(0, 2).join(", ")}${allProjects.size > 2 ? " +more" : ""}`);
            return parts.length > 0 ? parts.join(" · ") : null;
          })();
          return (
            <div key={day.key} className={`rounded-xl border ${day.isToday ? "border-blue-500/30 bg-blue-500/[0.04]" : "border-white/[0.06] bg-[hsl(222_18%_10%)]"}`}>
              <div className="px-4 py-2.5 border-b border-white/[0.05]">
                <div className="flex items-center gap-2">
                  <span className={`text-[11.5px] font-bold ${day.isToday ? "text-blue-300" : "text-foreground"}`}>{day.label}</span>
                  {!hasActivity && <span className="text-[10px] text-muted-foreground/40 ml-1">— quiet day</span>}
                  {hasActivity && (
                    <div className="ml-auto flex items-center gap-2">
                      {day.added.length > 0 && <span className="text-[10px] text-muted-foreground"><span className="text-blue-400 font-semibold">+{day.added.length}</span> tasks</span>}
                      {day.completed.length > 0 && <span className="text-[10px] text-muted-foreground"><span className="text-green-400 font-semibold">✓{day.completed.length}</span> done</span>}
                      {day.logs.length > 0 && <span className="text-[10px] text-muted-foreground"><span className="font-semibold" style={{ color: AMBER }}>{day.logs.length}</span> log{day.logMins > 0 ? ` · ${formatMins(day.logMins)}` : ""}</span>}
                    </div>
                  )}
                </div>
                {dayNarrative && (
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-relaxed">{dayNarrative}</p>
                )}
              </div>
              {hasActivity && (
                <div className="px-4 py-2 flex flex-col gap-1">
                  {day.logs.map(log => (
                    <button key={`l-${log.id}`} onClick={() => onOpenProject(log.project_name)}
                      className="flex items-center gap-2 text-left hover:bg-white/[0.04] rounded px-1.5 py-1 transition-colors w-full group">
                      <FileText size={9} style={{ color: AMBER }} className="shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[9px] font-bold uppercase tracking-wider truncate" style={{ color: avatarColor(log.project_name) }}>{log.project_name}</div>
                        <div className="text-[11px] text-foreground/75 truncate">{log.description}</div>
                      </div>
                      {log.duration_mins != null && log.duration_mins > 0 && (
                        <span className="text-[9.5px] text-muted-foreground/50 flex items-center gap-0.5 shrink-0">
                          <Timer size={8} />{formatMins(log.duration_mins)}
                        </span>
                      )}
                    </button>
                  ))}
                  {day.completed.map(item => (
                    <button key={`d-${item.id}`} onClick={() => onOpenItem(item)}
                      className="flex items-center gap-2 text-left hover:bg-white/[0.04] rounded px-1.5 py-1 transition-colors w-full group">
                      <CheckCircle2 size={10} className="text-green-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        {item.project_name && <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50 truncate">{item.project_name}</div>}
                        <div className="text-[11px] text-foreground/60 truncate line-through">{item.title}</div>
                      </div>
                      <TypeBadge type={item.type} />
                    </button>
                  ))}
                  {day.added.map(item => (
                    <button key={`a-${item.id}`} onClick={() => onOpenItem(item)}
                      className="flex items-center gap-2 text-left hover:bg-white/[0.04] rounded px-1.5 py-1 transition-colors w-full group">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        item.priority === "Urgent" ? "bg-red-500" : item.priority === "High" ? "bg-amber-400" : "border border-blue-400/60"
                      }`} />
                      <div className="flex-1 min-w-0">
                        {item.project_name && <div className="text-[9px] font-bold uppercase tracking-wider text-blue-400/70 truncate">{item.project_name}</div>}
                        <div className="text-[11px] text-foreground truncate">{item.title}</div>
                      </div>
                      {item.person && <span className="text-[10px] text-muted-foreground shrink-0">{item.person}</span>}
                      <TypeBadge type={item.type} />
                    </button>
                  ))}
                  {day.updated.map(item => (
                    <button key={`u-${item.id}`} onClick={() => onOpenItem(item)}
                      className="flex items-center gap-2 text-left hover:bg-white/[0.04] rounded px-1.5 py-1 transition-colors w-full opacity-50">
                      <RefreshCw size={9} className="text-muted-foreground shrink-0" />
                      <span className="text-[10.5px] text-muted-foreground flex-1 truncate">{item.project_name || item.title}</span>
                      <TypeBadge type={item.type} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({ item, onClose, onSave, onDelete }: {
  item: Request;
  onClose: () => void;
  onSave: (id: string, data: Partial<Request>) => void;
  onDelete: (id: string) => void;
}) {
  const [projectName, setProjectName] = useState(item.project_name || "");
  const [title,       setTitle]       = useState(item.title);
  const [person,      setPerson]      = useState(item.person || "");
  const [type,        setType]        = useState(item.type);
  const [priority,    setPriority]    = useState(item.priority);
  const [deadline,    setDeadline]    = useState(item.deadline || "");
  const [entryDate,   setEntryDate]   = useState(effectiveDate(item));
  const [assignee,    setAssignee]    = useState(item.assignee || "");
  const [notes,       setNotes]       = useState(item.notes || "");
  const [status,      setStatus]      = useState(item.status);

  const dl = deadlineInfo(item.deadline);
  const typeColor = type === "Review" ? SENSE_BLUE : type === "Proposal" ? AMBER : type === "Project" ? "#60a5fa" : type === "BD" ? "#34d399" : SLATE_DIM;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ scale: 0.95, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 16 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-[500px] max-w-full max-h-[90vh] bg-[hsl(222_18%_11%)] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="h-0.5 w-full shrink-0" style={{ background: typeColor }} />

        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2.5">
            <TypeBadge type={type} />
            {dl && <span className={`text-[11px] font-medium ${dl.cls}`}>{dl.text}</span>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-muted-foreground transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto styled-scroll px-5 py-4 flex flex-col gap-4">
          {/* Project name */}
          <div>
            <label className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">Project Name</label>
            <input value={projectName} onChange={e => setProjectName(e.target.value)}
              placeholder="e.g. NMB Tower, Boulder Bay"
              className="w-full bg-transparent text-[13px] font-semibold text-foreground placeholder:text-muted-foreground/50 border-0 border-b border-white/[0.08] pb-1.5 outline-none focus:border-blue-500/50 transition-colors" />
          </div>
          {/* Task / Name */}
          <div>
            <label className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
              {(type === "Proposal" || type === "BD") ? "Name" : "Task"}
            </label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder={(type === "Proposal" || type === "BD") ? "e.g. Devonshire I+II Phase II, Kelowna Pursuit" : "Task description"}
              className="w-full bg-transparent text-[14px] font-medium text-foreground placeholder:text-muted-foreground/50 border-0 border-b border-white/[0.08] pb-1.5 outline-none focus:border-blue-500/50 transition-colors"
              autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Type",     value: type,     onChange: setType,     options: ["Review","Proposal","BD","Project","Task"], icon: <Tag size={11} /> },
              { label: "Priority", value: priority, onChange: setPriority, options: ["Urgent","High","Normal","Low"],       icon: <Zap size={11} /> },
            ].map(f => (
              <div key={f.label}>
                <label className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1">{f.icon}{f.label}</label>
                <div className="relative">
                  <select value={f.value} onChange={e => f.onChange(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12.5px] text-foreground outline-none focus:border-blue-500/50 pr-8">
                    {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <ChevronDown size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            ))}

            <div>
              <label className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1"><User size={11} />Requester</label>
              <input value={person} onChange={e => setPerson(e.target.value)} placeholder="Name"
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12.5px] text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500/50" />
            </div>

            <div>
              <label className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1"><User size={11} className="text-blue-400" />Assigned To</label>
              <input value={assignee} onChange={e => setAssignee(e.target.value)} placeholder="Assignee name"
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12.5px] text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500/50" />
            </div>

            <div>
              <label className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1"><Calendar size={11} />Deadline</label>
              <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12.5px] text-foreground outline-none focus:border-blue-500/50" />
            </div>

            <div className="col-span-2">
              <label className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                <CalendarDays size={11} className="text-blue-400" />
                Entry Date
                <span className="ml-auto font-normal normal-case text-[9px] text-muted-foreground/60">When did this happen?</span>
              </label>
              <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)}
                className="w-full rounded-lg border border-blue-500/20 bg-blue-500/[0.04] px-3 py-2 text-[12.5px] text-foreground outline-none focus:border-blue-500/50" />
              <p className="text-[9.5px] text-muted-foreground/50 mt-1">Backdate to log work done on a previous day — shows up in Weekly Review under that day.</p>
            </div>
          </div>

          <div>
            <label className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">Status</label>
            <div className="flex gap-1 p-1 rounded-lg bg-white/[0.04] border border-white/[0.06]">
              {[["inbox","Inbox"],["in-progress","In Progress"],["done","Done"]].map(([k, l]) => (
                <button key={k} onClick={() => setStatus(k)}
                  className={`flex-1 py-1.5 rounded-md text-[11.5px] font-semibold transition-all ${status === k ? "bg-white/[0.1] text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Context, links, follow-up actions..."
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12.5px] text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500/50 resize-none" />
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-white/[0.06] bg-[hsl(222_18%_10%)] shrink-0">
          <button onClick={() => { onDelete(item.id); onClose(); }}
            className="p-2 rounded-lg text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <Trash2 size={14} />
          </button>
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-[12.5px] text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors">Cancel</button>
          <button onClick={() => {
            onSave(item.id, { project_name: projectName.trim() || null, title: title.trim() || item.title, person: person.trim() || null, type, priority, deadline: deadline || null, entry_date: entryDate || null, notes, status, assignee: assignee.trim() || null });
            onClose();
          }} className="px-4 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-[12.5px] font-semibold text-white transition-colors flex items-center gap-1.5">
            Save <ArrowRight size={12} />
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Project Modal ──────────────────────────────────────────────────────────

function ProjectModal({ projectName, items, workLogs, onClose, onOpenItem, onAddLog, onDeleteLog, onEditLog }: {
  projectName: string;
  items: Request[];
  workLogs: WorkLog[];
  onClose: () => void;
  onOpenItem: (item: Request) => void;
  onAddLog: (projectName: string, description: string, logDate: string, durationMins?: number) => Promise<void>;
  onDeleteLog: (id: string) => Promise<void>;
  onEditLog: (id: string, description: string, logDate: string, durationMins?: number) => Promise<void>;
}) {
  const [tab, setTab] = useState<"logs" | "tasks">("logs");
  const [logText, setLogText]         = useState("");
  const [logDate, setLogDate]         = useState(new Date().toISOString().split("T")[0]);
  const [logDuration, setLogDuration] = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [editingLogId, setEditingLogId]       = useState<string | null>(null);
  const [editLogText, setEditLogText]         = useState("");
  const [editLogDate, setEditLogDate]         = useState("");
  const [editLogDuration, setEditLogDuration] = useState("");

  // For Proposal/BD the modal is opened with the title as key — match both project_name and title
  const projItems = items.filter(i =>
    i.project_name?.toLowerCase() === projectName.toLowerCase() ||
    i.title?.toLowerCase() === projectName.toLowerCase()
  );
  const projLogs  = workLogs.filter(l => l.project_name.toLowerCase() === projectName.toLowerCase())
    .sort((a, b) => b.log_date.localeCompare(a.log_date));

  const openItems      = projItems.filter(i => i.status !== "done");
  const completedItems = projItems.filter(i => i.status === "done");
  const activeDays     = new Set(projLogs.map(l => l.log_date)).size;
  const totalMins      = projLogs.reduce((s, l) => s + (l.duration_mins ?? 0), 0);
  const accentColor    = avatarColor(projectName);

  // Group logs by date
  const logsByDate: Record<string, WorkLog[]> = {};
  for (const log of projLogs) {
    if (!logsByDate[log.log_date]) logsByDate[log.log_date] = [];
    logsByDate[log.log_date].push(log);
  }
  const sortedDates = Object.keys(logsByDate).sort((a, b) => b.localeCompare(a));

  const handleAddLog = async () => {
    const desc = logText.trim();
    if (!desc) return;
    setSubmitting(true);
    const mins = logDuration ? Math.round(parseFloat(logDuration) * 60) || undefined : undefined;
    await onAddLog(projectName, desc, logDate, mins);
    setLogText(""); setLogDuration(""); setLogDate(new Date().toISOString().split("T")[0]);
    setSubmitting(false);
  };

  const formatMins = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 > 0 ? m % 60 + "m" : ""}`.trim() : `${m}m`;

  return (
    <motion.div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div className="relative w-full max-w-2xl bg-[hsl(222_20%_9%)] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
        initial={{ opacity: 0, y: -20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.96 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-white/[0.08] shrink-0"
          style={{ borderTopColor: accentColor, borderTopWidth: 3 }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: accentColor + "22" }}>
            <FolderOpen size={15} style={{ color: accentColor }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-bold text-foreground truncate">{projectName}</h2>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-[10.5px] text-muted-foreground">
                <span className="font-semibold text-foreground/70">{projItems.length}</span> tasks
              </span>
              <span className="text-[10.5px] text-muted-foreground">
                <span className="font-semibold text-foreground/70">{projLogs.length}</span> log entries
              </span>
              {activeDays > 0 && (
                <span className="text-[10.5px] text-muted-foreground">
                  <span className="font-semibold text-foreground/70">{activeDays}</span> active days
                </span>
              )}
              {totalMins > 0 && (
                <span className="text-[10.5px] text-muted-foreground">
                  <span className="font-semibold" style={{ color: accentColor }}>{formatMins(totalMins)}</span> logged
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-muted-foreground transition-colors shrink-0">
            <X size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/[0.06] shrink-0">
          {(["logs", "tasks"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                tab === t ? "text-foreground border-b-2" : "text-muted-foreground hover:text-foreground/70"
              }`}
              style={tab === t ? { borderBottomColor: accentColor } : {}}>
              {t === "logs" ? `Work Log (${projLogs.length})` : `Tasks (${projItems.length})`}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto styled-scroll">
          {/* ── Work Log Tab ── */}
          {tab === "logs" && (
            <div className="flex flex-col">
              {/* Quick-add form */}
              <div className="px-5 py-4 border-b border-white/[0.06] bg-[hsl(222_20%_8%)]">
                <textarea value={logText} onChange={e => setLogText(e.target.value)}
                  placeholder={`What did you work on for ${projectName} today?`}
                  rows={2}
                  onKeyDown={e => { if (e.key === "Enter" && e.metaKey) handleAddLog(); }}
                  className="w-full bg-[hsl(222_18%_12%)] border border-white/[0.08] rounded-lg px-3 py-2 text-[12.5px] text-foreground placeholder:text-muted-foreground/50 outline-none resize-none focus:border-blue-500/40 transition-colors mb-2" />
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <CalendarDays size={11} />
                    <input type="date" value={logDate} onChange={e => setLogDate(e.target.value)}
                      className="bg-[hsl(222_18%_12%)] border border-white/[0.08] rounded px-2 py-1 text-[11px] text-foreground outline-none focus:border-blue-500/40 transition-colors" />
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Timer size={11} />
                    <input type="number" value={logDuration} onChange={e => setLogDuration(e.target.value)}
                      placeholder="hrs" min={0.25} max={24} step={0.25}
                      className="w-16 bg-[hsl(222_18%_12%)] border border-white/[0.08] rounded px-2 py-1 text-[11px] text-foreground outline-none focus:border-blue-500/40 transition-colors" />
                  </div>
                  <button onClick={handleAddLog} disabled={!logText.trim() || submitting}
                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ background: accentColor }}>
                    <Plus size={11} /> Log Work
                  </button>
                </div>
              </div>

              {/* Timeline */}
              {projLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 gap-2">
                  <BookOpen size={22} className="text-muted-foreground/20" />
                  <p className="text-[12px] text-muted-foreground/40">No work logged yet</p>
                  <p className="text-[10.5px] text-muted-foreground/25">Log your first entry above</p>
                </div>
              ) : (
                <div className="px-5 py-4 flex flex-col gap-4">
                  {sortedDates.map(dateKey => {
                    const dayLogs = logsByDate[dateKey];
                    const dayTotal = dayLogs.reduce((s, l) => s + (l.duration_mins ?? 0), 0);
                    const d = new Date(dateKey + "T00:00:00");
                    const todayKey = new Date().toISOString().split("T")[0];
                    const isToday = dateKey === todayKey;
                    const label = isToday ? "Today" : d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
                    return (
                      <div key={dateKey}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: isToday ? accentColor : undefined }}>
                            {label}
                          </div>
                          {dayTotal > 0 && (
                            <div className="text-[9.5px] text-muted-foreground/50 ml-1">{formatMins(dayTotal)}</div>
                          )}
                          <div className="flex-1 border-t border-white/[0.05]" />
                        </div>
                        <div className="flex flex-col gap-1.5 ml-1">
                          {dayLogs.map(log => (
                            editingLogId === log.id ? (
                              /* ── Inline edit mode ── */
                              <div key={log.id} className="rounded-lg px-3 py-2.5 bg-[hsl(222_18%_13%)] border border-blue-500/30 flex flex-col gap-2">
                                <textarea value={editLogText} onChange={e => setEditLogText(e.target.value)}
                                  rows={2} autoFocus
                                  className="w-full bg-[hsl(222_18%_10%)] border border-white/[0.08] rounded px-2 py-1.5 text-[12px] text-foreground outline-none resize-none focus:border-blue-500/40 transition-colors" />
                                <div className="flex items-center gap-2">
                                  <input type="date" value={editLogDate} onChange={e => setEditLogDate(e.target.value)}
                                    className="bg-[hsl(222_18%_10%)] border border-white/[0.08] rounded px-2 py-1 text-[11px] text-foreground outline-none focus:border-blue-500/40 transition-colors" />
                                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                    <Timer size={10} />
                                    <input type="number" value={editLogDuration} onChange={e => setEditLogDuration(e.target.value)}
                                      placeholder="hrs" min={0.25} max={24} step={0.25}
                                      className="w-14 bg-[hsl(222_18%_10%)] border border-white/[0.08] rounded px-2 py-1 text-[11px] text-foreground outline-none focus:border-blue-500/40 transition-colors" />
                                  </div>
                                  <div className="ml-auto flex items-center gap-1.5">
                                    <button onClick={() => setEditingLogId(null)}
                                      className="px-2 py-1 rounded text-[10.5px] text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors">Cancel</button>
                                    <button onClick={async () => {
                                      const desc = editLogText.trim();
                                      if (!desc) return;
                                      const mins = editLogDuration ? Math.round(parseFloat(editLogDuration) * 60) || undefined : undefined;
                                      await onEditLog(log.id, desc, editLogDate, mins);
                                      setEditingLogId(null);
                                    }}
                                      className="px-2.5 py-1 rounded text-[10.5px] font-semibold text-white transition-colors"
                                      style={{ background: accentColor }}>Save</button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              /* ── View mode ── */
                              <div key={log.id} className="group flex items-start gap-2.5 rounded-lg px-3 py-2 bg-[hsl(222_18%_11%)] hover:bg-[hsl(222_18%_13%)] transition-colors cursor-pointer"
                                onClick={() => { setEditingLogId(log.id); setEditLogText(log.description); setEditLogDate(log.log_date); setEditLogDuration(log.duration_mins ? String(Math.round(log.duration_mins / 60 * 100) / 100) : ""); }}>
                                <div className="w-1 h-1 rounded-full mt-1.5 shrink-0" style={{ background: accentColor }} />
                                <p className="flex-1 text-[12px] text-foreground/85 leading-relaxed">{log.description}</p>
                                <div className="flex items-center gap-2 shrink-0">
                                  {log.duration_mins != null && log.duration_mins > 0 && (
                                    <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                                      <Timer size={9} />{formatMins(log.duration_mins)}
                                    </span>
                                  )}
                                  <button onClick={e => { e.stopPropagation(); onDeleteLog(log.id); }}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/20 text-red-400/60 hover:text-red-400 transition-all">
                                    <Trash2 size={10} />
                                  </button>
                                </div>
                              </div>
                            )
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Tasks Tab ── */}
          {tab === "tasks" && (
            <div className="px-5 py-4 flex flex-col gap-4">
              {openItems.length > 0 && (
                <div>
                  <div className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-2">Open ({openItems.length})</div>
                  <div className="flex flex-col gap-1.5">
                    {openItems.map(item => (
                      <button key={item.id} onClick={() => { onOpenItem(item); onClose(); }}
                        className="flex items-center gap-2.5 text-left rounded-lg px-3 py-2.5 bg-[hsl(222_18%_11%)] hover:bg-[hsl(222_18%_13%)] transition-colors group">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          item.priority === "Urgent" ? "bg-red-500" : item.priority === "High" ? "bg-amber-400" : "border border-blue-400/60"
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-medium text-foreground truncate">{item.title}</div>
                          {item.notes && <div className="text-[10.5px] text-muted-foreground/60 truncate mt-0.5">{item.notes}</div>}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <TypeBadge type={item.type} />
                          {item.person && <span className="text-[10px] text-muted-foreground">{item.person}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {completedItems.length > 0 && (
                <div>
                  <div className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-2">Completed ({completedItems.length})</div>
                  <div className="flex flex-col gap-1.5">
                    {completedItems.map(item => (
                      <button key={item.id} onClick={() => { onOpenItem(item); onClose(); }}
                        className="flex items-center gap-2.5 text-left rounded-lg px-3 py-2.5 bg-[hsl(222_18%_10%)] hover:bg-[hsl(222_18%_12%)] transition-colors opacity-50 hover:opacity-75">
                        <CheckCircle2 size={12} className="text-green-400 shrink-0" />
                        <span className="flex-1 text-[12px] text-muted-foreground line-through truncate">{item.title}</span>
                        <TypeBadge type={item.type} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {projItems.length === 0 && (
                <div className="flex flex-col items-center justify-center py-14 gap-2">
                  <FileText size={22} className="text-muted-foreground/20" />
                  <p className="text-[12px] text-muted-foreground/40">No tasks yet</p>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Command Input ────────────────────────────────────────────────────────────

function CommandInput({ onSubmit, isLoading, matchBanner }: {
  onSubmit: (text: string) => void;
  isLoading: boolean;
  matchBanner?: React.ReactNode;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onSubmit(v);
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
  };

  return (
    <div>
      <div className="relative flex items-end gap-2 bg-[hsl(222_18%_12%)] border border-white/[0.08] rounded-xl px-3 py-2.5 focus-within:border-blue-500/40 transition-colors">
        <Sparkles size={14} className="text-blue-500/60 mb-1.5 shrink-0" />
        <textarea ref={ref} value={value}
          onChange={e => {
            setValue(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
          }}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder={"Line 1: Project name  ·  Line 2: Task description  ·  Line 3: Notes\ne.g.  NMB Tower CLT  ↵  Sarah's connection design review by Friday, urgent"}
          rows={1}
          className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground outline-none resize-none leading-relaxed py-0"
        />
        <button onClick={submit} disabled={!value.trim() || isLoading}
          className="p-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 disabled:opacity-25 disabled:cursor-not-allowed text-white transition-all shrink-0">
          <Send size={13} />
        </button>
      </div>
      {matchBanner}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

type ViewMode = "board" | "week";

export default function App() {
  const [filter,       setFilter]       = useState("all");
  const [viewMode,     setViewMode]     = useState<ViewMode>("board");
  const [editingItem,  setEditingItem]  = useState<Request | null>(null);
  const [toast, setToast]              = useState<{ msg: string; type?: "success" | "error" } | null>(null);
  const [items, setItems]              = useState<Request[]>([]);
  const [workLogs, setWorkLogs]        = useState<WorkLog[]>([]);
  const [projectModal, setProjectModal] = useState<string | null>(null);
  const [loading, setLoading]          = useState(false);
  const [pendingCreate, setPendingCreate] = useState<{
    parsed: Omit<Request, "id"|"created_at"|"updated_at"|"completed_at">;
    match:  { item: Request; score: number };
  } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  }, []);

  const fetchItems = useCallback(async () => {
    const { data, error } = await supabase
      .from("requests").select("*").order("created_at", { ascending: false });
    if (!error && data) {
      const mapped = data.map(rowToRequest);
      // Seed project colours deterministically before first render
      seedProjectColors(mapped.map(i => i.project_name).filter(Boolean) as string[]);
      setItems(mapped);
    }
  }, []);

  const fetchWorkLogs = useCallback(async () => {
    const { data, error } = await supabase
      .from("work_logs").select("*").order("log_date", { ascending: false });
    if (!error && data) setWorkLogs(data.map(rowToWorkLog));
  }, []);

  useEffect(() => {
    fetchItems();
    fetchWorkLogs();
    const ch = supabase.channel("requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "requests" }, () => fetchItems())
      .subscribe();
    const chLogs = supabase.channel("work_logs")
      .on("postgres_changes", { event: "*", schema: "public", table: "work_logs" }, () => fetchWorkLogs())
      .subscribe();
    return () => { supabase.removeChannel(ch); supabase.removeChannel(chLogs); };
  }, [fetchItems, fetchWorkLogs]);

  const createRequest = useCallback(async (data: Omit<Request, "id"|"created_at"|"updated_at"|"completed_at">) => {
    setLoading(true);
    const todayIso = new Date().toISOString().split("T")[0];
    const { error } = await supabase.from("requests").insert([{
      project_name: data.project_name, title: data.title, person: data.person,
      type: data.type, priority: data.priority, deadline: data.deadline,
      status: data.status, notes: data.notes || "", description: data.description || "",
      entry_date: data.entry_date || todayIso,
      assignee: data.assignee || null,
    }]);
    setLoading(false);
    if (error) { showToast("Failed to add", "error"); return; }
    showToast("Request added");
    fetchItems();
  }, [fetchItems, showToast]);

  const updateRequest = useCallback(async (id: string, data: Partial<Request>) => {
    const patch: any = { ...data, updated_at: new Date().toISOString() };
    if (data.status === "done") patch.completed_at = new Date().toISOString();
    if (data.status && data.status !== "done") patch.completed_at = null;
    await supabase.from("requests").update(patch).eq("id", id);
    fetchItems();
  }, [fetchItems]);

  const deleteRequest = useCallback(async (id: string) => {
    await supabase.from("requests").delete().eq("id", id);
    showToast("Deleted");
    fetchItems();
  }, [fetchItems, showToast]);

  const addWorkLog = useCallback(async (projectName: string, description: string, logDate: string, durationMins?: number) => {
    const { error } = await supabase.from("work_logs").insert([{
      project_name: projectName,
      description,
      log_date: logDate,
      duration_mins: durationMins ?? null,
    }]);
    if (error) { showToast("Failed to log", "error"); return; }
    showToast("Work logged");
    fetchWorkLogs();
  }, [fetchWorkLogs, showToast]);

  const deleteWorkLog = useCallback(async (id: string) => {
    await supabase.from("work_logs").delete().eq("id", id);
    fetchWorkLogs();
  }, [fetchWorkLogs]);

  const updateWorkLog = useCallback(async (id: string, description: string, logDate: string, durationMins?: number) => {
    await supabase.from("work_logs").update({
      description,
      log_date: logDate,
      duration_mins: durationMins ?? null,
    }).eq("id", id);
    fetchWorkLogs();
  }, [fetchWorkLogs]);

  const handleInput = useCallback((text: string) => {
    // Status commands
    if (/^(?:done|finish|complete)\s/i.test(text)) {
      const kw = text.replace(/^(?:done|finished?|completed?)\s+(?:with\s+|the\s+)?/i, "").trim();
      const found = items.find(i => i.status !== "done" && fuzzyMatch((i.project_name||"") + " " + i.title + " " + (i.person||""), kw));
      if (found) { updateRequest(found.id, { status: "done" }); showToast(`✓ Done: ${found.project_name || found.title}`); return; }
    }
    if (/^(?:start|begin|working on)\s/i.test(text)) {
      const kw = text.replace(/^(?:start(?:ing)?|begin(?:ning)?|working on)\s+(?:the\s+)?/i, "").trim();
      const found = items.find(i => i.status === "inbox" && fuzzyMatch((i.project_name||"") + " " + i.title + " " + (i.person||""), kw));
      if (found) { updateRequest(found.id, { status: "in-progress" }); showToast(`Started: ${found.project_name || found.title}`); return; }
    }

    const parsed = parseInput(text);
    // Generic categories (RFP, Tender, EIA, etc.) skip dedup — each is a fresh entry
    if (parsed._skipDedup) {
      createRequest(parsed);
      return;
    }
    // For real project names, use project_name as dedup key; fall back to title
    const matchKey = parsed.project_name || parsed.title;
    const match = findSimilarItem(matchKey, items);
    if (match) {
      setPendingCreate({ parsed, match });
    } else {
      createRequest(parsed);
    }
  }, [items, createRequest, updateRequest, showToast]);

  const handleMove   = (id: string, status: string) => updateRequest(id, { status });
  const handleDelete = (id: string) => deleteRequest(id);
  const handleSave   = (id: string, data: Partial<Request>) => { updateRequest(id, data); showToast("Saved"); };

  const filtered     = filter === "all" ? items : items.filter(i => i.type === filter);
  const score        = workloadScore(items);
  const active       = items.filter(i => i.status !== "done");
  const urgentCount  = active.filter(i => i.priority === "Urgent").length;

  const COLUMNS = [
    { status: "inbox",       label: "Inbox",       icon: <Clock size={12} />,        accentColor: SENSE_BLUE },
    { status: "in-progress", label: "In Progress",  icon: <Zap size={12} />,          accentColor: AMBER },
    { status: "done",        label: "Done",         icon: <CheckCircle2 size={12} />, accentColor: SLATE_DIM },
  ];

  // Smart open: Proposal/BD use title as the unique project key
  const openItem = useCallback((item: Request) => {
    if ((item.type === "Proposal" || item.type === "BD") && item.title) {
      setProjectModal(item.title);
    } else if (item.project_name) {
      setProjectModal(item.project_name);
    } else {
      setEditingItem(item);
    }
  }, []);

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">

      {/* ── Header ── */}
      <header className="flex items-center gap-3 px-5 h-[48px] border-b border-white/[0.06] bg-[hsl(222_20%_7%)] shrink-0 z-20">
        <div className="flex items-center gap-2 mr-1 shrink-0">
          <img src={paLogoUrl} alt="Kent's PA" width={26} height={26}
            style={{ filter: "invert(1)", opacity: 0.9 }}
            className="shrink-0" />
          <span className="font-display font-bold text-[14px] tracking-tight text-foreground">
            Kent's<span style={{ color: "hsl(207 85% 52%)" }}> PA</span>
          </span>
        </div>

        <div className="h-3.5 w-px bg-white/[0.08] mx-0.5" />

        <div className="flex items-center gap-0.5">
          <button onClick={() => setViewMode("board")}
            className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-all flex items-center gap-1.5 ${viewMode === "board" ? "bg-white/[0.08] text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"}`}>
            <Layers size={11} />Board
          </button>
          <button onClick={() => setViewMode("week")}
            className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-all flex items-center gap-1.5 ${viewMode === "week" ? "bg-white/[0.08] text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"}`}>
            <CalendarDays size={11} />Week
          </button>

          {viewMode === "board" && (
            <>
              <div className="h-3 w-px bg-white/[0.08] mx-1" />
              {[["all","All"],["Review","Reviews"],["Proposal","Proposals"],["BD","BD"],["Project","Projects"],["Task","Tasks"]].map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)}
                  className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-all ${filter === k ? "bg-white/[0.08] text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"}`}>
                  {l}
                </button>
              ))}
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] text-muted-foreground font-medium hidden sm:block">Workload</span>
            <WorkloadMeter score={score} />
          </div>
          <div className="hidden md:flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[11.5px]">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              <span className="text-muted-foreground">{active.length} active</span>
            </div>
            {urgentCount > 0 && (
              <div className="flex items-center gap-1.5 text-[11.5px]">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 urgent-pulse" />
                <span className="text-red-400">{urgentCount} urgent</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground/60 hidden lg:flex">
            <BarChart3 size={11} />
            <span>Insights</span>
          </div>
        </div>
      </header>

      {/* ── Body: board/week + always-on insights ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Main content */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          {viewMode === "week" ? (
            <WeeklyReview items={items} workLogs={workLogs} onOpenItem={setEditingItem} onOpenProject={setProjectModal} />
          ) : (
            <>
              {filter !== "all" ? (
                <div className="flex-1 overflow-hidden">
                  <FocusBoardView
                    filter={filter}
                    items={items}
                    workLogs={workLogs}
                    onMove={handleMove}
                    onDelete={handleDelete}
                    onOpenItem={openItem}
                    onOpenProject={name => setProjectModal(name)}
                  />
                </div>
              ) : (
                <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 pb-0">
                  <div className="flex gap-3 h-full pb-4 min-h-0">
                    {COLUMNS.map(col => (
                      <Column key={col.status} {...col}
                        items={filtered.filter(i => i.status === col.status)}
                        onMove={handleMove} onDelete={handleDelete}
                        onClick={openItem} />
                    ))}
                  </div>
                </div>
              )}

              {/* Command strip */}
              <div className="px-4 py-3 border-t border-white/[0.06] bg-[hsl(222_20%_8%)] shrink-0">
                <CommandInput onSubmit={handleInput} isLoading={loading}
                  matchBanner={
                    <AnimatePresence>
                      {pendingCreate && (
                        <MatchBanner
                          match={pendingCreate.match}
                          onOpen={() => { setEditingItem(pendingCreate.match.item); setPendingCreate(null); }}
                          onCreateNew={() => { createRequest(pendingCreate.parsed); setPendingCreate(null); }}
                          onDismiss={() => setPendingCreate(null)}
                        />
                      )}
                    </AnimatePresence>
                  }
                />
                <p className="text-[10px] text-muted-foreground/50 mt-1.5 px-0.5">
                  Line 1: project name · Line 2: task · Line 3: notes · <kbd className="px-1 py-0.5 rounded bg-white/[0.05] text-[9px]">Shift+Enter</kbd> new line
                </p>
              </div>
            </>
          )}
        </div>

        {/* ── Always-on Insights / Focus column ── */}
        <aside className="w-[272px] shrink-0 border-l border-white/[0.07] bg-[hsl(222_20%_8%)] flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] shrink-0">
            {filter !== "all" && filter in TYPE_FOCUS_CONFIG ? (
              <>
                <div style={{ color: TYPE_COLORS[filter] }} className="shrink-0">
                  {TYPE_FOCUS_CONFIG[filter as FocusType].icon}
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: TYPE_COLORS[filter] }}>{filter}</span>
                <button onClick={() => setFilter("all")}
                  className="ml-auto text-[9px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08]">
                  × All
                </button>
              </>
            ) : (
              <>
                <BarChart3 size={12} className="text-blue-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Insights</span>
              </>
            )}
          </div>
          {filter !== "all" && filter in TYPE_FOCUS_CONFIG ? (
            <TypeFocusPanel
              type={filter as FocusType}
              items={items}
              workLogs={workLogs}
              onOpenItem={item => setEditingItem(item)}
            />
          ) : (
            <InsightsPanel items={items} workLogs={workLogs} onOpenItem={item => setEditingItem(item)} />
          )}
        </aside>
      </div>

      {/* ── Edit Modal ── */}
      <AnimatePresence>
        {editingItem && (
          <EditModal item={editingItem} onClose={() => setEditingItem(null)}
            onSave={handleSave} onDelete={handleDelete} />
        )}
      </AnimatePresence>

      {/* ── Project Modal ── */}
      <AnimatePresence>
        {projectModal && (
          <ProjectModal
            projectName={projectModal}
            items={items}
            workLogs={workLogs}
            onClose={() => setProjectModal(null)}
            onOpenItem={item => { setProjectModal(null); setEditingItem(item); }}
            onAddLog={addWorkLog}
            onDeleteLog={deleteWorkLog}
            onEditLog={updateWorkLog}
          />
        )}
      </AnimatePresence>

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }} transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={`fixed bottom-[72px] right-[284px] z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-2xl text-[12.5px] font-semibold border ${
              toast.type === "error" ? "bg-red-950 border-red-800/50 text-red-200" : "bg-[hsl(222_18%_14%)] border-blue-500/25 text-foreground"
            }`}>
            {toast.type === "error" ? <AlertTriangle size={13} className="text-red-400" /> : <CheckCircle2 size={13} className="text-blue-400" />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
