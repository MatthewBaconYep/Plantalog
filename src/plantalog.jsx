import { useState, useEffect, useRef, useCallback } from "react";

// ─── Storage ──────────────────────────────────────────────────────────────────
async function loadData(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
  catch { return null; }
}
async function saveData(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ─── IndexedDB for photos ─────────────────────────────────────────────────────
function openPhotoDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("plantalog_photos", 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore("photos", { keyPath: "plantId" });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}
async function savePhotos(plantId, photos, primaryPhoto) {
  try {
    const db = await openPhotoDB();
    const tx = db.transaction("photos", "readwrite");
    tx.objectStore("photos").put({ plantId, photos, primaryPhoto });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
    db.close();
  } catch(e) { console.error("savePhotos error", e); }
}
async function loadAllPhotos() {
  try {
    const db = await openPhotoDB();
    const tx = db.transaction("photos", "readonly");
    const all = await new Promise((res, rej) => {
      const req = tx.objectStore("photos").getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = rej;
    });
    db.close();
    // Return a map of plantId -> {photos, primaryPhoto}
    const map = {};
    all.forEach(r => { map[r.plantId] = { photos: r.photos, primaryPhoto: r.primaryPhoto }; });
    return map;
  } catch(e) { console.error("loadAllPhotos error", e); return {}; }
}
async function deletePhotos(plantId) {
  try {
    const db = await openPhotoDB();
    const tx = db.transaction("photos", "readwrite");
    tx.objectStore("photos").delete(plantId);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
    db.close();
  } catch {}
}

// Compress a photo file to max 800px on longest side, JPEG quality 0.75
// Keeps storage well under the 5MB per-key limit even with many photos
function compressPhoto(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const MAX = 800;
        let { width: w, height: h } = img;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else       { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ─── Seed ─────────────────────────────────────────────────────────────────────
const SEED_ROOMS = [
  { id: "r1", name: "Living Room", order: 1 },
  { id: "r2", name: "Kitchen",     order: 2 },
  { id: "r3", name: "Bedroom",     order: 3 },
];
const fmt = d => {
  const obj = d instanceof Date ? d : new Date(String(d).slice(0,10) + "T12:00:00");
  if (isNaN(obj)) return "";
  const y = obj.getFullYear();
  const m = String(obj.getMonth() + 1).padStart(2, "0");
  const day = String(obj.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const getToday = () => new Date();
const today  = getToday(); // used only for seeds
const daysAgo= n => fmt(new Date(today - n * 864e5));

const SEED_PLANTS = [
  { id:"p1", roomId:"r1", name:"Monstera Deliciosa", obtainedDate:"2022-03-15", pottedDate:"2022-03-15", originalPot:true,  potMonths:0, potYears:2, currentPotSize:10, nextPotSize:12, waterFreqDays:7,  lastWatered:daysAgo(7),  health:4, photos:[], primaryPhoto:null, notes:"" },
  { id:"p2", roomId:"r1", name:"Pothos Golden",       obtainedDate:"2023-06-01", pottedDate:"2023-06-01", originalPot:true,  potMonths:6, potYears:0, currentPotSize:6,  nextPotSize:8,  waterFreqDays:10, lastWatered:daysAgo(3),  health:3, photos:[], primaryPhoto:null, notes:"" },
  { id:"p3", roomId:"r2", name:"Basil",               obtainedDate:"2024-01-10", pottedDate:"2024-01-10", originalPot:false, potMonths:3, potYears:0, currentPotSize:4,  nextPotSize:6,  waterFreqDays:3,  lastWatered:daysAgo(4),  health:2, photos:[], primaryPhoto:null, notes:"" },
  { id:"p4", roomId:"r2", name:"Aloe Vera",           obtainedDate:"2021-08-20", pottedDate:"2022-08-20", originalPot:false, potMonths:0, potYears:2, currentPotSize:8,  nextPotSize:10, waterFreqDays:14, lastWatered:daysAgo(14), health:4, photos:[], primaryPhoto:null, notes:"" },
  { id:"p5", roomId:"r3", name:"Snake Plant",         obtainedDate:"2020-05-05", pottedDate:"2021-05-05", originalPot:false, potMonths:0, potYears:2, currentPotSize:8,  nextPotSize:10, waterFreqDays:21, lastWatered:daysAgo(22), health:3, photos:[], primaryPhoto:null, notes:"" },
  { id:"p6", roomId:"r3", name:"ZZ Plant",            obtainedDate:"2023-11-01", pottedDate:"2023-11-01", originalPot:true,  potMonths:0, potYears:2, currentPotSize:6,  nextPotSize:8,  waterFreqDays:14, lastWatered:daysAgo(2),  health:1, photos:[], primaryPhoto:null, notes:"" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const HEALTH = {
  1: { label:"Dying",    color:"#e53e3e", bg:"#fff5f5", text:"#c53030" },
  2: { label:"Caution",  color:"#d69e2e", bg:"#fffff0", text:"#b7791f" },
  3: { label:"Good",     color:"#68d391", bg:"#f0fff4", text:"#276749" },
  4: { label:"Thriving", color:"#276749", bg:"#e6ffed", text:"#1a4731" },
};

const daysBetween = (a, b) => {
  // Parse as local noon to avoid any DST or UTC-offset edge cases
  const parse = s => { const d = new Date(String(s).slice(0,10) + "T12:00:00"); return d; };
  return Math.round((parse(b) - parse(a)) / 864e5);
};

function plantAgeDecimal(d) {
  const days = daysBetween(d, fmt(getToday()));
  if (days < 30) return `${days}d`;
  return `${(days/365).toFixed(1)}y`;
}
function plantAgeLabel(d) {
  const days = daysBetween(d, fmt(getToday()));
  const y = Math.floor(days/365), m = Math.floor((days%365)/30);
  if (y>0&&m>0) return `${y}y ${m}m`;
  if (y>0) return `${y}y`;
  if (m>0) return `${m}m`;
  return `${days}d`;
}
function potAge(d)       { return plantAgeLabel(d); }
function repotEveryLabel(p){
  const total = (p.potYears||0) + (p.potMonths||0)/12;
  if(!total) return "—";
  return total===Math.floor(total) ? total+"y" : total.toFixed(1)+"y";
}
function isPotDue(p,now) { const pd=daysBetween(p.pottedDate,fmt(now||getToday())),dd=(p.potYears*365)+(p.potMonths*30); return dd>0&&pd>=dd; }
function potOverdueDays(p,now){ const pd=daysBetween(p.pottedDate,fmt(now||getToday())),dd=(p.potYears*365)+(p.potMonths*30); return dd===0?0:Math.max(0,pd-dd); }
function isWaterDue(p,now)   { return daysBetween(p.lastWatered,fmt(now||getToday()))>=p.waterFreqDays; }
function isTomorrow(p,now)   { return daysBetween(p.lastWatered,fmt(now||getToday()))+1>=p.waterFreqDays; }
function waterFreqColor(d){
  if(d<=2)  return "#f0fdf4"; // near white-green
  if(d<=4)  return "#dcfce7"; // very pale mint
  if(d<=6)  return "#bbf7d0"; // light mint
  if(d<=8)  return "#86efac"; // soft green
  if(d<=10) return "#4ade80"; // bright light green
  if(d<=12) return "#22c55e"; // medium green
  if(d<=14) return "#16a34a"; // clear green
  if(d<=17) return "#15803d"; // medium forest
  if(d<=20) return "#166534"; // deep forest
  if(d<=23) return "#155f2e"; // slightly deeper
  if(d<=26) return "#145a29"; // a step darker
  if(d<=30) return "#135425"; // another step
  if(d<=35) return "#124e21"; // noticeable but not extreme
  if(d<=42) return "#104819"; // getting dark
  if(d<=50) return "#092d15"; // darker
  if(d<=60) return "#072412"; // deep
  if(d<=75) return "#051c0e"; // very deep
  if(d<=90) return "#03140a"; // near-black green
  return "#020d07";            // absolute darkest — almost never used
}
function freqTextColor(d){
  if(d<=10) return "#14532d";
  return "white";
}
function formatMD(s)     { if(!s)return"—"; const d=new Date(s+"T00:00:00"); return `${d.getMonth()+1}/${d.getDate()}`; }
function uid()           { return Math.random().toString(36).slice(2,10); }
// Display a YYYY-MM-DD string as M/D/YY (no leading zeros)
function fmtDisplay(s){ if(!s)return""; const d=new Date(s+"T00:00:00"); return `${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`; }
// Parse M/D/YY or M/D/YYYY back to YYYY-MM-DD
function parseDateInput(s){
  const clean=s.trim().replace(/[^0-9/]/g,"");
  const parts=clean.split("/");
  if(parts.length<2)return"";
  const m=parseInt(parts[0]),d=parseInt(parts[1]),y=parts[2]?parseInt(parts[2]):new Date().getFullYear();
  if(!m||!d)return"";
  const yr=y<100?(y>=50?1900+y:2000+y):y;
  return `${yr}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}
function getPrimaryPhoto(plant) {
  if (!plant.photos||!plant.photos.length) return null;
  if (plant.primaryPhoto!=null && plant.photos[plant.primaryPhoto]) return plant.photos[plant.primaryPhoto];
  return plant.photos[0];
}

// Room color palette — covers full spectrum + neutrals
const ROOM_COLORS = [
  null,        // no color
  "#fc8181",   // red light
  "#e53e3e",   // red
  "#f6ad55",   // orange light
  "#dd6b20",   // orange
  "#faf089",   // yellow light
  "#d69e2e",   // yellow
  "#68d391",   // green light
  "#38a169",   // green
  "#63b3ed",   // blue light
  "#2b6cb0",   // blue
  "#b794f4",   // violet light
  "#6b46c1",   // violet
  "#f687b3",   // pink light
  "#d53f8c",   // pink
  "#4fd1c5",   // teal light
  "#319795",   // teal
  "#a0aec0",   // slate light
  "#718096",   // slate
  "#a0785a",   // brown light
  "#5c4033",   // brown
];

// Returns white or dark text depending on background luminance
function roomTextColor(hex) {
  if (!hex) return "var(--bark)";
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  return lum > 0.55 ? "#1e1410" : "#ffffff";
}

function RoomHeader({ room, count, style, collapsed, onToggle }) {
  const color = room.color || null;
  const chevron = onToggle ? (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{marginLeft:4,flexShrink:0,transition:"transform .2s",transform:collapsed?"rotate(-90deg)":"rotate(0deg)",opacity:.7}}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ) : null;
  if (color) {
    const textColor = roomTextColor(color);
    return (
      <div className="room-header colored" style={{background:color,color:textColor,...(onToggle?{cursor:"pointer"}:{}),...(style||{})}} onClick={onToggle}>
        <h3>{room.name}</h3>
        {chevron}
        <span className="room-count" style={{marginLeft:"auto"}}>{count}</span>
      </div>
    );
  }
  return (
    <div className="room-header" style={{...(onToggle?{cursor:"pointer"}:{}),...(style||{})}} onClick={onToggle}>
      <h3>{room.name}</h3>
      {chevron}
      <span className="room-count">{count}</span>
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  :root{
    --cream:#e8e2d8; --bark:#5c4033; --bark-light:#8d6e63;
    --leaf:#2d6a4f;  --leaf-light:#52b788; --leaf-pale:#d8f3dc;
    --soil:#2e2018;  --sand:#e8dcc8;
    --teal:#1b4d3e;  --brown:#6b4226;
    --text:#1e1410;  --text-muted:#7a6055;
    --shadow:0 1px 5px rgba(60,30,10,.09);
    --radius:11px;
    --card-bg:white; --page-bg:#e8e2d8; --input-bg:white; --border:#ddd5c4; --border-strong:#a89880;
  }
  .dark{
    --cream:#18181b; --sand:#56555e; --text:#e8e6e1; --text-muted:#9a9090;
    --shadow:0 1px 5px rgba(0,0,0,.35); --card-bg:#38383f; --page-bg:#18181b;
    --input-bg:#3a3a3f; --border:#4a4a52; --leaf-pale:#1a3528;
  }
  .dark .plant-name{color:var(--text);}
  .dark .plant-sub{color:var(--text-muted)!important;}
  .dark .room-list-name{color:var(--text);}
  .dark .room-list-count{color:var(--text-muted);}
  .dark .room-header h3{color:var(--text-muted);}
  .dark .icon-btn{color:var(--text);opacity:.7;}
  .dark .dash-card .big-num{color:var(--leaf-light);}
  .dark .btn-secondary{background:var(--input-bg);color:var(--text);border:1.5px solid var(--border);}
  .dark .tab-bar{background:var(--card-bg);}
  .dark .check-btn{border-color:var(--leaf-light);color:var(--leaf-light);}
  .dark .freq-inc-btn{border-color:var(--leaf-light);color:var(--leaf-light);}
  .dark .freq-inc-btn:hover{background:var(--leaf-light);color:var(--soil);}
  .dark .check-btn:hover{background:var(--leaf-light);color:var(--soil);border-color:var(--leaf-light);}
  .dark .nav{background:var(--card-bg);border-top:1px solid rgba(255,255,255,.1);}
  .dark .edit-icon-btn{opacity:.7;color:var(--text);}
  .dark .dash-card .lbl{color:var(--text);}
  .dark .dash-card .big-num{color:var(--leaf-light);}
  .dark .pct-bar-fill + * , .dark .health-card-sub{color:var(--text);}
  .dark .tab-btn{color:var(--text);}
  .dark .plant-sub{color:var(--text-muted);}
  .dark .check-btn.brown{border-color:var(--leaf-light);color:var(--leaf-light);}
  .dark .check-btn.brown:hover{background:var(--leaf-light);color:var(--soil);border-color:var(--leaf-light);}
  .dark .repot-card .plant-sub{color:var(--text)!important;}
  .dark .repot-arrow{color:var(--text-muted)!important;}
  .dark .repot-next-pot{color:var(--leaf-light)!important;}
  .dark .good-health-lbl{color:var(--text)!important;}
  .dark .good-health-pct{color:var(--leaf-light)!important;}
  .dark .section-hdr-water{color:#4dd0e1!important;}
  .dark .section-hdr-pot{color:#d4956a!important;}
  .dark .section-hdr-photos{color:var(--text)!important;}
  .dark .form-section-label{color:var(--text-muted);}
  .dark .detail-body .info-val{color:var(--leaf-light);}
  .dark .tile-lbl{color:var(--text)!important;}
  .dark .info-val{color:var(--leaf-light)!important;}
  .dark .next-water-soon{background:#1e3a5f!important;}
  .dark .next-water-soon .tile-lbl{color:#90cdf4!important;}
  .dark .next-water-soon .info-val-next{color:#bee3f8!important;}
  .dark .info-val-next{color:var(--leaf-light)!important;}
  .dark .pot-sub-lbl{color:var(--text)!important;}
  .dark .color-swatch-none{background:var(--input-bg);}
  .dark{--watering-bg:rgba(14,116,144,.18);--watering-border:rgba(14,116,144,.4);--potting-bg:rgba(161,100,60,.2);--potting-border:rgba(161,100,60,.4);}
  .app{--watering-bg:rgba(14,116,144,.1);--watering-border:rgba(14,116,144,.35);--potting-bg:rgba(193,96,58,.1);--potting-border:rgba(193,96,58,.35);}
  .dark .form-section-label{opacity:1;}
  body{font-family:'DM Sans',sans-serif;background:var(--cream);color:var(--text);transition:background .3s,color .3s;}
  .app{max-width:480px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column;background:var(--cream);}

  /* Nav */
  .nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:#141414;display:flex;z-index:100;border-radius:16px 16px 0 0;}
  .nav-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 0 8px;color:#e8e6e1;cursor:pointer;border:none;background:none;font-family:'DM Sans',sans-serif;font-size:11px;letter-spacing:.5px;text-transform:uppercase;font-weight:600;transition:color .2s;position:relative;}
  .nav-btn.active{color:var(--leaf-light);}
  .nav-btn svg{width:22px;height:22px;}
  .nav-badge{position:absolute;top:6px;right:calc(50% - 17px);background:#e53e3e;color:white;border-radius:50%;width:14px;height:14px;font-size:8px;display:flex;align-items:center;justify-content:center;font-weight:700;}

  /* Header */
  .page-header{padding:40px 14px 10px;color:white;}
  .page-header.green{background:#2d6a4f;}
  .page-header.teal{background:#0e7490;}
  .page-header.brown{background:#c1603a;}
  .dark .page-header.teal{background:#0a4a57;}
  .dark .page-header.brown{background:#8b3e22;}
  .page-header h1{font-size:32px;font-weight:700;letter-spacing:-.3px;line-height:1.1;}
  .page-header p{font-size:13px;opacity:.72;margin-top:3px;}

  /* Dashboard */
  .dashboard{padding:9px 12px 5px;}
  .dash-row{display:flex;gap:7px;margin-bottom:7px;}
  .dash-card{background:var(--card-bg);border-radius:var(--radius);padding:9px 11px;box-shadow:var(--shadow);cursor:pointer;outline:2px solid transparent;outline-offset:-1px;transition:outline-color .15s;}
  .dash-card.selected{outline-color:var(--leaf);}
  .dash-card .big-num{font-size:30px;font-weight:700;color:var(--leaf);line-height:1;text-align:center;}
  .dash-card .lbl{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-top:2px;font-weight:600;text-align:center;}
  .health-pills{display:flex;gap:5px;flex:1;}
  .health-pill{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:7px 3px;border-radius:8px;cursor:pointer;outline:2px solid transparent;outline-offset:-1px;transition:outline-color .15s;}
  .dark .dash-card.selected{outline-width:3px;}
  .dark .health-pill.selected{outline-width:3px;}
  .health-pill .num{font-size:30px;font-weight:700;line-height:1;}
  .health-pill .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.3px;margin-top:2px;font-weight:700;}
  .pct-bar{height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-top:6px;}
  .pct-bar-fill{height:100%;background:linear-gradient(90deg,var(--leaf-light),var(--leaf));border-radius:3px;transition:width .6s;}
  .dark .pct-bar-fill{background:linear-gradient(90deg,#68d391,var(--leaf-light));}

  /* Tab bar */
  .tab-bar{display:flex;background:white;border-radius:9px;padding:3px;margin:7px 12px 5px;box-shadow:var(--shadow);}
  .tab-btn{flex:1;padding:8px;border:none;background:none;border-radius:7px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:15px;font-weight:700;color:var(--text-muted);transition:all .18s;}
  .tab-btn.active{background:var(--leaf);color:white;}

  /* Plant list */
  .section{padding:0 10px 85px;}
  .room-group{margin-bottom:12px;}
  .room-header{display:flex;align-items:center;gap:5px;margin-bottom:5px;padding:3px 1px;border-bottom:1px solid var(--border);}
  .room-header h3{font-size:13px;font-weight:700;color:var(--bark);text-transform:uppercase;letter-spacing:.7px;}
  .room-count{font-size:12px;color:var(--text-muted);margin-left:auto;font-weight:700;}
  .room-header.colored{padding:2px 8px;border-radius:5px;border-bottom:none;margin-bottom:5px;}
  .room-header.colored h3{color:inherit;}
  .room-header.colored .room-count{color:inherit;opacity:.85;}

  /* Compact plant card */
  .plant-card{background:var(--card-bg);border-radius:9px;padding:7px 8px;margin-bottom:4px;box-shadow:var(--shadow);cursor:pointer;display:flex;align-items:center;gap:7px;transition:box-shadow .15s;}
  .plant-card:hover{box-shadow:0 3px 12px rgba(60,30,10,.13);}
  .plant-thumb{width:42px;height:42px;border-radius:8px;flex-shrink:0;background:var(--leaf-pale);display:flex;align-items:center;justify-content:center;font-size:19px;overflow:hidden;}
  .plant-thumb img{width:100%;height:100%;object-fit:cover;}
  .plant-name-col{flex:1;min-width:0;}
  .plant-name{font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .plant-sub{font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;}

  /* Stat tiles */
  .stat-tiles{display:flex;gap:4px;align-items:stretch;flex-shrink:0;}
  .health-bar-tile{width:5px;border-radius:3px;align-self:stretch;flex-shrink:0;}
  .stat-tile{display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:7px;width:50px;padding:6px 2px;background:var(--page-bg);}
  .stat-tile .st-lbl{font-size:9.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.2px;line-height:1;margin-bottom:3px;font-weight:600;}
  .stat-tile .st-val{font-size:15px;font-weight:700;line-height:1;color:var(--text);}
  .edit-icon-btn{background:none;border:none;cursor:pointer;font-size:16px;opacity:.45;padding:3px 4px;transition:opacity .2s;flex-shrink:0;}
  .edit-icon-btn:hover{opacity:.85;}

  /* Check button (water/repot) */
  .check-btn{width:34px;height:34px;border-radius:50%;border:2px solid #1b4d3e;background:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#1b4d3e;transition:all .18s;}
  .check-btn:hover{background:#1b4d3e;color:white;border-color:#1b4d3e;}
  .check-btn.brown{border-color:#c1603a;color:#c1603a;}
  .check-btn.brown:hover{background:#c1603a;color:white;border-color:#c1603a;}

  /* Freq increase button */
  .freq-inc-btn{width:34px;height:34px;border-radius:50%;border:2px solid #1b4d3e;background:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#1b4d3e;transition:all .18s;font-size:15px;font-weight:700;font-family:'DM Sans',sans-serif;}
  .freq-inc-btn:hover{background:#1b4d3e;color:white;}
  .freq-tooltip-wrap{position:relative;flex-shrink:0;}
  .freq-tooltip{position:absolute;bottom:calc(100% + 8px);right:0;background:var(--soil);border-radius:10px;padding:10px 12px;box-shadow:0 4px 16px rgba(0,0,0,.3);z-index:50;min-width:240px;}
  .dark .freq-tooltip{background:#3a3a3f;}
  .dark .freq-tooltip::after{background:#3a3a3f;}
  .freq-tooltip::after{content:'';position:absolute;bottom:-5px;right:10px;width:10px;height:10px;background:var(--soil);transform:rotate(45deg);border-radius:1px;}
  .freq-tooltip-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:white;margin-bottom:8px;}
  .freq-tooltip .check-btn{border-color:white!important;color:white!important;border-width:2.5px!important;}
  .freq-tooltip .check-btn:hover{background:rgba(255,255,255,.2)!important;border-color:white!important;}
  .freq-tooltip-row{display:flex;align-items:center;gap:7px;}
  .freq-opt{background:rgba(255,255,255,.12);border:none;color:white;border-radius:6px;padding:7px 12px;font-size:14px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;transition:background .15s;white-space:nowrap;}
  .freq-opt:hover,.freq-opt.active{background:var(--leaf-light);color:var(--soil);}
  .freq-custom{width:52px;padding:7px 6px;border-radius:6px;border:none;background:rgba(255,255,255,.12);color:white;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:700;text-align:center;}
  .freq-custom::placeholder{color:rgba(255,255,255,.35);}
  .freq-custom:focus{outline:none;background:rgba(255,255,255,.22);}

  /* Water cards */
  .water-card{background:var(--card-bg);border-radius:9px;padding:7px 8px;margin-bottom:4px;box-shadow:var(--shadow);display:flex;align-items:center;gap:7px;transition:opacity .3s,transform .3s;}
  .water-card.leaving{opacity:0;transform:translateX(60px) scale(.95);}
  .all-done{text-align:center;padding:30px 20px 16px;}
  .all-done .emoji{font-size:52px;display:block;margin-bottom:10px;}
  .all-done h2{font-size:20px;font-weight:700;color:var(--leaf);margin-bottom:5px;}
  .all-done p{font-size:12px;color:var(--text-muted);}
  .dark .upnext-lbl{color:var(--leaf-light)!important;}
  .tomorrow-section{margin-top:18px;text-align:left;}
  .tomorrow-section h3{font-size:11px;font-weight:700;color:var(--bark);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px;}

  /* Repot cards */
  .repot-card{background:var(--card-bg);border-radius:9px;padding:7px 8px;margin-bottom:4px;box-shadow:var(--shadow);display:flex;align-items:center;gap:7px;transition:opacity .3s,transform .3s;}
  .repot-card.leaving{opacity:0;transform:translateX(60px) scale(.95);}
  .pot-badge{background:var(--sand);padding:2px 7px;border-radius:20px;font-weight:700;font-size:11px;}
  .pot-badge.next{background:var(--leaf-pale);color:var(--leaf);}

  /* Modal */
  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.48);z-index:200;display:flex;align-items:flex-end;justify-content:center;}
  .modal{background:var(--page-bg);border-radius:18px 18px 0 0;width:100%;max-width:480px;max-height:88vh;overflow-y:auto;padding:12px 12px 20px;}
  .modal h2{font-size:20px;font-weight:700;margin-bottom:8px;color:var(--leaf);}
  .dark .modal h2{color:var(--leaf-light);}
  .form-group{margin-bottom:6px;}
  .form-group>label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:3px;font-weight:700;}
  .dark .form-group>label{color:var(--text);}
  .form-group input,.form-group select{width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;font-family:'DM Sans',sans-serif;font-size:15px;background:var(--input-bg);color:var(--text);font-weight:600;}
  .form-group input:focus,.form-group select:focus{outline:none;border-color:var(--leaf-light);}
  /* Input with suffix: input shrinks to content width, suffix sits right next to value */
  .input-suffix-wrap{display:flex;align-items:center;justify-content:center;background:var(--input-bg);border:1.5px solid var(--border);border-radius:7px;overflow:hidden;text-align:center;}
  .input-suffix-wrap:focus-within{border-color:var(--leaf-light);}
  .input-suffix-wrap input{border:none!important;outline:none!important;background:transparent;padding:8px 0 8px 4px;font-family:'DM Sans',sans-serif;font-size:15px;font-weight:600;color:var(--text);width:4ch;min-width:2ch;max-width:5ch;text-align:center;flex-shrink:0;}
  .input-suffix-wrap input::-webkit-outer-spin-button,
  .input-suffix-wrap input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}
  .input-suffix-wrap input[type=number]{-moz-appearance:textfield;}
  .input-suffix{font-size:15px;font-weight:700;color:var(--text-muted);padding:8px 4px 8px 0;flex-shrink:0;}
  .dark .input-suffix{color:var(--text);}
  .form-row{display:grid;grid-template-columns:1fr 1fr;gap:7px;}
  .form-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;}
  .form-section{border-radius:9px;padding:8px 10px;margin-bottom:6px;}
  .form-section-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;opacity:.85;}
  .health-selector{display:flex;gap:4px;}
  .health-opt{flex:1;padding:7px 2px;border-radius:6px;border:2px solid transparent;cursor:pointer;text-align:center;font-size:12px;font-weight:700;transition:all .15s;}
  .health-opt.selected{border-width:2px;}
  .modal-actions{display:flex;gap:7px;margin-top:10px;}
  .btn{padding:11px 14px;border-radius:9px;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:15px;font-weight:700;transition:all .15s;}
  .btn-primary{background:var(--leaf);color:white;flex:1;}
  .btn-primary:hover{background:#245c43;}
  .btn-secondary{background:var(--sand);color:var(--text);}
  .app:not(.dark) .btn-secondary{background:#cec5b5;}
  .btn-danger{background:#fed7d7;color:#c53030;}
  .app:not(.dark) .btn-danger{background:#f5b8b8;}



  /* Detail */
  .detail-modal{background:var(--cream);border-radius:18px 18px 0 0;width:100%;max-width:480px;max-height:92vh;overflow-y:auto;display:flex;flex-direction:column;}
  .detail-header{padding:18px 14px 14px;color:white;position:relative;border-radius:18px 18px 0 0;flex-shrink:0;}
  .detail-back{position:absolute;top:12px;left:12px;background:rgba(255,255,255,.22);border:none;border-radius:50%;width:28px;height:28px;color:white;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;}
  .close-x-btn{position:absolute;top:8px;left:8px;background:rgba(255,255,255,.22);border:none;border-radius:50%;width:34px;height:34px;color:white;cursor:pointer;padding:0;}
  .close-x-btn::before{content:"✕";display:block;width:100%;height:100%;line-height:34px;text-align:center;font-size:16px;pointer-events:none;}
  .detail-edit{position:absolute;top:12px;right:12px;background:rgba(255,255,255,.22);border:none;border-radius:20px;padding:4px 11px;color:white;cursor:pointer;font-size:11px;font-family:'DM Sans',sans-serif;font-weight:700;}
  .detail-body{padding:12px 12px 28px;}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px;}
  .info-card{background:var(--card-bg);border-radius:9px;padding:9px 11px;box-shadow:var(--shadow);}
  .info-card .val{font-size:17px;font-weight:700;color:var(--leaf);}
  .info-card .key{font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-top:1px;font-weight:500;}

  /* Photo lightbox */
  .lightbox{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:300;display:flex;flex-direction:column;align-items:center;justify-content:center;}
  .lightbox img{max-width:95vw;max-height:78vh;object-fit:contain;border-radius:10px;user-select:none;}
  .lightbox-close{position:absolute;top:16px;right:16px;background:rgba(255,255,255,.15);border:none;color:white;border-radius:50%;width:34px;height:34px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
  .lightbox-arrow{position:absolute;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.15);border:none;color:white;border-radius:50%;width:38px;height:38px;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
  .lightbox-arrow.left{left:10px;}
  .lightbox-arrow.right{right:10px;}
  .lightbox-dots{display:flex;gap:6px;margin-top:16px;}
  .lightbox-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.35);transition:background .2s;}
  .lightbox-dot.active{background:white;}

  /* Photo grid */
  .photo-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px;position:relative;user-select:none;}
  .photo-thumb-wrap{position:relative;width:88px;height:88px;cursor:grab;touch-action:none;border-radius:8px;transition:transform .2s cubic-bezier(.25,.46,.45,.94),opacity .2s,box-shadow .2s;}
  .photo-thumb-wrap.dragging{opacity:.35;transform:scale(.95);}
  .photo-thumb-wrap.drag-over{transform:scale(1.04);}
  .photo-thumb{width:88px;height:88px;object-fit:cover;border-radius:8px;display:block;pointer-events:none;}
  .photo-ghost{position:fixed;pointer-events:none;z-index:9999;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.4);opacity:.92;transform:scale(1.08);transition:none;}
  .photo-primary-star{position:absolute;top:0;left:2px;font-size:15px;line-height:1;filter:drop-shadow(0 1px 3px rgba(0,0,0,.7));pointer-events:none;color:white;}
  .photo-menu-btn{position:absolute;top:2px;right:2px;background:rgba(0,0,0,.45);border:none;color:white;border-radius:50%;width:17px;height:17px;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;}
  .photo-menu{position:absolute;top:20px;right:2px;background:#2e2018;border-radius:8px;box-shadow:0 3px 12px rgba(0,0,0,.35);z-index:20;display:flex;flex-direction:row;gap:0;overflow:hidden;}
  .photo-menu-action{background:none;border:none;cursor:pointer;padding:7px 10px;display:flex;align-items:center;justify-content:center;transition:background .15s;}
  .photo-menu-action:hover{background:rgba(255,255,255,.12);}
  .photo-add{width:88px;height:88px;border:2px dashed var(--sand);border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-muted);font-size:20px;}
  .photo-add:hover{border-color:var(--leaf-light);color:var(--leaf);}

  /* Manage Rooms */
  .room-list-item{background:var(--card-bg);border-radius:var(--radius);padding:10px 13px;margin-bottom:6px;display:flex;align-items:center;gap:9px;box-shadow:var(--shadow);}
  .room-color-swatch{width:14px;height:14px;border-radius:50%;border:1.5px solid rgba(0,0,0,.15);flex-shrink:0;}
  .color-picker-row{display:flex;flex-wrap:wrap;gap:7px;margin-top:4px;}
  .color-swatch-btn{width:26px;height:26px;border-radius:50%;border:2.5px solid transparent;cursor:pointer;transition:transform .1s,border-color .1s;flex-shrink:0;}
  .color-swatch-btn:hover{transform:scale(1.15);}
  .color-swatch-btn.selected{border-color:var(--soil);}
  .color-swatch-none{background:white;border:2px dashed #aaa;position:relative;}
  .color-swatch-none::after{content:"✕";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:#aaa;}
  .room-actions{margin-left:auto;display:flex;gap:3px;}
  .icon-btn{background:none;border:none;cursor:pointer;font-size:18px;padding:5px;opacity:.5;transition:opacity .2s;}
  .icon-btn:hover{opacity:1;}
  .checkbox-label{display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13px;}
  .checkbox-label input[type=checkbox]{width:14px;height:14px;accent-color:var(--leaf);}

  /* drag-over highlight */
  .drag-over{outline:2px dashed var(--leaf-light);}

  .empty{text-align:center;padding:44px 20px;color:var(--text-muted);}
  .empty .ico{font-size:40px;display:block;margin-bottom:10px;}
  .empty p{font-size:13px;}
  /* Dark mode toggle */
  .toggle-switch{position:relative;width:44px;height:24px;flex-shrink:0;}
  .toggle-switch input{opacity:0;width:0;height:0;position:absolute;}
  .toggle-track{position:absolute;inset:0;background:#ccc;border-radius:12px;cursor:pointer;transition:background .3s;}
  .toggle-switch input:checked+.toggle-track{background:var(--leaf);}
  .toggle-thumb{position:absolute;top:3px;left:3px;width:18px;height:18px;background:white;border-radius:50%;transition:transform .3s;pointer-events:none;}
  .toggle-switch input:checked~.toggle-track .toggle-thumb{transform:translateX(20px);}
  /* Notes */
  .notes-section{background:var(--card-bg);border-radius:10px;padding:12px;box-shadow:var(--shadow);}
  .notes-section-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--bark);margin-bottom:7px;}
  .dark .notes-section-label{color:var(--text);}
  .notes-preview{font-size:13px;color:var(--text);line-height:1.45;white-space:pre-wrap;word-break:break-word;}
  .dark .notes-preview{color:var(--text);}
  .notes-empty{font-size:12px;color:var(--text-muted);cursor:pointer;}
  .notes-add-btn{background:none;border:1.5px dashed var(--border-strong,#b0a898);border-radius:7px;padding:7px 12px;width:100%;text-align:left;color:var(--text-muted);font-family:'DM Sans',sans-serif;font-size:13px;cursor:pointer;}
  .notes-add-btn:hover{border-color:var(--leaf-light);color:var(--leaf);}
  .notes-editor{background:var(--input-bg);border:1.5px solid var(--border);border-radius:8px;padding:8px 10px;font-family:'DM Sans',sans-serif;font-size:13px;color:var(--text);width:100%;min-height:72px;resize:vertical;line-height:1.45;}
  .notes-editor:focus{outline:none;border-color:var(--leaf-light);}
  .notes-editor-actions{display:flex;gap:7px;margin-top:7px;justify-content:flex-end;}
  /* Utilities screen */
  .util-section{background:var(--card-bg);border-radius:var(--radius);padding:14px;box-shadow:var(--shadow);margin-bottom:12px;}
  .util-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);}
  .util-row:last-child{border-bottom:none;padding-bottom:0;}
  .util-row:first-child{padding-top:0;}
  .util-label{font-size:15px;font-weight:700;color:var(--text);}
  .util-sublabel{font-size:13px;color:var(--text-muted);margin-top:2px;}
  .util-btn{background:var(--leaf);color:white;border:none;border-radius:8px;padding:9px 16px;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:700;cursor:pointer;}
  .util-btn.secondary{background:var(--page-bg);color:var(--text);border:1.5px solid var(--border);}

`;

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen,  setScreen]  = useState("home");
  const [rooms,   setRooms]   = useState(null);
  const [plants,  setPlants]  = useState(null);
  const [loaded,  setLoaded]  = useState(false);
  const [todayDate, setTodayDate] = useState(fmt(getToday()));
  const [showImport, setShowImport] = useState(false);
  const [importTab,  setImportTab]  = useState("xls");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [xlsPreview, setXlsPreview] = useState(null);
  const [xlsLoading, setXlsLoading] = useState(false);
  const [xlsxReady,  setXlsxReady]  = useState(!!window.XLSX);
  const [darkMode,   setDarkMode]   = useState(false);
  const importRef = useRef();
  const xlsRef    = useRef();

  // Auto-refresh at midnight so due dates always reflect the real current day
  useEffect(() => {
    const tick = () => {
      const now = fmt(getToday());
      setTodayDate(prev => prev !== now ? now : prev);
    };
    const id = setInterval(tick, 60_000); // check every minute
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (window.XLSX) { setXlsxReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => setXlsxReady(true);
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await loadData("pt_rooms");
        const p = await loadData("pt_plants");
        const dm = await loadData("pt_darkmode");
        const photoMap = await loadAllPhotos();
        const rooms = r || SEED_ROOMS;
        // Merge photos back into plants from IndexedDB
        const plants = (p || SEED_PLANTS).map(plant => {
          const stored = photoMap[plant.id];
          return stored ? {...plant, photos: stored.photos, primaryPhoto: stored.primaryPhoto} : plant;
        });
        setRooms(rooms);
        setPlants(plants);
        if (dm !== null) setDarkMode(dm);
      } catch (e) {
        console.error("Load error:", e);
        setRooms(SEED_ROOMS);
        setPlants(SEED_PLANTS);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const saveReady = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    if (!saveReady.current) { saveReady.current = true; return; }
    if (rooms) saveData("pt_rooms", rooms);
  }, [rooms, loaded]);
  useEffect(() => {
    if (!loaded) return;
    if (!saveReady.current) return;
    if (!plants) return;
    // Save photos to IndexedDB, strip from localStorage entry
    plants.forEach(p => {
      if (p.photos && p.photos.length > 0) savePhotos(p.id, p.photos, p.primaryPhoto);
    });
    const stripped = plants.map(p => ({...p, photos: [], primaryPhoto: null}));
    saveData("pt_plants", stripped);
  }, [plants, loaded]);
  useEffect(() => {
    if (!loaded) return;
    saveData("pt_darkmode", darkMode);
  }, [darkMode, loaded]);

  function exportData() {
    const payload = JSON.stringify({ rooms, plants }, null, 2);
    const b64 = btoa(unescape(encodeURIComponent(payload)));
    const a = document.createElement("a");
    a.href = "data:application/json;base64," + b64;
    a.download = `plantalog-backup-${fmt(getToday())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function importData() {
    try {
      const data = JSON.parse(importText);
      if (!Array.isArray(data.rooms) || !Array.isArray(data.plants)) throw new Error();
      // Save photos to IndexedDB, then store plants without photos in localStorage
      data.plants.forEach(p => {
        if (p.photos && p.photos.length > 0) savePhotos(p.id, p.photos, p.primaryPhoto);
      });
      setRooms(data.rooms);
      setPlants(data.plants);
      closeImport();
    } catch { setImportError("Invalid backup file. Please paste the full contents of a Plantalog backup JSON."); }
  }

  function closeImport() {
    setShowImport(false); setImportTab("xls"); setImportText(""); setImportError("");
    setXlsPreview(null); setXlsLoading(false);
  }

  function downloadTemplate() {
    const b64 = "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";
    const a = document.createElement("a");
    a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + b64;
    a.download = "plantalog_import_template.xlsx";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function parseDate(val) {
    if (!val) return fmt(getToday());
    if (typeof val === "number") {
      // Excel serial date
      const d = new Date((val - 25569) * 86400 * 1000);
      return fmt(d);
    }
    const s = String(val).trim();
    const d = new Date(s);
    return isNaN(d) ? fmt(getToday()) : fmt(d);
  }

  function handleXlsFile(e) {
    const file = e.target.files[0]; if (!file) return;
    const XLSX = window.XLSX;
    if (!XLSX) { setImportError("Spreadsheet library not loaded yet."); return; }
    setXlsLoading(true); setXlsPreview(null); setImportError("");
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb   = XLSX.read(ev.target.result, { type: "array", cellDates: false });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

        // Find header row: the row where col A is exactly "Plant Name"
        let headerRow = -1;
        for (let i = 0; i < Math.min(rows.length, 6); i++) {
          if (String(rows[i][0]).trim().toLowerCase() === "plant name") { headerRow = i; break; }
        }
        if (headerRow < 0) throw new Error("Could not find header row. Make sure column A header is 'Plant Name'.");

        // Template structure: row after headers is hints/descriptions — skip it too
        // Data starts at headerRow + 2
        // Read rooms sheet — but primary mapping is always from app's own rooms by order
        const roomMap = {}; // order → room id
        rooms.forEach(r => { roomMap[r.order] = r.id; });
        // Do NOT override with sheet name-matching — it can produce wrong mappings

        const warnings = [];
        const newPlants = [];

        // headerRow=1 (0-indexed): row 0=section labels, row 1=col headers, row 2=hints → data starts at headerRow+2
        // But template has: row 0=section labels, row 1=headers, row 2=hints → skip 2 rows after header row
        rows.slice(headerRow + 2).forEach((row, i) => {
          const name = String(row[0]||"").trim();
          if (!name) return; // skip empty rows

          const roomNum  = Number(row[1]) || 1;
          const roomId   = roomMap[roomNum] || rooms[0]?.id || "r1";
          if (!roomMap[roomNum]) warnings.push(`Row ${headerRow+3+i}: Room # ${roomNum} not found — assigned to first room.`);

          const health   = Math.min(4, Math.max(1, Number(row[2])||3));
          const origPot  = String(row[7]||"").toLowerCase().trim() === "x";
          const keepYrs  = Math.max(0, Number(row[8])||0);
          const keepMo   = Math.min(11, Math.max(0, Number(row[9])||0));
          const potSize  = Math.max(1, Number(row[10])||6);
          const nextPot  = Math.max(1, Number(row[11])||potSize+2);

          newPlants.push({
            id: uid(), roomId, name, health,
            obtainedDate: parseDate(row[3]),
            waterFreqDays: Math.max(1, Number(row[4])||7),
            lastWatered:   parseDate(row[5]),
            pottedDate:    parseDate(row[6]),
            originalPot: origPot,
            potYears: keepYrs, potMonths: keepMo,
            currentPotSize: potSize, nextPotSize: nextPot,
            photos: [], primaryPhoto: null,
          });
        });

        if (!newPlants.length) throw new Error("No plant rows found. Make sure rows start below the header and hint rows.");
        setXlsPreview({ plants: newPlants, warnings });
        setXlsLoading(false);
      } catch(err) {
        setImportError(err.message || "Could not read file. Please use the Plantalog template.");
        setXlsLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  function confirmXlsImport(mode) {
    // mode: "add" = append, "replace" = replace all plants
    if (mode === "replace") setPlants(xlsPreview.plants);
    else setPlants(ps => [...ps, ...xlsPreview.plants]);
    closeImport();
  }

  if (!loaded) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:"'DM Sans',sans-serif",color:"#2d6a4f",fontSize:18}}>
      🌱 Loading…
    </div>
  );

  return (
    <>
      <style>{styles}</style>
      <div className={`app${darkMode?" dark":""}`}>
        {screen==="home"  && <HomeScreen  rooms={rooms} setRooms={setRooms} plants={plants} setPlants={setPlants} todayDate={todayDate} />}
        {screen==="water" && <WaterScreen rooms={rooms} plants={plants} setPlants={setPlants} todayDate={todayDate} />}
        {screen==="repot" && <RepotScreen rooms={rooms} plants={plants} setPlants={setPlants} todayDate={todayDate} />}
        {screen==="utils" && <UtilitiesScreen darkMode={darkMode} setDarkMode={setDarkMode} onExport={exportData} onImport={()=>setShowImport(true)} />}
        <Nav screen={screen} setScreen={setScreen} plants={plants} todayDate={todayDate} />
      </div>

      {/* Import modal */}
      {showImport && (
        <div className="modal-overlay" onClick={closeImport}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{paddingBottom:30}}>
            <h2>Import Plants</h2>

            {/* Tabs */}
            <div style={{display:"flex",gap:0,marginBottom:14,background:"var(--sand)",borderRadius:8,padding:3}}>
              {[["xls","📊  Excel Template"],["json","💾  JSON Backup"]].map(([id,label])=>(
                <button key={id} onClick={()=>{setImportTab(id);setImportError("");setXlsPreview(null);}}
                  style={{flex:1,padding:"6px 4px",border:"none",borderRadius:6,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:700,
                    background:importTab===id?"white":"transparent",color:importTab===id?"var(--leaf)":"var(--text-muted)",
                    boxShadow:importTab===id?"0 1px 4px rgba(0,0,0,.1)":"none",transition:"all .15s"}}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── Excel tab ── */}
            {importTab==="xls" && !xlsPreview && (
              <>
                <p style={{fontSize:12,color:"var(--text-muted)",marginBottom:12,lineHeight:1.5}}>
                  Download the template, fill it in with your plants, then upload it here. Your existing rooms will be pre-filled on the Rooms tab.
                </p>
                <button onClick={downloadTemplate}
                  style={{width:"100%",padding:"10px",marginBottom:14,borderRadius:9,border:"1.5px dashed var(--leaf-light)",background:"var(--leaf-pale)",color:"var(--leaf)",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download Template (.xlsx)
                </button>
                <div style={{textAlign:"center",fontSize:11,color:"var(--text-muted)",marginBottom:10}}>— then —</div>
                <button onClick={()=>xlsRef.current.click()} disabled={!xlsxReady}
                  style={{width:"100%",padding:"10px",borderRadius:9,border:"1.5px solid var(--sand)",background:"white",color:"var(--text)",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600,cursor:xlsxReady?"pointer":"default",opacity:xlsxReady?1:0.6,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  {xlsLoading ? "Reading file…" : "Upload Completed Template"}
                </button>
                <input ref={xlsRef} type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={handleXlsFile}/>
                {importError && <div style={{fontSize:11,color:"#c53030",marginTop:8,lineHeight:1.5}}>{importError}</div>}
              </>
            )}

            {/* ── Excel preview / confirm ── */}
            {importTab==="xls" && xlsPreview && (
              <>
                <div style={{background:"#f0fff4",border:"1px solid #68d391",borderRadius:8,padding:"9px 12px",marginBottom:10}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#276749",marginBottom:2}}>✓ {xlsPreview.plants.length} plant{xlsPreview.plants.length!==1?"s":""} ready to import</div>
                  <div style={{fontSize:11,color:"#276749"}}>{xlsPreview.plants.slice(0,5).map(p=>p.name).join(", ")}{xlsPreview.plants.length>5?` + ${xlsPreview.plants.length-5} more`:""}</div>
                </div>
                {xlsPreview.warnings.length>0 && (
                  <div style={{background:"#fffff0",border:"1px solid #d69e2e",borderRadius:8,padding:"8px 12px",marginBottom:10,maxHeight:80,overflowY:"auto"}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#b7791f",marginBottom:3}}>⚠ {xlsPreview.warnings.length} warning{xlsPreview.warnings.length!==1?"s":""}</div>
                    {xlsPreview.warnings.map((w,i)=><div key={i} style={{fontSize:10,color:"#b7791f"}}>{w}</div>)}
                  </div>
                )}
                <div style={{fontSize:11,color:"var(--text-muted)",marginBottom:12}}>How would you like to import?</div>
                <div style={{display:"flex",gap:8}}>
                  <button className="btn btn-secondary" onClick={()=>setXlsPreview(null)} style={{flex:"none"}}>← Back</button>
                  <button className="btn" onClick={()=>confirmXlsImport("add")} style={{flex:1,background:"var(--leaf-pale)",color:"var(--leaf)",border:"1.5px solid var(--leaf-light)"}}>Add to existing plants</button>
                  <button className="btn btn-primary" onClick={()=>confirmXlsImport("replace")} style={{flex:1}}>Replace all plants</button>
                </div>
              </>
            )}

            {/* ── JSON tab ── */}
            {importTab==="json" && (
              <>
                <p style={{fontSize:12,color:"var(--text-muted)",marginBottom:10}}>Select a Plantalog backup JSON file. This will replace all rooms and plants.</p>
                <label style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,width:"100%",padding:"14px 10px",borderRadius:8,border:"2px dashed var(--sand)",cursor:"pointer",color:"var(--text-muted)",fontSize:13,fontWeight:600,background:"var(--page-bg)"}}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  {importText ? "✓ File loaded — ready to restore" : "Tap to choose a .json file"}
                  <input type="file" accept=".json,application/json" style={{display:"none"}} onChange={e=>{
                    const file=e.target.files[0]; if(!file) return;
                    const reader=new FileReader();
                    reader.onload=ev=>{setImportText(ev.target.result);setImportError("");};
                    reader.readAsText(file);
                    e.target.value="";
                  }}/>
                </label>
                {importText && <div style={{fontSize:11,color:"var(--leaf)",marginTop:6,fontWeight:600}}>✓ File loaded — tap Restore to apply</div>}
                {importError && <div style={{fontSize:11,color:"#c53030",marginTop:6}}>{importError}</div>}
                <div className="modal-actions" style={{marginTop:12}}>
                  <button className="btn btn-secondary" onClick={closeImport}>Cancel</button>
                  <button className="btn btn-primary" onClick={importData} style={{opacity:importText?1:0.5,pointerEvents:importText?"auto":"none"}}>Restore</button>
                </div>
              </>
            )}

            {importTab==="xls" && !xlsPreview && (
              <div style={{marginTop:14}}>
                <button className="btn btn-secondary" style={{width:"100%"}} onClick={closeImport}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
function Nav({ screen, setScreen, plants, todayDate }) {
  const now = todayDate ? new Date(todayDate+"T00:00:00") : getToday();
  const due = plants ? plants.filter(p=>isWaterDue(p,now)).length : 0;
  return (
    <nav className="nav">
      <button className={`nav-btn${screen==="home" ?" active":""}`} onClick={()=>{ setScreen("home"); window.scrollTo({top:0,behavior:"instant"}); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>
        Home
      </button>
      <button className={`nav-btn${screen==="water"?" active":""}`} onClick={()=>{ setScreen("water"); window.scrollTo({top:0,behavior:"instant"}); }}>
        {due>0 && <span className="nav-badge">{due}</span>}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2C6 9 4 13.5 4 16a8 8 0 0016 0c0-2.5-2-7-8-14z"/></svg>
        Water
      </button>
      <button className={`nav-btn${screen==="repot"?" active":""}`} onClick={()=>{ setScreen("repot"); window.scrollTo({top:0,behavior:"instant"}); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2v10M8 6l4-4 4 4M5 14h14l-2 7H7l-2-7z"/></svg>
        Repot
      </button>
      <button className={`nav-btn${screen==="utils"?" active":""}`} onClick={()=>{ setScreen("utils"); window.scrollTo({top:0,behavior:"instant"}); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
        Utils
      </button>
    </nav>
  );
}

// ─── PlantCard (shared compact card) ─────────────────────────────────────────
// mode: "home" | "water" | "repot"
function PlantCard({ plant, rooms, onClick, onEdit, onCheck, onFreqInc, mode="home", leaving=false }) {
  const h            = HEALTH[plant.health];
  const photo        = getPrimaryPhoto(plant);
  const daysSince    = daysBetween(plant.lastWatered, fmt(getToday()));
  const daysLeft     = plant.waterFreqDays - daysSince;
  const od           = potOverdueDays(plant);
  const potDue       = isPotDue(plant);
  const potCrimson   = od >= 365;
  const potColor     = potCrimson?"#9b1c1c":potDue?"#be185d":"var(--text)";
  const potBg        = potCrimson?"#fee2e2":potDue?"#fce7f3":"var(--page-bg)";
  const room         = rooms ? rooms.find(r=>r.id===plant.roomId) : null;

  const cardClass = mode==="water" ? `water-card${leaving?" leaving":""}` :
                    mode==="repot" ? `repot-card${leaving?" leaving":""}` :
                    "plant-card";

  return (
    <div className={cardClass} onClick={onClick} style={{cursor:"pointer"}}>
      {/* Thumbnail */}
      <div className="plant-thumb">
        {photo ? <img src={photo} alt={plant.name}/> : <span>🌿</span>}
      </div>

      {/* Name + sub */}
      <div className="plant-name-col">
        <div className="plant-name">{plant.name}</div>
        {mode==="repot" && room && (
          room.color
            ? <span style={{background:room.color,color:roomTextColor(room.color),padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:700,whiteSpace:"nowrap",marginTop:2,display:"inline-block"}}>{room.name}</span>
            : <div className="plant-sub">{room.name}</div>
        )}
      </div>

      {/* Stat tiles */}
      <div className="stat-tiles">
        {/* Health bar — always shown */}
        <div className="health-bar-tile" data-health={plant.health} style={{background:h.color}} title={h.label}/>

        {/* HOME tiles */}
        {mode==="home" && <>
          <div className="stat-tile" title="Watering frequency" style={{background:waterFreqColor(plant.waterFreqDays)}}>
            <div className="st-lbl" style={{color:freqTextColor(plant.waterFreqDays)}}>Freq</div>
            <div className="st-val" style={{color:freqTextColor(plant.waterFreqDays)}}>{plant.waterFreqDays}d</div>
          </div>
          <div className="stat-tile" title="Days until next watering" style={{background:daysLeft<=0?"#0e7490":daysLeft===1?"#bee3f8":"var(--page-bg)"}}>
            <div className="st-lbl" style={{color:daysLeft<=0?"rgba(255,255,255,0.75)":daysLeft===1?"#2b6cb0":"var(--text-muted)"}}>Next</div>
            <div className="st-val" style={{color:daysLeft<=0?"#ffffff":daysLeft===1?"#1a365d":"var(--text)"}}>
              {daysLeft<=0?`${daysLeft}d`:`${daysLeft}d`}
            </div>
          </div>
          <div className="stat-tile" title={potDue?"Due for repotting":"Pot age"} style={{background:potBg}}>
            <div className="st-lbl">Pot Age</div>
            <div className="st-val" style={{color:potColor}}>{plantAgeDecimal(plant.pottedDate)}</div>
          </div>
          <div className="stat-tile" title="Plant age" style={{background:"var(--page-bg)"}}>
            <div className="st-lbl">Age</div>
            <div className="st-val">{plantAgeDecimal(plant.obtainedDate)}</div>
          </div>
        </>}

        {/* WATER tiles */}
        {mode==="water" && <>
          <div className="stat-tile" title="Watering frequency" style={{background:waterFreqColor(plant.waterFreqDays)}}>
            <div className="st-lbl" style={{color:freqTextColor(plant.waterFreqDays)}}>Freq</div>
            <div className="st-val" style={{color:freqTextColor(plant.waterFreqDays)}}>{plant.waterFreqDays}d</div>
          </div>
          <div className="stat-tile" title="Days until next watering"
            style={{background:daysLeft<0?"#fee2e2":daysLeft===0?"var(--page-bg)":"var(--page-bg)"}}>
            <div className="st-lbl" style={{color:daysLeft<0?"#9b1c1c":"var(--text-muted)"}}>Next</div>
            <div className="st-val" style={{color:daysLeft<0?"#9b1c1c":"var(--text)"}}>
              {daysLeft===0?"Now":daysLeft<0?`${Math.abs(daysLeft)}d`:`${daysLeft}d`}
            </div>
          </div>
        </>}

        {/* REPOT tiles */}
        {mode==="repot" && <>
          <div className="stat-tile" title="Current pot size" style={{background:"var(--page-bg)"}}>
            <div className="st-lbl">Pot Size</div>
            <div className="st-val">{plant.currentPotSize}"</div>
          </div>
          <div className="stat-tile" title="Next pot size" style={{background:"var(--page-bg)"}}>
            <div className="st-lbl">Next</div>
            <div className="st-val"><span className="repot-next-pot" style={{color:"var(--leaf)"}}>{plant.nextPotSize}"</span></div>
          </div>
          <div className="stat-tile" title="Pot age" style={{background:"var(--page-bg)"}}>
            <div className="st-lbl">Pot Age</div>
            <div className="st-val">{plantAgeDecimal(plant.pottedDate)}</div>
          </div>
        </>}
      </div>

      {/* Right action */}

      {mode==="water" && onFreqInc && (
        <button className="freq-inc-btn" onClick={onFreqInc} title="Increase water frequency">
          <svg viewBox="0 0 24 26" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 2C6 9 4 13.5 4 16a8 8 0 0016 0c0-2.5-2-7-8-14z"/>
            <line x1="12" y1="11" x2="12" y2="18"/>
            <line x1="8.5" y1="14.5" x2="15.5" y2="14.5"/>
          </svg>
        </button>
      )}
      {(mode==="water"||mode==="repot") && onCheck && (
        <button className={`check-btn${mode==="repot"?" brown":""}`} onClick={e=>{e.stopPropagation();onCheck();}} title={mode==="water"?"Mark watered":"Mark repotted"}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      )}
    </div>
  );
}

// ─── Home Screen ──────────────────────────────────────────────────────────────
function HomeScreen({ rooms, setRooms, plants, setPlants }) {
  const [showModal,    setShowModal]    = useState(false);
  const [editPlant,    setEditPlant]    = useState(null);
  const [detailPlant,  setDetailPlant]  = useState(null);
  const [homeTab,      setHomeTab]      = useState("plants");
  // null = all, 1-4 = health filter
  const [healthFilter, setHealthFilter] = useState(null);
  const [collapsedRooms, setCollapsedRooms] = useState({});

  const healthCounts = [1,2,3,4].map(h=>plants.filter(p=>p.health===h).length);
  const greenCount   = healthCounts[2]+healthCounts[3];
  const greenPct     = plants.length ? Math.round(greenCount/plants.length*100) : 0;
  const sortedRooms  = [...rooms].sort((a,b)=>a.order-b.order);

  const filtered = healthFilter ? plants.filter(p=>p.health===healthFilter) : plants;

  function selectHealth(h) {
    setHealthFilter(prev => prev===h ? null : h);
    setHomeTab("plants");
  }
  function selectAll() { setHealthFilter(null); }



  return (
    <>
      <div className="page-header green">
        <h1>Plantalog</h1>
        <p>Your green family at a glance</p>
      </div>

      <div className="dashboard">
        {/* Row 1: total + health pills */}
        <div className="dash-row">
          <div
            className={`dash-card${healthFilter===null?" selected":""}`}
            style={{flexShrink:0,minWidth:62,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}
            onClick={selectAll}
          >
            <div className="big-num">{plants.length}</div>
            <div className="lbl">All</div>
          </div>
          <div className="health-pills">
            {[1,2,3,4].map(h=>(
              <div key={h}
                className={`health-pill${healthFilter===h?" selected":""}`}
                style={{background:HEALTH[h].bg,...(healthFilter===h?{outlineColor:HEALTH[h].color}:{})}}
                onClick={()=>selectHealth(h)}
              >
                <span className="num" style={{color:HEALTH[h].color}}>{healthCounts[h-1]}</span>
                <span className="lbl" style={{color:HEALTH[h].text}}>{HEALTH[h].label}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Row 2: health % bar */}
        <div className="dash-row">
          <div className="dash-card" style={{flex:1,cursor:"default"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
              <span className="good-health-lbl" style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,color:"var(--text-muted)"}}>In Good Health</span>
              <span className="good-health-pct" style={{fontSize:22,fontWeight:700,color:greenPct>=75?"#276749":greenPct>=50?"#d69e2e":"#e53e3e"}}>{greenPct}%</span>
            </div>
            <div className="pct-bar"><div className="pct-bar-fill" style={{width:`${greenPct}%`}}/></div>
          </div>
        </div>
      </div>

      <div className="tab-bar" style={{display:"flex",alignItems:"center"}}>
        <button className={`tab-btn${homeTab==="plants"?" active":""}`} onClick={()=>setHomeTab("plants")}>Plants</button>
        <button className={`tab-btn${homeTab==="rooms" ?" active":""}`} onClick={()=>setHomeTab("rooms")}>Rooms</button>
        <button onClick={()=>{ if(homeTab==="plants"){ setEditPlant(null); setShowModal(true); } else { document.getElementById("add-room-btn")?.click(); } }}
          style={{marginLeft:4,flexShrink:0,padding:"8px 14px",borderRadius:7,background:"var(--leaf)",color:"white",border:"none",cursor:"pointer",fontSize:15,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
      </div>

      {homeTab==="plants" ? (
        <div className="section">
          {healthFilter && (
            <div style={{fontSize:11,color:"var(--text-muted)",margin:"0 2px 8px",fontWeight:600}}>
              Showing: {HEALTH[healthFilter].label} plants
              <button onClick={selectAll} style={{marginLeft:8,background:"none",border:"none",cursor:"pointer",color:"var(--leaf)",fontSize:11,fontWeight:700}}>× Clear</button>
            </div>
          )}
          {sortedRooms.map(room=>{
            const rPlants = filtered.filter(p=>p.roomId===room.id).sort((a,b)=>a.name.localeCompare(b.name));
            if (!rPlants.length) return null;
            const isCollapsed = !!collapsedRooms[room.id];
            return (
              <div key={room.id} className="room-group">
                <RoomHeader room={room} count={rPlants.length}
                  collapsed={isCollapsed}
                  onToggle={()=>setCollapsedRooms(prev=>({...prev,[room.id]:!prev[room.id]}))}
                />
                {!isCollapsed && rPlants.map(plant=>(
                  <PlantCard key={plant.id} plant={plant} rooms={rooms} mode="home"
                    onClick={()=>setDetailPlant(plant)}
                    onEdit={()=>{ setEditPlant(plant); setShowModal(true); }}
                  />
                ))}
              </div>
            );
          })}
          {filtered.length===0 && <div className="empty"><span className="ico">🌱</span><p>No plants match this filter.</p></div>}
        </div>
      ) : (
        <div className="section"><ManageRooms rooms={rooms} setRooms={setRooms} plants={plants}/></div>
      )}


      {showModal && (
        <PlantModal
          plant={editPlant} rooms={rooms}
          onSave={p=>{ if(editPlant) setPlants(ps=>ps.map(x=>x.id===p.id?p:x)); else setPlants(ps=>[...ps,{...p,id:uid()}]); setShowModal(false); setEditPlant(null); setDetailPlant(null); }}
          onDelete={editPlant?()=>{ deletePhotos(editPlant.id); setPlants(ps=>ps.filter(x=>x.id!==editPlant.id)); setShowModal(false); setEditPlant(null); setDetailPlant(null); }:null}
          onClose={()=>{ setShowModal(false); setEditPlant(null); setDetailPlant(null); }}
          onCancel={detailPlant?()=>{ setShowModal(false); setEditPlant(null); /* detailPlant stays, reopening detail */ }:null}
        />
      )}
      {!showModal && detailPlant && (()=>{ const dp=plants.find(p=>p.id===detailPlant.id)||detailPlant; return (
        <PlantDetail plant={dp} rooms={rooms} plants={plants} setPlants={setPlants}
          onClose={()=>setDetailPlant(null)}
          onEdit={()=>{ setDetailPlant(dp); setShowModal(true); setEditPlant(dp); }}
        />
      );})()}
    </>
  );
}

// ─── Plant Detail ─────────────────────────────────────────────────────────────
function PlantDetail({ plant, rooms, plants, setPlants, onClose, onEdit }) {
  const room    = rooms.find(r=>r.id===plant.roomId);
  const h       = HEALTH[plant.health];
  const fileRef = useRef();
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const [openMenuIdx, setOpenMenuIdx] = useState(null);
  const [dragState, setDragState] = useState(null); // {fromIdx, overIdx, ghostStyle}
  const [localOrder, setLocalOrder] = useState(null); // reordered indices during drag
  const pointerDown = useRef(false);
  const ghostRef = useRef(null);

  const daysSince = daysBetween(plant.lastWatered, fmt(getToday()));
  const daysLeft  = plant.waterFreqDays - daysSince;
  const potDue    = isPotDue(plant);

  function handlePhoto(e) {
    const file=e.target.files[0]; if(!file) return;
    compressPhoto(file).then(dataUrl =>
      setPlants(ps=>ps.map(p=>p.id===plant.id?{...p,photos:[...p.photos,dataUrl]}:p))
    );
    e.target.value="";
  }
  function removePhoto(i) {
    setPlants(ps=>ps.map(p=>{
      if(p.id!==plant.id) return p;
      const photos=[...p.photos]; photos.splice(i,1);
      let primary=p.primaryPhoto;
      if(primary===i) primary=null;
      else if(primary>i) primary=primary-1;
      return {...p,photos,primaryPhoto:primary};
    }));
  }
  function setPrimary(i) {
    setPlants(ps=>ps.map(p=>p.id===plant.id?{...p,primaryPhoto:i}:p));
  }
  function commitOrder(order) {
    setPlants(ps=>ps.map(p=>{
      if(p.id!==plant.id) return p;
      const photos = order.map(i=>p.photos[i]);
      const oldPrimary = p.primaryPhoto==null ? 0 : p.primaryPhoto;
      const primary = order.indexOf(oldPrimary);
      return {...p, photos, primaryPhoto: primary===0?null:primary};
    }));
  }

  function onPointerDown(e, fromIdx) {
    if(e.button===2) return;
    e.preventDefault();
    pointerDown.current = true;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const order = plant.photos.map((_,i)=>i);
    setLocalOrder(order);
    setDragState({ fromIdx, overIdx: fromIdx, offsetX, offsetY,
      ghostStyle:{ left: e.clientX - offsetX, top: e.clientY - offsetY, width: rect.width, height: rect.height }
    });

    function onMove(ev) {
      const cx = ev.touches?.[0]?.clientX ?? ev.clientX;
      const cy = ev.touches?.[0]?.clientY ?? ev.clientY;
      // update ghost position
      setDragState(ds => ds ? {...ds, ghostStyle:{...ds.ghostStyle, left: cx - ds.offsetX, top: cy - ds.offsetY}} : ds);
      // find which slot we're hovering
      const thumbs = document.querySelectorAll('.photo-thumb-wrap[data-idx]');
      let hit = fromIdx;
      thumbs.forEach(t => {
        const r = t.getBoundingClientRect();
        if(cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
          hit = Number(t.dataset.idx);
        }
      });
      setDragState(ds => ds ? {...ds, overIdx: hit} : ds);
      // live reorder
      setLocalOrder(() => {
        const o = plant.photos.map((_,i)=>i);
        const [item] = o.splice(fromIdx, 1);
        o.splice(hit, 0, item);
        return o;
      });
    }

    function onUp() {
      pointerDown.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      setDragState(ds => {
        if(ds) {
          setLocalOrder(lo => { if(lo) commitOrder(lo); return null; });
        }
        return null;
      });
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('touchmove', onMove, {passive:false});
    window.addEventListener('touchend', onUp);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{padding:0,overflow:"hidden",maxHeight:"96vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>

        {/* Header — health color */}
        <div style={{background:h.color,color:plant.health===3?"#1a4731":"white",padding:"14px 14px 12px",position:"relative",flexShrink:0,borderRadius:"14px 14px 0 0"}}>
          <button className="close-x-btn" onClick={e=>{e.stopPropagation();onClose();}} style={{zIndex:10,background:plant.health===3?"rgba(0,0,0,.15)":"rgba(255,255,255,.22)",color:plant.health===3?"#1a4731":"white"}}/>
          <button onClick={e=>{e.stopPropagation();onEdit();}} style={{position:"absolute",top:10,right:10,zIndex:10,background:plant.health===3?"rgba(0,0,0,.15)":"rgba(255,255,255,.22)",border:"none",borderRadius:20,padding:"0 14px",height:26,minWidth:44,color:plant.health===3?"#1a4731":"white",cursor:"pointer",fontSize:11,fontFamily:"'DM Sans',sans-serif",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>Edit</button>
          <div style={{textAlign:"center",paddingTop:4}}>
            <div style={{display:"flex",justifyContent:"center",marginBottom:4}}>
              {room?.color
                ? <span style={{background:room.color,color:roomTextColor(room.color),padding:"2px 10px",borderRadius:20,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".8px"}}>{room.name}</span>
                : <span style={{fontSize:10,opacity:plant.health===3?1:.8,color:plant.health===3?"#1a4731":"inherit",textTransform:"uppercase",letterSpacing:".8px"}}>{room?.name}</span>
              }
            </div>
            <div style={{fontSize:22,fontWeight:700,lineHeight:1.2}}>{plant.name}</div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:7,marginTop:5}}>
              <span style={{background:plant.health===3?"rgba(0,0,0,.12)":"rgba(255,255,255,.22)",padding:"3px 11px",borderRadius:20,fontSize:12,fontWeight:700}}>{h.label}</span>
              <span style={{background:plant.health===3?"rgba(0,0,0,.12)":"rgba(255,255,255,.22)",padding:"3px 11px",borderRadius:20,fontSize:12,fontWeight:700}}>Age: {plantAgeDecimal(plant.obtainedDate)}</span>
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{overflowY:"auto",padding:"10px 12px 80px",display:"flex",flexDirection:"column",gap:6}}>

          {/* Watering section */}
          <div className="form-section" style={{background:"var(--watering-bg,#1b4d3e18)",border:"1.5px solid var(--watering-border,#1b4d3e30)",marginBottom:0}}>
            <div className="form-section-label section-hdr-water">Watering</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
              <div style={{background:"var(--card-bg)",borderRadius:9,padding:"7px 10px",boxShadow:"var(--shadow)"}}>
                <div className="tile-lbl" style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:".4px",marginBottom:3}}>Water Every</div>
                <div className="info-val" style={{fontSize:22,fontWeight:700,color:"var(--leaf)"}}>{plant.waterFreqDays}d</div>
              </div>
              <div style={{background:"var(--card-bg)",borderRadius:9,padding:"7px 10px",boxShadow:"var(--shadow)"}}>
                <div className="tile-lbl" style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:".4px",marginBottom:3}}>Last Watered</div>
                <div className="info-val" style={{fontSize:22,fontWeight:700,color:"var(--leaf)"}}>{daysSince}d ago</div>
              </div>
              <div className={daysLeft===1?"next-water-soon":""}style={{background:daysLeft<=0?"#0e7490":daysLeft===1?"#bee3f8":"var(--card-bg)",borderRadius:9,padding:"7px 10px",boxShadow:"var(--shadow)"}}>
                <div className="tile-lbl" style={{fontSize:11,color:daysLeft<=0?"rgba(255,255,255,.75)":daysLeft===1?"#2b6cb0":"var(--text-muted)",textTransform:"uppercase",letterSpacing:".4px",marginBottom:3}}>Next Watering</div>
                <div className="info-val-next" style={{fontSize:22,fontWeight:700,color:daysLeft<=0?"white":daysLeft===1?"#1a365d":"var(--leaf)"}}>{daysLeft<=0?`${daysLeft}d`:`${daysLeft}d`}</div>
              </div>
              <div style={{background:"var(--card-bg)",borderRadius:9,padding:"7px 10px",boxShadow:"var(--shadow)"}}>
                <div className="tile-lbl" style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:".4px",marginBottom:3}}>Last Watered Date</div>
                <div className="info-val" style={{fontSize:22,fontWeight:700,color:"var(--leaf)"}}>{formatMD(plant.lastWatered)}</div>
              </div>
            </div>
          </div>

          {/* Potting section */}
          <div className="form-section" style={{background:"var(--potting-bg,#6b422618)",border:"1.5px solid var(--potting-border,#6b422630)",marginBottom:0}}>
            {/* Header row with inline Pot Age + Original Pot capsules */}
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
              <div className="form-section-label section-hdr-pot" style={{marginBottom:0}}>Potting</div>
<span style={{background:"var(--sand)",border:"1.5px solid var(--potting-border,#6b422630)",borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:700,color:"var(--text)",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:4}}><span style={{opacity:.7,fontWeight:600}}>Pot Age:</span>{plantAgeDecimal(plant.pottedDate)}</span>
              {plant.originalPot && <span style={{background:"var(--sand)",border:"1.5px solid var(--potting-border,#6b422630)",borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:700,color:"var(--text)",whiteSpace:"nowrap"}}>Original Pot</span>}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
              {/* Row 1: Repot Every | Last Potted */}
              <div style={{background:"var(--card-bg)",borderRadius:9,padding:"7px 10px",boxShadow:"var(--shadow)"}}>
                <div className="tile-lbl" style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:".4px",marginBottom:3}}>Repot Every</div>
                <div className="info-val" style={{fontSize:22,fontWeight:700,color:"var(--leaf)"}}>{repotEveryLabel(plant)}</div>
              </div>
              <div style={{background:"var(--card-bg)",borderRadius:9,padding:"7px 10px",boxShadow:"var(--shadow)"}}>
                <div className="tile-lbl" style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:".4px",marginBottom:3}}>Last Potted</div>
                <div className="info-val" style={{fontSize:20,fontWeight:700,color:"var(--leaf)"}}>{plant.pottedDate?new Date(plant.pottedDate+"T00:00:00").toLocaleDateString("en-US",{month:"numeric",day:"numeric",year:"2-digit"}):"—"}</div>
              </div>
              {/* Row 2: Current Pot | Next Pot */}
              <div style={{background:"var(--card-bg)",borderRadius:9,padding:"7px 10px",boxShadow:"var(--shadow)"}}>
                <div className="tile-lbl" style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:".4px",marginBottom:3}}>Current Pot</div>
                <div className="info-val" style={{fontSize:22,fontWeight:700,color:"var(--leaf)"}}>{plant.currentPotSize}"</div>
              </div>
              <div style={{background:potDue?"#fce7f3":"var(--card-bg)",borderRadius:9,padding:"7px 10px",boxShadow:"var(--shadow)"}}>
                <div className="tile-lbl" style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:".4px",marginBottom:3}}>Next Pot</div>
                <div className="info-val" style={{fontSize:22,fontWeight:700,color:potDue?"#be185d":"var(--leaf)"}}>{plant.nextPotSize}"</div>
              </div>
            </div>
          </div>

          {/* Photos */}
          <div style={{background:"var(--card-bg)",borderRadius:10,padding:12,boxShadow:"var(--shadow)"}}>
            <div className="section-hdr-photos" style={{fontSize:12,fontWeight:700,marginBottom:7,textTransform:"uppercase",letterSpacing:".5px",color:"var(--bark)"}}>Photos</div>
            <div className="photo-row">
              {(localOrder || plant.photos.map((_,i)=>i)).map((origIdx, slotIdx)=>{
                const src = plant.photos[origIdx];
                const isPrimary = (plant.primaryPhoto==null?0:plant.primaryPhoto)===origIdx;
                const isDragging = dragState && dragState.fromIdx===origIdx;
                return (
                  <div key={origIdx} data-idx={slotIdx}
                    className={`photo-thumb-wrap${isDragging?" dragging":""}`}
                    style={{width:88,height:88,touchAction:"none"}}
                    onPointerDown={e=>onPointerDown(e,origIdx)}>
                    <img src={src} className="photo-thumb" style={{width:88,height:88}} alt=""
                      onClick={()=>{ if(!dragState){ if(openMenuIdx===origIdx) setOpenMenuIdx(null); else setLightboxIdx(origIdx); }}}/>
                    {isPrimary && <span style={{position:"absolute",top:3,left:2,fontSize:15,lineHeight:1,filter:"drop-shadow(0 1px 3px rgba(0,0,0,.7))",pointerEvents:"none",color:"white"}}>★</span>}
                    <button className="photo-menu-btn" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setOpenMenuIdx(openMenuIdx===origIdx?null:origIdx);}}>⋯</button>
                    {openMenuIdx===origIdx && (
                      <div className="photo-menu" onClick={e=>e.stopPropagation()}>
                        <button className="photo-menu-action" title={isPrimary?"Primary":"Set as primary"} onPointerDown={e=>e.stopPropagation()} onClick={()=>{setPrimary(origIdx);setOpenMenuIdx(null);}}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill={isPrimary?"white":"none"} stroke="white" strokeWidth="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                          </svg>
                        </button>
                        <div style={{width:1,background:"rgba(255,255,255,.15)",margin:"5px 0"}}/>
                        <button className="photo-menu-action" title="Remove" onPointerDown={e=>e.stopPropagation()} onClick={()=>{removePhoto(origIdx);setOpenMenuIdx(null);}}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="photo-add" style={{width:88,height:88}} onClick={()=>{ if(!dragState) fileRef.current.click(); }}>+</div>
            </div>
            {/* Drag ghost */}
            {dragState && (
              <div ref={ghostRef} className="photo-ghost"
                style={{...dragState.ghostStyle, width:88, height:88}}>
                <img src={plant.photos[dragState.fromIdx]} style={{width:88,height:88,objectFit:"cover",borderRadius:8,display:"block"}} alt=""/>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handlePhoto}/>
            {plant.photos.length===0 && <div style={{fontSize:11,color:"var(--text-muted)",marginTop:3}}>Tap + to add a photo. Hold & drag to reorder.</div>}
            {plant.photos.length>1 && <div style={{fontSize:10,color:"var(--text-muted)",marginTop:5}}>Hold & drag to reorder · tap ⋯ to set primary or remove</div>}
          </div>

          {/* Notes */}
          {plant.notes && (
            <div className="notes-section">
              <div className="notes-section-label">Notes</div>
              <div className="notes-preview">{plant.notes}</div>
            </div>
          )}
        </div>

        {/* Lightbox */}
        {lightboxIdx!==null && (
          <div className="lightbox" onClick={()=>setLightboxIdx(null)}>
            <button className="lightbox-close" onClick={()=>setLightboxIdx(null)}>✕</button>
            {lightboxIdx>0 && <button className="lightbox-arrow left" onClick={e=>{e.stopPropagation();setLightboxIdx(i=>i-1);}}>‹</button>}
            {lightboxIdx<plant.photos.length-1 && <button className="lightbox-arrow right" onClick={e=>{e.stopPropagation();setLightboxIdx(i=>i+1);}}>›</button>}
            <img src={plant.photos[lightboxIdx]} alt="" onClick={e=>e.stopPropagation()}/>
            {plant.photos.length>1 && (
              <div className="lightbox-dots">
                {plant.photos.map((_,i)=>(
                  <div key={i} className={`lightbox-dot${i===lightboxIdx?" active":""}`} onClick={e=>{e.stopPropagation();setLightboxIdx(i);}}/>
                ))}
              </div>
            )}
          </div>
        )}
        {openMenuIdx!==null && <div style={{position:"fixed",inset:0,zIndex:10}} onClick={()=>setOpenMenuIdx(null)}/>}
      </div>
    </div>
  );
}

// ─── Manage Rooms ─────────────────────────────────────────────────────────────
function ManageRooms({ rooms, setRooms, plants }) {
  const [editing,setEditing]=useState(null);
  const [formName,setFormName]=useState("");
  const [formOrder,setFormOrder]=useState("");
  const [formColor,setFormColor]=useState(null);
  const sorted=[...rooms].sort((a,b)=>a.order-b.order);
  function openNew(){setEditing({});setFormName("");setFormOrder(rooms.length+1);setFormColor(null);}
  function openEdit(r){setEditing(r);setFormName(r.name);setFormOrder(r.order);setFormColor(r.color||null);}
  function save(){
    if(!formName.trim())return;
    if(editing.id) setRooms(rs=>rs.map(r=>r.id===editing.id?{...r,name:formName,order:Number(formOrder),color:formColor}:r));
    else setRooms(rs=>[...rs,{id:uid(),name:formName,order:Number(formOrder),color:formColor}]);
    setEditing(null);
  }
  function del(id){if(plants.some(p=>p.roomId===id)){alert("Move or delete this room's plants first.");return;}setRooms(rs=>rs.filter(r=>r.id!==id));}
  return(<>
    {sorted.map(r=>(
      <div key={r.id} className="room-list-item">
        <div style={{background:r.color||"var(--bark)",color:r.color?roomTextColor(r.color):"white",borderRadius:"50%",width:25,height:25,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0}}>{r.order}</div>
        <div><div className="room-list-name" style={{fontWeight:700,fontSize:15}}>{r.name}</div><div className="room-list-count" style={{fontSize:12,color:"var(--text-muted)",marginTop:1}}>{plants.filter(p=>p.roomId===r.id).length} plants</div></div>
        <div className="room-actions"><button className="icon-btn" onClick={()=>openEdit(r)}>✎</button><button className="icon-btn" onClick={()=>del(r.id)}>🗑</button></div>
      </div>
    ))}
    <button id="add-room-btn" className="btn btn-primary" style={{width:"100%",marginTop:5}} onClick={openNew}>+ Add Room</button>
    {editing!==null&&(
      <div className="modal-overlay" onClick={()=>setEditing(null)}>
        <div className="modal" onClick={e=>e.stopPropagation()}>
          <h2>{editing.id?"Edit Room":"New Room"}</h2>
          <div className="form-group"><label>Room Name</label><input value={formName} onChange={e=>setFormName(e.target.value)} placeholder="e.g. Living Room"/></div>
          <div className="form-group"><label>Sort Order</label><input type="number" value={formOrder} onChange={e=>setFormOrder(e.target.value)} placeholder="1"/></div>
          <div className="form-group">
            <label>Room Color</label>
            <div className="color-picker-row">
              {ROOM_COLORS.map((c,i)=>(
                <button key={i}
                  className={`color-swatch-btn${c===null?" color-swatch-none":""}${formColor===c?" selected":""}`}
                  style={c?{background:c}:{}}
                  title={c||"No color"}
                  onClick={()=>setFormColor(c)}
                />
              ))}
            </div>
            {formColor&&<div style={{marginTop:6,fontSize:11,color:"var(--text-muted)"}}>Preview: <span style={{display:"inline-block",background:formColor,color:roomTextColor(formColor),borderRadius:5,padding:"1px 8px",fontSize:11,fontWeight:700}}>{formName||"Room Name"}</span></div>}
          </div>
          <div className="modal-actions"><button className="btn btn-secondary" onClick={()=>setEditing(null)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></div>
        </div>
      </div>
    )}
  </>);
}

// ─── Plant Modal ──────────────────────────────────────────────────────────────
function PlantModal({ plant, rooms, onSave, onDelete, onClose, onCancel }) {
  const blank = {
    roomId:rooms[0]?.id||"", name:"", obtainedDate:fmt(getToday()), pottedDate:fmt(getToday()),
    originalPot:true, potMonths:0, potYears:2, currentPotSize:6, nextPotSize:7,
    waterFreqDays:7, lastWatered:fmt(getToday()), health:3, photos:[], primaryPhoto:null, notes:"" ,
  };
  const [form,setForm] = useState(plant?{...plant}:blank);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const sortedRooms=[...rooms].sort((a,b)=>a.order-b.order);
  const fileRef=useRef();
  const [editingNotes,setEditingNotes]=useState(false);
  const [notesDraft,setNotesDraft]=useState("");

  function handlePhoto(e){
    const file=e.target.files[0]; if(!file) return;
    compressPhoto(file).then(dataUrl =>
      set("photos",[...(form.photos||[]),dataUrl])
    );
    e.target.value="";
  }
  function removePhoto(i){
    const photos=[...form.photos]; photos.splice(i,1);
    let primary=form.primaryPhoto;
    if(primary===i) primary=null;
    else if(primary>i) primary=primary-1;
    setForm(f=>({...f,photos,primaryPhoto:primary}));
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h2>{plant?"Edit Plant":"Add Plant"}</h2>

        {/* Row 1: Name + Room */}
        <div className="form-row" style={{gap:7,marginBottom:7}}>
          <div className="form-group" style={{marginBottom:0,flex:2}}>
            <label>Plant Name</label>
            <input value={form.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. Monstera"/>
          </div>
          <div className="form-group" style={{marginBottom:0,flex:1}}>
            <label>Room</label>
            <select value={form.roomId} onChange={e=>set("roomId",e.target.value)}>
              {sortedRooms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>

        {/* Row 2: Health + Date Obtained */}
        <div className="form-row" style={{gap:7,marginBottom:7}}>
          <div className="form-group" style={{marginBottom:0}}>
            <label>Health</label>
            <div className="health-selector">
              {[1,2,3,4].map(h=>(
                <div key={h} className={`health-opt${form.health===h?" selected":""}`}
                  style={{background:HEALTH[h].bg,color:HEALTH[h].text,borderColor:form.health===h?HEALTH[h].color:"transparent"}}
                  onClick={()=>set("health",h)}>
                  {HEALTH[h].label}
                </div>
              ))}
            </div>
          </div>
          <div className="form-group" style={{marginBottom:0}}>
            <label>Date Obtained</label>
            <input type="date" value={form.obtainedDate} onChange={e=>set("obtainedDate",e.target.value)}/>
          </div>
        </div>

        {/* ── Watering ── */}
        <div className="form-section" style={{background:"var(--watering-bg,#1b4d3e18)",border:"1.5px solid var(--watering-border,#1b4d3e30)"}}>
          <div className="form-section-label section-hdr-water">Watering</div>
          <div className="form-row" style={{gap:7}}>
            <div className="form-group" style={{marginBottom:0}}>
              <label>Water Every</label>
              <div className="input-suffix-wrap">
                <input type="number" min="1" value={form.waterFreqDays} onChange={e=>set("waterFreqDays",Number(e.target.value))}/>
                <span className="input-suffix">d</span>
              </div>
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label>Last Watered</label>
              <input type="date" value={form.lastWatered} onChange={e=>set("lastWatered",e.target.value)}/>
            </div>
          </div>
        </div>

        {/* ── Potting ── */}
        <div className="form-section" style={{background:"var(--potting-bg,#6b422618)",border:"1.5px solid var(--potting-border,#6b422630)"}}>
          <div className="form-section-label section-hdr-pot">Potting</div>
          {/* Row 1: Repot Every (y + m) | Last Potted */}
          <div className="form-row" style={{gap:7,marginBottom:7}}>
            <div className="form-group" style={{marginBottom:0}}>
              <label>Repot Every</label>
              <div style={{display:"flex",gap:5}}>
                <div className="input-suffix-wrap" style={{flex:1}}>
                  <input type="number" min="0" value={form.potYears} onChange={e=>set("potYears",Number(e.target.value))}/>
                  <span className="input-suffix">y</span>
                </div>
                <div className="input-suffix-wrap" style={{flex:1}}>
                  <input type="number" min="0" max="11" value={form.potMonths} onChange={e=>set("potMonths",Number(e.target.value))}/>
                  <span className="input-suffix">m</span>
                </div>
              </div>
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label>Last Potted</label>
              <input type="date" value={form.pottedDate} onChange={e=>set("pottedDate",e.target.value)}/>
            </div>
          </div>
          {/* Row 2: Pot Size | Next Pot (aligned to y/m cols) | Original Pot */}
          <div className="form-group" style={{marginBottom:0}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:5}}>
              {/* Labels row */}
              <div style={{marginBottom:2}}>
                <div className="pot-sub-lbl" style={{fontSize:10,color:"#6b4226",fontWeight:700,textTransform:"uppercase",letterSpacing:".3px"}}>Pot Size</div>
              </div>
              <div style={{marginBottom:2}}>
                <div className="pot-sub-lbl" style={{fontSize:10,color:"#6b4226",fontWeight:700,textTransform:"uppercase",letterSpacing:".3px"}}>Next Pot</div>
              </div>
              <div style={{gridColumn:"3/5",marginBottom:2}}>
                <div className="pot-sub-lbl" style={{fontSize:10,color:"#6b4226",fontWeight:700,textTransform:"uppercase",letterSpacing:".3px"}}>Original Pot</div>
              </div>
              {/* Current pot size */}
              <div className="input-suffix-wrap">
                <input type="number" min="1" step="0.5" style={{minWidth:0,width:"100%"}} value={form.currentPotSize}
                  onChange={e=>{
                    const v=parseFloat(e.target.value)||0;
                    setForm(f=>({...f, currentPotSize:v, nextPotSize:Math.round((v+1)*2)/2}));
                  }}/>
                <span className="input-suffix">"</span>
              </div>
              {/* Next pot size */}
              <div className="input-suffix-wrap">
                <input type="number" min="1" step="0.5" style={{minWidth:0,width:"100%"}} value={form.nextPotSize}
                  onChange={e=>set("nextPotSize",parseFloat(e.target.value)||0)}/>
                <span className="input-suffix">"</span>
              </div>
              {/* Original pot checkbox — spans cols 3+4, centered */}
              <div style={{gridColumn:"3/5",display:"flex",alignItems:"center",gap:8,paddingLeft:4}}>
                <input type="checkbox" checked={form.originalPot} onChange={e=>set("originalPot",e.target.checked)} style={{width:18,height:18,cursor:"pointer",flexShrink:0,accentColor:"#c1603a"}}/>
              </div>
            </div>
          </div>
        </div>

        {/* Photos — compact inline strip, below Potting */}
        <div className="form-group">
          <label>Photos</label>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
            {(form.photos||[]).map((src,i)=>(
              <div key={i} style={{position:"relative",width:64,height:64,flexShrink:0}}>
                <img src={src} style={{width:64,height:64,objectFit:"cover",borderRadius:7,display:"block"}} alt=""/>
                {(form.primaryPhoto===i||(form.primaryPhoto==null&&i===0))&&<span style={{position:"absolute",top:1,left:2,fontSize:15,lineHeight:1,filter:"drop-shadow(0 1px 3px rgba(0,0,0,.7))",pointerEvents:"none",color:"white"}}>★</span>}
                <button onClick={()=>removePhoto(i)} style={{position:"absolute",top:1,right:1,background:"rgba(0,0,0,.55)",border:"none",color:"white",borderRadius:"50%",width:15,height:15,fontSize:9,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>✕</button>
              </div>
            ))}
            <div style={{width:64,height:64,border:"2px dashed var(--border-strong,#b0a898)",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"var(--text-muted)",fontSize:22,flexShrink:0}} onClick={()=>fileRef.current.click()}>+</div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handlePhoto}/>
        </div>

        {/* Notes */}
        <div className="form-group">
          <label>Notes</label>
          {editingNotes?(
            <>
              <textarea className="notes-editor" value={notesDraft} onChange={e=>setNotesDraft(e.target.value)} placeholder="Add any notes about this plant..." autoFocus/>
              <div className="notes-editor-actions">
                <button title="Delete note" onClick={()=>{set("notes","");setNotesDraft("");setEditingNotes(false);}} style={{background:"none",border:"none",cursor:"pointer",color:"var(--text-muted)",padding:"4px 6px",fontSize:18,lineHeight:1}}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                </button>
                <button title="Save note" onClick={()=>{set("notes",notesDraft.trim());setEditingNotes(false);}} style={{background:"var(--leaf)",border:"none",borderRadius:7,padding:"5px 14px",cursor:"pointer",color:"white",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700}}>
                  Save
                </button>
              </div>
            </>
          ):(
            form.notes
              ? <div style={{position:"relative",cursor:"pointer"}} onClick={()=>{setNotesDraft(form.notes);setEditingNotes(true);}}>
                  <div className="notes-preview">{form.notes.length>120?form.notes.slice(0,120)+"…":form.notes}</div>
                  <div style={{fontSize:11,color:"var(--text-muted)",marginTop:3}}>Tap to edit</div>
                </div>
              : <button className="notes-add-btn" onClick={()=>{setNotesDraft("");setEditingNotes(true);}}>+ Add a note…</button>
          )}
        </div>

        <div className="modal-actions">
          {onDelete&&<button className="btn btn-danger" onClick={onDelete}>Delete</button>}
          <button className="btn btn-secondary" onClick={onCancel||onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={()=>{ if(!form.name.trim()) return alert("Plant name required."); onSave(form); }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Water Screen ─────────────────────────────────────────────────────────────
function WaterScreen({ rooms, plants, setPlants, todayDate }) {
  const now = new Date(todayDate + "T00:00:00");
  const [leaving,    setLeaving]    = useState({});
  const [openFreq,   setOpenFreq]   = useState(null);
  const [freqPick,   setFreqPick]   = useState(null);
  const [freqCustom, setFreqCustom] = useState("");
  const [detailPlant,setDetailPlant]= useState(null);
  const [editPlant,  setEditPlant]  = useState(null);
  const [showModal,  setShowModal]  = useState(false);

  const sortedRooms = [...rooms].sort((a,b)=>a.order-b.order);
  const due     = plants.filter(p=>isWaterDue(p,now));
  const allDone = due.length===0;

  function water(id) {
    setLeaving(l=>({...l,[id]:true}));
    setTimeout(()=>{
      setPlants(ps=>ps.map(p=>p.id===id?{...p,lastWatered:fmt(now)}:p));
      setLeaving(l=>{const n={...l};delete n[id];return n;});
    },350);
  }

  function saveFreq(plantId) {
    const add = freqPick ?? (freqCustom ? parseInt(freqCustom,10) : null);
    if (!add || add <= 0) return;
    setOpenFreq(null); setFreqPick(null); setFreqCustom("");
    setLeaving(l=>({...l,[plantId]:true}));
    setTimeout(()=>{
      setPlants(ps=>ps.map(p=>p.id===plantId?{...p,waterFreqDays:p.waterFreqDays+add}:p));
      setLeaving(l=>{const n={...l};delete n[plantId];return n;});
    },350);
  }

  function openTooltip(e, plantId) {
    e.stopPropagation();
    if (openFreq===plantId) { setOpenFreq(null); setFreqPick(null); setFreqCustom(""); }
    else { setOpenFreq(plantId); setFreqPick(null); setFreqCustom(""); }
  }

  function renderByRoom(list, showActions) {
    return sortedRooms.map(room=>{
      const rp = list.filter(p=>p.roomId===room.id).sort((a,b)=>a.name.localeCompare(b.name));
      if (!rp.length) return null;
      return (
        <div key={room.id} className="room-group">
          <RoomHeader room={room} count={rp.length} />
          {rp.map(plant=>(
            <div key={plant.id} style={{position:"relative"}}>
              {/* Freq tooltip */}
              {showActions && openFreq===plant.id && (
                <div className="freq-tooltip" onClick={e=>e.stopPropagation()}>
                  <div className="freq-tooltip-title">Freq Increase</div>
                  <div className="freq-tooltip-row">
                    {[3,7,10].map(d=>(
                      <button key={d} className={`freq-opt${freqPick===d?" active":""}`}
                        onClick={()=>{ setFreqPick(d); setFreqCustom(""); }}>
                        +{d}d
                      </button>
                    ))}
                    <input className="freq-custom" type="number" min="1" placeholder="+?d"
                      value={freqCustom}
                      onChange={e=>{ setFreqCustom(e.target.value.replace(/[^0-9]/g,"")); setFreqPick(null); }}
                    />
                    <button className="check-btn" style={{flexShrink:0,borderColor:"white",color:"white",borderWidth:"2.5px"}}
                      onClick={()=>saveFreq(plant.id)}>
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                  </div>
                </div>
              )}
              <PlantCard plant={plant} rooms={rooms} mode="water"
                leaving={!!leaving[plant.id]}
                onClick={()=>setDetailPlant(plant)}
                onCheck={showActions?()=>water(plant.id):null}
                onFreqInc={showActions?(e)=>openTooltip(e,plant.id):null}
              />
            </div>
          ))}
        </div>
      );
    });
  }

  // Plants due in days 1–7 from today, grouped by exact day offset then by room
  const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const upNext = [];
  for (let d = 1; d <= 7; d++) {
    const group = plants.filter(p => {
      const daysSince  = daysBetween(p.lastWatered, fmt(now));
      const daysLeft   = p.waterFreqDays - daysSince;
      return daysLeft === d;
    });
    if (group.length) upNext.push({ daysAway: d, plants: group });
  }

  function dayLabel(d) {
    const target = new Date(now);
    target.setDate(target.getDate() + d);
    const dow = DAYS[target.getDay()];
    if (d === 1) return `Tomorrow · ${dow}`;
    return `In ${d} days · ${dow}`;
  }

  function renderUpNextGroup({ daysAway, plants: gPlants }) {
    const byRoom = sortedRooms.map(room => {
      const rp = gPlants.filter(p => p.roomId === room.id).sort((a,b) => a.name.localeCompare(b.name));
      if (!rp.length) return null;
      return (
        <div key={room.id} className="room-group" style={{marginBottom:4}}>
          <RoomHeader room={room} count={rp.length} style={{marginBottom:4}} />
          {rp.map(plant=>(
            <div key={plant.id} style={{position:"relative"}}>
              {openFreq===plant.id && (
                <div className="freq-tooltip" onClick={e=>e.stopPropagation()}>
                  <div className="freq-tooltip-title">Freq Increase</div>
                  <div className="freq-tooltip-row">
                    {[3,7,10].map(d=>(
                      <button key={d} className={`freq-opt${freqPick===d?" active":""}`}
                        onClick={()=>{ setFreqPick(d); setFreqCustom(""); }}>
                        +{d}d
                      </button>
                    ))}
                    <input className="freq-custom" type="number" min="1" placeholder="+?d"
                      value={freqCustom}
                      onChange={e=>{ setFreqCustom(e.target.value.replace(/[^0-9]/g,"")); setFreqPick(null); }}
                    />
                    <button className="check-btn" style={{flexShrink:0}}
                      onClick={()=>saveFreq(plant.id)}>
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                  </div>
                </div>
              )}
              <PlantCard key={plant.id} plant={plant} rooms={rooms} mode="water"
                leaving={!!leaving[plant.id]}
                onClick={()=>setDetailPlant(plant)}
                onCheck={()=>water(plant.id)}
                onFreqInc={(e)=>openTooltip(e,plant.id)}
              />
            </div>
          ))}
        </div>
      );
    });
    return (
      <div key={daysAway} style={{marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          <div className="upnext-lbl" style={{fontSize:13,fontWeight:700,color:"var(--leaf)",textTransform:"uppercase",letterSpacing:.5}}>
            {dayLabel(daysAway)}
          </div>
          <div style={{flex:1,height:1,background:"var(--text-muted)"}}/>
          <div style={{fontSize:11,color:"var(--text-muted)"}}>{gPlants.length} plant{gPlants.length!==1?"s":""}</div>
        </div>
        {byRoom}
      </div>
    );
  }

  return(
    <>
      {/* Close tooltip on outside click */}
      {openFreq!==null && <div style={{position:"fixed",inset:0,zIndex:40}} onClick={()=>{setOpenFreq(null);setFreqPick(null);setFreqCustom("");}}/>}
      <div className="page-header teal">
        <h1>Water</h1>
        <p>{allDone?"All plants watered today 🎉":`${due.length} plant${due.length!==1?"s":""} need${due.length===1?"s":""} water today`}</p>
      </div>
      <div className="section" style={{paddingTop:10}}>
        {/* Today's due plants */}
        {allDone?(
          <div style={{textAlign:"center",padding:"28px 20px 20px",color:"var(--text-muted)"}}>
            <div style={{fontSize:44,marginBottom:8}}>🌿</div>
            <div style={{fontSize:20,fontWeight:700,color:"var(--leaf)",marginBottom:6}}>All done for today!</div>
            <div style={{fontSize:14}}>Your plants are happy and hydrated.</div>
          </div>
        ):renderByRoom(due,true)}

        {/* Up Next — always shown */}
        {upNext.length>0&&(
          <div style={{marginTop: allDone?0:20}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <h2 style={{fontSize:16,fontWeight:700,color:"var(--text)",margin:0}}>Up Next</h2>
              <div style={{fontSize:11,color:"var(--text-muted)"}}>— next 7 days</div>
            </div>
            {upNext.map(g=>renderUpNextGroup(g))}
          </div>
        )}
        {upNext.length===0&&allDone&&(
          <div style={{textAlign:"center",fontSize:12,color:"var(--text-muted)",paddingBottom:16}}>Nothing due in the next 7 days.</div>
        )}
      </div>
      {showModal && <PlantModal plant={editPlant} rooms={rooms}
        onSave={p=>{ setPlants(ps=>ps.map(x=>x.id===p.id?p:x)); setShowModal(false); setEditPlant(null); }}
        onDelete={()=>{ deletePhotos(editPlant.id); setPlants(ps=>ps.filter(x=>x.id!==editPlant.id)); setShowModal(false); setEditPlant(null); }}
        onClose={()=>{ setShowModal(false); setEditPlant(null); }}
      />}
      {detailPlant && (()=>{ const dp=plants.find(p=>p.id===detailPlant.id)||detailPlant; return (
        <PlantDetail plant={dp} rooms={rooms} plants={plants} setPlants={setPlants}
          onClose={()=>setDetailPlant(null)}
          onEdit={()=>{ setEditPlant(dp); setDetailPlant(null); setShowModal(true); }}
        />
      );})()}
    </>
  );
}

// ─── Repot Screen ─────────────────────────────────────────────────────────────
function RepotScreen({ rooms, plants, setPlants, todayDate }) {
  const now = new Date((todayDate||fmt(getToday())) + "T00:00:00");
  const [leaving,    setLeaving]    = useState({});
  const [detailPlant,setDetailPlant]= useState(null);
  const [editPlant,  setEditPlant]  = useState(null);
  const [showModal,  setShowModal]  = useState(false);
  const due=[...plants].filter(p=>isPotDue(p,now)).sort((a,b)=>a.nextPotSize-b.nextPotSize||a.name.localeCompare(b.name));

  function repot(id){
    setLeaving(l=>({...l,[id]:true}));
    setTimeout(()=>{
      setPlants(ps=>ps.map(p=>{
        if(p.id!==id) return p;
        const newCurrent = p.nextPotSize;
        const newNext    = Math.round((newCurrent+1)*2)/2;
        return {...p, pottedDate:fmt(now), originalPot:false, currentPotSize:newCurrent, nextPotSize:newNext};
      }));
      setLeaving(l=>{const n={...l};delete n[id];return n;});
    },350);
  }

  return(
    <>
      <div className="page-header brown">
        <h1>Repot</h1>
        <p>{due.length} plant{due.length!==1?"s":""} ready for a new home</p>
      </div>
      <div className="section" style={{paddingTop:10}}>
        {due.length===0&&<div className="empty"><span className="ico">🪴</span><p>No plants are due for repotting right now.</p></div>}
        {due.map(plant=>(
          <PlantCard key={plant.id} plant={plant} rooms={rooms} mode="repot"
            leaving={!!leaving[plant.id]}
            onClick={()=>setDetailPlant(plant)}
            onCheck={()=>repot(plant.id)}
          />
        ))}
      </div>
      {showModal && <PlantModal plant={editPlant} rooms={rooms}
        onSave={p=>{ setPlants(ps=>ps.map(x=>x.id===p.id?p:x)); setShowModal(false); setEditPlant(null); }}
        onDelete={()=>{ deletePhotos(editPlant.id); setPlants(ps=>ps.filter(x=>x.id!==editPlant.id)); setShowModal(false); setEditPlant(null); }}
        onClose={()=>{ setShowModal(false); setEditPlant(null); }}
      />}
      {detailPlant && (()=>{ const dp=plants.find(p=>p.id===detailPlant.id)||detailPlant; return (
        <PlantDetail plant={dp} rooms={rooms} plants={plants} setPlants={setPlants}
          onClose={()=>setDetailPlant(null)}
          onEdit={()=>{ setEditPlant(dp); setDetailPlant(null); setShowModal(true); }}
        />
      );})()}
    </>
  );
}


// ─── Utilities Screen ─────────────────────────────────────────────────────────
function UtilitiesScreen({ darkMode, setDarkMode, onExport, onImport }) {
  return (
    <>
      <div className="page-header" style={{background:"#44403c"}}>
        <h1>Utilities</h1>
        <p>App settings and data management</p>
      </div>
      <div className="section" style={{paddingTop:14}}>
        <div style={{fontSize:12,fontWeight:700,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:".7px",marginBottom:6,paddingLeft:2}}>Appearance</div>
        <div className="util-section">
          <div className="util-row">
            <div>
              <div className="util-label">Dark Mode</div>
              <div className="util-sublabel">Easy on the eyes at night</div>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={darkMode} onChange={e=>setDarkMode(e.target.checked)}/>
              <div className="toggle-track">
                <div className="toggle-thumb"/>
              </div>
            </label>
          </div>
        </div>
        <div style={{fontSize:12,fontWeight:700,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:".7px",marginBottom:6,paddingLeft:2,marginTop:16}}>Data</div>
        <div className="util-section">
          <div className="util-row">
            <div>
              <div className="util-label">Export Backup</div>
              <div className="util-sublabel">Save your plants and rooms as a JSON file</div>
            </div>
            <button className="util-btn" onClick={onExport}>Export</button>
          </div>
          <div className="util-row">
            <div>
              <div className="util-label">Import Backup</div>
              <div className="util-sublabel">Restore from a JSON or Excel file</div>
            </div>
            <button className="util-btn secondary" onClick={onImport}>Import</button>
          </div>
        </div>
      </div>
    </>
  );
}
