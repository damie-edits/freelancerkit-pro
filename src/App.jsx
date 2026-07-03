import { useState, useEffect, useRef } from "react";
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

// ─── NOTE FOR VERCEL DEPLOYMENT ──────────────────────────────────────────────
// The three AI features (rate pitch, reminder draft, receipt scanner) call the
// Anthropic API.  In Claude.ai this works without a key.  When you deploy to
// Vercel you will need to add a lightweight /api/ai.js serverless proxy that
// injects your ANTHROPIC_API_KEY from an environment variable.
// We will wire that up together in the deployment step.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Constants ───────────────────────────────────────────────────────────────
const CURRENCIES = {
  USD: { symbol: "$", name: "US Dollar" },
  NGN: { symbol: "₦", name: "Nigerian Naira" },
  GBP: { symbol: "£", name: "British Pound" },
  EUR: { symbol: "€", name: "Euro" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (sym, n) =>
  `${sym}${parseFloat(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
const generateCode = () =>
  Math.random().toString(36).substring(2, 8).toUpperCase();
const todayStr = () => new Date().toISOString().split("T")[0];

const daysOverdue = (dueDate) => {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  const now = new Date();
  due.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.floor((now - due) / 86400000);
};

const addInterval = (dateStr, freq, n = 1) => {
  const d = new Date(dateStr);
  if (freq === "weekly") d.setDate(d.getDate() + 7 * n);
  else if (freq === "quarterly") d.setMonth(d.getMonth() + 3 * n);
  else if (freq === "yearly") d.setFullYear(d.getFullYear() + n);
  else d.setMonth(d.getMonth() + n);
  return d.toISOString().split("T")[0];
};

const monthKey = (dateStr) => {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (key) => {
  const [y, m] = key.split("-");
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString(
    "en-US",
    { month: "short", year: "2-digit" }
  );
};

const invoiceTotal = (inv) => {
  const sub = (inv.items || []).reduce((s, i) => s + (i.amount || 0), 0);
  return sub * (1 + (parseFloat(inv.taxRate) || 0) / 100);
};

const blankItems = () => [{ id: uid(), desc: "", qty: "1", rate: "", amount: 0 }];

// ─── localStorage helpers ────────────────────────────────────────────────────
const lsGet = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};
const lsSet = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Plus Jakarta Sans',sans-serif;background:#080815;color:#E2E2EE;min-height:100vh;}

  .kit-header{background:linear-gradient(160deg,#10102A 0%,#180D30 100%);border-bottom:1px solid #26264A;padding:14px 20px;position:sticky;top:0;z-index:40;}
  .kit-header-inner{max-width:820px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}
  .kit-logo{font-size:19px;font-weight:800;letter-spacing:-0.5px;}
  .kit-logo span{color:#00E5A0;}
  .kit-sub{font-size:10px;color:#6A6A8A;margin-top:2px;text-transform:uppercase;letter-spacing:1px;}
  .hdr-actions{display:flex;align-items:center;gap:8px;}
  .currency-sel{background:#16163A;border:1px solid #26264A;color:#E2E2EE;padding:7px 10px;border-radius:9px;font-family:'Plus Jakarta Sans',sans-serif;font-size:12px;cursor:pointer;outline:none;}
  .link-btn{background:transparent;border:1px solid #26264A;color:#8080A0;padding:7px 11px;border-radius:9px;font-size:11px;cursor:pointer;font-weight:600;font-family:'Plus Jakarta Sans',sans-serif;transition:all .15s;}
  .link-btn:hover{border-color:#7B68EE;color:#7B68EE;}

  .main{max-width:820px;margin:0 auto;padding:18px 20px 90px;}

  .card{background:#12122C;border:1px solid #22224A;border-radius:16px;padding:22px;margin-bottom:14px;}
  .card-title{font-size:11px;font-weight:700;color:#9090B8;text-transform:uppercase;letter-spacing:1px;margin-bottom:18px;display:flex;align-items:center;gap:8px;}
  .dot{width:7px;height:7px;border-radius:50%;background:#7B68EE;flex-shrink:0;}
  .dot.g{background:#00E5A0;}
  .dot.r{background:#FF6B6B;}

  .g2{display:grid;grid-template-columns:1fr 1fr;gap:13px;}
  @media(max-width:520px){.g2{grid-template-columns:1fr;}}

  .lbl{display:block;font-size:11px;font-weight:700;color:#6A6A8A;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;}
  .inp{width:100%;background:#080815;border:1px solid #22224A;color:#E2E2EE;padding:10px 12px;border-radius:8px;font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;outline:none;transition:border-color .2s;}
  .inp:focus{border-color:#7B68EE;}
  .inp::placeholder{color:#3A3A5A;}
  textarea.inp{resize:vertical;}
  select.inp{cursor:pointer;}

  .btn{padding:11px 22px;border-radius:10px;border:none;font-family:'Plus Jakarta Sans',sans-serif;font-weight:700;font-size:13px;cursor:pointer;transition:all .2s;width:100%;}
  .btn:disabled{opacity:.45;cursor:not-allowed;}
  .btn-primary{background:#7B68EE;color:#fff;}
  .btn-primary:not(:disabled):hover{background:#6555DD;transform:translateY(-1px);}
  .btn-accent{background:linear-gradient(135deg,#00E5A0,#00C078);color:#060613;}
  .btn-accent:not(:disabled):hover{opacity:.88;transform:translateY(-1px);}
  .btn-outline{background:transparent;border:1px solid #22224A;color:#8080A0;width:auto;padding:8px 14px;font-size:12px;}
  .btn-outline:hover{border-color:#7B68EE;color:#7B68EE;}
  .btn-danger-sm{background:none;border:none;color:#3A3A5A;font-size:20px;cursor:pointer;transition:color .15s;padding:2px 6px;}
  .btn-danger-sm:hover{color:#FF6B6B;}

  .stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;}
  @media(min-width:600px){.stat-grid{grid-template-columns:repeat(4,1fr);}}
  .stat-card{background:#12122C;border:1px solid #22224A;border-radius:12px;padding:16px;}
  .stat-label{font-size:10px;font-weight:700;color:#5A5A7A;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;}
  .stat-value{font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:#E2E2EE;}
  .stat-value.g{color:#00E5A0;}
  .stat-value.r{color:#FF6B6B;}
  .stat-value.p{color:#9B8EFF;}

  .rate-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px;}
  .rate-card{background:#080815;border:1px solid #22224A;border-radius:12px;padding:16px;text-align:center;}
  .rate-label{font-size:10px;font-weight:700;color:#5A5A7A;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;}
  .rate-val{font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:700;color:#00E5A0;letter-spacing:-1px;}
  .rate-val.p{color:#9B8EFF;font-size:30px;}

  .badge{display:inline-block;padding:3px 8px;border-radius:5px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;}
  .badge-draft{background:#22224A;color:#9090B8;}
  .badge-sent{background:#1A2E4A;color:#5BA8FF;}
  .badge-paid{background:#0D3A2A;color:#00E5A0;}
  .badge-overdue{background:#3A1414;color:#FF6B6B;}

  .list-card{background:#080815;border:1px solid #22224A;border-radius:10px;padding:14px;margin-bottom:9px;cursor:pointer;transition:border-color .15s;}
  .list-card:hover{border-color:#7B68EE;}
  .lc-row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}
  .lc-name{font-size:14px;font-weight:700;color:#E2E2EE;}
  .lc-meta{font-size:11px;color:#6A6A8A;margin-top:3px;}
  .lc-amount{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:#00E5A0;}

  .empty{text-align:center;padding:32px 20px;color:#5A5A7A;font-size:13px;}

  .hint{font-size:12px;color:#5A5A7A;line-height:1.6;margin-bottom:14px;}
  .hint em{color:#7B68EE;font-style:normal;font-weight:600;}

  .ai-box{background:#080815;border:1px solid #22224A;border-radius:10px;padding:16px;margin-top:14px;font-size:13px;line-height:1.75;color:#B8B8D8;white-space:pre-wrap;}
  .ai-tag{font-size:10px;color:#7B68EE;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;}

  .spin{display:inline-block;width:14px;height:14px;border:2px solid #3A3A5A;border-top-color:#00E5A0;border-radius:50%;animation:spinning .7s linear infinite;vertical-align:middle;margin-right:6px;}
  @keyframes spinning{to{transform:rotate(360deg);}}

  .line-hdr{display:grid;grid-template-columns:2fr 60px 90px 90px 30px;gap:7px;margin-bottom:7px;}
  @media(max-width:540px){.line-hdr{display:none;}}
  .line-row{display:grid;grid-template-columns:2fr 60px 90px 90px 30px;gap:7px;margin-bottom:7px;align-items:center;}
  @media(max-width:540px){.line-row{grid-template-columns:1fr 1fr;gap:6px;}.line-row .s2{grid-column:1/-1;}}
  .amt-cell{font-family:'JetBrains Mono',monospace;font-size:12px;color:#00E5A0;background:#080815;border:1px solid #22224A;border-radius:7px;padding:10px;text-align:right;}

  .divider{border:none;border-top:1px solid #22224A;margin:18px 0;}
  .tot-row{display:flex;justify-content:space-between;font-size:13px;color:#6A6A8A;margin-bottom:6px;}
  .tot-row span:last-child{font-family:'JetBrains Mono',monospace;color:#C0C0DA;}
  .grand-row{display:flex;justify-content:space-between;align-items:center;padding-top:12px;border-top:1px solid #22224A;margin-top:6px;}
  .grand-lbl{font-size:15px;font-weight:700;}
  .grand-val{font-family:'JetBrains Mono',monospace;font-size:24px;font-weight:700;color:#00E5A0;}

  .toggle-row{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:4px 0;}
  .toggle-track{width:42px;height:24px;border-radius:12px;background:#22224A;position:relative;cursor:pointer;transition:background .2s;border:none;flex-shrink:0;}
  .toggle-track.on{background:#00C078;}
  .toggle-thumb{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s;}
  .toggle-track.on .toggle-thumb{left:21px;}

  .sig-wrap{background:#fff;border-radius:10px;overflow:hidden;}
  .sig-canvas{display:block;width:100%;height:120px;touch-action:none;}

  .scan-drop{border:1.5px dashed #33335A;border-radius:10px;padding:22px;text-align:center;cursor:pointer;color:#6A6A8A;font-size:13px;margin-bottom:12px;transition:border-color .15s;}
  .scan-drop:hover{border-color:#7B68EE;color:#7B68EE;}
  .scan-img{max-width:100%;max-height:150px;border-radius:8px;margin-bottom:10px;display:block;}

  .forecast-tbl{width:100%;border-collapse:collapse;}
  .forecast-tbl th{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#5A5A7A;font-weight:700;padding:8px 10px;border-bottom:1px solid #22224A;text-align:left;}
  .forecast-tbl td{padding:9px 10px;border-bottom:1px solid #1A1A3A;font-size:13px;}
  .forecast-tbl td:not(:first-child){font-family:'JetBrains Mono',monospace;font-size:12px;}
  .forecast-tbl tr:last-child td{border-bottom:none;}

  .pv-overlay{position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:200;overflow-y:auto;padding:22px 14px;}
  .pv-sheet{max-width:660px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;font-family:'Plus Jakarta Sans',sans-serif;}
  .pv-hdr{background:#12122C;padding:26px 30px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;}
  .pv-from-name{font-size:18px;font-weight:800;color:#E2E2EE;}
  .pv-from-sm{font-size:12px;color:#6A6A8A;margin-top:3px;}
  .pv-inv-lbl{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6A6A8A;text-align:right;}
  .pv-inv-num{font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:#00E5A0;text-align:right;margin-top:4px;}
  .pv-body{padding:26px 30px;color:#1A1A3A;}
  .pv-slbl{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#999;font-weight:700;margin-bottom:5px;}
  .pv-cname{font-size:15px;font-weight:700;color:#1A1A3A;}
  .pv-csub{font-size:12px;color:#666;}
  .pv-dates{display:flex;gap:24px;margin:16px 0;}
  .pv-dval{font-size:13px;font-weight:600;color:#1A1A3A;margin-top:4px;}
  .pv-tbl{width:100%;border-collapse:collapse;margin-bottom:16px;}
  .pv-tbl th{background:#F0F0FF;padding:9px 11px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#888;font-weight:700;}
  .pv-tbl th:not(:first-child){text-align:right;}
  .pv-tbl td{padding:10px 11px;font-size:13px;border-bottom:1px solid #F0F0F0;}
  .pv-tbl td:not(:first-child){text-align:right;font-family:'JetBrains Mono',monospace;font-size:12px;}
  .pv-tots{border-top:2px solid #1A1A3A;padding-top:12px;}
  .pv-trow{display:flex;justify-content:space-between;font-size:13px;color:#444;margin-bottom:5px;}
  .pv-grand{font-weight:800;font-size:17px;color:#1A1A3A;margin-top:9px;padding-top:9px;border-top:1px solid #DDD;display:flex;justify-content:space-between;}
  .pv-grand .a{font-family:'JetBrains Mono',monospace;color:#4F46E5;}
  .pv-notes{margin-top:18px;padding-top:14px;border-top:1px solid #EEE;}
  .pv-notes-txt{font-size:12px;color:#666;line-height:1.6;margin-top:5px;}
  .pay-buttons{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;}
  .pay-btn{padding:8px 14px;border-radius:7px;color:#fff;text-decoration:none;font-size:12px;font-weight:700;}
  .pv-actions{padding:14px 30px;background:#F8F8FF;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;border-top:1px solid #E8E8FF;}
  .pv-btn{padding:8px 16px;border-radius:7px;border:none;cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif;font-weight:700;font-size:12px;transition:all .15s;}
  .pv-btn-o{background:transparent;border:1px solid #DDD;color:#666;}
  .pv-btn-o:hover{border-color:#7B68EE;color:#7B68EE;}
  .pv-btn-p{background:#4F46E5;color:#fff;}
  .pv-btn-p:hover{background:#3730C8;}
  .pv-code-box{margin-top:18px;padding:12px;background:#F0F0FF;border-radius:8px;font-size:11px;color:#555;}
  .pv-code{font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:#4F46E5;letter-spacing:2px;}

  .ov-item{background:#1A0808;border:1px solid #3A1A1A;border-radius:9px;padding:12px 14px;margin-bottom:8px;}
  .ov-name{font-weight:700;font-size:13px;}
  .ov-date{font-size:11px;color:#FF8B8B;margin-top:2px;}

  .bottom-nav{position:fixed;bottom:0;left:0;right:0;background:#0D0D24;border-top:1px solid #22224A;display:flex;padding:6px 0 calc(8px + env(safe-area-inset-bottom));z-index:50;}
  .bn-item{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:none;cursor:pointer;padding:5px 2px;}
  .bn-icon{font-size:20px;opacity:.5;transition:opacity .15s;}
  .bn-label{font-size:9px;color:#5A5A7A;font-weight:700;text-transform:uppercase;letter-spacing:.3px;}
  .bn-item.active .bn-icon{opacity:1;}
  .bn-item.active .bn-label{color:#00E5A0;}

  .reminder-sheet{max-width:480px;background:#12122C;}
  .reminder-body{padding:22px 28px;}
  .reminder-actions{padding:14px 28px;background:#0D0D24;border-top:1px solid #22224A;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;}

  @media print{.pv-actions{display:none!important;}.pv-overlay{background:#fff!important;padding:0!important;}.pv-sheet{border-radius:0;}}
`;

// ─── Sub-components ────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    draft: ["Draft", "badge-draft"],
    sent: ["Sent", "badge-sent"],
    paid: ["Paid", "badge-paid"],
    overdue: ["Overdue", "badge-overdue"],
  };
  const [label, cls] = map[status] || map.draft;
  return <span className={`badge ${cls}`}>{label}</span>;
}

function LineItemsEditor({ items, setItems, sym }) {
  const update = (id, field, val) =>
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const u = { ...it, [field]: val };
        u.amount = (parseFloat(u.qty) || 0) * (parseFloat(u.rate) || 0);
        return u;
      })
    );
  const add = () =>
    setItems((p) => [...p, { id: uid(), desc: "", qty: "1", rate: "", amount: 0 }]);
  const remove = (id) =>
    setItems((p) => (p.length > 1 ? p.filter((i) => i.id !== id) : p));

  return (
    <>
      <div className="line-hdr">
        {["Description", "Qty", `Rate (${sym})`, "Amount", ""].map((h, i) => (
          <span key={i} className="lbl" style={{ marginBottom: 0 }}>{h}</span>
        ))}
      </div>
      {items.map((it) => (
        <div key={it.id} className="line-row">
          <input className="inp s2" placeholder="Service description" value={it.desc} onChange={(e) => update(it.id, "desc", e.target.value)} />
          <input className="inp" type="number" value={it.qty} onChange={(e) => update(it.id, "qty", e.target.value)} />
          <input className="inp" type="number" placeholder="0.00" value={it.rate} onChange={(e) => update(it.id, "rate", e.target.value)} />
          <div className="amt-cell">{fmt(sym, it.amount)}</div>
          <button className="btn-danger-sm" onClick={() => remove(it.id)}>×</button>
        </div>
      ))}
      <button className="btn btn-outline" style={{ marginTop: 8 }} onClick={add}>+ Add Line</button>
    </>
  );
}

function PayButtons({ links }) {
  if (!links) return null;
  const defs = [
    { key: "stripe", label: "Pay with Stripe", color: "#635BFF" },
    { key: "paypal", label: "Pay with PayPal", color: "#003087" },
    { key: "paystack", label: "Pay with Paystack", color: "#00A859" },
    { key: "flutterwave", label: "Pay with Flutterwave", color: "#F5A623" },
  ];
  const active = defs.filter((d) => links[d.key]);
  if (!active.length) return null;
  return (
    <div className="pay-buttons">
      {active.map((d) => (
        <a key={d.key} href={links[d.key]} target="_blank" rel="noopener noreferrer"
          className="pay-btn" style={{ background: d.color }}>
          {d.label}
        </a>
      ))}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────
export default function FreelancerKitPro() {
  const [tab, setTab] = useState("home");
  const [loaded, setLoaded] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const sym = CURRENCIES[currency].symbol;

  // Business info
  const [bizName, setBizName] = useState("");
  const [bizEmail, setBizEmail] = useState("");
  const [bizLoc, setBizLoc] = useState("");
  const [sigDataUrl, setSigDataUrl] = useState(null);
  const [payLinks, setPayLinks] = useState({ stripe: "", paypal: "", paystack: "", flutterwave: "" });
  const [teamEnabled, setTeamEnabled] = useState(false);
  const [teamCode, setTeamCode] = useState("");
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Data
  const [invoices, setInvoices] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [receipts, setReceipts] = useState([]);

  // Invoice UI
  const [invView, setInvView] = useState("list");
  const [curInv, setCurInv] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [curSeries, setCurSeries] = useState(null);

  // Subscription form
  const [newSub, setNewSub] = useState({ name: "", cost: "", cycle: "monthly", nextRenewal: "", category: "" });

  // Receipt scanning
  const [receiptImg, setReceiptImg] = useState(null);
  const [newReceipt, setNewReceipt] = useState({ vendor: "", date: "", amount: "", category: "" });
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState("");

  // Calculator
  const [calcExp, setCalcExp] = useState("");
  const [calcInc, setCalcInc] = useState("");
  const [workDays, setWorkDays] = useState("20");
  const [hrsDay, setHrsDay] = useState("8");
  const [rates, setRates] = useState(null);
  const [aiPitch, setAiPitch] = useState("");
  const [pitchLoading, setPitchLoading] = useState(false);

  // Reminder modal
  const [reminderModal, setReminderModal] = useState(null);

  // Signature
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const hasDraft = useRef(false);

  // ── Load from localStorage on mount ──────────────────────────────────────
  useEffect(() => {
    const biz = lsGet("fk-biz", null);
    if (biz) {
      setBizName(biz.name || "");
      setBizEmail(biz.email || "");
      setBizLoc(biz.loc || "");
      setSigDataUrl(biz.sig || null);
      setPayLinks(biz.payLinks || { stripe: "", paypal: "", paystack: "", flutterwave: "" });
    }
    const team = lsGet("fk-team", { enabled: false, code: "" });
    setTeamEnabled(team.enabled);
    setTeamCode(team.code);
    const prefix = team.enabled && team.code ? `team:${team.code}:` : "";
    setInvoices(lsGet(`${prefix}fk-invoices`, []));
    setRecurring(lsGet(`${prefix}fk-recurring`, []));
    setSubscriptions(lsGet(`${prefix}fk-subs`, []));
    setReceipts(lsGet(`${prefix}fk-receipts`, []));
    const cur = lsGet("fk-currency", "USD");
    setCurrency(cur);
    setLoaded(true);
  }, []);

  const prefix = () => (teamEnabled && teamCode ? `team:${teamCode}:` : "");

  // ── Persist helpers ───────────────────────────────────────────────────────
  const saveInvoices = (list) => { setInvoices(list); lsSet(`${prefix()}fk-invoices`, list); };
  const saveRecurring = (list) => { setRecurring(list); lsSet(`${prefix()}fk-recurring`, list); };
  const saveSubs = (list) => { setSubscriptions(list); lsSet(`${prefix()}fk-subs`, list); };
  const saveReceipts = (list) => { setReceipts(list); lsSet(`${prefix()}fk-receipts`, list); };

  const saveBiz = (overrides = {}) => {
    const data = {
      name: overrides.name ?? bizName,
      email: overrides.email ?? bizEmail,
      loc: overrides.loc ?? bizLoc,
      sig: overrides.sig ?? sigDataUrl,
      payLinks: overrides.payLinks ?? payLinks,
    };
    lsSet("fk-biz", data);
  };

  const handleCurrencyChange = (val) => {
    setCurrency(val);
    lsSet("fk-currency", val);
  };

  const handleTeamToggle = () => {
    const next = !teamEnabled;
    setTeamEnabled(next);
    lsSet("fk-team", { enabled: next, code: teamCode });
    if (next && teamCode) {
      const p = `team:${teamCode}:`;
      setInvoices(lsGet(`${p}fk-invoices`, []));
      setRecurring(lsGet(`${p}fk-recurring`, []));
      setSubscriptions(lsGet(`${p}fk-subs`, []));
      setReceipts(lsGet(`${p}fk-receipts`, []));
    } else {
      setInvoices(lsGet("fk-invoices", []));
      setRecurring(lsGet("fk-recurring", []));
      setSubscriptions(lsGet("fk-subs", []));
      setReceipts(lsGet("fk-receipts", []));
    }
  };

  // ── Signature canvas ──────────────────────────────────────────────────────
  const getCanvasPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * (canvas.width / rect.width),
      y: (src.clientY - rect.top) * (canvas.height / rect.height),
    };
  };
  const startSig = (e) => {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const p = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const drawSig = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const p = getCanvasPos(e);
    ctx.strokeStyle = "#1A1A3A";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    hasDraft.current = true;
  };
  const endSig = () => { drawing.current = false; };
  const clearSig = () => {
    canvasRef.current.getContext("2d").clearRect(0, 0, 600, 120);
    hasDraft.current = false;
    setSigDataUrl(null);
    saveBiz({ sig: null });
  };
  const commitSig = () => {
    const url = canvasRef.current.toDataURL("image/png");
    setSigDataUrl(url);
    saveBiz({ sig: url });
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 1800);
  };

  // ── Invoice helpers ───────────────────────────────────────────────────────
  const blankInvoice = () => ({
    id: uid(),
    invNo: `INV-${String(invoices.length + 1).padStart(3, "0")}`,
    clientName: "", clientEmail: "",
    issueDate: todayStr(), dueDate: "",
    items: blankItems(), taxRate: "0",
    notes: "Payment due within 14 days. Thank you for your business.",
    status: "draft",
    publicCode: generateCode(),
  });

  const openNewInvoice = () => { setCurInv(blankInvoice()); setInvView("form"); };
  const openEditInvoice = (inv) => { setCurInv({ ...inv }); setInvView("form"); };
  const updateInv = (field, val) => setCurInv((p) => ({ ...p, [field]: val }));
  const setInvItems = (upd) => setCurInv((p) => ({ ...p, items: typeof upd === "function" ? upd(p.items) : upd }));

  const saveInvoice = (statusOverride) => {
    const inv = {
      ...curInv,
      status: statusOverride || curInv.status,
      bizName, bizEmail, bizLoc, payLinks, sigDataUrl,
    };
    const exists = invoices.some((i) => i.id === inv.id);
    const updated = exists
      ? invoices.map((i) => (i.id === inv.id ? inv : i))
      : [inv, ...invoices];
    saveInvoices(updated);
    setCurInv(inv);
    return inv;
  };

  const deleteInvoice = (id) => {
    saveInvoices(invoices.filter((i) => i.id !== id));
    setInvView("list");
  };
  const markPaid = (id) =>
    saveInvoices(invoices.map((i) => (i.id === id ? { ...i, status: "paid" } : i)));

  // ── Recurring series ──────────────────────────────────────────────────────
  const blankSeries = () => ({
    id: uid(), label: "",
    clientName: "", clientEmail: "",
    items: blankItems(), taxRate: "0", notes: "",
    frequency: "monthly", nextDueDate: todayStr(),
  });

  const saveSeries = () => {
    const exists = recurring.some((s) => s.id === curSeries.id);
    saveRecurring(
      exists
        ? recurring.map((s) => (s.id === curSeries.id ? curSeries : s))
        : [curSeries, ...recurring]
    );
    setInvView("list");
  };

  const generateFromSeries = (series) => {
    const due = new Date();
    due.setDate(due.getDate() + 14);
    const newInv = {
      id: uid(),
      invNo: `INV-${String(invoices.length + 1).padStart(3, "0")}`,
      clientName: series.clientName, clientEmail: series.clientEmail,
      issueDate: todayStr(), dueDate: due.toISOString().split("T")[0],
      items: series.items.map((i) => ({ ...i, id: uid() })),
      taxRate: series.taxRate, notes: series.notes,
      status: "draft", publicCode: generateCode(),
      bizName, bizEmail, bizLoc, payLinks, sigDataUrl,
    };
    saveInvoices([newInv, ...invoices]);
    saveRecurring(
      recurring.map((s) =>
        s.id === series.id
          ? { ...s, nextDueDate: addInterval(s.nextDueDate, s.frequency) }
          : s
      )
    );
    setTab("invoices");
    setInvView("list");
  };

  // ── Subscriptions ─────────────────────────────────────────────────────────
  const addSub = () => {
    if (!newSub.name || !newSub.cost) return;
    saveSubs([{ id: uid(), ...newSub }, ...subscriptions]);
    setNewSub({ name: "", cost: "", cycle: "monthly", nextRenewal: "", category: "" });
  };

  // ── Receipts / OCR ────────────────────────────────────────────────────────
  const handleReceiptFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      setReceiptImg(reader.result);
      setScanError("");
      setScanLoading(true);
      const base64 = reader.result.split(",")[1];
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 400,
            messages: [{
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: file.type || "image/jpeg", data: base64 } },
                { type: "text", text: 'Extract from this receipt: vendor name, date (YYYY-MM-DD), total amount (number only), one-word category (Software/Travel/Food/Equipment/Office/Other). Respond ONLY with valid JSON, no markdown: {"vendor":"","date":"","amount":0,"category":""}' },
              ],
            }],
          }),
        });
        const data = await res.json();
        const raw = data.content.map((b) => b.text || "").join("").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(raw);
        setNewReceipt({ vendor: parsed.vendor || "", date: parsed.date || todayStr(), amount: String(parsed.amount || ""), category: parsed.category || "" });
      } catch {
        setScanError("Couldn't read the receipt automatically — fill in the details below.");
        setNewReceipt({ vendor: "", date: todayStr(), amount: "", category: "" });
      }
      setScanLoading(false);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const saveReceipt = () => {
    if (!newReceipt.vendor || !newReceipt.amount) return;
    saveReceipts([{ id: uid(), ...newReceipt }, ...receipts]);
    setNewReceipt({ vendor: "", date: "", amount: "", category: "" });
    setReceiptImg(null);
  };

  // ── AI Rate pitch ─────────────────────────────────────────────────────────
  const calcRates = () => {
    const monthly = (parseFloat(calcExp) || 0) + (parseFloat(calcInc) || 0);
    const days = parseInt(workDays) || 20;
    const hrs = parseInt(hrsDay) || 8;
    const hourly = monthly / (days * hrs);
    setRates({ hourly: hourly.toFixed(2), daily: (hourly * hrs).toFixed(2), weekly: (hourly * hrs * (days / 4.33)).toFixed(2), monthly: monthly.toFixed(2) });
    setAiPitch("");
  };

  const genPitch = async () => {
    setPitchLoading(true);
    setAiPitch("");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 300,
          messages: [{ role: "user", content: `Write 2-3 confident, professional sentences a freelancer charging ${sym}${rates.hourly}/hour can send to a client who questions the rate. Focus on value delivered — not cost. No fluff, no clichés.` }],
        }),
      });
      const data = await res.json();
      setAiPitch(data.content.map((b) => b.text || "").join(""));
    } catch {
      setAiPitch("Couldn't connect right now — try again in a moment.");
    }
    setPitchLoading(false);
  };

  // ── Overdue reminder ──────────────────────────────────────────────────────
  const openReminder = async (inv) => {
    setReminderModal({ inv, text: "", loading: true });
    const od = daysOverdue(inv.dueDate);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 300,
          messages: [{ role: "user", content: `Write a short payment reminder (3-4 sentences, no subject line) from a freelancer to a client. Invoice ${inv.invNo} for ${fmt(sym, invoiceTotal(inv))} is ${od} day(s) overdue. Tone: ${od > 14 ? "firm but professional" : "friendly nudge"}. Ready to send, no placeholders.` }],
        }),
      });
      const data = await res.json();
      setReminderModal({ inv, text: data.content.map((b) => b.text || "").join(""), loading: false });
    } catch {
      setReminderModal({ inv, text: "Couldn't generate reminder — please try again.", loading: false });
    }
  };

  // ── Derived data ──────────────────────────────────────────────────────────
  const overdueInvs = invoices.filter((inv) => inv.status === "sent" && daysOverdue(inv.dueDate) > 0);
  const outstanding = invoices.filter((inv) => !["paid", "draft"].includes(inv.status)).reduce((s, inv) => s + invoiceTotal(inv), 0);
  const thisMonKey = monthKey(todayStr());
  const monthSubCost = subscriptions.reduce((s, sub) => { const c = parseFloat(sub.cost) || 0; return s + (sub.cycle === "yearly" ? c / 12 : c); }, 0);
  const thisMonExp = monthSubCost + receipts.filter((r) => r.date && monthKey(r.date) === thisMonKey).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const thisMonInc = invoices.filter((inv) => inv.status === "paid" && monthKey(inv.issueDate) === thisMonKey).reduce((s, inv) => s + invoiceTotal(inv), 0);
  const dueRecurring = recurring.filter((s) => s.nextDueDate <= todayStr());

  const buildForecast = () => {
    const incByMonth = {};
    invoices.filter((i) => i.status === "paid").forEach((inv) => {
      const k = monthKey(inv.issueDate);
      incByMonth[k] = (incByMonth[k] || 0) + invoiceTotal(inv);
    });
    const expByMonth = {};
    receipts.forEach((r) => {
      if (!r.date) return;
      const k = monthKey(r.date);
      expByMonth[k] = (expByMonth[k] || 0) + (parseFloat(r.amount) || 0);
    });
    const now = new Date();
    const keys = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
    const actual = keys.map((k) => ({ month: monthLabel(k), income: Math.round(incByMonth[k] || 0), expense: Math.round((expByMonth[k] || 0) + monthSubCost) }));
    const withData = actual.filter((a) => a.income > 0);
    const avgInc = withData.length ? withData.reduce((s, a) => s + a.income, 0) / withData.length : 0;
    const avgExp = Object.keys(expByMonth).length ? Object.values(expByMonth).reduce((s, v) => s + v, 0) / Object.keys(expByMonth).length : 0;
    const projected = Array.from({ length: 3 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return { month: monthLabel(k), income: Math.round(avgInc), expense: Math.round(monthSubCost + avgExp), projected: true };
    });
    return [...actual, ...projected];
  };

  if (!loaded) {
    return (
      <>
        <style>{styles}</style>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#080815", color: "#6A6A8A" }}>
          <span className="spin" />Loading FreelancerKit…
        </div>
      </>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{styles}</style>

      {/* Header */}
      <div className="kit-header">
        <div className="kit-header-inner">
          <div>
            <div className="kit-logo">Freelancer<span>Kit</span> Pro</div>
            <div className="kit-sub">{teamEnabled && teamCode ? `Team: ${teamCode}` : "Your Freelance Business, Organized"}</div>
          </div>
          <div className="hdr-actions">
            <select className="currency-sel" value={currency} onChange={(e) => handleCurrencyChange(e.target.value)}>
              {Object.entries(CURRENCIES).map(([c, { name }]) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="main">

        {/* ══ HOME ══ */}
        {tab === "home" && (
          <>
            <div className="stat-grid">
              <div className="stat-card"><div className="stat-label">Outstanding</div><div className="stat-value">{fmt(sym, outstanding)}</div></div>
              <div className="stat-card"><div className="stat-label">Overdue</div><div className={`stat-value ${overdueInvs.length ? "r" : "g"}`}>{overdueInvs.length}</div></div>
              <div className="stat-card"><div className="stat-label">This Month Income</div><div className="stat-value g">{fmt(sym, thisMonInc)}</div></div>
              <div className="stat-card"><div className="stat-label">This Month Net</div><div className={`stat-value ${thisMonInc - thisMonExp >= 0 ? "p" : "r"}`}>{fmt(sym, thisMonInc - thisMonExp)}</div></div>
            </div>

            <div className="card">
              <div className="card-title"><span className="dot g" />6-Month Profit Forecast</div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={buildForecast()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#22224A" />
                  <XAxis dataKey="month" stroke="#6A6A8A" fontSize={11} />
                  <YAxis stroke="#6A6A8A" fontSize={11} />
                  <Tooltip contentStyle={{ background: "#12122C", border: "1px solid #22224A", borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="income" stroke="#00E5A0" strokeWidth={2} dot={{ r: 3 }} name="Income" />
                  <Line type="monotone" dataKey="expense" stroke="#FF6B6B" strokeWidth={2} dot={{ r: 3 }} name="Expenses" strokeDasharray={(d) => d?.projected ? "5 3" : "0"} />
                </LineChart>
              </ResponsiveContainer>
              <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>Solid lines = actual from paid invoices &amp; logged expenses. Last 3 projected from your averages.</p>
            </div>

            {overdueInvs.length > 0 && (
              <div className="card">
                <div className="card-title"><span className="dot r" />Overdue Invoices</div>
                {overdueInvs.map((inv) => (
                  <div key={inv.id} className="ov-item">
                    <div className="lc-row">
                      <div><div className="ov-name">{inv.clientName || "Unnamed"} — {inv.invNo}</div><div className="ov-date">{daysOverdue(inv.dueDate)} day(s) overdue · {fmt(sym, invoiceTotal(inv))}</div></div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-outline" style={{ fontSize: 11, padding: "6px 10px" }} onClick={() => markPaid(inv.id)}>Mark Paid</button>
                        <button className="btn btn-outline" style={{ fontSize: 11, padding: "6px 10px" }} onClick={() => openReminder(inv)}>Reminder</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {dueRecurring.length > 0 && (
              <div className="card">
                <div className="card-title"><span className="dot" />Recurring Invoices Due</div>
                {dueRecurring.map((s) => (
                  <div key={s.id} className="list-card" style={{ cursor: "default" }}>
                    <div className="lc-row">
                      <div><div className="lc-name">{s.label || s.clientName}</div><div className="lc-meta">Due {s.nextDueDate} · {s.frequency}</div></div>
                      <button className="btn btn-primary" style={{ width: "auto", padding: "8px 14px", fontSize: 12 }} onClick={() => generateFromSeries(s)}>Generate</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ══ INVOICES ══ */}
        {tab === "invoices" && invView === "list" && (
          <>
            <button className="btn btn-accent" style={{ marginBottom: 14 }} onClick={openNewInvoice}>+ New Invoice</button>
            {invoices.length === 0 && <div className="empty">No invoices yet. Create your first one above.</div>}
            {invoices.map((inv) => {
              const od = inv.status === "sent" && daysOverdue(inv.dueDate) > 0;
              return (
                <div key={inv.id} className="list-card" onClick={() => openEditInvoice(inv)}>
                  <div className="lc-row">
                    <div>
                      <div className="lc-name">{inv.clientName || "Unnamed client"}</div>
                      <div className="lc-meta">{inv.invNo} · {inv.dueDate ? `Due ${inv.dueDate}` : "no due date"}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="lc-amount">{fmt(sym, invoiceTotal(inv))}</div>
                      <StatusBadge status={od ? "overdue" : inv.status} />
                    </div>
                  </div>
                </div>
              );
            })}

            {recurring.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <div className="card-title"><span className="dot" />Recurring Series</div>
                {recurring.map((s) => (
                  <div key={s.id} className="list-card" onClick={() => { setCurSeries(s); setInvView("series-form"); }}>
                    <div className="lc-row">
                      <div><div className="lc-name">{s.label || s.clientName}</div><div className="lc-meta">Next: {s.nextDueDate} · {s.frequency}</div></div>
                      <button className="btn-danger-sm" onClick={(e) => { e.stopPropagation(); saveRecurring(recurring.filter((r) => r.id !== s.id)); }}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={() => { setCurSeries(blankSeries()); setInvView("series-form"); }}>+ New Recurring Series</button>
          </>
        )}

        {tab === "invoices" && invView === "form" && curInv && (
          <>
            <button className="link-btn" style={{ marginBottom: 14 }} onClick={() => setInvView("list")}>← Back</button>
            <div className="card">
              <div className="card-title"><span className="dot" />Client</div>
              <div className="g2">
                <div><label className="lbl">Client Name</label><input className="inp" value={curInv.clientName} onChange={(e) => updateInv("clientName", e.target.value)} placeholder="Client Name" /></div>
                <div><label className="lbl">Client Email</label><input className="inp" type="email" value={curInv.clientEmail} onChange={(e) => updateInv("clientEmail", e.target.value)} placeholder="client@email.com" /></div>
              </div>
            </div>

            <div className="card">
              <div className="card-title"><span className="dot" />Invoice Info</div>
              <div className="g2">
                <div><label className="lbl">Invoice No.</label><input className="inp" value={curInv.invNo} onChange={(e) => updateInv("invNo", e.target.value)} /></div>
                <div><label className="lbl">Status</label>
                  <select className="inp" value={curInv.status} onChange={(e) => updateInv("status", e.target.value)}>
                    <option value="draft">Draft</option><option value="sent">Sent</option><option value="paid">Paid</option>
                  </select>
                </div>
                <div><label className="lbl">Issue Date</label><input className="inp" type="date" value={curInv.issueDate} onChange={(e) => updateInv("issueDate", e.target.value)} /></div>
                <div><label className="lbl">Due Date</label><input className="inp" type="date" value={curInv.dueDate} onChange={(e) => updateInv("dueDate", e.target.value)} /></div>
              </div>
            </div>

            <div className="card">
              <div className="card-title"><span className="dot" />Services</div>
              <LineItemsEditor items={curInv.items} setItems={setInvItems} sym={sym} />
              <div className="divider" />
              <div style={{ marginBottom: 16 }}><label className="lbl">Tax Rate (%)</label><input className="inp" type="number" value={curInv.taxRate} onChange={(e) => updateInv("taxRate", e.target.value)} style={{ width: 110 }} /></div>
              <div className="tot-row"><span>Subtotal</span><span>{fmt(sym, curInv.items.reduce((s, i) => s + (i.amount || 0), 0))}</span></div>
              {parseFloat(curInv.taxRate) > 0 && <div className="tot-row"><span>Tax ({curInv.taxRate}%)</span><span>{fmt(sym, curInv.items.reduce((s, i) => s + (i.amount || 0), 0) * parseFloat(curInv.taxRate) / 100)}</span></div>}
              <div className="grand-row"><span className="grand-lbl">Total Due</span><span className="grand-val">{fmt(sym, invoiceTotal(curInv))}</span></div>
            </div>

            <div className="card">
              <div className="card-title"><span className="dot" />Notes</div>
              <textarea className="inp" rows={3} value={curInv.notes} onChange={(e) => updateInv("notes", e.target.value)} />
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
              <button className="btn btn-outline" style={{ color: "#FF8B8B", borderColor: "#3A1414" }} onClick={() => deleteInvoice(curInv.id)}>Delete</button>
              <button className="btn btn-primary" onClick={() => saveInvoice()}>Save</button>
            </div>
            <button className="btn btn-accent" onClick={() => { saveInvoice(curInv.status === "draft" ? "sent" : curInv.status); setShowPreview(true); }}>
              👁 Preview &amp; Print
            </button>
          </>
        )}

        {tab === "invoices" && invView === "series-form" && curSeries && (
          <>
            <button className="link-btn" style={{ marginBottom: 14 }} onClick={() => setInvView("list")}>← Back</button>
            <div className="card">
              <div className="card-title"><span className="dot" />Recurring Series</div>
              <div className="g2">
                <div><label className="lbl">Label</label><input className="inp" value={curSeries.label} onChange={(e) => setCurSeries((p) => ({ ...p, label: e.target.value }))} placeholder="e.g. Monthly Retainer" /></div>
                <div><label className="lbl">Frequency</label>
                  <select className="inp" value={curSeries.frequency} onChange={(e) => setCurSeries((p) => ({ ...p, frequency: e.target.value }))}>
                    <option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option>
                  </select>
                </div>
                <div><label className="lbl">Client Name</label><input className="inp" value={curSeries.clientName} onChange={(e) => setCurSeries((p) => ({ ...p, clientName: e.target.value }))} /></div>
                <div><label className="lbl">Client Email</label><input className="inp" value={curSeries.clientEmail} onChange={(e) => setCurSeries((p) => ({ ...p, clientEmail: e.target.value }))} /></div>
                <div><label className="lbl">Next Due Date</label><input className="inp" type="date" value={curSeries.nextDueDate} onChange={(e) => setCurSeries((p) => ({ ...p, nextDueDate: e.target.value }))} /></div>
              </div>
            </div>
            <div className="card">
              <div className="card-title"><span className="dot" />Services</div>
              <LineItemsEditor items={curSeries.items} setItems={(upd) => setCurSeries((p) => ({ ...p, items: typeof upd === "function" ? upd(p.items) : upd }))} sym={sym} />
              <div className="divider" />
              <div><label className="lbl">Tax Rate (%)</label><input className="inp" type="number" value={curSeries.taxRate} onChange={(e) => setCurSeries((p) => ({ ...p, taxRate: e.target.value }))} style={{ width: 110 }} /></div>
            </div>
            <div className="card">
              <div className="card-title"><span className="dot" />Notes</div>
              <textarea className="inp" rows={2} value={curSeries.notes} onChange={(e) => setCurSeries((p) => ({ ...p, notes: e.target.value }))} />
            </div>
            <p className="hint">Tap "Generate" on the Home tab each time a recurring invoice is due. Generating still needs one tap from you — nothing can send invoices automatically while the app is closed without a backend server.</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-outline" style={{ color: "#FF8B8B", borderColor: "#3A1414" }} onClick={() => { saveRecurring(recurring.filter((s) => s.id !== curSeries.id)); setInvView("list"); }}>Delete</button>
              <button className="btn btn-primary" onClick={saveSeries}>Save Series</button>
            </div>
          </>
        )}

        {/* ══ EXPENSES ══ */}
        {tab === "expenses" && (
          <>
            <div className="card">
              <div className="card-title"><span className="dot" />Subscriptions <span style={{ color: "#5A5A7A", textTransform: "none", fontWeight: 500, letterSpacing: 0 }}> · {fmt(sym, monthSubCost)}/mo</span></div>
              <div className="g2">
                <div><label className="lbl">Name</label><input className="inp" placeholder="e.g. Grammarly" value={newSub.name} onChange={(e) => setNewSub({ ...newSub, name: e.target.value })} /></div>
                <div><label className="lbl">Cost ({sym})</label><input className="inp" type="number" placeholder="0.00" value={newSub.cost} onChange={(e) => setNewSub({ ...newSub, cost: e.target.value })} /></div>
                <div><label className="lbl">Billing Cycle</label>
                  <select className="inp" value={newSub.cycle} onChange={(e) => setNewSub({ ...newSub, cycle: e.target.value })}>
                    <option value="monthly">Monthly</option><option value="yearly">Yearly</option>
                  </select>
                </div>
                <div><label className="lbl">Next Renewal</label><input className="inp" type="date" value={newSub.nextRenewal} onChange={(e) => setNewSub({ ...newSub, nextRenewal: e.target.value })} /></div>
              </div>
              <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={addSub}>+ Add Subscription</button>
              {subscriptions.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  {subscriptions.map((s) => (
                    <div key={s.id} className="list-card" style={{ cursor: "default" }}>
                      <div className="lc-row">
                        <div><div className="lc-name">{s.name}</div><div className="lc-meta">{s.cycle} {s.nextRenewal ? `· renews ${s.nextRenewal}` : ""}</div></div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div className="lc-amount" style={{ fontSize: 13 }}>{fmt(sym, s.cost)}</div>
                          <button className="btn-danger-sm" onClick={() => saveSubs(subscriptions.filter((x) => x.id !== s.id))}>×</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-title"><span className="dot g" />AI Receipt Scanner</div>
              <p className="hint">Take a photo of any receipt — Claude reads it and fills in the details automatically.</p>
              <label className="scan-drop" htmlFor="receipt-file">
                {scanLoading ? (<><span className="spin" />Reading receipt…</>) : "📷 Tap to upload or take a photo"}
              </label>
              <input id="receipt-file" type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handleReceiptFile} />
              {receiptImg && <img src={receiptImg} className="scan-img" alt="receipt" />}
              {scanError && <p style={{ color: "#FF6B6B", fontSize: 12, marginBottom: 10 }}>{scanError}</p>}
              {(newReceipt.vendor || newReceipt.amount || receiptImg) && !scanLoading && (
                <>
                  <div className="g2">
                    <div><label className="lbl">Vendor</label><input className="inp" value={newReceipt.vendor} onChange={(e) => setNewReceipt({ ...newReceipt, vendor: e.target.value })} /></div>
                    <div><label className="lbl">Date</label><input className="inp" type="date" value={newReceipt.date} onChange={(e) => setNewReceipt({ ...newReceipt, date: e.target.value })} /></div>
                    <div><label className="lbl">Amount ({sym})</label><input className="inp" type="number" value={newReceipt.amount} onChange={(e) => setNewReceipt({ ...newReceipt, amount: e.target.value })} /></div>
                    <div><label className="lbl">Category</label><input className="inp" value={newReceipt.category} onChange={(e) => setNewReceipt({ ...newReceipt, category: e.target.value })} /></div>
                  </div>
                  <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={saveReceipt}>Save Expense</button>
                </>
              )}
              {receipts.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div className="card-title" style={{ marginBottom: 10 }}><span className="dot" />Logged Receipts · {fmt(sym, receipts.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0))} total</div>
                  {receipts.map((r) => (
                    <div key={r.id} className="list-card" style={{ cursor: "default" }}>
                      <div className="lc-row">
                        <div><div className="lc-name">{r.vendor}</div><div className="lc-meta">{r.date} {r.category ? `· ${r.category}` : ""}</div></div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div className="lc-amount" style={{ fontSize: 13 }}>{fmt(sym, r.amount)}</div>
                          <button className="btn-danger-sm" onClick={() => saveReceipts(receipts.filter((x) => x.id !== r.id))}>×</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ══ CALCULATOR ══ */}
        {tab === "calculator" && (
          <>
            <div className="card">
              <div className="card-title"><span className="dot" />Your Monthly Numbers</div>
              <div className="g2">
                <div><label className="lbl">Monthly Expenses ({sym})</label><input className="inp" type="number" placeholder="e.g. 500" value={calcExp} onChange={(e) => setCalcExp(e.target.value)} /></div>
                <div><label className="lbl">Target Monthly Take-Home ({sym})</label><input className="inp" type="number" placeholder="e.g. 2000" value={calcInc} onChange={(e) => setCalcInc(e.target.value)} /></div>
                <div><label className="lbl">Working Days / Month</label><input className="inp" type="number" value={workDays} onChange={(e) => setWorkDays(e.target.value)} /></div>
                <div><label className="lbl">Hours Per Day</label><input className="inp" type="number" value={hrsDay} onChange={(e) => setHrsDay(e.target.value)} /></div>
              </div>
              <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={calcRates}>Calculate My Minimum Rates</button>
            </div>

            {rates && (
              <>
                <div className="card">
                  <div className="card-title"><span className="dot g" />Your Minimum Rates</div>
                  <div className="rate-grid">
                    <div className="rate-card"><div className="rate-label">Per Hour</div><div className="rate-val">{fmt(sym, rates.hourly)}</div></div>
                    <div className="rate-card"><div className="rate-label">Per Day</div><div className="rate-val">{fmt(sym, rates.daily)}</div></div>
                    <div className="rate-card"><div className="rate-label">Per Week</div><div className="rate-val">{fmt(sym, rates.weekly)}</div></div>
                    <div className="rate-card"><div className="rate-label">Monthly Target</div><div className="rate-val p">{fmt(sym, rates.monthly)}</div></div>
                  </div>
                  <p className="hint">These are your <em>floor rates</em> — minimum to break even. Always charge <em>more</em> to cover revisions and scope creep.</p>
                  <button className="btn btn-accent" onClick={genPitch} disabled={pitchLoading}>
                    {pitchLoading ? <><span className="spin" />Generating…</> : "✨ Generate AI Rate Pitch"}
                  </button>
                  {aiPitch && <div className="ai-box"><div className="ai-tag">AI Rate Pitch · Copy &amp; send to clients</div>{aiPitch}</div>}
                </div>

                <div className="card">
                  <div className="card-title"><span className="dot" />Profit Forecast</div>
                  <table className="forecast-tbl">
                    <thead><tr><th>Period</th><th>At floor rate</th><th>At 1.5× rate</th><th>At 2× rate</th></tr></thead>
                    <tbody>
                      {[{ label: "1 Month", mult: 1 }, { label: "3 Months", mult: 3 }, { label: "6 Months", mult: 6 }, { label: "12 Months", mult: 12 }].map(({ label, mult }) => (
                        <tr key={label}>
                          <td style={{ fontWeight: 700 }}>{label}</td>
                          <td>{fmt(sym, rates.monthly * mult)}</td>
                          <td style={{ color: "#00E5A0" }}>{fmt(sym, rates.monthly * mult * 1.5)}</td>
                          <td style={{ color: "#9B8EFF" }}>{fmt(sym, rates.monthly * mult * 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {/* ══ SETTINGS ══ */}
        {tab === "settings" && (
          <>
            <div className="card">
              <div className="card-title"><span className="dot" />Your Business Info</div>
              <div className="g2">
                <div><label className="lbl">Name / Business</label><input className="inp" value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="Your Name" /></div>
                <div><label className="lbl">Email</label><input className="inp" type="email" value={bizEmail} onChange={(e) => setBizEmail(e.target.value)} placeholder="you@email.com" /></div>
                <div><label className="lbl">Location</label><input className="inp" value={bizLoc} onChange={(e) => setBizLoc(e.target.value)} placeholder="Lagos, Nigeria" /></div>
              </div>
            </div>

            <div className="card">
              <div className="card-title"><span className="dot" />Digital Signature</div>
              <p className="hint">Draw your signature — it gets stamped on every invoice you generate.</p>
              <div className="sig-wrap">
                <canvas ref={canvasRef} className="sig-canvas" width={600} height={120}
                  onMouseDown={startSig} onMouseMove={drawSig} onMouseUp={endSig} onMouseLeave={endSig}
                  onTouchStart={startSig} onTouchMove={drawSig} onTouchEnd={endSig} />
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button className="btn btn-outline" onClick={clearSig}>Clear</button>
                <button className="btn btn-primary" onClick={commitSig}>Save Signature</button>
              </div>
              {sigDataUrl && <div style={{ marginTop: 12, background: "#fff", borderRadius: 8, padding: 10 }}><img src={sigDataUrl} alt="sig" style={{ maxHeight: 45 }} /></div>}
            </div>

            <div className="card">
              <div className="card-title"><span className="dot" />Payment Links</div>
              <p className="hint">Paste your own links from each payment provider's dashboard. This app turns them into "Pay Now" buttons on your invoices — it doesn't process payments itself.</p>
              <div className="g2">
                <div><label className="lbl">Stripe</label><input className="inp" placeholder="https://buy.stripe.com/..." value={payLinks.stripe} onChange={(e) => setPayLinks({ ...payLinks, stripe: e.target.value })} /></div>
                <div><label className="lbl">PayPal</label><input className="inp" placeholder="https://paypal.me/..." value={payLinks.paypal} onChange={(e) => setPayLinks({ ...payLinks, paypal: e.target.value })} /></div>
                <div><label className="lbl">Paystack</label><input className="inp" placeholder="https://paystack.com/pay/..." value={payLinks.paystack} onChange={(e) => setPayLinks({ ...payLinks, paystack: e.target.value })} /></div>
                <div><label className="lbl">Flutterwave</label><input className="inp" placeholder="https://flutterwave.com/pay/..." value={payLinks.flutterwave} onChange={(e) => setPayLinks({ ...payLinks, flutterwave: e.target.value })} /></div>
              </div>
            </div>

            <div className="card">
              <div className="card-title"><span className="dot" />Team Mode</div>
              <div className="toggle-row">
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Share data with a team</div>
                  <p className="hint" style={{ marginBottom: 0 }}>All devices that enter the same team code share the same invoices, subscriptions and receipts (stored locally per-device under that code). For true real-time sync across devices, a backend is needed — that's a future step.</p>
                </div>
                <button className={`toggle-track ${teamEnabled ? "on" : ""}`} onClick={handleTeamToggle}><span className="toggle-thumb" /></button>
              </div>
              {teamEnabled && (
                <input className="inp" style={{ marginTop: 12 }} placeholder="Team code e.g. DAMIE2026" value={teamCode} onChange={(e) => setTeamCode(e.target.value.toUpperCase())} onBlur={(e) => { lsSet("fk-team", { enabled: true, code: e.target.value.toUpperCase() }); }} />
              )}
            </div>

            <button className="btn btn-accent" onClick={() => { saveBiz(); setSettingsSaved(true); setTimeout(() => setSettingsSaved(false), 1800); }}>
              {settingsSaved ? "✓ Saved" : "Save Settings"}
            </button>
          </>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="bottom-nav">
        {[
          { id: "home", icon: "🏠", label: "Home" },
          { id: "invoices", icon: "🧾", label: "Invoices" },
          { id: "expenses", icon: "💳", label: "Expenses" },
          { id: "calculator", icon: "🧮", label: "Calculator" },
          { id: "settings", icon: "⚙️", label: "Settings" },
        ].map((t) => (
          <button key={t.id} className={`bn-item ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            <span className="bn-icon">{t.icon}</span>
            <span className="bn-label">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ── Invoice Preview Modal ── */}
      {showPreview && curInv && (
        <div className="pv-overlay" onClick={(e) => e.target === e.currentTarget && setShowPreview(false)}>
          <div className="pv-sheet">
            <div className="pv-hdr">
              <div>
                <div className="pv-from-name">{curInv.bizName || bizName || "Your Name"}</div>
                {(curInv.bizEmail || bizEmail) && <div className="pv-from-sm">{curInv.bizEmail || bizEmail}</div>}
                {(curInv.bizLoc || bizLoc) && <div className="pv-from-sm">{curInv.bizLoc || bizLoc}</div>}
              </div>
              <div>
                <div className="pv-inv-lbl">Invoice</div>
                <div className="pv-inv-num">{curInv.invNo}</div>
                <div style={{ marginTop: 8 }}>
                  <StatusBadge status={curInv.status === "sent" && daysOverdue(curInv.dueDate) > 0 ? "overdue" : curInv.status} />
                </div>
              </div>
            </div>

            <div className="pv-body">
              <div style={{ marginBottom: 16 }}>
                <div className="pv-slbl">Bill To</div>
                <div className="pv-cname">{curInv.clientName || "Client"}</div>
                {curInv.clientEmail && <div className="pv-csub">{curInv.clientEmail}</div>}
              </div>

              <div className="pv-dates">
                <div><div className="pv-slbl">Issue Date</div><div className="pv-dval">{curInv.issueDate || "—"}</div></div>
                {curInv.dueDate && <div><div className="pv-slbl">Due Date</div><div className="pv-dval">{curInv.dueDate}</div></div>}
              </div>

              <table className="pv-tbl">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th style={{ textAlign: "right" }}>Qty</th>
                    <th style={{ textAlign: "right" }}>Rate</th>
                    <th style={{ textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(curInv.items || []).map((item) => (
                    <tr key={item.id}>
                      <td>{item.desc || "—"}</td>
                      <td>{item.qty}</td>
                      <td>{fmt(sym, parseFloat(item.rate) || 0)}</td>
                      <td>{fmt(sym, item.amount || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="pv-tots">
                <div className="pv-trow"><span>Subtotal</span><span>{fmt(sym, (curInv.items || []).reduce((s, i) => s + (i.amount || 0), 0))}</span></div>
                {parseFloat(curInv.taxRate) > 0 && (
                  <div className="pv-trow">
                    <span>Tax ({curInv.taxRate}%)</span>
                    <span>{fmt(sym, (curInv.items || []).reduce((s, i) => s + (i.amount || 0), 0) * parseFloat(curInv.taxRate) / 100)}</span>
                  </div>
                )}
                <div className="pv-grand"><span>Total Due</span><span className="a">{fmt(sym, invoiceTotal(curInv))}</span></div>
              </div>

              <PayButtons links={curInv.payLinks || payLinks} />

              {(curInv.sigDataUrl || sigDataUrl) && (
                <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid #EEE" }}>
                  <div className="pv-slbl">Authorised By</div>
                  <img src={curInv.sigDataUrl || sigDataUrl} alt="Signature" style={{ maxHeight: 50, marginTop: 6, display: "block" }} />
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{curInv.bizName || bizName}</div>
                </div>
              )}

              {curInv.notes && (
                <div className="pv-notes">
                  <div className="pv-slbl">Notes</div>
                  <div className="pv-notes-txt">{curInv.notes}</div>
                </div>
              )}

              <div className="pv-code-box">
                <div style={{ marginBottom: 4, fontWeight: 600 }}>Client Reference Code</div>
                <div className="pv-code">{curInv.publicCode}</div>
                <div style={{ marginTop: 6, fontSize: 11 }}>Share this code with your client so they can reference this invoice.</div>
              </div>
            </div>

            <div className="pv-actions">
              <button className="pv-btn pv-btn-o" onClick={() => setShowPreview(false)}>← Edit</button>
              <button className="pv-btn pv-btn-p" onClick={() => window.print()}>🖨 Print / Save PDF</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reminder Modal ── */}
      {reminderModal && (
        <div className="pv-overlay" onClick={(e) => e.target === e.currentTarget && setReminderModal(null)}>
          <div className="pv-sheet reminder-sheet">
            <div className="pv-hdr">
              <div>
                <div className="pv-from-name" style={{ fontSize: 15 }}>Payment Reminder</div>
                <div className="pv-from-sm">{reminderModal.inv.invNo} · {reminderModal.inv.clientName}</div>
              </div>
            </div>
            <div className="reminder-body">
              {reminderModal.loading
                ? <div style={{ textAlign: "center", padding: "28px 0", color: "#6A6A8A" }}><span className="spin" />Drafting reminder…</div>
                : <div className="ai-box" style={{ marginTop: 0 }}>{reminderModal.text}</div>}
            </div>
            <div className="reminder-actions">
              <button className="pv-btn pv-btn-o" onClick={() => setReminderModal(null)}>Close</button>
              <button className="pv-btn pv-btn-o" onClick={() => { try { navigator.clipboard.writeText(reminderModal.text); } catch {} }}>📋 Copy</button>
              {reminderModal.inv.clientEmail && (
                <a className="pv-btn pv-btn-p" style={{ textDecoration: "none" }}
                  href={`mailto:${reminderModal.inv.clientEmail}?subject=${encodeURIComponent("Payment Reminder - " + reminderModal.inv.invNo)}&body=${encodeURIComponent(reminderModal.text)}`}>
                  ✉️ Open in Email
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
