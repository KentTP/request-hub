import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { motion, AnimatePresence } from "framer-motion";

// Local Request type matching Supabase schema
type Request = {
  id: string;
  title: string;
  person: string | null;
  type: string;
  priority: string;
  deadline: string | null;
  status: string;
  notes: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};
import {
  AreaChart, Area, ResponsiveContainer, Tooltip, XAxis,
} from "recharts";
import {
  Zap, Clock, CheckCircle2, AlertTriangle, ChevronRight, X,
  Send, Sparkles, BarChart3, Trash2, ArrowRight,
  TrendingUp, TrendingDown, Minus, Calendar,
  User, Tag, ChevronDown, RefreshCw, Target,
} from "lucide-react";

// Supabase helpers — map DB snake_case ↔ camelCase lightly
function rowToRequest(row: any): Request {
  return {
    id: row.id,
    title: row.title,
    person: row.person ?? null,
    type: row.type,
    priority: row.priority,
    deadline: row.deadline ?? null,
    status: row.status,
    notes: row.notes ?? null,
    description: row.description ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at ?? null,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { label: string; cls: string }> = {
  Review:   { label: "Review",   cls: "type-review" },
  Proposal: { label: "Proposal", cls: "type-proposal" },
  Project:  { label: "Project",  cls: "type-project" },
  Task:     { label: "Task",     cls: "type-task" },
};

const PRIORITY_ORDER: Record<string, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

function avatarColor(name: string): string {
  const palette = ["#3b9fd4", "#60a5fa", "#f59e0b", "#a78bfa", "#f87171", "#38bdf8", "#fb923c"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return palette[h % palette.length];
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
      if (diff < 0) s += 20;
      else if (diff <= 2) s += 12;
      else if (diff <= 7) s += 5;
    }
    score += s;
  });
  return Math.min(100, score);
}

// ─── NLP Parser ──────────────────────────────────────────────────────────────

const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

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
  if (/\bend of month\b/.test(l)) {
    const d = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return d.toISOString().split("T")[0];
  }
  const mPat = MONTHS.join("|");
  const mM = text.match(new RegExp(`(\\d{1,2})\\s+(${mPat})\\w*|(${mPat})\\w*\\s+(\\d{1,2})`, "i"));
  if (mM) {
    const day = parseInt(mM[1] || mM[4]);
    const mStr = (mM[2] || mM[3]).slice(0, 3).toLowerCase();
    const mon = MONTHS.indexOf(mStr);
    const yr = today.getFullYear();
    const d = new Date(yr, mon, day);
    if (d < today) d.setFullYear(yr + 1);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  const nM = text.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (nM) {
    const day = parseInt(nM[1]), mon = parseInt(nM[2]) - 1;
    const raw = nM[3]; const yr = raw ? (raw.length === 2 ? 2000 + parseInt(raw) : parseInt(raw)) : today.getFullYear();
    if (day >= 1 && day <= 31 && mon >= 0 && mon <= 11) {
      const d = new Date(yr, mon, day);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    }
  }
  return null;
}

// Month names to avoid extracting as person names
const MONTH_NAMES = new Set(["january","february","march","april","may","june","july","august","september","october","november","december","jan","feb","mar","apr","jun","jul","aug","sep","oct","nov","dec"]);

function extractPerson(text: string): string | null {
  const patterns = [
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:asked|wants|needs|has asked|sent)\b/,
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)'s\s+\w+\s+(?:review|proposal|project|tender|doc|report)/i,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)'s\s+(?:review|proposal|project|tender|doc|report)/i,
    /\bfor\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
    /\bfrom\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const name = m[1].trim();
      if (!MONTH_NAMES.has(name.toLowerCase())) return name;
    }
  }
  return null;
}

function extractType(text: string): string {
  const l = text.toLowerCase();
  if (/\b(review|look at|evaluate|assess|give feedback|read through|proofread)\b/.test(l)) return "Review";
  if (/\b(proposal|tender|bid|rfp|rfq|pitch|quote)\b/.test(l)) return "Proposal";
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

function generateTitle(text: string, person: string | null, type: string): string {
  let c = text;
  // Remove person references
  if (person) {
    const e = person.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    c = c.replace(new RegExp(`^${e}(?:'s?)?\\s+(?:asked me to|wants me to|needs|asked|wants)\\s*`, "i"), "");
    c = c.replace(new RegExp(`\\b${e}(?:'s)?\\s+`, "i"), "");
    c = c.replace(new RegExp(`\\s+for\\s+${e}\\b`, "i"), "");
    c = c.replace(new RegExp(`\\s+from\\s+${e}\\b`, "i"), "");
    c = c.replace(new RegExp(`\\s+by\\s+${e}\\b`, "i"), "");
  }
  // Remove leading action verbs
  c = c.replace(/^(?:to\s+)?(?:review|check|look at|help with|evaluate|read through|give feedback on)\s*/i, "");
  // Remove deadline phrases (order matters — most specific first)
  const monthPat = MONTHS.join("|");
  c = c.replace(new RegExp(`[,\\s]*(?:by|before|due in?|due)\\s+(?:end of\\s+)?(?:this\\s+)?(?:week|month|today|tomorrow|monday|tuesday|wednesday|thursday|friday|eow)\\b`, "ig"), "");
  c = c.replace(new RegExp(`[,\\s]*(?:by|before|due)\\s+\\d{1,2}\\s+(?:${monthPat})\\w*`, "ig"), "");
  c = c.replace(new RegExp(`[,\\s]*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\\w*)\\s+\\d{1,2}\\b`, "ig"), ""); // "June 30" standalone
  c = c.replace(new RegExp(`[,\\s]*(?:by|before|due)\\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\\w*\\b`, "ig"), ""); // "by June"
  c = c.replace(/[,\s]*(?:by|before|due)\s+\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?/ig, "");
  c = c.replace(/[,\s]*(?:by|before|due)\s+\d{1,2}\b/ig, ""); // e.g. "by 15"
  c = c.replace(/[,\s]*\bin\s+\d+\s+days?\b/ig, "");
  c = c.replace(/[,\s]*\bnext\s+week\b/ig, "");
  c = c.replace(/\bdue\b\s*/ig, ""); // stray "due" word
  // Remove priority modifiers
  c = c.replace(/[,\s]*(?:urgent|asap|high priority|high|low priority|no rush|not urgent|can wait|important)\b/ig, "");
  // Clean up
  c = c.replace(/\s+/g, " ").replace(/^[,.\-–\s]+|[,.\-–\s]+$/g, "").trim();
  return c.length > 2 ? c[0].toUpperCase() + c.slice(1) : `${type} request`;
}

function parseInput(text: string): Omit<Request, "id" | "created_at" | "updated_at" | "completed_at"> {
  const t = text.trim();
  const person = extractPerson(t);
  const type = extractType(t);
  const priority = extractPriority(t);
  const deadline = parseDeadline(t);
  const title = generateTitle(t, person, type);
  return { title, person: person || null, type, priority, deadline: deadline || null, status: "inbox", notes: "", description: t };
}

// Fuzzy match — returns true if all words in keyword appear in target
function fuzzyMatch(target: string, keyword: string): boolean {
  const t = target.toLowerCase();
  const words = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  return words.length > 0 && words.every(w => t.includes(w));
}

// ─── Components ──────────────────────────────────────────────────────────────

function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const color = avatarColor(name);
  return (
    <div
      style={{ background: color, width: size, height: size, fontSize: size * 0.38 }}
      className="rounded-full flex items-center justify-center text-white font-bold shrink-0 select-none"
    >
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
  const color = score < 30 ? "hsl(207 85% 52%)" : score < 60 ? "hsl(38 92% 55%)" : score < 85 ? "hsl(25 95% 55%)" : "hsl(5 80% 50%)";
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1 w-[72px] rounded-full bg-white/10 overflow-hidden">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      <span className="text-[11px] font-semibold tabular" style={{ color }}>{label}</span>
    </div>
  );
}

function RequestCard({
  item,
  onMove,
  onDelete,
  onClick,
}: {
  item: Request;
  onMove: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onClick: (item: Request) => void;
}) {
  const dl = deadlineInfo(item.deadline);
  const isOverdue = dl && dl.diff !== undefined && dl.diff < 0 && item.status !== "done";

  const borderColor = isOverdue
    ? "hsl(5 80% 50% / 0.7)"
    : item.priority === "Urgent"
    ? "hsl(5 80% 50% / 0.5)"
    : item.priority === "High"
    ? "hsl(38 92% 55% / 0.5)"
    : "transparent";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, y: 6 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      data-testid={`card-${item.id}`}
      className={`group relative rounded-lg border border-white/[0.07] bg-surface-1 p-3.5 cursor-pointer
        hover:border-white/[0.14] hover:bg-surface-3 transition-all duration-150
        ${item.status === "done" ? "opacity-45 hover:opacity-65" : ""}
      `}
      style={{ borderLeftColor: borderColor, borderLeftWidth: 2 }}
      onClick={() => onClick(item)}
    >
      {/* Top row — badges + hover actions */}
      <div className="flex items-start gap-1.5 mb-2">
        <TypeBadge type={item.type} />
        {item.priority !== "Normal" && (
          <span className={`text-[9.5px] font-bold uppercase tracking-wide mt-px ${
            item.priority === "Urgent" ? "priority-urgent" : item.priority === "High" ? "priority-high" : "priority-low"
          }`}>
            {item.priority}
          </span>
        )}
        {isOverdue && (
          <span className="text-[9.5px] font-bold uppercase tracking-wide text-red-400 mt-px ml-0.5">overdue</span>
        )}
        <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {item.status === "inbox" && (
            <button
              data-testid={`btn-start-${item.id}`}
              onClick={e => { e.stopPropagation(); onMove(item.id, "in-progress"); }}
              className="p-1 rounded hover:bg-blue-500/15 text-blue-400/70 hover:text-blue-400 transition-colors"
              title="Start working"
            >
              <ChevronRight size={12} />
            </button>
          )}
          {item.status !== "done" && (
            <button
              data-testid={`btn-done-${item.id}`}
              onClick={e => { e.stopPropagation(); onMove(item.id, "done"); }}
              className="p-1 rounded hover:bg-blue-500/15 text-blue-400/70 hover:text-blue-400 transition-colors"
              title="Mark done"
            >
              <CheckCircle2 size={12} />
            </button>
          )}
          {item.status === "done" && (
            <button
              data-testid={`btn-reopen-${item.id}`}
              onClick={e => { e.stopPropagation(); onMove(item.id, "inbox"); }}
              className="p-1 rounded hover:bg-white/10 text-muted-foreground transition-colors"
              title="Reopen"
            >
              <RefreshCw size={12} />
            </button>
          )}
          <button
            data-testid={`btn-delete-${item.id}`}
            onClick={e => { e.stopPropagation(); onDelete(item.id); }}
            className="p-1 rounded hover:bg-red-500/15 text-red-400/50 hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Title */}
      <p className="text-[13px] font-semibold text-foreground leading-snug mb-2.5 pr-1">
        {item.title}
      </p>

      {/* Meta row */}
      <div className="flex items-center gap-3">
        {item.person && (
          <div className="flex items-center gap-1.5">
            <Avatar name={item.person} size={16} />
            <span className="text-[11px] text-muted-foreground">{item.person}</span>
          </div>
        )}
        {dl && (
          <div className={`flex items-center gap-1 text-[10.5px] font-medium ml-auto ${dl.cls}`}>
            <Clock size={9} />
            <span>{dl.text}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Column({
  status, label, items, onMove, onDelete, onClick, icon, accentColor,
}: {
  status: string; label: string; items: Request[];
  onMove: (id: string, s: string) => void;
  onDelete: (id: string) => void;
  onClick: (item: Request) => void;
  icon: React.ReactNode; accentColor: string;
}) {
  const [over, setOver] = useState(false);
  const sorted = [...items].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  return (
    <div
      className={`flex flex-col rounded-xl border flex-1 min-w-[260px] max-w-[420px] transition-all duration-150
        ${over ? "border-white/20 bg-white/[0.015]" : "border-white/[0.07] bg-[hsl(222_18%_10%)]"}
      `}
      style={{ borderTopColor: over ? accentColor : undefined, borderTopWidth: over ? 2 : undefined }}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData("id"); if (id) onMove(id, status); }}
    >
      {/* Column header */}
      <div
        className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] shrink-0"
        style={{ borderTopColor: accentColor, borderTopWidth: 2, borderTopLeftRadius: "0.75rem", borderTopRightRadius: "0.75rem" }}
      >
        <span style={{ color: accentColor }}>{icon}</span>
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
        <span className="ml-auto flex items-center justify-center w-5 h-5 rounded bg-white/[0.06] text-[10px] font-bold text-muted-foreground tabular">
          {items.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto styled-scroll p-3 flex flex-col gap-2">
        <AnimatePresence mode="popLayout">
          {sorted.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-14 gap-2 text-center"
            >
              <div className="w-9 h-9 rounded-full bg-white/[0.04] flex items-center justify-center">
                <span style={{ color: accentColor, opacity: 0.35 }}>{icon}</span>
              </div>
              <p className="text-[11.5px] text-muted-foreground/50">Nothing here</p>
            </motion.div>
          ) : (
            sorted.map(item => (
              <div
                key={item.id}
                draggable
                onDragStart={e => e.dataTransfer.setData("id", item.id)}
              >
                <RequestCard
                  item={item}
                  onMove={onMove}
                  onDelete={onDelete}
                  onClick={onClick}
                />
              </div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Insights Panel ──────────────────────────────────────────────────────────

function InsightsSpark({ items }: { items: Request[] }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today); d.setDate(d.getDate() - (13 - i));
    const key = d.toISOString().split("T")[0];
    const added = items.filter(x => x.created_at && new Date(x.created_at).toISOString().split("T")[0] === key).length;
    const done  = items.filter(x => x.completed_at && new Date(x.completed_at).toISOString().split("T")[0] === key).length;
    return { date: key, added, done, label: d.toLocaleDateString("en-CA", { month: "short", day: "numeric" }) };
  });

  const doneThisWeek = items.filter(x => {
    if (x.status !== "done" || !x.completed_at) return false;
    const d = new Date(today); d.setDate(d.getDate() - 7);
    return new Date(x.completed_at) >= d;
  }).length;
  const doneLastWeek = items.filter(x => {
    if (x.status !== "done" || !x.completed_at) return false;
    const start = new Date(today); start.setDate(start.getDate() - 14);
    const end   = new Date(today); end.setDate(end.getDate() - 7);
    return new Date(x.completed_at) >= start && new Date(x.completed_at) < end;
  }).length;
  const velocity = doneThisWeek - doneLastWeek;

  const active  = items.filter(i => i.status !== "done");
  const urgent  = active.filter(i => i.priority === "Urgent");
  const overdue = active.filter(i => i.deadline && (deadlineInfo(i.deadline)?.diff ?? 0) < 0);

  const byPerson: Record<string, number> = {};
  items.forEach(i => { if (i.person) byPerson[i.person] = (byPerson[i.person] || 0) + 1; });
  const topPeople = Object.entries(byPerson).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto styled-scroll h-full">
      {/* KPI 2×2 */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "Active",       value: active.length,      icon: <Target size={12} />,       color: "hsl(207 85% 52%)" },
          { label: "Urgent",       value: urgent.length,      icon: <Zap size={12} />,           color: urgent.length ? "hsl(5 80% 50%)" : "hsl(207 85% 52%)" },
          { label: "Done / week",  value: doneThisWeek,       icon: <CheckCircle2 size={12} />,  color: "hsl(207 85% 52%)" },
          { label: "Overdue",      value: overdue.length,     icon: <AlertTriangle size={12} />, color: overdue.length ? "hsl(5 80% 50%)" : "hsl(207 85% 52%)" },
        ].map(kpi => (
          <div key={kpi.label} className="rounded-lg border border-white/[0.06] bg-[hsl(222_18%_12%)] p-2.5">
            <div className="flex items-center gap-1 mb-1.5" style={{ color: kpi.color }}>
              {kpi.icon}
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground leading-none">{kpi.label}</span>
            </div>
            <div className="text-xl font-display font-bold tabular" style={{ color: kpi.color }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Velocity sparkline */}
      <div className="rounded-lg border border-white/[0.06] bg-[hsl(222_18%_12%)] p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Velocity · 14 days</span>
          <div className={`flex items-center gap-1 text-[10px] font-semibold ${velocity > 0 ? "text-blue-400" : velocity < 0 ? "text-red-400" : "text-muted-foreground"}`}>
            {velocity > 0 ? <TrendingUp size={10} /> : velocity < 0 ? <TrendingDown size={10} /> : <Minus size={10} />}
            <span>{velocity > 0 ? `+${velocity}` : velocity} vs last wk</span>
          </div>
        </div>
        <div className="h-[64px] -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={days} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="gDone" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="hsl(207 85% 52%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(207 85% 52%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gAdded" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="hsl(213 80% 58%)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="hsl(213 80% 58%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" hide />
              <Tooltip
                contentStyle={{ background: "hsl(222 18% 14%)", border: "1px solid hsl(222 15% 22%)", borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: "hsl(210 20% 80%)" }}
                itemStyle={{ color: "hsl(210 15% 65%)" }}
              />
              <Area type="monotone" dataKey="added" stroke="hsl(213 80% 58%)" strokeWidth={1.5} fill="url(#gAdded)" name="Added" />
              <Area type="monotone" dataKey="done"  stroke="hsl(207 85% 52%)" strokeWidth={1.5} fill="url(#gDone)"  name="Completed" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center gap-4 mt-1.5">
          <div className="flex items-center gap-1.5"><div className="w-2 h-0.5 rounded bg-blue-400" /><span className="text-[9.5px] text-muted-foreground">Completed</span></div>
          <div className="flex items-center gap-1.5"><div className="w-2 h-0.5 rounded bg-blue-400"  /><span className="text-[9.5px] text-muted-foreground">Added</span></div>
        </div>
      </div>

      {/* Top requesters */}
      {topPeople.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-[hsl(222_18%_12%)] p-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-2.5">Top Requesters</span>
          <div className="flex flex-col gap-2">
            {topPeople.map(([name, count]) => {
              const max = topPeople[0][1];
              return (
                <div key={name} className="flex items-center gap-2">
                  <Avatar name={name} size={18} />
                  <span className="text-[11.5px] text-foreground flex-1 truncate">{name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="w-14 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                      <div className="h-full rounded-full bg-blue-500/60 transition-all" style={{ width: `${(count / max) * 100}%` }} />
                    </div>
                    <span className="text-[10.5px] font-bold tabular text-muted-foreground w-3 text-right">{count}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Overdue list */}
      {overdue.length > 0 && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/[0.04] p-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-red-400/80 block mb-2">Overdue · {overdue.length}</span>
          <div className="flex flex-col gap-1.5">
            {overdue.slice(0, 5).map(item => {
              const dl = deadlineInfo(item.deadline);
              return (
                <div key={item.id} className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-red-500 shrink-0" />
                  <span className="text-[11.5px] text-foreground flex-1 truncate">{item.title}</span>
                  <span className="text-[10.5px] text-red-400 shrink-0">{dl?.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({
  item, onClose, onSave, onDelete, onMove,
}: {
  item: Request;
  onClose: () => void;
  onSave: (id: string, data: Partial<Request>) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, status: string) => void;
}) {
  const [title,    setTitle]    = useState(item.title);
  const [person,   setPerson]   = useState(item.person || "");
  const [type,     setType]     = useState(item.type);
  const [priority, setPriority] = useState(item.priority);
  const [deadline, setDeadline] = useState(item.deadline || "");
  const [notes,    setNotes]    = useState(item.notes || "");
  const [status,   setStatus]   = useState(item.status);

  const dl = deadlineInfo(item.deadline);
  const typeColor = type === "Review" ? "hsl(213 80% 58%)" : type === "Proposal" ? "hsl(38 92% 55%)" : type === "Project" ? "hsl(207 85% 52%)" : "hsl(215 12% 45%)";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, y: 16 }}
        animate={{ scale: 1,    y: 0 }}
        exit={{ scale: 0.95,    y: 16 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-[500px] max-w-full max-h-[90vh] bg-[hsl(222_18%_11%)] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        data-testid="modal-edit"
      >
        {/* Type colour stripe */}
        <div className="h-0.5 w-full shrink-0" style={{ background: typeColor }} />

        {/* Modal header */}
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
          {/* Title field */}
          <input
            data-testid="input-title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full bg-transparent text-[15px] font-semibold text-foreground placeholder:text-muted-foreground border-0 outline-none focus:ring-0"
            placeholder="Request title"
            autoFocus
          />

          {/* Type + Priority */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Type",     value: type,     onChange: setType,     options: ["Review","Proposal","Project","Task"], icon: <Tag size={11} /> },
              { label: "Priority", value: priority, onChange: setPriority, options: ["Urgent","High","Normal","Low"],        icon: <Zap size={11} /> },
            ].map(f => (
              <div key={f.label}>
                <label className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                  {f.icon}{f.label}
                </label>
                <div className="relative">
                  <select
                    data-testid={`select-${f.label.toLowerCase()}`}
                    value={f.value}
                    onChange={e => f.onChange(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12.5px] text-foreground outline-none focus:border-blue-500/50 pr-8"
                  >
                    {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <ChevronDown size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            ))}

            {/* Requester */}
            <div>
              <label className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                <User size={11} />Requester
              </label>
              <input
                data-testid="input-person"
                value={person}
                onChange={e => setPerson(e.target.value)}
                placeholder="Name"
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12.5px] text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500/50"
              />
            </div>

            {/* Deadline */}
            <div>
              <label className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                <Calendar size={11} />Deadline
              </label>
              <input
                data-testid="input-deadline"
                type="date"
                value={deadline}
                onChange={e => setDeadline(e.target.value)}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12.5px] text-foreground outline-none focus:border-blue-500/50"
              />
            </div>
          </div>

          {/* Status toggle */}
          <div>
            <label className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">Status</label>
            <div className="flex gap-1 p-1 rounded-lg bg-white/[0.04] border border-white/[0.06]">
              {[["inbox","Inbox"],["in-progress","In Progress"],["done","Done"]].map(([k, l]) => (
                <button
                  key={k}
                  data-testid={`btn-status-${k}`}
                  onClick={() => setStatus(k)}
                  className={`flex-1 py-1.5 rounded-md text-[11.5px] font-semibold transition-all ${status === k ? "bg-white/[0.1] text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">Notes</label>
            <textarea
              data-testid="input-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Add context or notes..."
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12.5px] text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500/50 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-white/[0.06] bg-[hsl(222_18%_10%)] shrink-0">
          <button
            data-testid="btn-delete"
            onClick={() => { onDelete(item.id); onClose(); }}
            className="p-2 rounded-lg text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={14} />
          </button>
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-[12.5px] text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors">
            Cancel
          </button>
          <button
            data-testid="btn-save"
            onClick={() => {
              onSave(item.id, {
                title: title.trim() || item.title,
                person: person.trim() || null,
                type, priority, deadline: deadline || null, notes, status,
              });
              onClose();
            }}
            className="px-4 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-[12.5px] font-semibold text-white transition-colors flex items-center gap-1.5"
          >
            Save <ArrowRight size={12} />
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Command Input ────────────────────────────────────────────────────────────

function CommandInput({ onSubmit, isLoading }: { onSubmit: (text: string) => void; isLoading: boolean }) {
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
    <div className="relative flex items-end gap-2 bg-[hsl(222_18%_12%)] border border-white/[0.08] rounded-xl px-3 py-2.5 focus-within:border-blue-500/40 transition-colors">
      <Sparkles size={14} className="text-blue-500/60 mb-1.5 shrink-0" />
      <textarea
        ref={ref}
        data-testid="input-command"
        value={value}
        onChange={e => {
          setValue(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px";
        }}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        placeholder="e.g.  Sarah's EIA review by Friday, urgent  —  or  start CLT proposal  —  or  done with seismic report"
        rows={1}
        className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground outline-none resize-none leading-relaxed py-0"
      />
      <button
        data-testid="btn-send"
        onClick={submit}
        disabled={!value.trim() || isLoading}
        className="p-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 disabled:opacity-25 disabled:cursor-not-allowed text-white transition-all shrink-0"
      >
        <Send size={13} />
      </button>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [filter,       setFilter]       = useState("all");
  const [showInsights, setShowInsights] = useState(false);
  const [editingItem,  setEditingItem]  = useState<Request | null>(null);
  const [toast, setToast]   = useState<{ msg: string; type?: "success" | "error" } | null>(null);
  const [items, setItems]   = useState<Request[]>([]);
  const [loading, setLoading] = useState(false);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  }, []);

  // ── Fetch all requests ──
  const fetchItems = useCallback(async () => {
    const { data, error } = await supabase
      .from("requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setItems(data.map(rowToRequest));
  }, []);

  useEffect(() => {
    fetchItems();
    // Real-time subscription
    const channel = supabase
      .channel("requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "requests" }, () => fetchItems())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchItems]);

  // ── Create ──
  const createRequest = useCallback(async (data: Omit<Request, "id" | "created_at" | "updated_at" | "completed_at">) => {
    setLoading(true);
    const { error } = await supabase.from("requests").insert([{
      title: data.title,
      person: data.person,
      type: data.type,
      priority: data.priority,
      deadline: data.deadline,
      status: data.status,
      notes: data.notes || "",
      description: data.description || "",
    }]);
    setLoading(false);
    if (error) { showToast("Failed to add", "error"); return; }
    showToast("Request added");
    fetchItems();
  }, [fetchItems, showToast]);

  // ── Update ──
  const updateRequest = useCallback(async (id: string, data: Partial<Request>) => {
    const patch: any = { ...data, updated_at: new Date().toISOString() };
    // Auto-set completed_at when marking done
    if (data.status === "done") patch.completed_at = new Date().toISOString();
    if (data.status && data.status !== "done") patch.completed_at = null;
    await supabase.from("requests").update(patch).eq("id", id);
    fetchItems();
  }, [fetchItems]);

  // ── Delete ──
  const deleteRequest = useCallback(async (id: string) => {
    await supabase.from("requests").delete().eq("id", id);
    showToast("Deleted");
    fetchItems();
  }, [fetchItems, showToast]);

  const handleInput = useCallback((text: string) => {
    // "done with X" / "complete X" / "finish X"
    if (/^(?:done|finish|complete)\s/i.test(text)) {
      const kw = text.replace(/^(?:done|finished?|completed?)\s+(?:with\s+|the\s+)?/i, "").trim();
      const found = items.find(i =>
        i.status !== "done" && fuzzyMatch(i.title + " " + (i.person || ""), kw)
      );
      if (found) {
        updateRequest(found.id, { status: "done" });
        showToast(`✓ Done: ${found.title}`);
        return;
      }
    }

    // "start X" / "working on X" / "begin X"
    if (/^(?:start|begin|working on)\s/i.test(text)) {
      const kw = text.replace(/^(?:start(?:ing)?|begin(?:ning)?|working on)\s+(?:the\s+)?/i, "").trim();
      const found = items.find(i =>
        i.status === "inbox" && fuzzyMatch(i.title + " " + (i.person || ""), kw)
      );
      if (found) {
        updateRequest(found.id, { status: "in-progress" });
        showToast(`Started: ${found.title}`);
        return;
      }
    }

    // Default: create
    createRequest(parseInput(text));
  }, [items, createRequest, updateRequest, showToast]);

  const handleMove   = (id: string, status: string) => updateRequest(id, { status });
  const handleDelete = (id: string) => deleteRequest(id);
  const handleSave   = (id: string, data: Partial<Request>) => { updateRequest(id, data); showToast("Saved"); };

  const filtered = filter === "all" ? items : items.filter(i => i.type === filter);
  const score    = workloadScore(items);
  const active   = items.filter(i => i.status !== "done");
  const urgentCount = active.filter(i => i.priority === "Urgent").length;

  const COLUMNS = [
    { status: "inbox",       label: "Inbox",       icon: <Clock size={12} />,        accentColor: "hsl(207 85% 52%)" },
    { status: "in-progress", label: "In Progress",  icon: <Zap size={12} />,          accentColor: "hsl(38 92% 55%)" },
    { status: "done",        label: "Done",         icon: <CheckCircle2 size={12} />, accentColor: "hsl(215 12% 42%)" },
  ];

  const EXAMPLES = ["Sarah's EIA by Friday", "Review Mike's proposal, urgent", "NMB tender 20 Jun"];

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">

      {/* ── Header ── */}
      <header className="flex items-center gap-3 px-5 h-[48px] border-b border-white/[0.06] bg-[hsl(222_20%_7%)] shrink-0 z-20">
        {/* Logo mark */}
        <div className="flex items-center gap-2 mr-1 shrink-0">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-label="RequestHub logo">
            <rect width="20" height="20" rx="5" fill="hsl(207 85% 52%)" />
            <path d="M5 6.5h10M5 10h7M5 13.5h8.5" stroke="hsl(222 20% 8%)" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          <span className="font-display font-bold text-[14px] tracking-tight text-foreground">
            Request<span style={{ color: "hsl(207 85% 52%)" }}>Hub</span>
          </span>
        </div>

        <div className="h-3.5 w-px bg-white/[0.08] mx-0.5" />

        {/* Type filter tabs */}
        <div className="flex items-center gap-0.5">
          {[["all","All"],["Review","Reviews"],["Proposal","Proposals"],["Project","Projects"],["Task","Tasks"]].map(([k, l]) => (
            <button
              key={k}
              data-testid={`filter-${k}`}
              onClick={() => setFilter(k)}
              className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-all ${
                filter === k
                  ? "bg-white/[0.08] text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-4">
          {/* Workload meter */}
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] text-muted-foreground font-medium hidden sm:block">Workload</span>
            <WorkloadMeter score={score} />
          </div>

          {/* Stats pills */}
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

          {/* Insights toggle */}
          <button
            data-testid="btn-insights"
            onClick={() => setShowInsights(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-medium transition-all ${
              showInsights
                ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                : "border border-white/[0.08] text-muted-foreground hover:text-foreground hover:border-white/[0.18]"
            }`}
          >
            <BarChart3 size={12} />
            <span className="hidden sm:block">Insights</span>
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* ── Kanban Board ── */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 pb-0">
            <div className="flex gap-3 h-full pb-4 min-h-0">
              {COLUMNS.map(col => (
                <Column
                  key={col.status}
                  {...col}
                  items={filtered.filter(i => i.status === col.status)}
                  onMove={handleMove}
                  onDelete={handleDelete}
                  onClick={setEditingItem}
                />
              ))}
            </div>
          </div>

          {/* ── Command strip ── */}
          <div className="px-4 py-3 border-t border-white/[0.06] bg-[hsl(222_20%_8%)] shrink-0">
            <CommandInput onSubmit={handleInput} isLoading={loading} />
            <div className="flex items-center gap-3 mt-2 px-0.5">
              <span className="text-[10.5px] text-muted-foreground">
                <kbd className="px-1 py-0.5 rounded bg-white/[0.05] text-[9.5px]">Enter</kbd> to add ·{" "}
                <kbd className="px-1 py-0.5 rounded bg-white/[0.05] text-[9.5px]">Shift+Enter</kbd> for new line
              </span>
              <div className="flex items-center gap-2 ml-auto">
                {EXAMPLES.map(ex => (
                  <button
                    key={ex}
                    onClick={() => handleInput(ex)}
                    className="text-[10.5px] text-muted-foreground hover:text-blue-400 transition-colors hidden md:block"
                  >
                    {ex.length > 24 ? ex.slice(0, 24) + "…" : ex}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Insights panel — slides in from right as overlay ── */}
        <AnimatePresence>
          {showInsights && (
            <>
              {/* Click-outside backdrop (subtle) */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-10"
                style={{ background: "transparent" }}
                onClick={() => setShowInsights(false)}
              />
              <motion.aside
                initial={{ x: 300, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 300, opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="absolute right-0 top-0 bottom-0 z-20 w-[280px] border-l border-white/[0.07] bg-[hsl(222_20%_8%)] flex flex-col shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
                  <div className="flex items-center gap-2">
                    <BarChart3 size={12} className="text-blue-400" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Insights</span>
                  </div>
                  <button
                    onClick={() => setShowInsights(false)}
                    className="p-1 rounded hover:bg-white/[0.06] text-muted-foreground/60 transition-colors"
                  >
                    <X size={13} />
                  </button>
                </div>
                <InsightsSpark items={items} />
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* ── Edit Modal ── */}
      <AnimatePresence>
        {editingItem && (
          <EditModal
            item={editingItem}
            onClose={() => setEditingItem(null)}
            onSave={handleSave}
            onDelete={handleDelete}
            onMove={handleMove}
          />
        )}
      </AnimatePresence>

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={`fixed bottom-[72px] right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-2xl text-[12.5px] font-semibold border ${
              toast.type === "error"
                ? "bg-red-950 border-red-800/50 text-red-200"
                : "bg-[hsl(222_18%_14%)] border-blue-500/25 text-foreground"
            }`}
          >
            {toast.type === "error"
              ? <AlertTriangle size={13} className="text-red-400" />
              : <CheckCircle2 size={13} className="text-blue-400" />
            }
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
