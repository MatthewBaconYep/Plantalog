// React hooks from global
import { useState, useEffect, useRef, useCallback } from "react";

// ─── Preview Mode ─────────────────────────────────────────────────────────────
// Set to true to bypass login and use local data (for Claude preview)
// Set to false for production (GitHub Pages)
const PREVIEW_MODE = true;

// ─── Supabase ─────────────────────────────────────────────────────────────────

function getSupabase() {
  return window.__supabase_client;
}

async function initSupabase() {
  if (window.__supabase_client) return window.__supabase_client;
  // Load Supabase from CDN if not already loaded
  if (!window.supabase) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  window.__supabase_client = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    }
  });
  return window.__supabase_client;
}

// ─── Local Storage (offline fallback + settings) ──────────────────────────────
async function loadData(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
  catch { return null; }
}
async function saveData(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ─── Supabase data sync ───────────────────────────────────────────────────────
async function sbLoadRooms(userId) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from("rooms").select("*").eq("user_id", userId);
  if (error) { console.error("sbLoadRooms", error); return null; }
  if (!data || data.length === 0) return null;
  return data.map((r, i) => ({ id: r.id, name: r.name, order: r.order ?? i, color: r.color }));
}

async function sbSaveRooms(userId, rooms) {
  const sb = getSupabase();
  if (!sb || !rooms) return;
  const rows = rooms.map(r => ({ id: r.id, user_id: userId, name: r.name, order: r.order, color: r.color || null }));
  const { error } = await sb.from("rooms").upsert(rows, { onConflict: "id" });
  if (error) { console.error("sbSaveRooms", error); }
}

async function sbDeleteRooms(userId, ids) {
  const sb = getSupabase();
  if (!sb || !ids || ids.length === 0) return;
  await sb.from("rooms").delete().eq("user_id", userId).in("id", ids);
}

async function sbLoadPlants(userId) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from("plants").select("*").eq("user_id", userId);
  if (error) { console.error("sbLoadPlants", error); return null; }
  if (!data || data.length === 0) return null;
  return data.map(r => {
    if (!r.data) return null;
    return { ...r.data, id: r.id };
  }).filter(Boolean);
}

async function sbSavePlants(userId, plants) {
  const sb = getSupabase();
  if (!sb || !plants) return;
  const rows = plants.map(p => {
    const { id, ...rest } = p;
    const data = { ...rest, photos: [], primaryPhoto: null };
    return { id, user_id: userId, data };
  });
  const { error } = await sb.from("plants").upsert(rows, { onConflict: "id" });
  if (error) { console.error("sbSavePlants", error); return; }
}

async function sbDeletePlants(userId, ids) {
  const sb = getSupabase();
  if (!sb || !ids || ids.length === 0) return;
  await sb.from("plants").delete().eq("user_id", userId).in("id", ids);
}

async function sbDeletePlant(userId, plantId) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("plants").delete().eq("user_id", userId).eq("id", plantId);
}

async function sbLoadSettings(userId) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from("settings").select("*").eq("user_id", userId).single();
  if (error) return null;
  return data;
}

async function sbSaveSettings(userId, settings) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("settings").upsert({ user_id: userId, ...settings }, { onConflict: "user_id" });
}

// ─── Supabase photo storage ───────────────────────────────────────────────────
async function sbSavePhoto(userId, plantId, index, base64Data) {
  const sb = getSupabase();
  if (!sb || !base64Data) return null;
  try {
    // Convert base64 to blob
    const res = await fetch(base64Data);
    const blob = await res.blob();
    const path = `${userId}/${plantId}/${index}.jpg`;
    const { error } = await sb.storage.from("plant-photos").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
    if (error) { console.error("sbSavePhoto", error); return null; }
    const { data } = sb.storage.from("plant-photos").getPublicUrl(path);
    return data.publicUrl;
  } catch(e) { console.error("sbSavePhoto error", e); return null; }
}

async function sbDeletePlantPhotos(userId, plantId) {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { data } = await sb.storage.from("plant-photos").list(`${userId}/${plantId}`);
    if (data && data.length > 0) {
      const paths = data.map(f => `${userId}/${plantId}/${f.name}`);
      await sb.storage.from("plant-photos").remove(paths);
    }
  } catch(e) { console.error("sbDeletePlantPhotos error", e); }
}

async function sbLoadPlantPhotoUrls(userId, plantId) {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data } = await sb.storage.from("plant-photos").list(`${userId}/${plantId}`, { sortBy: { column: "name", order: "asc" } });
    if (!data || data.length === 0) return [];
    return data.map(f => sb.storage.from("plant-photos").getPublicUrl(`${userId}/${plantId}/${f.name}`).data.publicUrl);
  } catch(e) { return []; }
}

// ─── IndexedDB for photos (local fallback) ────────────────────────────────────
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
    const map = {};
    all.forEach(r => { map[r.plantId] = { photos: r.photos, primaryPhoto: r.primaryPhoto }; });
    return map;
  } catch(e) { return {}; }
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
  {
    "id": "r1",
    "name": "Living Room",
    "order": 2,
    "color": "#dd6b20"
  },
  {
    "id": "r2",
    "name": "Kitchen",
    "order": 6,
    "color": "#2b6cb0"
  },
  {
    "id": "r3",
    "name": "Bedroom",
    "order": 7,
    "color": "#6b46c1"
  },
  {
    "id": "09tckbm8",
    "name": "Sun Room",
    "order": 1,
    "color": "#fc8181"
  },
  {
    "id": "69kwqnda",
    "name": "Studio",
    "order": 3,
    "color": "#d69e2e"
  },
  {
    "id": "cqjo8qsw",
    "name": "Office",
    "order": 4,
    "color": "#68d391"
  },
  {
    "id": "g4iwg5s7",
    "name": "Bathroom",
    "order": 5,
    "color": "#319795"
  }
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
  {
    "id": "od6lssq1",
    "roomId": "09tckbm8",
    "name": "Beefsteak Begonia",
    "health": 4,
    "obtainedDate": "2020-10-25",
    "waterFreqDays": 24,
    "lastWatered": "2026-02-12",
    "pottedDate": "2025-10-04",
    "originalPot": false,
    "potYears": 2,
    "potMonths": 0,
    "currentPotSize": 10,
    "nextPotSize": 11,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "2cjn75qq",
    "roomId": "09tckbm8",
    "name": "Blue Star Fern",
    "health": 4,
    "obtainedDate": "2024-12-07",
    "waterFreqDays": 10,
    "lastWatered": "2026-03-05",
    "pottedDate": "2025-05-11",
    "originalPot": false,
    "potYears": 2,
    "potMonths": 0,
    "currentPotSize": 7,
    "nextPotSize": 8,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "euxqewy5",
    "roomId": "09tckbm8",
    "name": "Christmas Cactus",
    "health": 4,
    "obtainedDate": "2024-11-08",
    "waterFreqDays": 10,
    "lastWatered": "2026-03-05",
    "pottedDate": "2025-05-09",
    "originalPot": false,
    "potYears": 2,
    "potMonths": 0,
    "currentPotSize": 8,
    "nextPotSize": 9,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "yan4tbt4",
    "roomId": "09tckbm8",
    "name": "Dieffenbachia",
    "health": 3,
    "obtainedDate": "2024-08-09",
    "waterFreqDays": 20,
    "lastWatered": "2026-02-16",
    "pottedDate": "2025-05-08",
    "originalPot": false,
    "potYears": 2,
    "potMonths": 0,
    "currentPotSize": 10,
    "nextPotSize": 11,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "0b30ba24",
    "roomId": "09tckbm8",
    "name": "Monstera Deliciosa",
    "health": 4,
    "obtainedDate": "2023-10-29",
    "waterFreqDays": 30,
    "lastWatered": "2026-02-19",
    "pottedDate": "2024-07-31",
    "originalPot": false,
    "potYears": 3,
    "potMonths": 0,
    "currentPotSize": 11.5,
    "nextPotSize": 13,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "kn1lx2q4",
    "roomId": "r1",
    "name": "Bird Of Paradise",
    "health": 3,
    "obtainedDate": "2024-09-11",
    "waterFreqDays": 35,
    "lastWatered": "2026-03-05",
    "pottedDate": "2025-06-19",
    "originalPot": false,
    "potYears": 2,
    "potMonths": 0,
    "currentPotSize": 11,
    "nextPotSize": 12,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "49gxi3ti",
    "roomId": "r1",
    "name": "Snake Laurentii",
    "health": 1,
    "obtainedDate": "2023-09-13",
    "waterFreqDays": 70,
    "lastWatered": "2026-02-04",
    "pottedDate": "2025-06-19",
    "originalPot": false,
    "potYears": 2,
    "potMonths": 0,
    "currentPotSize": 11,
    "nextPotSize": 12,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "l4m7t566",
    "roomId": "69kwqnda",
    "name": "Philidendron Cherry Red",
    "health": 4,
    "obtainedDate": "2024-10-06",
    "waterFreqDays": 10,
    "lastWatered": "2026-03-05",
    "pottedDate": "2025-01-17",
    "originalPot": false,
    "potYears": 1,
    "potMonths": 0,
    "currentPotSize": 7,
    "nextPotSize": 8,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "lovzpr6j",
    "roomId": "69kwqnda",
    "name": "Philodendron Brasil",
    "health": 4,
    "obtainedDate": "2024-06-28",
    "waterFreqDays": 10,
    "lastWatered": "2026-03-05",
    "pottedDate": "2025-07-05",
    "originalPot": false,
    "potYears": 1,
    "potMonths": 0,
    "currentPotSize": 5,
    "nextPotSize": 6,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "8bo5h6bj",
    "roomId": "69kwqnda",
    "name": "ZZ",
    "health": 3,
    "obtainedDate": "2025-04-19",
    "waterFreqDays": 21,
    "lastWatered": "2026-02-12",
    "pottedDate": "2025-11-18",
    "originalPot": false,
    "potYears": 2,
    "potMonths": 0,
    "currentPotSize": 7.5,
    "nextPotSize": 9,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "gw60xh99",
    "roomId": "cqjo8qsw",
    "name": "Croton",
    "health": 1,
    "obtainedDate": "2024-06-10",
    "waterFreqDays": 17,
    "lastWatered": "2026-02-25",
    "pottedDate": "2025-10-03",
    "originalPot": false,
    "potYears": 2,
    "potMonths": 0,
    "currentPotSize": 7,
    "nextPotSize": 8,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "gl1ezscn",
    "roomId": "cqjo8qsw",
    "name": "Dragon Tree",
    "health": 3,
    "obtainedDate": "2024-06-10",
    "waterFreqDays": 24,
    "lastWatered": "2026-02-12",
    "pottedDate": "2025-09-28",
    "originalPot": false,
    "potYears": 2,
    "potMonths": 0,
    "currentPotSize": 7.5,
    "nextPotSize": 9,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "rw1h76bu",
    "roomId": "cqjo8qsw",
    "name": "Ficus Benjamina",
    "health": 4,
    "obtainedDate": "2023-10-29",
    "waterFreqDays": 17,
    "lastWatered": "2026-02-24",
    "pottedDate": "2025-06-19",
    "originalPot": false,
    "potYears": 2,
    "potMonths": 0,
    "currentPotSize": 9,
    "nextPotSize": 10,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "vbjhhl44",
    "roomId": "cqjo8qsw",
    "name": "Money Tree",
    "health": 4,
    "obtainedDate": "2025-05-11",
    "waterFreqDays": 14,
    "lastWatered": "2026-03-05",
    "pottedDate": "2025-05-11",
    "originalPot": true,
    "potYears": 1,
    "potMonths": 0,
    "currentPotSize": 9,
    "nextPotSize": 10,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "iqgsepct",
    "roomId": "g4iwg5s7",
    "name": "Aglaonema Silver Bay",
    "health": 4,
    "obtainedDate": "2024-06-10",
    "waterFreqDays": 40,
    "lastWatered": "2026-02-04",
    "pottedDate": "2025-05-11",
    "originalPot": false,
    "potYears": 2,
    "potMonths": 0,
    "currentPotSize": 10,
    "nextPotSize": 11,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "z8k37ru0",
    "roomId": "r2",
    "name": "Begonia Red Kiss",
    "health": 4,
    "obtainedDate": "2024-09-11",
    "waterFreqDays": 14,
    "lastWatered": "2026-02-25",
    "pottedDate": "2025-05-08",
    "originalPot": false,
    "potYears": 2,
    "potMonths": 0,
    "currentPotSize": 7,
    "nextPotSize": 8,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "uedvasc3",
    "roomId": "r2",
    "name": "Chinese Money Plant",
    "health": 4,
    "obtainedDate": "2025-07-31",
    "waterFreqDays": 10,
    "lastWatered": "2026-02-25",
    "pottedDate": "2025-11-13",
    "originalPot": false,
    "potYears": 1,
    "potMonths": 0,
    "currentPotSize": 5,
    "nextPotSize": 6,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "j6f5xjzs",
    "roomId": "r2",
    "name": "Fluffy Ruffle Fern",
    "health": 2,
    "obtainedDate": "2025-03-06",
    "waterFreqDays": 14,
    "lastWatered": "2026-03-05",
    "pottedDate": "2025-10-03",
    "originalPot": false,
    "potYears": 2,
    "potMonths": 0,
    "currentPotSize": 7,
    "nextPotSize": 8,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "prnzjset",
    "roomId": "r2",
    "name": "Golden Ball Cactus",
    "health": 4,
    "obtainedDate": "2024-06-01",
    "waterFreqDays": 14,
    "lastWatered": "2026-02-17",
    "pottedDate": "2024-06-01",
    "originalPot": true,
    "potYears": 2,
    "potMonths": 0,
    "currentPotSize": 2,
    "nextPotSize": 3,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "bq6237wh",
    "roomId": "r2",
    "name": "Silver Dragon",
    "health": 4,
    "obtainedDate": "2024-10-06",
    "waterFreqDays": 7,
    "lastWatered": "2026-03-05",
    "pottedDate": "2024-12-27",
    "originalPot": false,
    "potYears": 2,
    "potMonths": 0,
    "currentPotSize": 6,
    "nextPotSize": 7,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "g1mo0zge",
    "roomId": "r3",
    "name": "Marble Queen Pothos",
    "health": 4,
    "obtainedDate": "2024-06-10",
    "waterFreqDays": 24,
    "lastWatered": "2026-02-12",
    "pottedDate": "2025-05-11",
    "originalPot": false,
    "potYears": 2,
    "potMonths": 0,
    "currentPotSize": 9,
    "nextPotSize": 10,
    "photos": [],
    "primaryPhoto": null
  },
  {
    "id": "58yv2kz7",
    "roomId": "r3",
    "name": "Wax",
    "health": 4,
    "obtainedDate": "2024-06-10",
    "waterFreqDays": 30,
    "lastWatered": "2026-02-12",
    "pottedDate": "2025-10-15",
    "originalPot": false,
    "potYears": 2,
    "potMonths": 0,
    "currentPotSize": 6,
    "nextPotSize": 7,
    "photos": [],
    "primaryPhoto": null
  }
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
  .dark body, .dark{background:#000;}
  .dark .tab-bar{background:var(--card-bg);}

  .dark .nav{background:var(--card-bg);border-top:1px solid rgba(255,255,255,.1);}
  .dark .edit-icon-btn{opacity:.7;color:var(--text);}
  .dark .dash-card .lbl{color:var(--text);}
  .dark .dash-card .big-num{color:var(--leaf-light);}
  .dark .pct-bar-fill + * , .dark .health-card-sub{color:var(--text);}
  .dark .tab-btn{color:var(--text);}
  .dark .plant-sub{color:var(--text-muted);}
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
  .dark{--watering-bg:rgba(14,116,144,.18);--watering-border:rgba(14,116,144,.4);--potting-bg:rgba(161,100,60,.2);--potting-border:rgba(161,100,60,.4);--pot-due-bg:#3b1212;--pot-due-border:#7f1d1d;--pot-due-text:#fca5a5;}
  .app{--watering-bg:rgba(14,116,144,.1);--watering-border:rgba(14,116,144,.35);--potting-bg:rgba(193,96,58,.1);--potting-border:rgba(193,96,58,.35);}
  .dark .form-section-label{opacity:1;}
  html{background:#1a1a1a;}
  body{font-family:'DM Sans',sans-serif;background:var(--cream);color:var(--text);transition:background .3s,color .3s;margin:0;padding:0;}
  .app{max-width:480px;margin:0 auto;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;background:var(--cream);}

  /* Nav */
  .nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:#141414;display:flex;z-index:100;border-radius:16px 16px 0 0;padding-bottom:0;}
  .nav-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 0 6px;color:#e8e6e1;cursor:pointer;border:none;background:none;font-family:'DM Sans',sans-serif;font-size:11px;letter-spacing:.5px;text-transform:uppercase;font-weight:600;transition:color .2s;position:relative;}
  .nav-btn.active{color:var(--leaf-light);}
  .nav-btn.active.water{color:#22d3ee;}
  .nav-btn.active.repot{color:#e07850;}
  .nav-btn.active.utils{color:#a8a29e;}
  .nav-btn svg{width:22px;height:22px;}
  .nav-badge{position:absolute;top:6px;right:calc(50% - 17px);background:#e53e3e;color:white;border-radius:50%;width:14px;height:14px;font-size:8px;display:flex;align-items:center;justify-content:center;font-weight:700;}

  /* Header */
  .page-header{padding:40px 14px 10px;color:white;}
  .page-header.green{background:#2d6a4f;}
  .page-header.teal{background:#0e7490;}

  /* Fill status bar area with header color — works in both Safari and standalone */
  .page-header.green::before,
  .page-header.teal::before,
  .page-header.brown::before,
  .page-header.slate::before {
    content: "";
    display: block;
    position: fixed;
    top: 0; left: 0; right: 0;
    height: env(safe-area-inset-top, 0px);
    z-index: 200;
    pointer-events: none;
  }
  .page-header.green::before  { background: #2d6a4f; }
  .page-header.teal::before   { background: #0e7490; }
  .page-header.brown::before  { background: #c1603a; }
  .page-header.slate::before  { background: #44403c; }
  .dark .page-header.teal::before  { background: #0a4a57; }
  .dark .page-header.brown::before { background: #8b3e22; }
  .dark .page-header.slate::before { background: #2c2925; }

  /* ── Phone portrait (Safari browser) ── */
  @media (max-width: 480px) and (orientation: portrait) {
    .phone-hide { display: none !important; }
    .page-header { padding-top: max(54px, calc(env(safe-area-inset-top, 44px) + 12px)); }
    .nav { padding-bottom: 0; }
    .nav-btn { padding-top: 13px; padding-bottom: 0; }
  }

  /* ── Standalone only — home screen app ── */
  @media (display-mode: standalone) and (max-width: 480px) {
    .nav { padding-bottom: max(20px, env(safe-area-inset-bottom, 20px)); }
  }
  .page-header.slate{background:#44403c;}
  .dark .page-header.slate{background:#2c2925;}
  .dark .page-header.teal{background:#0a4a57;}
  .page-header.brown{background:#c1603a;}
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
  .check-btn{width:34px;height:34px;border-radius:50%;border:2px solid #0e7490;background:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#0e7490;transition:all .18s;}
  .check-btn:hover{background:#0e7490;color:white;border-color:#0e7490;}
  .dark .check-btn{border-color:#22d3ee;color:#22d3ee;}
  .dark .check-btn:hover{background:#22d3ee;color:#0c1a1f;border-color:#22d3ee;}
  .check-btn.brown{border-color:#c1603a;color:#c1603a;}
  .check-btn.brown:hover{background:#c1603a;color:white;border-color:#c1603a;}
  .dark .check-btn.brown{border-color:#e07850;color:#e07850;}
  .dark .check-btn.brown:hover{background:#e07850;color:white;border-color:#e07850;}

  /* Freq increase button */
  .freq-inc-btn{width:34px;height:34px;border-radius:50%;border:2px solid #0e7490;background:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#0e7490;transition:all .18s;font-size:15px;font-weight:700;font-family:'DM Sans',sans-serif;}
  .freq-inc-btn:hover{background:#0e7490;color:white;}
  .dark .freq-inc-btn{border-color:#22d3ee;color:#22d3ee;}
  .dark .freq-inc-btn:hover{background:#22d3ee;color:#0c1a1f;}
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
  .util-btn{background:var(--leaf);color:white;border:1.5px solid rgba(0,0,0,0.15);border-radius:8px;padding:9px 16px;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:700;cursor:pointer;min-width:90px;text-align:center;}
  .util-btn.secondary{background:var(--page-bg);color:var(--text);border:1.5px solid var(--border);}

`;

// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [mode, setMode]       = useState("login"); // "login" | "signup" | "reset"
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]     = useState("");
  const [info, setInfo]       = useState("");
  const [loading, setLoading] = useState(false);

  async function handleEmail(e) {
    e.preventDefault();
    setError(""); setInfo("");
    if (!email || !password) { setError("Please enter your email and password."); return; }
    setLoading(true);
    const sb = getSupabase();
    try {
      if (mode === "login") {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onLogin(data.user);
      } else if (mode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          setError("An account with this email already exists.");
        } else {
          setInfo("Check your email for a confirmation link, then come back to log in.");
          setMode("login");
        }
      } else if (mode === "reset") {
        const { error } = await sb.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setInfo("Password reset email sent. Check your inbox.");
        setMode("login");
      }
    } catch(err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(""); setLoading(true);
    const sb = getSupabase();
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
    if (error) { setError(error.message); setLoading(false); }
  }

  async function handleApple() {
    setError(""); setLoading(true);
    const sb = getSupabase();
    const { error } = await sb.auth.signInWithOAuth({ provider: "apple", options: { redirectTo: window.location.origin } });
    if (error) { setError(error.message); setLoading(false); }
  }

  const logoBase64 = "data:image/jpeg;base64,"; // placeholder — icon loaded from /apple-touch-icon.png

  return (
    <div style={{position:"fixed",inset:0,background:"#1b4d3e",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px 20px",fontFamily:"'DM Sans',sans-serif",overflowY:"auto",boxSizing:"border-box"}}>

      {/* Logo + Title */}
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:32}}>
        <img src="data:image/png;base64,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" alt="Plantalog" style={{width:120,height:120,borderRadius:26,marginBottom:18,boxShadow:"0 4px 24px rgba(0,0,0,0.3)"}}/>
        <div style={{fontSize:32,fontWeight:800,color:"#e8e2d0",letterSpacing:"-0.5px"}}>Plantalog</div>
        <div style={{fontSize:14,color:"rgba(232,226,208,0.65)",marginTop:4}}>Your green family at a glance</div>
      </div>

      {/* Card */}
      <div style={{width:"100%",maxWidth:380,background:"rgba(255,255,255,0.07)",borderRadius:18,padding:"28px 24px",backdropFilter:"blur(10px)",border:"1px solid rgba(255,255,255,0.12)"}}>

        {/* Mode tabs */}
        {mode !== "reset" && (
          <div style={{display:"flex",gap:0,marginBottom:22,background:"rgba(0,0,0,0.2)",borderRadius:10,padding:3}}>
            {[["login","Sign In"],["signup","Create Account"]].map(([m,label])=>(
              <button key={m} onClick={()=>{setMode(m);setError("");setInfo("");}}
                style={{flex:1,padding:"8px 4px",border:"none",borderRadius:8,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,transition:"all .15s",
                  background:mode===m?"rgba(255,255,255,0.15)":"transparent",
                  color:mode===m?"#e8e2d0":"rgba(232,226,208,0.5)"}}>
                {label}
              </button>
            ))}
          </div>
        )}

        {mode === "reset" && (
          <div style={{marginBottom:18}}>
            <button onClick={()=>{setMode("login");setError("");setInfo("");}} style={{background:"none",border:"none",color:"rgba(232,226,208,0.6)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,padding:0,display:"flex",alignItems:"center",gap:4}}>
              ← Back to Sign In
            </button>
            <div style={{fontSize:18,fontWeight:700,color:"#e8e2d0",marginTop:10}}>Reset Password</div>
          </div>
        )}

        {info && <div style={{background:"rgba(74,222,128,0.15)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:8,padding:"10px 12px",marginBottom:14,fontSize:13,color:"#86efac",lineHeight:1.4}}>{info}</div>}
        {error && <div style={{background:"rgba(252,129,129,0.15)",border:"1px solid rgba(252,129,129,0.3)",borderRadius:8,padding:"10px 12px",marginBottom:14,fontSize:13,color:"#fca5a5",lineHeight:1.4}}>{error}</div>}

        {/* Email/password form */}
        <form onSubmit={e=>{e.preventDefault();handleEmail(e);}} style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
          <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="Email address" autoComplete="email"
            style={{padding:"12px 14px",borderRadius:10,border:"1px solid rgba(255,255,255,0.15)",background:"rgba(255,255,255,0.08)",color:"#e8e2d0",fontFamily:"'DM Sans',sans-serif",fontSize:14,outline:"none",width:"100%",boxSizing:"border-box"}}/>
          {mode !== "reset" && (
            <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Password" autoComplete={mode==="signup"?"new-password":"current-password"}
              style={{padding:"12px 14px",borderRadius:10,border:"1px solid rgba(255,255,255,0.15)",background:"rgba(255,255,255,0.08)",color:"#e8e2d0",fontFamily:"'DM Sans',sans-serif",fontSize:14,outline:"none",width:"100%",boxSizing:"border-box"}}/>
          )}
          <button type="submit" disabled={loading}
            style={{width:"100%",padding:"13px",borderRadius:10,border:"none",background:"#e8e2d0",color:"#1b4d3e",fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:700,cursor:loading?"default":"pointer",opacity:loading?0.7:1,transition:"opacity .15s"}}>
            {loading ? "..." : mode==="login" ? "Sign In" : mode==="signup" ? "Create Account" : "Send Reset Email"}
          </button>
        </form>

        {mode === "login" && (
          <button onClick={()=>{setMode("reset");setError("");setInfo("");}}
            style={{background:"none",border:"none",color:"rgba(232,226,208,0.5)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,width:"100%",marginBottom:4,padding:0}}>
            Forgot password?
          </button>
        )}
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
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
  const [showCardPhotos, setShowCardPhotos] = useState(true);

  // Auth state
  const [user,       setUser]       = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState(""); // "", "saving", "saved", "error"

  const importRef = useRef();
  const xlsRef    = useRef();
  const syncTimer = useRef(null);

  // ── Init Supabase + listen for auth changes ──
  useEffect(() => {
    if (PREVIEW_MODE) { setAuthLoaded(true); return; }
    (async () => {
      const sb = await initSupabase();
      const { data: { session } } = await sb.auth.getSession();
      if (session?.user) setUser(session.user);
      setAuthLoaded(true);
      sb.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user || null);
      });
    })();
  }, []);

  // ── Load data once auth is resolved ──
  useEffect(() => {
    if (!authLoaded) return;
    (async () => {
      try {
        const dm  = await loadData("pt_darkmode");
        const scp = await loadData("pt_showcardphotos");
        if (dm  !== null) setDarkMode(dm);
        if (scp !== null) setShowCardPhotos(scp);

        if (!PREVIEW_MODE && user) {
          // Logged in — load from Supabase
          const [sbRooms, sbPlants, sbSettings] = await Promise.all([
            sbLoadRooms(user.id),
            sbLoadPlants(user.id),
            sbLoadSettings(user.id),
          ]);
          if (sbSettings) {
            if (sbSettings.dark_mode   !== null) setDarkMode(sbSettings.dark_mode);
            if (sbSettings.show_photos !== null) setShowCardPhotos(sbSettings.show_photos);
          }
          const photoMap = await loadAllPhotos();
          const DEFAULT_ROOMS = [{ id: uid(), name: "Home", order: 1, color: null }];
          const DEFAULT_PLANTS = [];
          const resolvedRooms  = sbRooms  || DEFAULT_ROOMS;
          const resolvedPlants = (sbPlants || DEFAULT_PLANTS).map(plant => {
            const local = photoMap[plant.id];
            return local ? {...plant, photos: local.photos, primaryPhoto: local.primaryPhoto} : plant;
          });
          setRooms(resolvedRooms);
          setPlants(resolvedPlants);
          if (!sbRooms)  await sbSaveRooms(user.id, DEFAULT_ROOMS);
          if (!sbPlants) await sbSavePlants(user.id, DEFAULT_PLANTS);
        } else {
          // Preview mode or not logged in — use local storage
          const r = await loadData("pt_rooms");
          const p = await loadData("pt_plants");
          const photoMap = await loadAllPhotos();
          const rooms  = r || SEED_ROOMS;
          const plants = (p || SEED_PLANTS).map(plant => {
            const stored = photoMap[plant.id];
            return stored ? {...plant, photos: stored.photos, primaryPhoto: stored.primaryPhoto} : plant;
          });
          setRooms(rooms);
          setPlants(plants);
        }
      } catch (e) {
        console.error("Load error:", e);
        setRooms(SEED_ROOMS);
        setPlants(SEED_PLANTS);
      } finally {
        setLoaded(true);
      }
    })();
  }, [authLoaded, user]);

  // ── Auto-refresh at midnight ──
  useEffect(() => {
    const tick = () => {
      const now = fmt(getToday());
      setTodayDate(prev => prev !== now ? now : prev);
    };
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // ── XLSX loader ──
  useEffect(() => {
    if (window.XLSX) { setXlsxReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => setXlsxReady(true);
    document.head.appendChild(s);
  }, []);

  // ── Debounced cloud sync helper ──
  function triggerSync(fn) {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    setSyncStatus("saving");
    syncTimer.current = setTimeout(async () => {
      try { await fn(); setSyncStatus("saved"); setTimeout(()=>setSyncStatus(""),2000); }
      catch { setSyncStatus("error"); }
    }, 1200);
  }

  // ── Save rooms (local + cloud) ──
  const saveReady = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    if (!saveReady.current) { saveReady.current = true; return; }
    if (!rooms) return;
    saveData("pt_rooms", rooms);
    if (!PREVIEW_MODE && user) triggerSync(() => sbSaveRooms(user.id, rooms));
  }, [rooms, loaded]);

  // ── Save plants (local + cloud) ──
  useEffect(() => {
    if (!loaded || !saveReady.current || !plants) return;
    plants.forEach(p => {
      if (p.photos && p.photos.length > 0) savePhotos(p.id, p.photos, p.primaryPhoto);
    });
    const stripped = plants.map(p => ({...p, photos: [], primaryPhoto: null}));
    saveData("pt_plants", stripped);
    if (!PREVIEW_MODE && user) triggerSync(() => sbSavePlants(user.id, plants));
  }, [plants, loaded]);

  // ── Save settings ──
  useEffect(() => {
    if (!loaded) return;
    saveData("pt_darkmode", darkMode);
    if (!PREVIEW_MODE && user) sbSaveSettings(user.id, { dark_mode: darkMode, show_photos: showCardPhotos });
  }, [darkMode, loaded]);
  useEffect(() => {
    document.body.style.background = darkMode ? "#000" : "";
  }, [darkMode]);
  useEffect(() => {
    if (!loaded) return;
    saveData("pt_showcardphotos", showCardPhotos);
    if (!PREVIEW_MODE && user) sbSaveSettings(user.id, { dark_mode: darkMode, show_photos: showCardPhotos });
  }, [showCardPhotos, loaded]);

  // ── Sign out ──
  async function handleSignOut() {
    const sb = getSupabase();
    if (sb) await sb.auth.signOut();
    setUser(null);
    setLoaded(false);
    setScreen("home");
    setRooms([]);
    setPlants([]);
  }

  async function handleDeleteAccount() {
    const sb = getSupabase();
    if (!sb || !user) return;
    try {
      // Delete all user data first
      await Promise.all([
        sb.from("plants").delete().eq("user_id", user.id),
        sb.from("rooms").delete().eq("user_id", user.id),
        sb.from("settings").delete().eq("user_id", user.id),
      ]);
      // Delete account via Supabase edge function (requires admin, so we sign out and show message)
      await sb.auth.signOut();
      setUser(null);
      setLoaded(false);
      setScreen("home");
      setRooms([]);
      setPlants([]);
    } catch(e) {
      console.error("Delete account error", e);
    }
  }

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
      data.plants.forEach(p => {
        if (p.photos && p.photos.length > 0) savePhotos(p.id, p.photos, p.primaryPhoto);
      });
      setRooms(data.rooms);
      setPlants(data.plants);
      if (!PREVIEW_MODE && user) {
        sbSaveRooms(user.id, data.rooms);
        sbSavePlants(user.id, data.plants);
      }
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

  // Show a blank screen while Supabase initializes
  if (!authLoaded) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#1b4d3e",fontFamily:"'DM Sans',sans-serif",color:"#e8e2d0",fontSize:18,flexDirection:"column",gap:16}}>
      <img src="data:image/png;base64,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" alt="" style={{width:72,height:72,borderRadius:16,opacity:0.9}}/>
      <div style={{opacity:0.7}}>Loading…</div>
    </div>
  );

  // Show login screen if not authenticated (skipped in preview mode)
  if (!PREVIEW_MODE && !user) return <LoginScreen onLogin={u => { setUser(u); setScreen("home"); }} />;

  // Show loading spinner while data loads after login
  if (!loaded) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#1b4d3e",fontFamily:"'DM Sans',sans-serif",color:"#e8e2d0",fontSize:18,flexDirection:"column",gap:16}}>
      <img src="data:image/png;base64,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" alt="" style={{width:72,height:72,borderRadius:16,opacity:0.9}}/>
      <div style={{opacity:0.7}}>Loading your plants…</div>
    </div>
  );

  return (
    <>
      <style>{styles}</style>
      <div className={`app${darkMode?" dark":""}`}>
        {/* Sync status indicator */}
        {syncStatus==="saving" && <div style={{position:"fixed",top:8,right:12,fontSize:11,color:"rgba(255,255,255,0.6)",zIndex:999,fontFamily:"'DM Sans',sans-serif"}}>Syncing…</div>}
        {syncStatus==="saved"  && <div style={{position:"fixed",top:8,right:12,fontSize:11,color:"rgba(74,222,128,0.8)",zIndex:999,fontFamily:"'DM Sans',sans-serif"}}>✓ Saved</div>}
        {syncStatus==="error"  && <div style={{position:"fixed",top:8,right:12,fontSize:11,color:"rgba(252,129,129,0.9)",zIndex:999,fontFamily:"'DM Sans',sans-serif"}}>⚠ Sync error</div>}

        {screen==="home"  && <HomeScreen  rooms={rooms} setRooms={setRooms} plants={plants} setPlants={setPlants} todayDate={todayDate} showCardPhotos={showCardPhotos} user={user} />}
        {screen==="water" && <WaterScreen rooms={rooms} plants={plants} setPlants={setPlants} todayDate={todayDate} showCardPhotos={showCardPhotos} user={user} />}
        {screen==="repot" && <RepotScreen rooms={rooms} plants={plants} setPlants={setPlants} todayDate={todayDate} showCardPhotos={showCardPhotos} user={user} />}
        {screen==="utils" && <UtilitiesScreen darkMode={darkMode} setDarkMode={setDarkMode} showCardPhotos={showCardPhotos} setShowCardPhotos={setShowCardPhotos} onExport={exportData} onImport={()=>setShowImport(true)} user={user || (PREVIEW_MODE ? {email:"preview@plantalog.app"} : null)} onSignOut={handleSignOut} onDeleteAccount={handleDeleteAccount} />}
        <Nav screen={screen} setScreen={setScreen} plants={plants} todayDate={todayDate} />

        {/* Import modal — inside .app so dark class applies */}
        {showImport && (
        <div className="modal-overlay" onClick={closeImport}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{paddingBottom:30}}>
            <h2>Import Plants</h2>

            {/* Tabs */}
            <div style={{display:"flex",gap:0,marginBottom:14,background:"var(--sand)",borderRadius:8,padding:3}}>
              {[["xls","📊  Excel Template"],["json","💾  JSON Backup"]].map(([id,label])=>(
                <button key={id} onClick={()=>{setImportTab(id);setImportError("");setXlsPreview(null);}}
                  style={{flex:1,padding:"6px 4px",border:"none",borderRadius:6,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:700,
                    background:importTab===id?"var(--card-bg)":(darkMode?"rgba(255,255,255,0.08)":"transparent"),
                    color:importTab===id?"var(--leaf-light)":(darkMode?"var(--leaf-light)":"var(--text-muted)"),
                    boxShadow:importTab===id?"0 1px 4px rgba(0,0,0,.15)":"none",transition:"all .15s"}}>
                  {label}
                </button>
              ))}
            </div>

            {/* Tab content — fixed min-height so card doesn't shrink between tabs */}
            <div style={{minHeight:220}}>

            {/* ── Excel tab ── */}
            {importTab==="xls" && !xlsPreview && (
              <>
                <p style={{fontSize:12,color:"var(--text-muted)",marginBottom:12,lineHeight:1.5}}>
                  Download the template, fill it in with your plants, then upload it here. Your existing rooms will be pre-filled on the Rooms tab.
                </p>
                <button onClick={downloadTemplate}
                  style={{width:"100%",padding:"10px",marginBottom:14,borderRadius:9,border:"1.5px dashed var(--leaf-light)",background:"var(--leaf-pale)",color:darkMode?"var(--leaf-light)":"var(--leaf)",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download Template (.xlsx)
                </button>
                <div style={{textAlign:"center",fontSize:11,color:"var(--text-muted)",marginBottom:10}}>— then —</div>
                <button onClick={()=>xlsRef.current.click()} disabled={!xlsxReady}
                  style={{width:"100%",padding:"10px",borderRadius:9,border:"1.5px solid var(--border)",background:"var(--card-bg)",color:"var(--text)",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600,cursor:xlsxReady?"pointer":"default",opacity:xlsxReady?1:0.6,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  {xlsLoading ? "Reading file…" : "Upload Completed Template"}
                </button>
                <input ref={xlsRef} type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={handleXlsFile}/>
                {importError && <div style={{fontSize:11,color:"#fc8181",marginTop:8,lineHeight:1.5}}>{importError}</div>}
              </>
            )}

            {/* ── Excel preview / confirm ── */}
            {importTab==="xls" && xlsPreview && (
              <>
                <div style={{background:"var(--leaf-pale)",border:"1px solid var(--leaf-light)",borderRadius:8,padding:"9px 12px",marginBottom:10}}>
                  <div style={{fontSize:12,fontWeight:700,color:"var(--leaf)",marginBottom:2}}>✓ {xlsPreview.plants.length} plant{xlsPreview.plants.length!==1?"s":""} ready to import</div>
                  <div style={{fontSize:11,color:"var(--leaf)"}}>{xlsPreview.plants.slice(0,5).map(p=>p.name).join(", ")}{xlsPreview.plants.length>5?` + ${xlsPreview.plants.length-5} more`:""}</div>
                </div>
                {xlsPreview.warnings.length>0 && (
                  <div style={{background:"var(--sand)",border:"1px solid var(--border)",borderRadius:8,padding:"8px 12px",marginBottom:10,maxHeight:80,overflowY:"auto"}}>
                    <div style={{fontSize:11,fontWeight:700,color:"var(--bark)",marginBottom:3}}>⚠ {xlsPreview.warnings.length} warning{xlsPreview.warnings.length!==1?"s":""}</div>
                    {xlsPreview.warnings.map((w,i)=><div key={i} style={{fontSize:10,color:"var(--bark)"}}>{w}</div>)}
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
                <label style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,width:"100%",padding:"14px 10px",borderRadius:8,border:"2px dashed var(--border-strong)",cursor:"pointer",color:"var(--text-muted)",fontSize:13,fontWeight:600,background:"var(--page-bg)"}}>
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
                {importError && <div style={{fontSize:11,color:"#fc8181",marginTop:6}}>{importError}</div>}
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

            </div>{/* end fixed-height tab content */}
          </div>
        </div>
        )}
      </div>
    </>
  );
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
function Nav({ screen, setScreen, plants, todayDate }) {
  const now = todayDate ? new Date(todayDate+"T00:00:00") : getToday();
  const due = plants ? plants.filter(p=>isWaterDue(p,now)).length : 0;
  return (
    <nav className="nav">
      <button className={`nav-btn home${screen==="home" ?" active":""}`} onClick={()=>{ setScreen("home"); window.scrollTo({top:0,behavior:"instant"}); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>
        Home
      </button>
      <button className={`nav-btn water${screen==="water"?" active water":""}`} onClick={()=>{ setScreen("water"); window.scrollTo({top:0,behavior:"instant"}); }}>
        {due>0 && <span className="nav-badge">{due}</span>}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2C6 9 4 13.5 4 16a8 8 0 0016 0c0-2.5-2-7-8-14z"/></svg>
        Water
      </button>
      <button className={`nav-btn repot${screen==="repot"?" active repot":""}`} onClick={()=>{ setScreen("repot"); window.scrollTo({top:0,behavior:"instant"}); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2v10M8 6l4-4 4 4M5 14h14l-2 7H7l-2-7z"/></svg>
        Repot
      </button>
      <button className={`nav-btn utils${screen==="utils"?" active utils":""}`} onClick={()=>{ setScreen("utils"); window.scrollTo({top:0,behavior:"instant"}); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
        Utils
      </button>
    </nav>
  );
}

// ─── PlantCard (shared compact card) ─────────────────────────────────────────
// mode: "home" | "water" | "repot"
function PlantCard({ plant, rooms, onClick, onEdit, onCheck, onFreqInc, mode="home", leaving=false, showCardPhotos=true }) {
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
      {showCardPhotos && (
      <div className="plant-thumb">
        {photo ? <img src={photo} alt={plant.name}/> : <span>🌿</span>}
      </div>
      )}

      {/* Name + sub */}
      <div className="plant-name-col">
        <div className="plant-name">{plant.name}</div>
        {mode==="repot" && room && (
          <div style={{display:"flex",gap:4,alignItems:"center",marginTop:2,flexWrap:"wrap"}}>
            {room.color
              ? <span style={{background:room.color,color:roomTextColor(room.color),padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:700,whiteSpace:"nowrap",display:"inline-block"}}>{room.name}</span>
              : <span style={{fontSize:10,fontWeight:700,color:"var(--text-muted)"}}>{room.name}</span>
            }
            {plant.originalPot && <span style={{background:"transparent",color:"#c1603a",border:"1.5px solid #c1603a",padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:700,whiteSpace:"nowrap",display:"inline-block",letterSpacing:".3px"}}>ORIGINAL</span>}
          </div>
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
          <div className="stat-tile" title="Days until next watering" style={{background:daysLeft<0?"#fee2e2":daysLeft===0?"#0e7490":daysLeft===1?"#bee3f8":"var(--page-bg)"}}>
            <div className="st-lbl" style={{color:daysLeft<0?"#9b1c1c":daysLeft===0?"rgba(255,255,255,0.75)":daysLeft===1?"#2b6cb0":"var(--text-muted)"}}>Next</div>
            <div className="st-val" style={{color:daysLeft<0?"#9b1c1c":daysLeft===0?"#ffffff":daysLeft===1?"#1a365d":"var(--text)"}}>
              {daysLeft<0?`${daysLeft}d`:daysLeft===0?"Now":`${daysLeft}d`}
            </div>
          </div>
          <div className="stat-tile" title={potDue?"Due for repotting":"Pot age"} style={{background:potBg}}>
            <div className="st-lbl">Pot Age</div>
            <div className="st-val" style={{color:potColor}}>{plantAgeDecimal(plant.pottedDate)}</div>
          </div>
          <div className="stat-tile phone-hide" title="Plant age" style={{background:"var(--page-bg)"}}>
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
            style={{background:daysLeft<0?"#fee2e2":daysLeft===0?"#0e7490":"var(--page-bg)"}}>
            <div className="st-lbl" style={{color:daysLeft<0?"#9b1c1c":daysLeft===0?"rgba(255,255,255,0.75)":"var(--text-muted)"}}>Next</div>
            <div className="st-val" style={{color:daysLeft<0?"#9b1c1c":daysLeft===0?"#ffffff":"var(--text)"}}>
              {daysLeft===0?"Now":daysLeft<0?`${daysLeft}d`:`${daysLeft}d`}
            </div>
          </div>
        </>}

        {/* REPOT tiles */}
        {mode==="repot" && <>
          <div className="stat-tile phone-hide" title="Current pot size" style={{background:"var(--page-bg)"}}>
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
function HomeScreen({ rooms, setRooms, plants, setPlants, showCardPhotos=true, user }) {
  const [showModal,    setShowModal]    = useState(false);
  const [editPlant,    setEditPlant]    = useState(null);
  const [detailPlant,  setDetailPlant]  = useState(null);
  const [homeTab,      setHomeTab]      = useState("plants");
  const openNewRef = useRef(null);
  // null = all, 1-4 = health filter
  const [healthFilter, setHealthFilter] = useState(null);
  const [collapsedRooms, setCollapsedRooms] = useState({});

  const healthCounts = [1,2,3,4].map(h=>plants.filter(p=>p.health===h).length);
  const greenCount   = healthCounts[2]+healthCounts[3];
  const greenPct     = plants.length ? Math.round(greenCount/plants.length*100) : 0;
  const sortedRooms  = [...rooms].sort((a,b)=>(a.order??0)-(b.order??0));

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
        <button onClick={()=>{ if(homeTab==="plants"){ setEditPlant(null); setShowModal(true); } else { openNewRef.current?.(); } }}
          style={{marginLeft:4,flexShrink:0,padding:"8px 14px",borderRadius:7,background:"var(--leaf)",color:"white",border:"none",cursor:"pointer",fontSize:15,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>&#xff0b;</button>
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
                  <PlantCard key={plant.id} plant={plant} rooms={rooms} mode="home" showCardPhotos={showCardPhotos}
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
        <div className="section"><ManageRooms rooms={rooms} setRooms={setRooms} plants={plants} user={user} openNewRef={openNewRef}/></div>
      )}


      {showModal && (
        <PlantModal
          plant={editPlant} rooms={rooms}
          onSave={p=>{ if(editPlant) setPlants(ps=>ps.map(x=>x.id===p.id?p:x)); else setPlants(ps=>[...ps,{...p,id:uid()}]); setShowModal(false); setEditPlant(null); setDetailPlant(null); }}
          onDelete={editPlant?()=>{ deletePhotos(editPlant.id); if(!PREVIEW_MODE&&user) sbDeletePlant(user.id,editPlant.id); setPlants(ps=>ps.filter(x=>x.id!==editPlant.id)); setShowModal(false); setEditPlant(null); setDetailPlant(null); }:null}
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
              <span style={{
                background: potDue ? "var(--pot-due-bg, #fee2e2)" : "var(--sand)",
                border: `1.5px solid ${potDue ? "var(--pot-due-border, #fca5a5)" : "var(--potting-border, #6b422630)"}`,
                borderRadius:20, padding:"2px 9px", fontSize:11, fontWeight:700,
                color: potDue ? "var(--pot-due-text, #991b1b)" : "var(--text)",
                whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:4
              }}><span style={{opacity:.7,fontWeight:600}}>Pot Age:</span>{plantAgeDecimal(plant.pottedDate)}</span>
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
              <div style={{background:"var(--card-bg)",borderRadius:9,padding:"7px 10px",boxShadow:"var(--shadow)"}}>
                <div className="tile-lbl" style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:".4px",marginBottom:3}}>Next Pot</div>
                <div className="info-val" style={{fontSize:22,fontWeight:700,color:"var(--leaf)"}}>{plant.nextPotSize}"</div>
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
function ManageRooms({ rooms, setRooms, plants, user, openNewRef }) {
  const [editing,setEditing]=useState(null);
  const [formName,setFormName]=useState("");
  const [formOrder,setFormOrder]=useState("");
  const [formColor,setFormColor]=useState(null);
  const sorted=[...rooms].sort((a,b)=>(a.order??0)-(b.order??0));
  function openNew(){setEditing({});setFormName("");setFormOrder(rooms.length+1);setFormColor(null);}
  useEffect(()=>{ if(openNewRef) openNewRef.current = openNew; });
  function openEdit(r){setEditing(r);setFormName(r.name);setFormOrder(r.order);setFormColor(r.color||null);}
  function save(){
    if(!formName.trim())return;
    if(editing.id) setRooms(rs=>rs.map(r=>r.id===editing.id?{...r,name:formName,order:Number(formOrder),color:formColor}:r));
    else setRooms(rs=>[...rs,{id:uid(),name:formName,order:Number(formOrder),color:formColor}]);
    setEditing(null);
  }
  function del(id){if(plants.some(p=>p.roomId===id)){alert("Move or delete this room's plants first.");return;} if(!PREVIEW_MODE&&user) sbDeleteRooms(user.id,[id]); setRooms(rs=>rs.filter(r=>r.id!==id));}
  return(<>
    {sorted.map(r=>(
      <div key={r.id} className="room-list-item">
        <div style={{background:r.color||"var(--bark)",color:r.color?roomTextColor(r.color):"white",borderRadius:"50%",width:25,height:25,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0}}>{r.order}</div>
        <div><div className="room-list-name" style={{fontWeight:700,fontSize:15}}>{r.name}</div><div className="room-list-count" style={{fontSize:12,color:"var(--text-muted)",marginTop:1}}>{plants.filter(p=>p.roomId===r.id).length} plants</div></div>
        <div className="room-actions"><button className="icon-btn" onClick={()=>openEdit(r)}>✎</button><button className="icon-btn" onClick={()=>del(r.id)}>🗑</button></div>
      </div>
    ))}
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
  const sortedRooms=[...rooms].sort((a,b)=>(a.order??0)-(b.order??0));
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
function WaterScreen({ rooms, plants, setPlants, todayDate, showCardPhotos=true, user }) {
  const now = new Date(todayDate + "T00:00:00");
  const [leaving,    setLeaving]    = useState({});
  const [openFreq,   setOpenFreq]   = useState(null);
  const [freqPick,   setFreqPick]   = useState(null);
  const [freqCustom, setFreqCustom] = useState("");
  const [detailPlant,setDetailPlant]= useState(null);
  const [editPlant,  setEditPlant]  = useState(null);
  const [showModal,  setShowModal]  = useState(false);

  const sortedRooms = [...rooms].sort((a,b)=>(a.order??0)-(b.order??0));
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
              <PlantCard plant={plant} rooms={rooms} mode="water" showCardPhotos={showCardPhotos}
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
              <PlantCard key={plant.id} plant={plant} rooms={rooms} mode="water" showCardPhotos={showCardPhotos}
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
        onDelete={()=>{ deletePhotos(editPlant.id); if(!PREVIEW_MODE&&user) sbDeletePlant(user.id,editPlant.id); setPlants(ps=>ps.filter(x=>x.id!==editPlant.id)); setShowModal(false); setEditPlant(null); }}
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
function RepotScreen({ rooms, plants, setPlants, todayDate, showCardPhotos=true, user }) {
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
          <PlantCard key={plant.id} plant={plant} rooms={rooms} mode="repot" showCardPhotos={showCardPhotos}
            leaving={!!leaving[plant.id]}
            onClick={()=>setDetailPlant(plant)}
            onCheck={()=>repot(plant.id)}
          />
        ))}
      </div>
      {showModal && <PlantModal plant={editPlant} rooms={rooms}
        onSave={p=>{ setPlants(ps=>ps.map(x=>x.id===p.id?p:x)); setShowModal(false); setEditPlant(null); }}
        onDelete={()=>{ deletePhotos(editPlant.id); if(!PREVIEW_MODE&&user) sbDeletePlant(user.id,editPlant.id); setPlants(ps=>ps.filter(x=>x.id!==editPlant.id)); setShowModal(false); setEditPlant(null); }}
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
function UtilitiesScreen({ darkMode, setDarkMode, showCardPhotos, setShowCardPhotos, onExport, onImport, user, onSignOut, onDeleteAccount }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <>
      <div className="page-header slate">
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
          <div className="util-row">
            <div>
              <div className="util-label">Show Photos on Cards</div>
              <div className="util-sublabel">Display plant photo thumbnails in lists</div>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={showCardPhotos} onChange={e=>setShowCardPhotos(e.target.checked)}/>
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

        {user && <>
          <div style={{fontSize:12,fontWeight:700,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:".7px",marginBottom:6,paddingLeft:2,marginTop:16}}>Account</div>
          <div className="util-section">
            <div className="util-row">
              <div>
                <div className="util-label">Signed In</div>
                <div className="util-sublabel">{user.email || "via OAuth"}</div>
              </div>
              <button className="util-btn secondary" onClick={onSignOut}>Sign Out</button>
            </div>
            <div className="util-row">
              <div>
                <div className="util-label" style={{color:"#e53e3e"}}>Delete Account</div>
                <div className="util-sublabel">Permanently remove all your data</div>
              </div>
              {!confirmDelete
                ? <button className="util-btn" style={{background:"#fff5f5",color:"#e53e3e",border:"1.5px solid #fed7d7"}} onClick={()=>setConfirmDelete(true)}>Delete</button>
                : <div style={{display:"flex",gap:6}}>
                    <button className="util-btn secondary" onClick={()=>setConfirmDelete(false)}>Cancel</button>
                    <button className="util-btn" style={{background:"#e53e3e",color:"white"}} onClick={onDeleteAccount}>Confirm</button>
                  </div>
              }
            </div>
          </div>
        </>}
      </div>
    </>
  );
}

export default App;
