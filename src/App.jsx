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
  const [scanError, se
