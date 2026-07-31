// React hooks from global
const { useState, useEffect, useLayoutEffect, useRef, useCallback } = React;

// ─── Preview Mode ─────────────────────────────────────────────────────────────
// Set to true to bypass login and use local data (for Claude preview)
// Set to false for production (GitHub Pages)
const PREVIEW_MODE = false;

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
    // Save photo URLs and primaryPhoto in the DB row so order and favorite persist
    // (photos are stored in Storage; we save just the URLs here for ordering)
    return { id, user_id: userId, data: rest };
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

// Upload a single base64 photo to Supabase Storage, returns public URL or null
async function sbSavePhoto(userId, plantId, filename, base64Data) {
  const sb = getSupabase();
  if (!sb || !base64Data) return null;
  try {
    const res = await fetch(base64Data);
    const blob = await res.blob();
    const path = `${userId}/${plantId}/${filename}`;
    const { error } = await sb.storage.from("plant-photos").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
    if (error) { console.error("sbSavePhoto", error); return null; }
    const { data } = sb.storage.from("plant-photos").getPublicUrl(path);
    return data.publicUrl;
  } catch(e) { console.error("sbSavePhoto error", e); return null; }
}

// Upload multiple photos for a plant, returns array of URLs
// New base64 photos get a unique timestamp filename; existing URLs are kept as-is
async function sbSaveAllPhotos(userId, plantId, photos) {
  const urls = [];
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    if (photo && (photo.startsWith("http://") || photo.startsWith("https://"))) {
      urls.push(photo);
    } else {
      const filename = `${Date.now()}_${i}.jpg`;
      const url = await sbSavePhoto(userId, plantId, filename, photo);
      urls.push(url || photo);
    }
  }
  return urls;
}

// Delete a single photo by URL from Supabase Storage
async function sbDeleteSinglePhoto(userId, plantId, photoUrl) {
  const sb = getSupabase();
  if (!sb || !photoUrl) return;
  try {
    // Extract filename from URL
    const parts = photoUrl.split(`${userId}/${plantId}/`);
    if (parts.length < 2) return;
    const filename = parts[1].split("?")[0];
    await sb.storage.from("plant-photos").remove([`${userId}/${plantId}/${filename}`]);
  } catch(e) { console.error("sbDeleteSinglePhoto error", e); }
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

// Migrate all IndexedDB photos to Supabase Storage for a user's plants
// Called once on login if IndexedDB has photos
async function migratePhotosToSupabase(userId, plants, setPlants) {
  const photoMap = await loadAllPhotos();
  if (!photoMap || Object.keys(photoMap).length === 0) return;
  console.log("Migrating photos to Supabase...", Object.keys(photoMap).length, "plants with photos");
  const updatedPlants = [...plants];
  for (let i = 0; i < updatedPlants.length; i++) {
    const plant = updatedPlants[i];
    const local = photoMap[plant.id];
    if (!local || !local.photos || local.photos.length === 0) continue;
    // Skip if photos already look like URLs (already migrated)
    if (local.photos[0] && (local.photos[0].startsWith("http://") || local.photos[0].startsWith("https://"))) {
      await deletePhotos(plant.id);
      continue;
    }
    console.log(`Migrating ${local.photos.length} photos for plant ${plant.id}`);
    const urls = await sbSaveAllPhotos(userId, plant.id, local.photos);
    updatedPlants[i] = { ...plant, photos: urls, primaryPhoto: local.primaryPhoto };
    await deletePhotos(plant.id); // clear from IndexedDB after successful upload
  }
  setPlants(updatedPlants);
  console.log("Photo migration complete.");
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

// ─── Photo capture date ───────────────────────────────────────────────────────
// Reads the real capture date out of a JPEG's EXIF block (tag DateTimeOriginal,
// falling back to DateTime). This matters because users often upload OLD photos
// of their plants — upload time would be wrong for them. Falls back to the
// file's lastModified, then to today.
function readExifDate(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = e => {
      try {
        const view = new DataView(e.target.result);
        if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return resolve(null); // not a JPEG
        let offset = 2;
        while (offset < view.byteLength - 4) {
          const marker = view.getUint16(offset);
          if ((marker & 0xFF00) !== 0xFF00) break;
          if (marker === 0xFFE1) {                                  // APP1 (holds EXIF)
            const exifStart = offset + 4;
            if (view.getUint32(exifStart) !== 0x45786966) return resolve(null); // "Exif"
            const tiff = exifStart + 6;
            const little = view.getUint16(tiff) === 0x4949;
            if (view.getUint16(tiff + 2, little) !== 0x002A) return resolve(null);
            const readIFD = (ifdOffset, wanted) => {
              const count = view.getUint16(ifdOffset, little);
              for (let i = 0; i < count; i++) {
                const entry = ifdOffset + 2 + i * 12;
                const tag = view.getUint16(entry, little);
                if (tag !== wanted) continue;
                const valOff = tiff + view.getUint32(entry + 8, little);
                let s = "";
                for (let c = 0; c < 19; c++) s += String.fromCharCode(view.getUint8(valOff + c));
                return s;
              }
              return null;
            };
            const findPointer = (ifdOffset, wanted) => {
              const count = view.getUint16(ifdOffset, little);
              for (let i = 0; i < count; i++) {
                const entry = ifdOffset + 2 + i * 12;
                if (view.getUint16(entry, little) === wanted)
                  return tiff + view.getUint32(entry + 8, little);
              }
              return null;
            };
            const ifd0 = tiff + view.getUint32(tiff + 4, little);
            const exifIFD = findPointer(ifd0, 0x8769);
            const raw = (exifIFD && readIFD(exifIFD, 0x9003)) || readIFD(ifd0, 0x0132);
            if (!raw) return resolve(null);
            const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})/);   // "YYYY:MM:DD HH:MM:SS"
            return resolve(m ? `${m[1]}-${m[2]}-${m[3]}` : null);
          }
          offset += 2 + view.getUint16(offset + 2);
        }
        resolve(null);
      } catch (err) { resolve(null); }
    };
    reader.readAsArrayBuffer(file.slice(0, 262144)); // EXIF lives in the header
  });
}

async function derivePhotoDate(file) {
  const exif = await readExifDate(file);
  if (exif) return exif;
  if (file && file.lastModified) return fmt(new Date(file.lastModified));
  return fmt(getToday());
}

const MONTH_NAMES = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];

// "2025-12-12" -> "December 12, 2025"
function prettyPhotoDate(d) {
  if (!d) return null;
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${MONTH_NAMES[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// Photos are kept oldest -> newest so a plant's growth reads left to right.
// Undated photos (uploaded before dates were recorded) sort to the end and
// keep their existing relative order. Sorting the stored arrays rather than
// just the display keeps primaryPhoto indexes valid everywhere.
function sortPhotosByDate(photos, photoDates, primaryPhoto) {
  if (!photos || !photos.length) return { photos: [], photoDates: [], primaryPhoto: null };
  const dates = Array.isArray(photoDates) ? photoDates : [];
  const primary = primaryPhoto == null ? 0 : primaryPhoto;
  const order = photos.map((_, i) => i);
  order.sort((a, b) => {
    const da = dates[a] || null, db = dates[b] || null;
    if (da && db) return da < db ? -1 : da > db ? 1 : a - b;  // ties keep original order
    if (da) return -1;
    if (db) return 1;
    return a - b;
  });
  const newPrimary = order.indexOf(primary);
  return {
    photos:       order.map(i => photos[i]),
    photoDates:   order.map(i => dates[i] || null),
    primaryPhoto: newPrimary < 0 ? null : newPrimary,
  };
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

function plantAgeDecimal(d, asOf) {
  const days = daysBetween(d, asOf ? fmt(new Date(String(asOf).slice(0,10)+"T12:00:00")) : fmt(getToday()));
  if (days < 30) return `${days}d`;
  return `${(days/365).toFixed(1)}y`;
}

// ─── Plant status: active / graveyard / recently deleted ─────────────────────
// plant.status      undefined = active | "graveyard" | "deleted"
// plant.diedDate    set when moved to the Graveyard
// plant.deletedDate set when moved to Recently Deleted
// plant.deletedFrom "active" | "graveyard" — where Restore sends it back to
const PURGE_DAYS = 30;
const isActivePlant = p => !p.status;

// Graveyard plants stop aging — everything is measured as of the day they died.
// A deleted plant that came from the graveyard keeps that frozen date too.
function ageAsOf(plant) {
  if (!plant) return null;
  if (plant.status === "graveyard") return plant.diedDate || null;
  if (plant.status === "deleted")   return plant.diedDate || null;
  return null;
}

function daysUntilPurge(plant, now) {
  if (!plant.deletedDate) return PURGE_DAYS;
  return PURGE_DAYS - daysBetween(plant.deletedDate, fmt(now || getToday()));
}

// "2026-12-12" -> "Dec 12, 2026"
// Push notification body text — mirrors the requested copy exactly for 2+
// plants ("You have plants ready..."), switching to "a plant" for exactly one.
// Emoji reaction for the Health Score tooltip. Bands are contiguous across
// 0-100 (the requested "51-74%" is treated as 50-74% so there's no gap at 50).
function healthScoreEmoji(pct) {
  if (pct <= 14) return "😵";
  if (pct <= 49) return "😬";
  if (pct <= 74) return "😊";
  if (pct <= 94) return "🥰";
  return "🤩";
}

// ─── Watering schedule (PDF) ──────────────────────────────────────────────────
const WATER_PDF_MAX_DAYS = 90;

function addDaysStr(dateStr, n) {
  const d = new Date(String(dateStr).slice(0,10) + "T12:00:00");
  d.setDate(d.getDate() + n);
  return fmt(d);
}

// Inclusive day count between two YYYY-MM-DD strings.
function rangeLengthDays(from, to) {
  return daysBetween(from, to) + 1;
}

function prettyLongDate(dateStr) {
  const d = new Date(String(dateStr).slice(0,10) + "T12:00:00");
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  return `${days[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

function shortDate(dateStr) {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr;
  return `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}`;
}

// Projects each plant's watering forward across the range. The app only knows
// a plant's NEXT due date; beyond that we assume it actually gets watered on
// schedule, so a 7-day plant due 8/1 also appears on 8/8 and 8/15. Plants
// already overdue are rolled forward into the range on the same assumption.
function buildWateringSchedule(plants, rooms, from, to) {
  const active = (plants || []).filter(p => isActivePlant(p) && Number(p.waterFreqDays) > 0);
  const byDate = {};

  active.forEach(p => {
    const freq = Number(p.waterFreqDays);
    let due = addDaysStr(p.lastWatered, freq);
    // Roll forward until we reach the window (covers overdue plants).
    let guard = 0;
    while (daysBetween(due, from) > 0 && guard++ < 5000) due = addDaysStr(due, freq);
    // Then step through the window.
    guard = 0;
    while (daysBetween(due, to) >= 0 && guard++ < 5000) {
      (byDate[due] ||= []).push(p);
      due = addDaysStr(due, freq);
    }
  });

  const sortedRooms = [...(rooms || [])].sort((a,b) => (a.order??0) - (b.order??0));
  return Object.keys(byDate).sort().map(date => ({
    date,
    rooms: sortedRooms.map(room => ({
      room,
      plants: byDate[date]
        .filter(p => p.roomId === room.id)
        .sort((a,b) => a.name.localeCompare(b.name)),
    })).filter(g => g.plants.length),
  }));
}

// Turn a photo URL (remote or data URL) into a data URL jsPDF can embed.
// Resolves to null rather than throwing on any failure, so one unreachable
// image can never stop the whole document from generating.
function dataUrlImageFormat(dataUrl) {
  return /^data:image\/png/i.test(String(dataUrl)) ? "PNG" : "JPEG";
}

function loadPhotoDataUrl(url) {
  return new Promise(resolve => {
    if (!url) return resolve(null);
    if (url.startsWith("data:")) return resolve(url);
    let settled = false;
    const done = v => { if (!settled) { settled = true; resolve(v); } };
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        // Square crop from the centre so every tile matches. Corner rounding is
        // applied later as a PDF clip, not here.
        const size = 240;                       // enough detail for a ~1in print tile
        const c = document.createElement("canvas");
        c.width = c.height = size;
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        c.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, size, size);
        done(c.toDataURL("image/jpeg", 0.8));
      } catch (e) { done(null); }              // tainted canvas (missing CORS headers)
    };
    img.onerror = () => done(null);
    setTimeout(() => done(null), 8000);        // never hang the whole export
    img.src = url;
  });
}

// Builds the watering schedule PDF. Letter portrait, 0.5" (36pt) margins all
// round. Returns the jsPDF doc so the caller decides how to deliver it.
async function generateWateringPdf({ plants, rooms, from, to }) {
  const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFCtor) throw new Error("PDF library not loaded yet. Give it a moment and try again.");

  const schedule = buildWateringSchedule(plants, rooms, from, to);

  // Pre-load every distinct photo once, in parallel.
  const urls = [...new Set(schedule.flatMap(d => d.rooms.flatMap(r => r.plants.map(getPrimaryPhoto))).filter(Boolean))];
  const loaded = await Promise.all(urls.map(loadPhotoDataUrl));
  const photos = {};
  urls.forEach((u, i) => { photos[u] = loaded[i]; });

  const doc = new jsPDFCtor({ unit:"pt", format:"letter" });
  const M = 36;                                   // 0.5 inch
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const CONTENT_W = PAGE_W - M * 2;
  const BOTTOM = PAGE_H - M;
  const LEAF = [45,106,79], INK = [30,20,16], MUTED = [122,96,85], LINE = [221,213,196];

  // Tiled layout: an image big enough to be recognisable dominates the space,
  // so packing plants into a grid uses the page far better than one full-width
  // row each. Three columns fit the 7.5in content width comfortably.
  const COLS = 3, GAP = 10;
  const TILE_W = (CONTENT_W - GAP * (COLS - 1)) / COLS;
  const IMG = 82;                                  // was 34, then 68
  const NAME_H = 19;                               // room for up to 2 wrapped lines
  const TILE_H = NAME_H + IMG + 5;
  const ROOM_H = 17, DATE_H = 22;
  let y = M;

  function rgb(hex) {
    const h = String(hex || "").replace("#","");
    if (h.length !== 6) return [92,64,51];        // fall back to --bark
    return [0,2,4].map(i => parseInt(h.slice(i,i+2),16));
  }
  function need(h) {
    if (y + h <= BOTTOM) return;
    doc.addPage();
    y = M;
  }
  function checkbox(x, cy, label) {
    const s = 9;
    doc.setDrawColor(140,140,140); doc.setLineWidth(0.8);
    doc.rect(x, cy - s + 1, s, s, "S");
    doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text(label, x + s + 3.5, cy);
  }

  // ── Title block ──
  doc.setFont("helvetica","bold"); doc.setFontSize(24); doc.setTextColor(...LEAF);
  doc.text("OOT Water Schedule", M, y + 18);
  y += 26;
  doc.setFont("helvetica","normal"); doc.setFontSize(10.5); doc.setTextColor(...MUTED);
  doc.text(`${shortDate(from)} to ${shortDate(to)}`, M, y + 8);
  y += 16;
  doc.setDrawColor(...LINE); doc.setLineWidth(1);
  doc.line(M, y, M + CONTENT_W, y);
  y += 16;

  if (!schedule.length) {
    doc.setFont("helvetica","normal"); doc.setFontSize(11); doc.setTextColor(...MUTED);
    doc.text("No plants need water in this date range.", M, y + 10);
    return doc;
  }

  schedule.forEach(day => {
    // Keep a date heading with at least its first room and one row of tiles.
    need(DATE_H + ROOM_H + TILE_H);
    doc.setFont("helvetica","bold"); doc.setFontSize(13); doc.setTextColor(...INK);
    doc.text(prettyLongDate(day.date), M, y + 11);
    const count = day.rooms.reduce((n,g) => n + g.plants.length, 0);
    doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...MUTED);
    doc.text(`${count} plant${count===1?"":"s"}`, M + CONTENT_W, y + 11, { align:"right" });
    y += 15;
    doc.setDrawColor(...LINE); doc.setLineWidth(0.7);
    doc.line(M, y, M + CONTENT_W, y);
    y += 7;

    day.rooms.forEach(group => {
      need(ROOM_H + TILE_H);
      doc.setFillColor(...rgb(group.room.color));
      doc.roundedRect(M, y, CONTENT_W, ROOM_H, 4, 4, "F");
      const light = roomTextColor(group.room.color || "#5c4033") === "#ffffff";
      doc.setTextColor(...(light ? [255,255,255] : [30,20,16]));
      doc.setFont("helvetica","bold"); doc.setFontSize(9.5);
      doc.text(group.room.name, M + 8, y + 12);
      y += ROOM_H + 5;

      // Lay the room's plants out in rows of COLS tiles.
      for (let i = 0; i < group.plants.length; i += COLS) {
        const rowPlants = group.plants.slice(i, i + COLS);
        need(TILE_H);
        const rowTop = y;

        rowPlants.forEach((p, col) => {
          const x = M + col * (TILE_W + GAP);

          // Name above the image, wrapped to at most two lines.
          doc.setFont("helvetica","bold"); doc.setFontSize(9.5); doc.setTextColor(...INK);
          const lines = doc.splitTextToSize(String(p.name || ""), TILE_W).slice(0, 2);
          lines.forEach((ln, li) => doc.text(ln, x, rowTop + 8 + li * 9.5));

          const imgTop = rowTop + NAME_H;
          const src = photos[getPrimaryPhoto(p)];
          let drew = false;
          if (src) {
            try {
              // Clip to a rounded rect so the photo itself has curved corners.
              doc.saveGraphicsState();
              doc.roundedRect(x, imgTop, IMG, IMG, IMG * 0.10, IMG * 0.10, null);
              doc.clip(); doc.discardPath();
              doc.addImage(src, dataUrlImageFormat(src), x, imgTop, IMG, IMG);
              doc.restoreGraphicsState();
              drew = true;
            } catch (e) {
              try { doc.restoreGraphicsState(); } catch (e2) {}
              drew = false;
            }
          }
          if (!drew) {
            doc.setDrawColor(...LINE); doc.setLineWidth(0.8);
            doc.roundedRect(x, imgTop, IMG, IMG, IMG * 0.10, IMG * 0.10, "S");
          }

          // Frequency and the two boxes sit beside the image.
          const sideX = x + IMG + 8;
          doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
          doc.text(`Every ${p.waterFreqDays} days`, sideX, imgTop + 9);
          checkbox(sideX, imgTop + 32, "Watered");
          checkbox(sideX, imgTop + 51, "Not Ready");
        });

        y = rowTop + TILE_H;
      }
      y += 4;
    });
    y += 6;
  });

  // Footer page numbers
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text("Plantalog", M, PAGE_H - 18);
    doc.text(`Page ${i} of ${pages}`, M + CONTENT_W, PAGE_H - 18, { align:"right" });
  }
  return doc;
}

function notificationMessage(kind, count) {
  const subject = count === 1 ? "a plant" : "plants";
  return kind === "water"
    ? `You have ${subject} ready for watering today!`
    : `You have ${subject} ready for a repot today!`;
}

function formatDiedDate(d) {
  const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "-";
  return `${MONTH_NAMES[Number(m[2]) - 1].slice(0,3)} ${Number(m[3])}, ${m[1]}`;
}

// Move a plant to the Graveyard or to Recently Deleted. Photos are deliberately
// left in place — both lists still show them, so they're only removed on purge.
function movePlantTo(setPlants, plantId, destination) {
  const today = fmt(getToday());
  setPlants(ps => ps.map(p => {
    if (p.id !== plantId) return p;
    if (destination === "graveyard")
      return { ...p, status:"graveyard", diedDate: p.diedDate || today };
    return { ...p, status:"deleted", deletedDate: today,
             deletedFrom: p.status === "graveyard" ? "graveyard" : "active" };
  }));
}

// Restore: caller specifies "active" or "graveyard" — the person chooses this
// explicitly in the confirm dialog now, rather than it being inferred.
function restorePlant(setPlants, plant, destination = "active") {
  setPlants(ps => ps.map(p => {
    if (p.id !== plant.id) return p;
    if (destination === "graveyard") {
      const { deletedDate, deletedFrom, ...rest } = p;
      // Prefer an existing died date (it came from the Graveyard originally);
      // otherwise it died on the day it was deleted, not today.
      return { ...rest, status:"graveyard", diedDate: p.diedDate || p.deletedDate || fmt(getToday()) };
    }
    const { deletedDate, deletedFrom, diedDate, status, ...rest } = p;
    return rest;   // fully active again
  }));
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
  if(!total) return "-";
  return total===Math.floor(total) ? total+"y" : total.toFixed(1)+"y";
}
function isPotDue(p,now) { const pd=daysBetween(p.pottedDate,fmt(now||getToday())),dd=(p.potYears*365)+(p.potMonths*30); return dd>0&&pd>=dd; }
function potOverdueDays(p,now){ const pd=daysBetween(p.pottedDate,fmt(now||getToday())),dd=(p.potYears*365)+(p.potMonths*30); return dd===0?0:Math.max(0,pd-dd); }
function hasWaterSchedule(p){ return Number(p && p.waterFreqDays) > 0; }
const DUE_SECTION_MIN_H = 220;

function isWaterDue(p,now)   { return hasWaterSchedule(p) && daysBetween(p.lastWatered,fmt(now||getToday()))>=p.waterFreqDays; }
function isTomorrow(p,now)   { return hasWaterSchedule(p) && daysBetween(p.lastWatered,fmt(now||getToday()))+1>=p.waterFreqDays; }
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
function formatMD(s)     { if(!s)return"-"; const d=new Date(s+"T00:00:00"); return `${d.getMonth()+1}/${d.getDate()}`; }
function formatDateUS(s) { if(!s)return""; const d=new Date(s+"T00:00:00"); return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`; }
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
  html{-webkit-text-size-adjust:100%;text-size-adjust:100%;}
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
    .nav { padding-bottom: 4px; }
    .nav-btn { padding-top: 13px; padding-bottom: 12px; }
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
  @keyframes undoIn{from{opacity:0;transform:translateY(3px);}to{opacity:1;transform:none;}}
  .header-undo-btn{animation:undoIn .22s ease-out both;display:flex;align-items:center;gap:5px;background:rgba(255,255,255,.22);border:none;color:white;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;padding:8px 14px;min-height:36px;border-radius:20px;cursor:pointer;flex-shrink:0;transition:background .15s;}
  @media (hover:hover) and (pointer:fine) { .header-undo-btn:hover{background:rgba(255,255,255,.34);} }

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
  /* Health score explainer, revealed by tapping the tile */
  @keyframes scoreTipIn{from{opacity:0;transform:translate(-50%,-4px);}to{opacity:1;transform:translate(-50%,0);}}
  .score-tip-backdrop{position:fixed;inset:0;z-index:59;background:transparent;}
  .score-tip{position:absolute;left:50%;top:calc(100% + 10px);transform:translateX(-50%);width:auto;min-width:170px;z-index:60;background:var(--card-bg);border:1.5px solid var(--border-strong);border-radius:10px;padding:10px 14px;box-shadow:0 8px 28px rgba(0,0,0,.28);cursor:default;animation:scoreTipIn .18s ease-out;}
  .score-tip-arrow{position:absolute;top:-6px;left:50%;width:12px;height:12px;background:var(--card-bg);border-left:1.5px solid var(--border-strong);border-top:1.5px solid var(--border-strong);transform:translateX(-50%) rotate(45deg);z-index:61;}
  .score-tip-emoji{font-size:32px;line-height:1;text-align:center;margin-bottom:6px;}
  /* Thriving's colour (#276749) is a dark forest green meant for a light
     pill background — on the tooltip's dark card-bg it's only ~1.7:1
     contrast, nearly unreadable. Brightened just here, not globally, since
     the original colour still works fine everywhere it's normally used. */
  .dark .score-tip-thriving{color:#4ade80!important;}
  .score-tip-row{display:flex;align-items:center;gap:14px;font-size:14px;color:var(--text);padding:3px 0;white-space:nowrap;}
  .score-tip-row>span:first-child{min-width:92px;}
  .score-tip-pts{color:var(--text-muted);font-weight:600;}
  .score-tip-total{margin-top:6px;padding-top:6px;border-top:1px solid var(--border);}
  .score-tip-total .score-tip-row{font-weight:700;}
  .pct-bar-fill{height:100%;background:linear-gradient(90deg,var(--leaf-light),var(--leaf));border-radius:3px;transition:width .6s;}
  .dark .pct-bar-fill{background:linear-gradient(90deg,#68d391,var(--leaf-light));}

  /* Tab bar */
  .tab-bar{display:flex;background:white;border-radius:9px;padding:3px;margin:7px 12px 5px;box-shadow:var(--shadow);}
  .tab-btn{flex:1;padding:8px;border:none;background:none;border-radius:7px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:15px;font-weight:700;color:var(--text-muted);transition:all .18s;}
  .tab-btn.active{background:var(--leaf);color:white;}

  /* Plant list */
  .section{padding:0 10px 85px;}
  .room-group{margin-bottom:12px;transition:margin-bottom .34s cubic-bezier(.16,.84,.44,1) .05s;}
  .room-group.emptying{margin-bottom:0;}
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
  .dark .check-btn{border-color:#22d3ee;color:#22d3ee;}
  .check-btn.brown{border-color:#c1603a;color:#c1603a;}
  .dark .check-btn.brown{border-color:#e07850;color:#e07850;}
  /* :hover is scoped to devices that actually have a pointer that can hover.
     On touch devices, tapping the check button removes the card (it "leaves"),
     the layout reshuffles, and the next card's button ends up under the
     finger — mobile Safari then applies :hover to it and never clears it
     since there's no real mouse to move away. Without this guard, that
     highlight sticks until the page repaints (e.g. backgrounding the app). */
  @media (hover:hover) and (pointer:fine) {
    .check-btn:hover{background:#0e7490;color:white;border-color:#0e7490;}
    .dark .check-btn:hover{background:#22d3ee;color:#0c1a1f;border-color:#22d3ee;}
    .check-btn.brown:hover{background:#c1603a;color:white;border-color:#c1603a;}
    .dark .check-btn.brown:hover{background:#e07850;color:white;border-color:#e07850;}
  }

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
  @media (hover:hover) and (pointer:fine) {
    .freq-tooltip .check-btn:hover{background:rgba(255,255,255,.2)!important;border-color:white!important;}
  }
  .freq-tooltip-row{display:flex;align-items:center;gap:7px;}
  .freq-opt{background:rgba(255,255,255,.12);border:none;color:white;border-radius:6px;padding:7px 12px;font-size:14px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;transition:background .15s;white-space:nowrap;}
  .freq-opt:hover,.freq-opt.active{background:var(--leaf-light);color:var(--soil);}
  .freq-custom{width:52px;padding:7px 6px;border-radius:6px;border:none;background:rgba(255,255,255,.12);color:white;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:700;text-align:center;}
  .freq-custom::placeholder{color:rgba(255,255,255,.35);}
  .freq-custom:focus{outline:none;background:rgba(255,255,255,.22);}

  /* Water cards */
  .water-card{background:var(--card-bg);border-radius:9px;padding:7px 8px;box-shadow:var(--shadow);display:flex;align-items:center;gap:7px;transition:opacity .18s ease-in,transform .24s cubic-bezier(.4,0,1,1);}
  .water-card.leaving{opacity:0;transform:translateX(-108%);}
  .all-done{text-align:center;padding:30px 20px 16px;}
  .all-done .emoji{font-size:52px;display:block;margin-bottom:10px;}
  .all-done h2{font-size:20px;font-weight:700;color:var(--leaf);margin-bottom:5px;}
  .all-done p{font-size:12px;color:var(--text-muted);}
  .dark .upnext-lbl{color:var(--leaf-light)!important;}
  .tomorrow-section{margin-top:18px;text-align:left;}
  .tomorrow-section h3{font-size:11px;font-weight:700;color:var(--bark);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px;}

  /* Repot cards */
  .repot-card{background:var(--card-bg);border-radius:9px;padding:7px 8px;box-shadow:var(--shadow);display:flex;align-items:center;gap:7px;transition:opacity .18s ease-in,transform .24s cubic-bezier(.4,0,1,1);}
  .repot-card.leaving{opacity:0;transform:translateX(-108%);}
  .pot-badge{background:var(--sand);padding:2px 7px;border-radius:20px;font-weight:700;font-size:11px;}
  .pot-badge.next{background:var(--leaf-pale);color:var(--leaf);}

  /* Modal */
  /* ── Motion ───────────────────────────────────────────────────────────────
     Entrances decelerate (fast start, gentle settle); exits accelerate away,
     and are shorter, since a departing element needs less attention. The
     sheet entrance carries a small overshoot because arriving at a card is a
     notable moment; routine actions deliberately don't overshoot, since
     repeated bounce reads as instability rather than polish. Everything is
     short enough that it never gates the next tap. */
  @keyframes sheetIn   { from { transform:translateY(100%); } to { transform:translateY(0); } }
  @keyframes sheetOut  { from { transform:translateY(0); }    to { transform:translateY(100%); } }

  @keyframes veilIn { from { background:rgba(0,0,0,0); } to { background:rgba(0,0,0,.48); } }
  @keyframes veilOut{ from { background:rgba(0,0,0,.48); } to { background:rgba(0,0,0,0); } }
  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.48);z-index:200;display:flex;align-items:flex-end;justify-content:center;animation:veilIn .26s ease-out both;}
  .modal-overlay.closing{animation:veilOut .22s ease-in both;}
  @keyframes sheetFade{ from { opacity:0; } to { opacity:1; } }
  @keyframes sheetFadeOut{ from { opacity:1; } to { opacity:0; } }
  .modal-overlay.ghost{background:transparent;animation:none;pointer-events:none;z-index:201;}
  .modal-overlay.ghost > .modal{animation:sheetFadeOut .19s ease-in both;}
  .modal-overlay.swap:not(.closing){animation:none;}       /* backdrop is already dark, but must still fade on close */
  .modal-overlay.swap > .modal{animation:sheetFade .15s ease-out both;}
  .modal-overlay > .modal{animation:sheetIn .34s cubic-bezier(.16,.84,.44,1) both;}
  .modal-overlay.closing > .modal{animation:sheetOut .19s cubic-bezier(.4,0,1,1) both;}
  /* Fade-through swap. Opacity only, never transform: a transformed ancestor
     becomes the containing block for position:fixed descendants, which would
     detach the modal overlays rendered inside these screens from the viewport
     and strand the card below the fold. */
  @keyframes xfadeOut{from{opacity:1;}to{opacity:0;}}
  /* Collapses to the element's real height, so the list closes the gap smoothly
     for the whole duration instead of sitting still and then snapping shut. */
  .collapse-slot{overflow:hidden;margin-bottom:4px;
    transition:height .34s cubic-bezier(.22,.61,.36,1),margin-bottom .34s cubic-bezier(.22,.61,.36,1);}
  .room-hdr-wrap{transition:opacity .18s ease-in,transform .24s cubic-bezier(.4,0,1,1);}
  .upnext-day{transition:opacity .22s ease-in;}
  .upnext-day.leaving{opacity:0;}
  .room-hdr-wrap.leaving{opacity:0;transform:translateX(-108%);}
  .collapse-slot.leaving > *{margin-top:0;margin-bottom:0;}
  @keyframes allDoneIn{from{opacity:0;}to{opacity:1;}}
  .all-done{animation:allDoneIn .34s ease-out .12s both;}   /* waits for the last row to finish collapsing */
  .xfade{position:relative;}
  .xfade-out{position:absolute;top:0;left:0;right:0;z-index:1;pointer-events:none;animation:xfadeOut .09s ease-out both;}
  @media (prefers-reduced-motion: reduce) {
    .modal-overlay, .modal-overlay > .modal,
    .modal-overlay.closing, .modal-overlay.closing > .modal { animation:none !important; }
    .xfade-out { display:none !important; }
    .header-undo-btn { animation:none !important; }
    .all-done { animation:none !important; }

    .water-card, .repot-card, .collapse-slot { transition:none !important; }
  }
  .phone-only{display:none;}
  .modal{background:var(--page-bg);border-radius:18px 18px 0 0;width:100%;max-width:480px;max-height:88vh;max-height:88dvh;overflow-y:auto;padding:12px 12px 20px;box-shadow:0 26px 0 var(--page-bg);}
  @media (max-width:480px){
    .phone-hide{display:none!important;}
    .phone-only{display:block!important;}
    .modal{padding-bottom:max(20px,env(safe-area-inset-bottom,20px));}
    /* Health row: span full width when Date Obtained is hidden */
    .health-full-row{grid-template-columns:1fr!important;}
    .health-full-row .form-group{min-width:0;}
    .health-selector{width:100%;}
  }
  /* Date inputs: tighten on any phone-sized screen (portrait or landscape) */
  @media (max-width:900px) and (pointer:coarse){
    .form-group input[type=date]{font-size:12px;padding:8px 2px;min-width:0;width:100%;box-sizing:border-box;}
  }
  .modal h2{font-size:20px;font-weight:700;margin-bottom:8px;color:var(--leaf);}
  .clone-btn{display:flex;align-items:center;gap:5px;background:var(--page-bg);border:1.5px solid var(--border);color:var(--text);font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;padding:5px 11px;border-radius:20px;cursor:pointer;flex-shrink:0;white-space:nowrap;}
  .clone-btn:hover{border-color:var(--border-strong);}
  .dark .modal h2{color:var(--leaf-light);}
  .form-group{margin-bottom:6px;}
  .form-group>label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:3px;font-weight:700;}
  .dark .form-group>label{color:var(--text);}
  .form-group input,.form-group select{width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;font-family:'DM Sans',sans-serif;font-size:15px;background:var(--input-bg);color:var(--text);font-weight:600;}
  .form-group input.field-error{border-color:#e53e3e;background:#fff5f5;color:#7a1a1a;}
  .dark .form-group input.field-error{background:#3a1d1d;color:#ff9b9b;}
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
  .form-row>*{min-width:0;}
  .form-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;}
  .form-row3>*{min-width:0;}
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
  .detail-sheet{max-height:96vh;max-height:96dvh;}
  .detail-modal{background:var(--cream);border-radius:18px 18px 0 0;width:100%;max-width:480px;max-height:92vh;max-height:92dvh;overflow-y:auto;display:flex;flex-direction:column;}
  .detail-header{padding:18px 14px 14px;color:white;position:relative;border-radius:18px 18px 0 0;flex-shrink:0;}
  .detail-back{position:absolute;top:12px;left:12px;background:rgba(255,255,255,.22);border:none;border-radius:50%;width:28px;height:28px;color:white;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;}
  .close-x-btn{position:absolute;top:8px;left:8px;background:rgba(255,255,255,.22);border:none;border-radius:50%;width:34px;height:34px;color:white;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;}
  .detail-edit{position:absolute;top:12px;right:12px;background:rgba(255,255,255,.22);border:none;border-radius:20px;padding:4px 11px;color:white;cursor:pointer;font-size:11px;font-family:'DM Sans',sans-serif;font-weight:700;}
  .detail-body{padding:12px 12px 28px;}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px;}
  .info-card{background:var(--card-bg);border-radius:9px;padding:9px 11px;box-shadow:var(--shadow);}
  .info-card .val{font-size:17px;font-weight:700;color:var(--leaf);}
  .info-card .key{font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-top:1px;font-weight:500;}

  /* Photo lightbox */
  .lightbox{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:300;display:flex;flex-direction:column;align-items:center;justify-content:center;}
  .lightbox img{max-width:95vw;max-height:78vh;max-height:78dvh;object-fit:contain;border-radius:10px;user-select:none;}
  /* Zoom stage: clips the scaled image and owns all pointer gestures */
  .lightbox-stage{position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;touch-action:none;max-width:95vw;max-height:78vh;max-height:78dvh;border-radius:10px;}
  .lightbox-stage img{display:block;-webkit-user-drag:none;transform-origin:center center;will-change:transform;}
  .lightbox-stage.zoomed{cursor:grab;}
  .lightbox-stage.panning{cursor:grabbing;}
  /* Capture date shown in the black space above the photo */
  .lightbox-date{background:none;border:none;color:rgba(255,255,255,.9);font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;letter-spacing:.2px;cursor:pointer;padding:6px 14px;border-radius:20px;margin-bottom:10px;transition:background .15s,color .15s;display:flex;align-items:center;gap:6px;}
  .lightbox-date:hover{background:rgba(255,255,255,.14);color:white;}
  .lightbox-date.empty{color:rgba(255,255,255,.45);font-weight:500;font-style:italic;}
  .lightbox-zoom-hint{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.55);color:rgba(255,255,255,.85);font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;pointer-events:none;}
  /* Calendar field (custom, replaces native input[type=date] for reliable
     cross-browser click-to-select behavior — Safari's native picker doesn't
     commit a date until the picker closes, and re-navigates on out-of-month
     day clicks instead of selecting them) */
  .cal-field-btn{width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;font-family:'DM Sans',sans-serif;font-size:15px;background:var(--input-bg);color:var(--text);font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:6px;text-align:left;}
  .cal-field-btn.placeholder{color:var(--text-muted);font-weight:500;}
  .cal-field-btn svg{flex-shrink:0;opacity:.55;}
  .cal-popup-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:520;display:flex;align-items:center;justify-content:center;padding:20px;}
  .cal-popup{background:var(--card-bg);border-radius:14px;padding:14px;width:100%;max-width:300px;box-shadow:0 12px 44px rgba(0,0,0,.42);}
  .cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
  .cal-nav-btn{background:none;border:none;color:var(--text);cursor:pointer;padding:4px 8px;border-radius:7px;display:flex;align-items:center;justify-content:center;}
  .cal-nav-btn:hover{background:var(--page-bg);}
  .cal-nav-title{font-size:14px;font-weight:700;color:var(--text);}
  .cal-weekdays{display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:4px;}
  .cal-weekdays span{text-align:center;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;}
  .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;}
  .cal-day{aspect-ratio:1;display:flex;align-items:center;justify-content:center;border:none;background:none;border-radius:8px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;color:var(--text);cursor:pointer;}
  .cal-day:hover{background:var(--page-bg);}
  .cal-day.other-month{color:var(--text-muted);opacity:.5;}
  .cal-day.today{box-shadow:inset 0 0 0 1.5px var(--leaf);}
  .cal-day.selected{background:var(--leaf);color:white;}
  .cal-day.selected:hover{background:var(--leaf);}
  /* Import preview + warning boxes.
     These need explicit dark variants: the default --leaf and --bark text
     colours sit almost on top of --leaf-pale and --sand once dark mode swaps
     those backgrounds, which left the text all but unreadable. */
  .imp-summary{background:var(--leaf-pale);border:1.5px solid var(--leaf);border-radius:8px;padding:9px 12px;margin-bottom:10px;}
  .imp-summary-title{font-size:12px;font-weight:700;color:#1b4d3e;margin-bottom:2px;}
  .imp-summary-names{font-size:11px;color:#1b4d3e;}
  .imp-summary-note{font-size:11px;color:var(--text-muted);margin-top:2px;}
  .dark .imp-summary{background:#0f2419;border-color:#52b788;}
  .dark .imp-summary-title,.dark .imp-summary-names{color:#8ee0ad;}
  .imp-warn{background:#fff5f5;border:1.5px solid #e53e3e;border-radius:8px;padding:8px 12px;margin-bottom:10px;max-height:90px;overflow-y:auto;}
  .imp-warn-title{font-size:11px;font-weight:700;color:#9b1c1c;margin-bottom:3px;}
  .imp-warn-item{font-size:10px;color:#9b1c1c;line-height:1.45;}
  .dark .imp-warn{background:#000;border-color:#ff6b6b;}
  .dark .imp-warn-title,.dark .imp-warn-item{color:#ff9b9b;}
  .imp-error{font-size:11px;margin-top:8px;line-height:1.5;color:#c53030;}
  .dark .imp-error{color:#ff9b9b;}
  /* The native time-input's clock icon renders black by default (a browser
     built-in, not something we draw), which disappears against a dark input
     background. Inverting it makes it white in dark mode only. */
  .dark .notif-time-input::-webkit-calendar-picker-indicator{filter:invert(1);}
  /* Watering schedule PDF preview thumbnail */
  .sched-preview{background:var(--page-bg);border:1.5px solid var(--border);border-radius:9px;padding:10px;margin-bottom:12px;display:flex;align-items:center;justify-content:center;height:132px;}
  /* Confirm dialog */
  .cfm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:500;display:flex;align-items:center;justify-content:center;padding:22px;}
  .cfm-card{background:var(--card-bg);border-radius:14px;padding:18px;width:100%;max-width:340px;box-shadow:0 12px 44px rgba(0,0,0,.42);}
  .cfm-title{font-size:17px;font-weight:800;color:var(--text);margin-bottom:6px;}
  .cfm-msg{font-size:13px;color:var(--text-muted);line-height:1.45;margin-bottom:15px;}
  .cfm-actions{display:flex;flex-direction:column;gap:7px;}
  .cfm-btn{width:100%;padding:11px 12px;border-radius:9px;border:1.5px solid var(--border);background:var(--page-bg);color:var(--text);font-family:'DM Sans',sans-serif;font-size:14px;font-weight:700;cursor:pointer;transition:filter .15s,border-color .15s;}
  .cfm-btn:hover{border-color:var(--border-strong);}
  .cfm-btn.grave{background:#4a5568;border-color:#4a5568;color:white;}
  .cfm-btn.danger{background:#e53e3e;border-color:#e53e3e;color:white;}
  .cfm-btn.go{background:var(--leaf);border-color:var(--leaf);color:white;}
  .cfm-btn.grave:hover,.cfm-btn.danger:hover,.cfm-btn.go:hover{filter:brightness(1.08);}
  .cfm-btn.cancel{background:none;border-color:transparent;color:var(--text-muted);}
  .cfm-sub{font-size:11px;font-weight:500;opacity:.85;display:block;margin-top:2px;}
  /* Graveyard / Recently Deleted */
  .util-row.tappable{cursor:pointer;}
  .util-chevron{color:var(--text-muted);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .sublist-back{background:none;border:none;color:white;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;cursor:pointer;opacity:.9;display:flex;align-items:center;gap:4px;padding:0;margin-bottom:6px;}
  .sublist-back:hover{opacity:1;}
  .purge-label{color:#e53e3e;font-size:10px;font-weight:700;letter-spacing:.2px;white-space:nowrap;}
  .dark .purge-label{color:#ff8080;}
  .died-pill{padding:3px 11px;border-radius:20px;font-size:12px;font-weight:700;}
  /* Date picker */
  .dp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:400;display:flex;align-items:center;justify-content:center;padding:20px;}
  .dp-card{background:var(--card-bg);border-radius:14px;padding:16px;width:100%;max-width:330px;box-shadow:0 10px 40px rgba(0,0,0,.4);}
  .dp-title{font-size:15px;font-weight:700;color:var(--text);margin-bottom:12px;}
  .dp-fields{display:flex;gap:8px;}
  .dp-field{flex:1;display:flex;flex-direction:column;gap:4px;}
  .dp-field label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--text-muted);}
  .dp-field input,.dp-field select{width:100%;padding:8px 8px;border:1.5px solid var(--border);border-radius:7px;font-family:'DM Sans',sans-serif;font-size:15px;font-weight:600;background:var(--input-bg);color:var(--text);}
  .dp-field.month{flex:1.5;}
  /* Scroll wheels (touch) */
  .dp-wheels{display:flex;gap:8px;position:relative;}
  .dp-wheel{flex:1;height:150px;overflow-y:scroll;scroll-snap-type:y mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch;position:relative;z-index:2;}
  .dp-wheel::-webkit-scrollbar{display:none;}
  .dp-wheel.month{flex:1.5;}
  .dp-wheel-item{height:38px;display:flex;align-items:center;justify-content:center;scroll-snap-align:center;font-size:17px;font-weight:600;color:var(--text-muted);transition:color .15s,transform .15s;}
  .dp-wheel-item.sel{color:var(--leaf);font-weight:800;transform:scale(1.08);}
  .dp-wheel-pad{height:56px;}
  .dp-wheel-mask{position:absolute;left:0;right:0;top:56px;height:38px;border-top:1.5px solid var(--border);border-bottom:1.5px solid var(--border);background:var(--page-bg);opacity:.5;border-radius:7px;pointer-events:none;z-index:1;}
  .dp-actions{display:flex;gap:8px;margin-top:14px;}
  .dp-actions .btn{flex:1;}
  .lightbox-close{position:absolute;top:16px;right:16px;background:rgba(255,255,255,.15);border:none;color:white;border-radius:50%;width:34px;height:34px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
  .lightbox-inner{position:relative;display:flex;align-items:center;justify-content:center;gap:12px;}
  .lightbox-arrow{background:rgba(255,255,255,.15);border:none;color:white;border-radius:50%;width:38px;height:38px;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .lightbox-arrow:hover{background:rgba(255,255,255,.3);}
  .lightbox-arrow.hidden{visibility:hidden;pointer-events:none;}
  @media (pointer:coarse) { .lightbox-arrow{display:none;} }
  .lightbox-dots{display:flex;gap:6px;margin-top:16px;}
  .lightbox-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.35);transition:background .2s;cursor:pointer;}
  .lightbox-dot.active{background:white;}

  /* Photo grid */
  .photo-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px;position:relative;user-select:none;}
  .photo-thumb-wrap{position:relative;width:68px;height:68px;cursor:pointer;border-radius:8px;transition:transform .15s,box-shadow .15s;user-select:none;-webkit-user-select:none;}
  .photo-thumb-wrap:hover{transform:scale(1.04);box-shadow:0 2px 10px rgba(0,0,0,.22);}
  .photo-thumb{width:68px;height:68px;object-fit:cover;border-radius:8px;display:block;pointer-events:none;user-select:none;-webkit-user-select:none;}
  .photo-primary-star{position:absolute;top:0;left:2px;font-size:20px;line-height:1;filter:drop-shadow(0 1px 3px rgba(0,0,0,.7));pointer-events:none;color:white;}
  .photo-menu-btn{position:absolute;top:2px;right:2px;background:rgba(0,0,0,.5);border:none;color:white;border-radius:50%;width:22px;height:22px;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;}
  .photo-menu{position:absolute;top:20px;right:2px;background:#2e2018;border-radius:8px;box-shadow:0 3px 12px rgba(0,0,0,.35);z-index:20;display:flex;flex-direction:row;gap:0;overflow:hidden;}
  .photo-menu-action{background:none;border:none;cursor:pointer;padding:7px 10px;display:flex;align-items:center;justify-content:center;transition:background .15s;}
  .photo-menu-action:hover{background:rgba(255,255,255,.12);}
  @media (pointer:coarse) {
    .photo-menu-btn{width:26px;height:26px;font-size:17px;top:3px;right:3px;}
    .photo-menu{border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.5);}
    .photo-menu-action{padding:13px 18px;}
    .photo-menu-action svg{width:20px;height:20px;}
  }
  .photo-add{width:68px;height:68px;border:2px dashed var(--sand);border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-muted);font-size:20px;}
  .photo-add:hover{border-color:var(--leaf-light);color:var(--leaf);}

  /* Manage Rooms */
  .room-list-item{background:var(--card-bg);border-radius:var(--radius);padding:7px 13px;margin-bottom:6px;display:flex;align-items:center;gap:9px;box-shadow:var(--shadow);}
  .room-color-swatch{width:14px;height:14px;border-radius:50%;border:1.5px solid rgba(0,0,0,.15);flex-shrink:0;}
  .color-picker-row{display:flex;flex-wrap:wrap;gap:7px;margin-top:4px;}
  .color-swatch-btn{width:26px;height:26px;border-radius:50%;border:2.5px solid transparent;cursor:pointer;transition:transform .1s,border-color .1s;flex-shrink:0;}
  .color-swatch-btn:hover{transform:scale(1.15);}
  .color-swatch-btn.selected{border-color:var(--soil);}
  .color-swatch-none{background:white;border:2px dashed #aaa;position:relative;}
  .color-swatch-none::after{content:"✕";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:#aaa;}
  .room-actions{margin-left:auto;display:flex;gap:6px;flex-shrink:0;}
  .icon-btn{background:none;border:none;cursor:pointer;font-size:18px;padding:5px;opacity:.5;transition:opacity .2s;}
  .icon-btn:hover{opacity:1;}
  .room-action-tile{background:var(--page-bg);border:1.5px solid var(--border);border-radius:8px;cursor:pointer;font-size:23px;font-weight:700;color:var(--text);width:46px;height:46px;display:flex;align-items:center;justify-content:center;opacity:.85;transition:opacity .15s,background .15s,border-color .15s;flex-shrink:0;}
  .room-action-tile:hover{opacity:1;border-color:var(--border-strong);}
  .room-action-tile-danger:hover{opacity:1;border-color:var(--border-strong);}
  .room-list-item.clickable{cursor:pointer;}
  .room-list-item.clickable:hover{box-shadow:0 2px 8px rgba(60,30,10,.15);}
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
  const [utilsSub, setUtilsSub] = useState(null); // "graveyard" | "deleted" | null, lifted so Nav can reset it
  const [rooms,   setRooms]   = useState(null);
  const [plants,  setPlants]  = useState(null);
  const [loaded,  setLoaded]  = useState(false);
  const [todayDate, setTodayDate] = useState(fmt(getToday()));

  // ── Cross-screen undo for Water/Repot actions ──
  // A shared stack rather than one per screen, since undoing needs to be able
  // to jump between Water and Repot: undo always reverts whatever the most
  // recent action was, switching screens first if that action happened on
  // the other one.
  const [undoStack, setUndoStack] = useState([]); // [{id, screen, plantId, revert, ts}]
  useEffect(() => { setUndoStack(s => s.filter(a => a.ts === todayDate)); }, [todayDate]);
  function pushUndo(actionScreen, plantId, revert) {
    setUndoStack(s => [...s, { id: uid(), screen: actionScreen, plantId, revert, ts: todayDate }]);
  }
  function performUndo() {
    if (!undoStack.length) return;
    const top = undoStack[undoStack.length - 1];
    setPlants(ps => ps.map(p => p.id === top.plantId ? { ...p, ...top.revert } : p));
    if (top.screen !== screen) { setScreen(top.screen); navCaptureScroll(); }
    setUndoStack(s => s.slice(0, -1));
  }
  const canUndo = undoStack.length > 0;
  const [showImport, setShowImport] = useState(false);
  const [importTab,  setImportTab]  = useState("xls");
  const [showExport, setShowExport] = useState(false);
  const [exportTab,  setExportTab]  = useState("xls");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [xlsPreview, setXlsPreview] = useState(null);
  const [xlsLoading, setXlsLoading] = useState(false);
  const [jsonPreview, setJsonPreview] = useState(null);
  const [xlsxReady,  setXlsxReady]  = useState(!!window.XLSX);
  const [excelJsReady, setExcelJsReady] = useState(!!window.ExcelJS);
  const [jsPdfReady, setJsPdfReady] = useState(!!(window.jspdf && window.jspdf.jsPDF));
  const [showSchedule, setShowSchedule] = useState(false);
  // Lets the Utilities sheets animate out before they unmount, the same way
  // the plant cards do.
  const [closingSheet, setClosingSheet] = useState(null);
  const sheetTimer = useRef(null);
  useEffect(() => () => clearTimeout(sheetTimer.current), []);
  function dismissSheet(name, done) {
    if (closingSheet) return;
    setClosingSheet(name);
    clearTimeout(sheetTimer.current);
    sheetTimer.current = setTimeout(() => { setClosingSheet(null); done(); }, SHEET_EXIT_MS);
  }
  const [schedFrom, setSchedFrom] = useState("");
  const [schedTo,   setSchedTo]   = useState("");
  const [schedBusy, setSchedBusy] = useState(false);
  const [schedError, setSchedError] = useState("");
  const [darkMode,   setDarkMode]   = useState(true);
  const [showCardPhotos, setShowCardPhotos] = useState(true);
  // Notification preferences — stored locally only, not synced to Supabase.
  // An actual push subscription is tied to one specific device/browser
  // install anyway, so a per-device preference is the right model even once
  // delivery is wired up; it also means this ships without needing a
  // database migration on the settings table.
  const [notifWaterEnabled, setNotifWaterEnabled] = useState(false);
  const [notifWaterTime,    setNotifWaterTime]    = useState("08:00");
  const [notifRepotEnabled, setNotifRepotEnabled] = useState(false);
  const [notifRepotTime,    setNotifRepotTime]    = useState("08:00");

  // Auth state
  const [user,       setUser]       = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState(""); // "", "saving", "saved", "error"

  const importRef = useRef();
  // Separate timer + pending-write slot per resource (rooms vs plants).
  // A single shared timer here was a real bug: watering a plant right after
  // any room change would clearTimeout() the room save before it ever fired,
  // silently dropping it with no error.
  const syncTimers    = useRef({});
  const pendingSyncFns = useRef({});

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
        const nwe = await loadData("pt_notif_water_enabled");
        const nwt = await loadData("pt_notif_water_time");
        const nre = await loadData("pt_notif_repot_enabled");
        const nrt = await loadData("pt_notif_repot_time");
        if (nwe !== null) setNotifWaterEnabled(nwe);
        if (nwt !== null) setNotifWaterTime(nwt);
        if (nre !== null) setNotifRepotEnabled(nre);
        if (nrt !== null) setNotifRepotTime(nrt);

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
          const DEFAULT_ROOMS = [{ id: uid(), name: "Home", order: 1, color: null }];
          const DEFAULT_PLANTS = [];
          const resolvedRooms  = sbRooms  || DEFAULT_ROOMS;
          const basePlants     = sbPlants || DEFAULT_PLANTS;

          // Rehydrate photos: use saved URLs from DB row (preserves order),
          // fall back to Storage listing for plants that predate URL saving
          const plantsWithPhotos = await Promise.all(basePlants.map(async plant => {
            try {
              if (plant.photos && plant.photos.length > 0) return plant; // URLs already in DB row
              const urls = await sbLoadPlantPhotoUrls(user.id, plant.id);
              if (urls && urls.length > 0) return { ...plant, photos: urls };
            } catch(e) { console.error("Photo load error for plant", plant.id, e); }
            return plant;
          }));

          setRooms(resolvedRooms);
          setPlants(plantsWithPhotos);
          if (!sbRooms)  await sbSaveRooms(user.id, DEFAULT_ROOMS);
          if (!sbPlants) await sbSavePlants(user.id, DEFAULT_PLANTS);

          // Migrate any remaining IndexedDB photos to Supabase in the background
          const photoMap = await loadAllPhotos();
          if (photoMap && Object.keys(photoMap).length > 0) {
            migratePhotosToSupabase(user.id, plantsWithPhotos, setPlants);
          }
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

  // ── Plant status: only active plants appear in Home / Water / Repot ──
  // plants is null until the initial load finishes, so guard for that.
  const livePlants = plants ? plants.filter(isActivePlant) : null;

  // ── Purge Recently Deleted plants past their 30 day window ──
  useEffect(() => {
    if (!plants) return;
    const expired = plants.filter(p => p.status === "deleted" && daysUntilPurge(p) <= 0);
    if (!expired.length) return;
    expired.forEach(p => {
      deletePhotos(p.id);
      if (!PREVIEW_MODE && user) { sbDeletePlantPhotos(user.id, p.id); sbDeletePlant(user.id, p.id); }
    });
    const gone = new Set(expired.map(p => p.id));
    setPlants(ps => ps.filter(p => !gone.has(p.id)));
  }, [todayDate, plants ? plants.length : 0]);

  // ── XLSX loader ──
  useEffect(() => {
    if (window.XLSX) { setXlsxReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => setXlsxReady(true);
    document.head.appendChild(s);
  }, []);

  // ── jsPDF loader ──
  // Only needed for the watering schedule export, so it's loaded the same
  // lazy way as the spreadsheet libraries rather than bundled up front.
  useEffect(() => {
    if (window.jspdf && window.jspdf.jsPDF) { setJsPdfReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/3.0.3/jspdf.umd.min.js";
    s.onload = () => setJsPdfReady(true);
    document.head.appendChild(s);
  }, []);

  // ── ExcelJS loader ──
  // Used only for WRITING styled workbooks (the Export and Template
  // downloads) — the free/community build of SheetJS (xlsx.full.min.js
  // above) silently drops cell styling (.s) on write, so it can't produce
  // colored headers or bold text. Reading uploaded files still goes through
  // SheetJS, unchanged; ExcelJS output is cross-compatible with it.
  useEffect(() => {
    if (window.ExcelJS) { setExcelJsReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
    s.onload = () => setExcelJsReady(true);
    document.head.appendChild(s);
  }, []);

  // ── Debounced cloud sync helper ──
  // Debouncing avoids firing a Supabase write on every single tap when
  // checking off several plants in a row — but a plain setTimeout can be
  // silently dropped if the tab closes, the app is backgrounded, or the
  // phone locks before it fires. That's a real data-loss window: watering
  // the last plant and immediately switching away loses that write, and on
  // next load the stale cloud copy overwrites it, so it reappears as due.
  // The visibilitychange/pagehide listeners below flush any pending write
  // the instant the page starts to disappear, closing that window.
  function triggerSync(key, fn) {
    if (syncTimers.current[key]) clearTimeout(syncTimers.current[key]);
    pendingSyncFns.current[key] = fn;
    setSyncStatus("saving");
    syncTimers.current[key] = setTimeout(async () => {
      pendingSyncFns.current[key] = null;
      try { await fn(); setSyncStatus("saved"); setTimeout(()=>setSyncStatus(""),2000); }
      catch { setSyncStatus("error"); }
    }, 1200);
  }

  useEffect(() => {
    function flushPendingSyncs() {
      Object.keys(pendingSyncFns.current).forEach(key => {
        const fn = pendingSyncFns.current[key];
        if (!fn) return;
        if (syncTimers.current[key]) clearTimeout(syncTimers.current[key]);
        pendingSyncFns.current[key] = null;
        fn().catch(()=>{});   // page may be closing — fire and forget
      });
    }
    function onVisibilityChange() { if (document.hidden) flushPendingSyncs(); }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flushPendingSyncs);
    window.addEventListener("beforeunload", flushPendingSyncs);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flushPendingSyncs);
      window.removeEventListener("beforeunload", flushPendingSyncs);
    };
  }, []);

  // ── Save rooms (local + cloud) ──
  const saveReady = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    if (!saveReady.current) { saveReady.current = true; return; }
    if (!rooms) return;
    saveData("pt_rooms", rooms);
    if (!PREVIEW_MODE && user) triggerSync("rooms", () => sbSaveRooms(user.id, rooms));
  }, [rooms, loaded]);

  // ── Save plants (local + cloud) ──
  useEffect(() => {
    if (!loaded || !saveReady.current || !plants) return;
    if (!PREVIEW_MODE && user) {
      // Check if any plant has new base64 photos that need uploading
      const plantsNeedingUpload = plants.filter(p =>
        p.photos && p.photos.some(ph => ph && ph.startsWith("data:"))
      );
      if (plantsNeedingUpload.length > 0) {
        // Upload outside the effect to avoid triggering it again
        (async () => {
          const updates = await Promise.all(plantsNeedingUpload.map(async p => {
            const urls = await sbSaveAllPhotos(user.id, p.id, p.photos);
            return { id: p.id, urls };
          }));
          setPlants(ps => ps.map(p => {
            const update = updates.find(u => u.id === p.id);
            return update ? { ...p, photos: update.urls } : p;
          }));
        })();
        return; // Don't save to Supabase yet — wait for URLs to come back
      }
    } else {
      // Preview/local mode — save to IndexedDB as before
      plants.forEach(p => {
        if (p.photos && p.photos.length > 0) savePhotos(p.id, p.photos, p.primaryPhoto);
      });
    }
    const stripped = plants.map(p => ({...p, photos: [], primaryPhoto: null}));
    saveData("pt_plants", stripped);
    if (!PREVIEW_MODE && user) triggerSync("plants", () => sbSavePlants(user.id, plants));
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
  useEffect(() => { if (loaded) saveData("pt_notif_water_enabled", notifWaterEnabled); }, [notifWaterEnabled, loaded]);
  useEffect(() => { if (loaded) saveData("pt_notif_water_time", notifWaterTime); }, [notifWaterTime, loaded]);
  useEffect(() => { if (loaded) saveData("pt_notif_repot_enabled", notifRepotEnabled); }, [notifRepotEnabled, loaded]);
  useEffect(() => { if (loaded) saveData("pt_notif_repot_time", notifRepotTime); }, [notifRepotTime, loaded]);

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

  // Dotted M.D.YY used in the schedule filename, e.g. 8.1.26
  function fmtDotDate(dateStr) {
    const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return "";
    return `${Number(m[2])}.${Number(m[3])}.${m[1].slice(2)}`;
  }

  function fmtFileDate(d) {
    const o = d instanceof Date ? d : new Date(d);
    return `${o.getMonth()+1}-${o.getDate()}-${String(o.getFullYear()).slice(2)}`;
  }

  function exportData() {
    const payload = JSON.stringify({ rooms, plants }, null, 2);
    const b64 = btoa(unescape(encodeURIComponent(payload)));
    const a = document.createElement("a");
    a.href = "data:application/json;base64," + b64;
    a.download = `Plantalog Backup ${fmtFileDate(getToday())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ── XLSX layout & styling ────────────────────────────────────────────────
  // These constants are a direct transcription of Matt's reference workbook
  // (Plantalog_XLS_Template.xlsx) — every colour, font size, width, height and
  // hint string below was read out of that file rather than approximated, so
  // the Export and the blank Import Template render identically to it.
  const XLS_HEADERS = ["ID","Plant Name","Room #","Health","Date Obtained",
    "Water Every","Last Watered","Date Potted","Original Pot",
    "Keep In Pot\nYears","Keep In Pot\nMonths","Pot Size","Next Pot","Notes"];
  const XLS_HINTS = ["Leave blank\nfor new plant","Your plant's full name",
    "Where your plant\nlives (see Rooms tab)","1=Dying 2=Caution\n3=Good 4=Thriving","MM/DD/YY",
    "Days between\nwaterings","MM/DD/YY","MM/DD/YY","X = Yes\nBlank = No",
    "Whole years","0–11 months","Inches","Inches","Additional notations about your plant"];
  // [startCol, endCol, label, headerFill, hintFill] — 0-indexed, inclusive.
  // The OTHER band's greys are Excel's "Text 1 lighter 25%" (#404040) and
  // "Background 1 darker 15%" (#D9D9D9), resolved from the theme colours the
  // reference file stores them as.
  const XLS_GROUPS = [
    [0, 4,  "PLANT INFO", "FF2D6A4F", "FFD8F3DC"],
    [5, 6,  "WATERING",   "FF1B4D3E", "FFC8E6D8"],
    [7, 12, "POTTING",    "FF6B4226", "FFEFE0D5"],
    [13,13, "OTHER",      "FF404040", "FFD9D9D9"],
  ];
  const XLS_COL_WIDTHS = [9.83203125, 28, 16.6640625, 14.6640625, 13.33203125,
    10.6640625, 10.6640625, 10.6640625, 10.6640625, 10.6640625, 10.6640625,
    10.6640625, 10.6640625, 52.5];
  const XLS_SPACER_WIDTH = 8.83203125;   // column O
  // Blank rows of spacer kept below the data so there's room to type new
  // plants in. The reference workbook fills column O for all 1,048,576 rows,
  // which is why it weighs 5.5 MB — replicating that would make every export
  // enormous and take ~30s to build in the browser, so it's bounded here.
  // Visually identical: the spacer only matters on rows that hold text.
  const XLS_SPACER_SPARE_ROWS = 300;
  const XLS_ROOMS_SPARE_ROWS = 100;      // blank Rooms rows kept ready to type into
  const XLS_ROW_HEIGHTS = { 1:14, 2:42, 3:35 };
  const XLS_REQUIRED_COLS = [1,2,3,4,5,6,7,9,10,11,12]; // all but ID(0), Original Pot(8), Notes(13)
  const XLS_REQUIRED_LABELS = { 1:"Plant Name",2:"Room #",3:"Health",4:"Date Obtained",
    5:"Water Every",6:"Last Watered",7:"Date Potted",9:"Keep In Pot Years",
    10:"Keep In Pot Months",11:"Pot Size",12:"Next Pot" };
  const XLS_DATE_COLS = [4,6,7];         // Date Obtained, Last Watered, Date Potted
  const XLS_DATE_FORMAT = "m/d/yy";      // no leading zeros, e.g. 7/1/23 and 12/23/25
  const XLS_HEALTH_BY_LABEL = {dying:1,caution:2,good:3,thriving:4};
  const XLS_HINT_TEXT = "FF555555";
  const XLS_ROOM_HINT_TEXT = "FF777777";
  const XLS_LINE = { style:"thin", color:{argb:"FFCCCCCC"} };
  const XLS_BOX = { top:XLS_LINE, bottom:XLS_LINE, left:XLS_LINE, right:XLS_LINE };
  function isBlankCell(v) { return v===undefined || v===null || String(v).trim()===""; }
  function xlsFill(argb) { return { type:"pattern", pattern:"solid", fgColor:{argb} }; }

  // Header rows are centre-aligned and data rows left-aligned, matching the
  // reference; everything is vertically centred. Note ExcelJS spells vertical
  // centring "middle" — "center" is silently dropped on write.
  function styleXlsPlantsSheet(ws, dataRows) {
    Object.keys(XLS_ROW_HEIGHTS).forEach(r => { ws.getRow(Number(r)).height = XLS_ROW_HEIGHTS[r]; });

    // Data-entry cells default to left / vertically-centred, so anything typed
    // in below the headers matches the alignment of exported rows. Set at
    // column level first (which covers the whole sheet, however far down you
    // scroll); the header rows below re-assert their own centring on top of it.
    for (let c = 1; c <= XLS_HEADERS.length; c++) {
      ws.getColumn(c).alignment = { horizontal:"left", vertical:"middle" };
    }

    XLS_GROUPS.forEach(([startCol, endCol, label, headerFill]) => {
      if (startCol !== endCol) {
        ws.mergeCells(`${ws.getColumn(startCol+1).letter}1:${ws.getColumn(endCol+1).letter}1`);
      }
      for (let c = startCol; c <= endCol; c++) {
        const cell = ws.getCell(1, c+1);
        if (c === startCol) cell.value = label;
        cell.font = { name:"Arial", size:11, bold:true, color:{argb:"FFFFFFFF"} };
        cell.fill = xlsFill(headerFill);
        cell.alignment = { horizontal:"center", vertical:"middle" };
        cell.border = { bottom:XLS_LINE };
      }
    });

    XLS_HEADERS.forEach((header, i) => {
      const col = i + 1;
      const [, , , headerFill, hintFill] = XLS_GROUPS.find(g => i >= g[0] && i <= g[1]);

      const headerCell = ws.getCell(2, col);
      headerCell.value = header;
      headerCell.font = { name:"Arial", size:10, bold:true, color:{argb:"FFFFFFFF"} };
      headerCell.fill = xlsFill(headerFill);
      headerCell.alignment = { horizontal:"center", vertical:"middle", wrapText:true };
      headerCell.border = XLS_BOX;

      const hintCell = ws.getCell(3, col);
      hintCell.value = XLS_HINTS[i];
      hintCell.font = { name:"Arial", size:9, italic:true, color:{argb:XLS_HINT_TEXT} };
      hintCell.fill = xlsFill(hintFill);
      hintCell.alignment = { horizontal:"center", vertical:"middle", wrapText:true };
      hintCell.border = XLS_BOX;

      ws.getColumn(col).width = XLS_COL_WIDTHS[i];
    });

    dataRows.forEach((row, r) => {
      const rowNum = 4 + r;
      ws.getRow(rowNum).values = row;
      for (let c = 1; c <= XLS_HEADERS.length; c++) {
        const cell = ws.getCell(rowNum, c);
        cell.font = { name:"Arial", size:10 };
        cell.alignment = { horizontal:"left", vertical:"middle" };
        cell.border = XLS_BOX;
        if (XLS_DATE_COLS.includes(c - 1)) cell.numFmt = XLS_DATE_FORMAT;
      }
    });

    // Column O holds a single space on every row. Excel lets long text spill
    // into a genuinely empty neighbour, which makes Notes look like it bleeds
    // past its column; a space makes the cell non-empty so it never does,
    // while still appearing blank.
    const spacerCol = XLS_HEADERS.length + 1;
    ws.getColumn(spacerCol).width = XLS_SPACER_WIDTH;
    const lastSpacer = dataRows.length + 3 + XLS_SPACER_SPARE_ROWS;
    for (let r = 4; r <= lastSpacer; r++) ws.getCell(r, spacerCol).value = " ";

    // The column-level default above is inherited rather than stored on each
    // cell, so selecting an empty cell in Excel shows no alignment chosen.
    // Writing it explicitly across the working rows makes it actually set.
    for (let r = 4 + dataRows.length; r <= lastSpacer; r++) {
      for (let c = 1; c <= XLS_HEADERS.length; c++) {
        ws.getCell(r, c).alignment = { horizontal:"left", vertical:"middle" };
      }
    }

    ws.views = [{ state:"frozen", ySplit:3 }];
  }

  function styleXlsRoomsSheet(ws, { blank, rooms: roomList }) {
    // Same treatment as the Plants sheet: left / vertically-centred by default
    // for anything typed in below the header, set at column level first so the
    // header row can re-assert its own centring on top.
    [1,2].forEach(c => { ws.getColumn(c).alignment = { horizontal:"left", vertical:"middle" }; });

    ["Room #","Room Name"].forEach((header, i) => {
      const cell = ws.getCell(1, i+1);
      cell.value = header;
      cell.font = { name:"Arial", size:10, bold:true, color:{argb:"FFFFFFFF"} };
      cell.fill = xlsFill("FF2D6A4F");
      cell.alignment = { horizontal:"center", vertical:"middle" };
      cell.border = XLS_BOX;
    });
    ws.getColumn(1).width = 12;
    ws.getColumn(2).width = 28;

    if (blank) {
      ws.getRow(2).height = 24;
      ["Use this # in the Plants tab","Your room names appear here"].forEach((hint, i) => {
        const cell = ws.getCell(2, i+1);
        cell.value = hint;
        cell.font = { name:"Arial", size:9, italic:true, color:{argb:XLS_ROOM_HINT_TEXT} };
        cell.fill = xlsFill("FFD8F3DC");
        cell.alignment = { horizontal:"center", vertical:"middle", wrapText:true };
        cell.border = XLS_BOX;
      });
    } else {
      roomList.forEach((room, i) => {
        const rowNum = 2 + i;
        ws.getCell(rowNum, 1).value = room.order;
        ws.getCell(rowNum, 2).value = room.name;
        [1,2].forEach(c => {
          const cell = ws.getCell(rowNum, c);
          cell.font = { name:"Arial", size:10 };
          cell.alignment = { horizontal:"left", vertical:"middle" };
          cell.border = XLS_BOX;
        });
      });
    }

    // Column-level alignment is inherited rather than stored per cell, so an
    // empty cell would show nothing selected in Excel. Write it explicitly
    // across the rows below the content so it is actually set.
    const firstEmpty = blank ? 3 : 2 + roomList.length;
    for (let r = firstEmpty; r < firstEmpty + XLS_ROOMS_SPARE_ROWS; r++) {
      [1,2].forEach(c => { ws.getCell(r, c).alignment = { horizontal:"left", vertical:"middle" }; });
    }
  }

  // One download mechanism for every generated file. Kept separate from any
  // library's own save() helper, since this path is already proven to work
  // in this app (it's what the spreadsheet exports use).
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function downloadXlsWorkbook(plantRows, roomsConfig, filename) {
    const ExcelJS = window.ExcelJS;
    if (!ExcelJS) return;
    const wb = new ExcelJS.Workbook();
    styleXlsPlantsSheet(wb.addWorksheet("Plants"), plantRows);
    styleXlsRoomsSheet(wb.addWorksheet("Rooms"), roomsConfig);
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportXlsx() {
    const roomById = {}; (rooms||[]).forEach(r => { roomById[r.id] = r; });
    const toDate = s => s ? new Date(String(s).slice(0,10)+"T12:00:00") : "";
    const dataRows = (plants||[]).filter(isActivePlant).map(p => {
      const room = roomById[p.roomId];
      return [
        p.id, p.name, room ? room.order : "",
        p.health,
        toDate(p.obtainedDate), p.waterFreqDays, toDate(p.lastWatered), toDate(p.pottedDate),
        p.originalPot ? "X" : "",
        p.potYears, p.potMonths, p.currentPotSize, p.nextPotSize,
        p.notes || "",
      ];
    });
    const sortedRooms = [...(rooms||[])].sort((a,b) => (a.order??0)-(b.order??0));
    return downloadXlsWorkbook(dataRows, { blank:false, rooms:sortedRooms }, `Plantalog Export ${fmtFileDate(getToday())}.xlsx`);
  }

  // Range must be complete, in order, and within the 90-day cap. The cap keeps
  // the PDF (and the image loading behind it) from ballooning by accident.
  const schedRangeDays = (schedFrom && schedTo) ? rangeLengthDays(schedFrom, schedTo) : 0;
  const schedRangeValid = !!(schedFrom && schedTo && schedRangeDays >= 1 && schedRangeDays <= WATER_PDF_MAX_DAYS);
  const schedRangeMessage =
    (!schedFrom || !schedTo) ? "" :
    schedRangeDays < 1 ? "The To date needs to be on or after the From date." :
    schedRangeDays > WATER_PDF_MAX_DAYS ? `That's ${schedRangeDays} days. Please choose a range of ${WATER_PDF_MAX_DAYS} days or fewer.` :
    `${schedRangeDays} day${schedRangeDays===1?"":"s"}`;

  async function createSchedulePdf() {
    if (!schedRangeValid) return;
    setSchedBusy(true); setSchedError("");
    try {
      const doc = await generateWateringPdf({ plants, rooms, from:schedFrom, to:schedTo });
      downloadBlob(doc.output("blob"), `OOT Water Schedule ${fmtDotDate(schedFrom)} - ${fmtDotDate(schedTo)}.pdf`);
      setShowSchedule(false);
    } catch (err) {
      setSchedError(err.message || "Could not create the PDF. Please try again.");
    } finally {
      setSchedBusy(false);
    }
  }

  // Blank template for new imports — identical layout and styling to the real
  // export, just with no plant rows. The Rooms tab lists the person's actual
  // rooms (sorted by number) so they can see which Room # to put against each
  // plant; it falls back to the instructional placeholder only when there are
  // no rooms yet, which is the case the placeholder was written for.
  function exportXlsTemplate() {
    const sortedRooms = [...(rooms||[])].sort((a,b) => (a.order??0)-(b.order??0));
    return downloadXlsWorkbook([], { blank: sortedRooms.length === 0, rooms: sortedRooms },
      "Plantalog Import Template.xlsx");
  }

  function checkJsonImport() {
    setImportError(""); setJsonPreview(null);
    try {
      const data = JSON.parse(importText);
      if (!Array.isArray(data.rooms) || !Array.isArray(data.plants)) throw new Error("Invalid backup file. Please select a Plantalog backup JSON file.");

      // Same rule as Excel: an ID used on more than one plant almost always
      // means the file was hand-edited or duplicated by mistake. Rather than
      // guess which one was intended, reject the whole import.
      const idCounts = {};
      data.plants.forEach(p => { const id = String(p.id||"").trim(); if (id) idCounts[id] = (idCounts[id]||0) + 1; });
      const duplicateIds = Object.keys(idCounts).filter(id => idCounts[id] > 1);
      if (duplicateIds.length) {
        throw new Error(`Import rejected: this backup contains the same plant ID more than once (${duplicateIds.join(", ")}). Each plant needs a unique ID, so this file can't be safely imported as-is.`);
      }

      const existingById = {}; (plants||[]).forEach(p => { existingById[p.id] = p; });
      const toAdd = [], toUpdate = [];
      data.plants.forEach(p => {
        const id = String(p.id||"").trim();
        const existing = id ? existingById[id] : null;
        if (existing) {
          const changed = Object.keys(p).some(k => JSON.stringify(existing[k]) !== JSON.stringify(p[k]));
          toUpdate.push({ id, name: p.name, fields: p, changed });
        } else {
          toAdd.push(id ? p : { ...p, id: uid() });
        }
      });

      setJsonPreview({ toAdd, toUpdate, warnings: [], rooms: data.rooms });
    } catch (err) {
      setImportError(err.message || "Invalid backup file. Please select a Plantalog backup JSON file.");
    }
  }

  function confirmJsonImport() {
    const { toAdd, toUpdate, rooms: incomingRooms } = jsonPreview;
    const updateMap = {};
    toUpdate.forEach(u => { if (u.changed) updateMap[u.id] = u.fields; });

    // Rooms: merge by ID the same way plants do, rather than a blind
    // replace, so existing room references stay valid.
    const roomById = {}; (rooms||[]).forEach(r => { roomById[r.id] = true; });
    const mergedRooms = [
      ...(rooms||[]).map(r => incomingRooms.find(ir => ir.id === r.id) || r),
      ...incomingRooms.filter(ir => !roomById[ir.id]),
    ];

    const mergedPlants = [
      ...(plants||[]).map(p => updateMap[p.id] ? { ...p, ...updateMap[p.id] } : p),
      ...toAdd,
    ];

    setRooms(mergedRooms);
    setPlants(mergedPlants);
    if (!PREVIEW_MODE && user) {
      sbSaveRooms(user.id, mergedRooms);
      sbSavePlants(user.id, mergedPlants);
      migratePhotosToSupabase(user.id, mergedPlants, setPlants);
    } else {
      mergedPlants.forEach(p => {
        if (p.photos && p.photos.length > 0) savePhotos(p.id, p.photos, p.primaryPhoto);
      });
    }
    closeImport();
  }

  function closeImport() {
    setShowImport(false); setImportTab("xls"); setImportText(""); setImportError("");
    setXlsPreview(null); setXlsLoading(false); setJsonPreview(null);
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
        let wb;
        try {
          wb = XLSX.read(ev.target.result, { type: "array", cellDates: false });
        } catch (readErr) {
          throw new Error("That file isn't a spreadsheet. Pick the .xlsx file you downloaded from Plantalog (Export, or the blank Import template).");
        }
        if (!wb || !wb.SheetNames || !wb.SheetNames.length) {
          throw new Error("That spreadsheet has no sheets in it. Pick the .xlsx file you downloaded from Plantalog.");
        }
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

        // Find header row: the row where col A is exactly "ID"
        let headerRow = -1;
        for (let i = 0; i < Math.min(rows.length, 6); i++) {
          if (String(rows[i][0]).trim().toLowerCase() === "id") { headerRow = i; break; }
        }
        // SheetJS will happily parse almost anything into a sheet, so a file
        // that isn't a Plantalog workbook lands here rather than throwing
        // above — this covers both "wrong file entirely" and "spreadsheet in
        // the wrong layout".
        if (headerRow < 0) throw new Error("This doesn't look like a Plantalog spreadsheet. Pick the .xlsx file you downloaded from Plantalog, either an Export or the blank Import template. Its header row should start with 'ID' in column A.");

        const roomMap = {}; // room # (order) → room id
        rooms.forEach(r => { roomMap[r.order] = r.id; });

        function parseHealth(v) {
          const s = String(v||"").trim().toLowerCase();
          if (XLS_HEALTH_BY_LABEL[s]) return XLS_HEALTH_BY_LABEL[s];
          return Math.min(4, Math.max(1, Number(v)||3));
        }

        const existingById = {}; plants.forEach(p => { existingById[p.id] = p; });

        // Gather every named row first — before deciding add vs. update — so
        // we can catch a duplicate ID across the WHOLE sheet up front. A
        // duplicate almost always means an accidental copy-paste while
        // editing, and silently keeping "whichever row came last" could
        // quietly discard real edits, so the whole import is rejected
        // instead rather than guessing which row the person meant.
        const parsedRows = [];
        rows.slice(headerRow + 2).forEach((row, i) => {
          const name = String(row[1]||"").trim();
          if (!name) return; // skip empty rows
          parsedRows.push({ row, rowNum: headerRow + 3 + i, name, idCell: String(row[0]||"").trim() });
        });

        const idRowNums = {};
        parsedRows.forEach(r => { if (r.idCell) (idRowNums[r.idCell] ||= []).push(r.rowNum); });
        const duplicateIds = Object.keys(idRowNums).filter(id => idRowNums[id].length > 1);
        if (duplicateIds.length) {
          const detail = duplicateIds.map(id => `ID "${id}" appears on rows ${idRowNums[id].join(", ")}`).join("; ");
          throw new Error(`Import rejected: the same plant ID appears more than once. ${detail}. Each row must have its own unique ID. Fix the spreadsheet and try again.`);
        }

        // Every field is required except ID, Original Pot, and Notes — a
        // row missing anything else almost always means a typo or a
        // half-filled row, so (like duplicate IDs) the whole import is
        // rejected up front rather than silently guessing a default.
        // Labels come from the shared constant so the error text always
        // matches the column headings the person is actually looking at.
        const missingByRow = [];
        parsedRows.forEach(({ row, rowNum }) => {
          const missing = XLS_REQUIRED_COLS.filter(idx => isBlankCell(row[idx]));
          if (missing.length) missingByRow.push(`Row ${rowNum}: missing ${missing.map(idx=>XLS_REQUIRED_LABELS[idx]).join(", ")}`);
        });
        if (missingByRow.length) {
          const shown = missingByRow.slice(0,6).join("; ");
          const more = missingByRow.length > 6 ? ` (+${missingByRow.length-6} more row${missingByRow.length-6!==1?"s":""})` : "";
          throw new Error(`Import rejected: some required fields are missing. ${shown}${more}. Only ID, Original Pot, and Notes may be left blank.`);
        }

        const warnings = [];
        const toAdd = [];
        const toUpdate = []; // { id, name, fields, changed }

        parsedRows.forEach(({ row, rowNum, name, idCell }) => {
          const roomNum = Number(row[2]) || 1;
          const roomId  = roomMap[roomNum] || rooms[0]?.id || "r1";
          if (!roomMap[roomNum]) warnings.push(`Row ${rowNum}: Room # ${roomNum} not found, so it was assigned to the first room.`);

          const origPot = String(row[8]||"").toLowerCase().trim() === "x";
          const keepYrs = Math.max(0, Number(row[9])||0);
          const keepMo  = Math.min(11, Math.max(0, Number(row[10])||0));
          const potSize = Math.max(1, Number(row[11])||6);
          const nextPot = Math.max(1, Number(row[12])||potSize+2);

          const fields = {
            roomId, name, health: parseHealth(row[3]),
            obtainedDate: parseDate(row[4]),
            waterFreqDays: Math.max(1, Number(row[5])||7),
            lastWatered:   parseDate(row[6]),
            pottedDate:    parseDate(row[7]),
            originalPot: origPot,
            potYears: keepYrs, potMonths: keepMo,
            currentPotSize: potSize, nextPotSize: nextPot,
            notes: String(row[13]||""),
          };

          const existing = idCell ? existingById[idCell] : null;
          if (existing) {
            const changed = Object.keys(fields).some(k => existing[k] !== fields[k]);
            toUpdate.push({ id: idCell, name, fields, changed });
          } else {
            if (idCell) warnings.push(`Row ${rowNum}: ID "${idCell}" doesn't match an existing plant, so it was added as new with a new ID.`);
            // Photos are never touched by XLS import — new plants simply start with none.
            toAdd.push({ id: uid(), photos: [], photoDates: [], primaryPhoto: null, ...fields });
          }
        });

        if (!toAdd.length && !toUpdate.length) throw new Error("No plant rows found. Make sure rows start below the header and hint rows.");
        setXlsPreview({ toAdd, toUpdate, warnings });
        setXlsLoading(false);
      } catch(err) {
        setImportError(err.message || "Could not read file. Please use the current Plantalog export/template format.");
        setXlsLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  function confirmXlsImport() {
    const { toAdd, toUpdate } = xlsPreview;
    const updateMap = {};
    toUpdate.forEach(u => { if (u.changed) updateMap[u.id] = u.fields; });
    setPlants(ps => {
      // Existing plants are spread first, so anything XLS doesn't carry —
      // photos, photoDates, primaryPhoto, graveyard/deleted status — is left
      // completely untouched. Only the spreadsheet-controlled fields change.
      const merged = ps.map(p => updateMap[p.id] ? { ...p, ...updateMap[p.id] } : p);
      return [...merged, ...toAdd];
    });
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

        <CrossFade value={screen} offsetFromScroll onSwapped={()=>window.scrollTo({top:0,behavior:"instant"})}>{shownScreen => (<>
        {shownScreen==="home"  && <HomeScreen  rooms={rooms} setRooms={setRooms} plants={livePlants} setPlants={setPlants} todayDate={todayDate} showCardPhotos={showCardPhotos} user={user} />}
        {shownScreen==="water" && <WaterScreen rooms={rooms} plants={livePlants} setPlants={setPlants} todayDate={todayDate} showCardPhotos={showCardPhotos} user={user} pushUndo={pushUndo} canUndo={canUndo} onUndo={performUndo} />}
        {shownScreen==="repot" && <RepotScreen rooms={rooms} plants={livePlants} setPlants={setPlants} todayDate={todayDate} showCardPhotos={showCardPhotos} user={user} pushUndo={pushUndo} canUndo={canUndo} onUndo={performUndo} />}
        {shownScreen==="utils" && <UtilitiesScreen darkMode={darkMode} setDarkMode={setDarkMode} showCardPhotos={showCardPhotos} setShowCardPhotos={setShowCardPhotos} onOpenExport={()=>setShowExport(true)} onImport={()=>setShowImport(true)} onOpenSchedule={()=>setShowSchedule(true)} user={user || (PREVIEW_MODE ? {email:"preview@plantalog.app"} : null)} onSignOut={handleSignOut} onDeleteAccount={handleDeleteAccount} rooms={rooms} plants={plants} setPlants={setPlants} sub={utilsSub} setSub={setUtilsSub}
          notifWaterEnabled={notifWaterEnabled} setNotifWaterEnabled={setNotifWaterEnabled} notifWaterTime={notifWaterTime} setNotifWaterTime={setNotifWaterTime}
          notifRepotEnabled={notifRepotEnabled} setNotifRepotEnabled={setNotifRepotEnabled} notifRepotTime={notifRepotTime} setNotifRepotTime={setNotifRepotTime} />}
        </>)}</CrossFade>
        <Nav screen={screen} setScreen={setScreen} plants={livePlants} todayDate={todayDate} onUtilsClick={()=>setUtilsSub(null)} />

        {/* Import modal — inside .app so dark class applies */}
        {showImport && (
        <div className={`modal-overlay${closingSheet==="import"?" closing":""}`} onClick={()=>dismissSheet("import", closeImport)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{paddingBottom:30}}>
            <h2>Import Plants</h2>

            {/* Tabs */}
            <div style={{display:"flex",gap:0,marginBottom:14,background:"var(--sand)",borderRadius:8,padding:3}}>
              {[["xls","📊  XLS"],["json","💾  JSON"]].map(([id,label])=>(
                <button key={id} onClick={()=>{setImportTab(id);setImportError("");setXlsPreview(null);setJsonPreview(null);}}
                  style={{flex:1,padding:"6px 4px",border:"none",borderRadius:6,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:700,
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
                <p style={{fontSize:12,color:"var(--text-muted)",marginBottom:8,lineHeight:1.5}}>
                  Download and complete the blank template to add a batch of new plants. If you have an export with plant updates, import the file here to save those updates in bulk.
                </p>
                <p style={{fontSize:12,color:"var(--text-muted)",marginBottom:12,lineHeight:1.5}}>
                  Rows with an ID update that plant. Rows without one are added as a new plant. Photos are never affected. Make sure to check the import tool's summary and warnings before importing.
                </p>
                <button onClick={exportXlsTemplate} disabled={!excelJsReady}
                  style={{width:"100%",padding:"10px",marginBottom:14,borderRadius:9,border:"1.5px dashed var(--leaf-light)",background:"var(--leaf-pale)",color:darkMode?"var(--leaf-light)":"var(--leaf)",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:excelJsReady?"pointer":"default",opacity:excelJsReady?1:0.6,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download Template (.xlsx)
                </button>
                <div style={{textAlign:"center",fontSize:11,color:"var(--text-muted)",marginBottom:10}}>then</div>
                <label style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,width:"100%",padding:"14px 10px",borderRadius:8,border:"2px dashed var(--border-strong)",cursor:xlsxReady?"pointer":"default",color:"var(--text-muted)",fontSize:13,fontWeight:600,background:"var(--page-bg)",opacity:xlsxReady?1:0.6}}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  {xlsLoading ? "Reading file…" : "Tap to choose your XLS file"}
                  <input type="file" style={{display:"none"}} disabled={!xlsxReady} onChange={handleXlsFile}/>
                </label>
                {importError && <div className="imp-error">{importError}</div>}
              </>
            )}

            {/* ── Excel preview / confirm ── */}
            {importTab==="xls" && xlsPreview && (()=>{
              const changedUpdates = xlsPreview.toUpdate.filter(u=>u.changed);
              const unchangedCount = xlsPreview.toUpdate.length - changedUpdates.length;
              const summaryNames = [...xlsPreview.toAdd.map(p=>p.name), ...changedUpdates.map(u=>u.name)];
              return (
              <>
                <div className="imp-summary">
                  <div className="imp-summary-title">
                    ✓ {xlsPreview.toAdd.length>0 && `${xlsPreview.toAdd.length} new`}
                    {xlsPreview.toAdd.length>0 && changedUpdates.length>0 && " · "}
                    {changedUpdates.length>0 && `${changedUpdates.length} updated`}
                    {xlsPreview.toAdd.length===0 && changedUpdates.length===0 && "Nothing to change"}
                  </div>
                  {summaryNames.length>0 && <div className="imp-summary-names">{summaryNames.slice(0,5).join(", ")}{summaryNames.length>5?` + ${summaryNames.length-5} more`:""}</div>}
                  {unchangedCount>0 && <div className="imp-summary-note">{unchangedCount} plant{unchangedCount!==1?"s":""} matched with no changes</div>}
                </div>
                {xlsPreview.warnings.length>0 && (
                  <div className="imp-warn">
                    <div className="imp-warn-title">⚠ {xlsPreview.warnings.length} warning{xlsPreview.warnings.length!==1?"s":""}</div>
                    {xlsPreview.warnings.map((w,i)=><div key={i} className="imp-warn-item">{w}</div>)}
                  </div>
                )}
                <div style={{display:"flex",gap:8}}>
                  <button className="btn btn-secondary" onClick={()=>setXlsPreview(null)} style={{flex:"none"}}>← Back</button>
                  <button className="btn btn-primary" onClick={confirmXlsImport} style={{flex:1}}
                    disabled={xlsPreview.toAdd.length===0 && changedUpdates.length===0}>Import</button>
                </div>
              </>
              );
            })()}

            {/* ── JSON tab: file picker ── */}
            {importTab==="json" && !jsonPreview && (
              <>
                <p style={{fontSize:12,color:"var(--text-muted)",marginBottom:10}}>Restore from a previously exported backup of your plant data.</p>
                <label style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,width:"100%",padding:"14px 10px",borderRadius:8,border:"2px dashed var(--border-strong)",cursor:"pointer",color:"var(--text-muted)",fontSize:13,fontWeight:600,background:"var(--page-bg)"}}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  {importText ? "✓ File loaded, ready to check" : "Tap to choose a .json file"}
                  <input type="file" accept=".json,application/json" style={{display:"none"}} onChange={e=>{
                    const file=e.target.files[0]; if(!file) return;
                    const reader=new FileReader();
                    reader.onload=ev=>{setImportText(ev.target.result);setImportError("");setJsonPreview(null);};
                    reader.readAsText(file);
                    e.target.value="";
                  }}/>
                </label>
                {importError && <div className="imp-error">{importError}</div>}
                <div className="modal-actions" style={{marginTop:12}}>
                  <button className="btn btn-secondary" onClick={()=>dismissSheet("import", closeImport)}>Cancel</button>
                  <button className="btn btn-primary" onClick={checkJsonImport} style={{opacity:importText?1:0.5,pointerEvents:importText?"auto":"none"}}>Check Import</button>
                </div>
              </>
            )}

            {/* ── JSON tab: preview / confirm ── */}
            {importTab==="json" && jsonPreview && (()=>{
              const changedUpdates = jsonPreview.toUpdate.filter(u=>u.changed);
              const unchangedCount = jsonPreview.toUpdate.length - changedUpdates.length;
              const summaryNames = [...jsonPreview.toAdd.map(p=>p.name), ...changedUpdates.map(u=>u.name)];
              return (
              <>
                <div className="imp-summary">
                  <div className="imp-summary-title">
                    ✓ {jsonPreview.toAdd.length>0 && `${jsonPreview.toAdd.length} new`}
                    {jsonPreview.toAdd.length>0 && changedUpdates.length>0 && " · "}
                    {changedUpdates.length>0 && `${changedUpdates.length} updated`}
                    {jsonPreview.toAdd.length===0 && changedUpdates.length===0 && "Nothing to change"}
                  </div>
                  {summaryNames.length>0 && <div className="imp-summary-names">{summaryNames.slice(0,5).join(", ")}{summaryNames.length>5?` + ${summaryNames.length-5} more`:""}</div>}
                  {unchangedCount>0 && <div className="imp-summary-note">{unchangedCount} plant{unchangedCount!==1?"s":""} matched with no changes</div>}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button className="btn btn-secondary" onClick={()=>setJsonPreview(null)} style={{flex:"none"}}>← Back</button>
                  <button className="btn btn-primary" onClick={confirmJsonImport} style={{flex:1}}
                    disabled={jsonPreview.toAdd.length===0 && changedUpdates.length===0}>Restore</button>
                </div>
              </>
              );
            })()}

            {importTab==="xls" && !xlsPreview && (
              <div style={{marginTop:14}}>
                <button className="btn btn-secondary" style={{width:"100%"}} onClick={()=>dismissSheet("import", closeImport)}>Cancel</button>
              </div>
            )}

            </div>{/* end fixed-height tab content */}
          </div>
        </div>
        )}

        {/* ── Export modal — same card/tab styling as Import ── */}
        {showExport && (
        <div className={`modal-overlay${closingSheet==="export"?" closing":""}`} onClick={()=>dismissSheet("export", ()=>setShowExport(false))}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{paddingBottom:30}}>
            <h2>Export Plants</h2>

            {/* Tabs */}
            <div style={{display:"flex",gap:0,marginBottom:14,background:"var(--sand)",borderRadius:8,padding:3}}>
              {[["xls","📊  XLS"],["json","💾  JSON"]].map(([id,label])=>(
                <button key={id} onClick={()=>setExportTab(id)}
                  style={{flex:1,padding:"6px 4px",border:"none",borderRadius:6,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:700,
                    background:exportTab===id?"var(--card-bg)":(darkMode?"rgba(255,255,255,0.08)":"transparent"),
                    color:exportTab===id?"var(--leaf-light)":(darkMode?"var(--leaf-light)":"var(--text-muted)"),
                    boxShadow:exportTab===id?"0 1px 4px rgba(0,0,0,.15)":"none",transition:"all .15s"}}>
                  {label}
                </button>
              ))}
            </div>

            {/* Tab content — fixed min-height to match Import's card sizing */}
            <div style={{minHeight:220}}>

            {/* ── Excel tab ── */}
            {exportTab==="xls" && (
              <>
                <p style={{fontSize:12,color:"var(--text-muted)",marginBottom:20,lineHeight:1.5}}>
                  All of your plant data in a nice lookin' spreadsheet. You can make edits to your plants and import them back in to make bulk updates. For example, to change your plant rooms after a move. It's also yours to keep if you ever stop using Plantalog.
                </p>
                <button onClick={exportXlsx} disabled={!excelJsReady}
                  style={{width:"100%",padding:"10px",borderRadius:9,border:"1.5px dashed var(--leaf-light)",background:"var(--leaf-pale)",color:darkMode?"var(--leaf-light)":"var(--leaf)",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:excelJsReady?"pointer":"default",opacity:excelJsReady?1:0.6,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download Plants (.xlsx)
                </button>
              </>
            )}

            {/* ── JSON tab ── */}
            {exportTab==="json" && (
              <>
                <p style={{fontSize:12,color:"var(--text-muted)",marginBottom:20,lineHeight:1.5}}>
                  A complete backup of your plant data, including photos. A safety net in case anything ever goes wrong.
                </p>
                <button onClick={exportData}
                  style={{width:"100%",padding:"10px",borderRadius:9,border:"1.5px dashed var(--leaf-light)",background:"var(--leaf-pale)",color:darkMode?"var(--leaf-light)":"var(--leaf)",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download Backup (.json)
                </button>
              </>
            )}

            <div style={{marginTop:14}}>
              <button className="btn btn-secondary" style={{width:"100%"}} onClick={()=>dismissSheet("export", ()=>setShowExport(false))}>Close</button>
            </div>

            </div>{/* end fixed-height tab content */}
          </div>
        </div>
        )}

        {/* ── OOT Water Schedule modal ── */}
        {showSchedule && (
        <div className={`modal-overlay${closingSheet==="schedule"?" closing":""}`} onClick={()=>dismissSheet("schedule", ()=>setShowSchedule(false))}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{paddingBottom:30}}>
            <h2>OOT Water Schedule</h2>

            {/* Vague preview of the document — drawn as SVG so it needs no
                assets and stays crisp; deliberately unreadable placeholder
                lines rather than a real render, just to convey the shape. */}
            <div className="sched-preview">
              <svg viewBox="0 0 200 116" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
                <rect x="30" y="4" width="140" height="108" rx="4" fill="var(--card-bg)" stroke="var(--border-strong)" strokeWidth="1"/>
                <rect x="40" y="13" width="58" height="7" rx="2" fill="var(--leaf)"/>
                <rect x="40" y="24" width="34" height="4" rx="2" fill="var(--border-strong)" opacity=".6"/>
                {[
                  { y:36, c:"#ffd166" },
                  { y:64, c:"#8ecae6" },
                  { y:92, c:"#c1603a" },
                ].map(({y,c},i)=>(
                  <g key={i}>
                    <rect x="40" y={y} width="120" height="6" rx="2" fill={c}/>
                    {[0,1].map(r=>(
                      <g key={r}>
                        <rect x="41" y={y+10+r*8} width="7" height="7" rx="1.5" fill="var(--sand)"/>
                        <rect x="51" y={y+12+r*8} width={r?34:46} height="3" rx="1.5" fill="var(--border-strong)" opacity=".55"/>
                        <rect x="139" y={y+11+r*8} width="4" height="4" rx="1" fill="none" stroke="var(--border-strong)" strokeWidth=".8"/>
                        <rect x="151" y={y+11+r*8} width="4" height="4" rx="1" fill="none" stroke="var(--border-strong)" strokeWidth=".8"/>
                      </g>
                    ))}
                  </g>
                ))}
              </svg>
            </div>

            <p style={{fontSize:12,color:"var(--text-muted)",marginBottom:14,lineHeight:1.5}}>
              A printable guide for whoever is looking after your plants while you're away. Every day in the range gets its own section listing the plants due for water that day, grouped by room, with a photo and a box to tick once it's done.
            </p>

            <div style={{display:"flex",gap:8,marginBottom:4}}>
              <div className="form-group" style={{flex:1,marginBottom:0}}>
                <label>From</label>
                <CalendarField value={schedFrom} onChange={d=>{setSchedFrom(d);setSchedError("");}}/>
              </div>
              <div className="form-group" style={{flex:1,marginBottom:0}}>
                <label>To</label>
                <CalendarField value={schedTo} viewHint={schedFrom} onChange={d=>{setSchedTo(d);setSchedError("");}}/>
              </div>
            </div>

            <div style={{minHeight:18,marginBottom:10}}>
              {schedRangeMessage && (
                <div style={{fontSize:11,fontWeight:600,color:schedRangeValid?"var(--text-muted)":"#c53030"}}>
                  {schedRangeMessage}
                </div>
              )}
            </div>

            {schedError && <div className="imp-error" style={{marginTop:0,marginBottom:8}}>{schedError}</div>}

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={()=>dismissSheet("schedule", ()=>setShowSchedule(false))}>Cancel</button>
              <button className="btn btn-primary"
                onClick={createSchedulePdf}
                disabled={!schedRangeValid || schedBusy || !jsPdfReady}
                style={{opacity:(schedRangeValid && !schedBusy && jsPdfReady)?1:0.5}}>
                {schedBusy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
        )}
      </div>
    </>
  );
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
// Scroll offset at the instant a nav tap happened, recorded before the reset
// so the crossfade can place the outgoing screen where it visually was.
let swapScrollY = 0;
function navCaptureScroll() {
  swapScrollY = window.scrollY || window.pageYOffset || 0;
}

function Nav({ screen, setScreen, plants, todayDate, onUtilsClick }) {
  const now = todayDate ? new Date(todayDate+"T00:00:00") : getToday();
  const due = plants ? plants.filter(p=>isWaterDue(p,now)).length : 0;
  return (
    <nav className="nav">
      <button className={`nav-btn home${screen==="home" ?" active":""}`} onClick={()=>{ setScreen("home"); navCaptureScroll(); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>
        Home
      </button>
      <button className={`nav-btn water${screen==="water"?" active water":""}`} onClick={()=>{ setScreen("water"); navCaptureScroll(); }}>
        {due>0 && <span className="nav-badge">{due}</span>}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2C6 9 4 13.5 4 16a8 8 0 0016 0c0-2.5-2-7-8-14z"/></svg>
        Water
      </button>
      <button className={`nav-btn repot${screen==="repot"?" active repot":""}`} onClick={()=>{ setScreen("repot"); navCaptureScroll(); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2v10M8 6l4-4 4 4M5 14h14l-2 7H7l-2-7z"/></svg>
        Repot
      </button>
      <button className={`nav-btn utils${screen==="utils"?" active utils":""}`} onClick={()=>{ setScreen("utils"); onUtilsClick && onUtilsClick(); navCaptureScroll(); }}>
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
  const frozenAt     = ageAsOf(plant);                 // graveyard plants stop aging
  const frozenNow    = frozenAt ? new Date(String(frozenAt).slice(0,10)+"T12:00:00") : null;
  const od           = potOverdueDays(plant, frozenNow);
  const potDue       = isPotDue(plant, frozenNow);
  const potCrimson   = od >= 365;
  const potColor     = potCrimson?"#9b1c1c":potDue?"#be185d":"var(--text)";
  const potBg        = potCrimson?"#fee2e2":potDue?"#fce7f3":"var(--page-bg)";
  const room         = rooms ? rooms.find(r=>r.id===plant.roomId) : null;
  const purgeDays    = mode==="deleted" ? daysUntilPurge(plant) : null;

  const cardClass = mode==="water" ? `water-card${leaving?" leaving":""}` :
                    mode==="repot" ? `repot-card${leaving?" leaving":""}` :
                    "plant-card";
  const showRoomPill = mode==="repot" || mode==="deleted";
  const collapsible  = mode==="water" || mode==="repot";

  const card = (
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
        {showRoomPill && room && (
          <div style={{display:"flex",gap:4,alignItems:"center",marginTop:2,flexWrap:"wrap"}}>
            {room.color
              ? <span style={{background:room.color,color:roomTextColor(room.color),padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:700,whiteSpace:"nowrap",display:"inline-block"}}>{room.name}</span>
              : <span style={{fontSize:10,fontWeight:700,color:"var(--text-muted)"}}>{room.name}</span>
            }
            {mode==="repot" && plant.originalPot && <span style={{background:"transparent",color:"#c1603a",border:"1.5px solid #c1603a",padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:700,whiteSpace:"nowrap",display:"inline-block",letterSpacing:".3px"}}>ORIGINAL</span>}
          </div>
        )}
        {mode==="deleted" && (
          <div className="purge-label" style={{marginTop:3}}>
            {Math.max(0,purgeDays)} day{Math.max(0,purgeDays)===1?"":"s"}
          </div>
        )}
        {mode==="graveyard" && plant.diedDate && (
          <div style={{fontSize:10,fontWeight:700,color:"var(--text-muted)",marginTop:3}}>
            Died {formatDiedDate(plant.diedDate)}
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

        {/* GRAVEYARD / RECENTLY DELETED tiles — same as home minus the watering
            countdown, and with ages frozen at the date the plant died. */}
        {(mode==="graveyard"||mode==="deleted") && <>
          <div className="stat-tile" title="Watering frequency" style={{background:waterFreqColor(plant.waterFreqDays)}}>
            <div className="st-lbl" style={{color:freqTextColor(plant.waterFreqDays)}}>Freq</div>
            <div className="st-val" style={{color:freqTextColor(plant.waterFreqDays)}}>{plant.waterFreqDays}d</div>
          </div>
          <div className="stat-tile" title="Pot age" style={{background:"var(--page-bg)"}}>
            <div className="st-lbl">Pot Age</div>
            <div className="st-val">{plantAgeDecimal(plant.pottedDate, frozenAt)}</div>
          </div>
          <div className="stat-tile phone-hide" title="Plant age" style={{background:"var(--page-bg)"}}>
            <div className="st-lbl">Age</div>
            <div className="st-val">{plantAgeDecimal(plant.obtainedDate, frozenAt)}</div>
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
  return collapsible
    ? <CollapseSlot leaving={!!leaving}>{card}</CollapseSlot>
    : card;
}

// ─── Home Screen ──────────────────────────────────────────────────────────────
function HomeScreen({ rooms, setRooms, plants, setPlants, showCardPhotos=true, user }) {
  const [showModal,    setShowModal]    = useState(false);
  const [editPlant,    setEditPlant]    = useState(null);
  const [detailPlant,  setDetailPlant]  = useState(null);
  const [sheetSwap, setSheetSwap] = useState(false);
  const [ghost, setGhost] = useState(null);   // {kind:"detail"|"modal", plant} held during a swap
  const ghostTimer = useRef(null);
  useEffect(() => () => clearTimeout(ghostTimer.current), []);
  function beginSwap(kind, plant) {
    setSheetSwap(true);
    setGhost({ kind, plant });
    clearTimeout(ghostTimer.current);
    ghostTimer.current = setTimeout(() => setGhost(null), 210);
  }
  const [homeTab,      setHomeTab]      = useState("plants");
  const openNewRef = useRef(null);
  // null = all, 1-4 = health filter
  const [healthFilter, setHealthFilter] = useState(null);
  const [scoreInfoOpen, setScoreInfoOpen] = useState(false);
  const [collapsedRooms, setCollapsedRooms] = useState({});

  const healthCounts = [1,2,3,4].map(h=>plants.filter(p=>p.health===h).length);
  // Health score: each plant contributes its health value as points
  // (Dying 1 ... Thriving 4), measured against a perfect score of 4 per
  // plant. Unlike a simple "how many are Good or better" count, this
  // distinguishes a collection of Thriving plants from one that is merely
  // Good, and lets a Dying plant drag the number down rather than counting
  // the same as a Caution one.
  const healthScore    = plants.reduce((sum,p)=>sum+(Number(p.health)||0),0);
  const healthScoreMax = plants.length * 4;
  const greenPct       = healthScoreMax ? Math.round(healthScore/healthScoreMax*100) : 0;
  const sortedRooms  = [...rooms].sort((a,b)=>(a.order??0)-(b.order??0));


  function selectHealth(h) {
    setHealthFilter(prev => prev===h ? null : h);
    setHomeTab("plants");
  }
  function selectAll() { setHealthFilter(null); }
  function selectRoom(roomId) {
    const collapsed = {};
    rooms.forEach(r => { collapsed[r.id] = r.id !== roomId; });
    setCollapsedRooms(collapsed);
    setHomeTab("plants");
  }



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
        {/* Row 2: health score */}
        <div className="dash-row">
          <div className="dash-card" style={{flex:1,position:"relative"}}
            onClick={()=>setScoreInfoOpen(o=>!o)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
              <span className="good-health-lbl" style={{fontSize:13,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,color:"var(--text-muted)"}}>
                Health Score
              </span>
              <span className="good-health-pct" style={{fontSize:22,fontWeight:700,color:greenPct>=75?"#276749":greenPct>=50?"#d69e2e":"#e53e3e"}}>{greenPct}%</span>
            </div>
            <div className="pct-bar"><div className="pct-bar-fill" style={{width:`${greenPct}%`}}/></div>

            {scoreInfoOpen && (
              <>
                {/* Covers the whole screen so any tap anywhere just closes the
                    tooltip instead of also activating whatever's underneath
                    (e.g. opening a plant card). stopPropagation keeps it from
                    also re-triggering the tile's own onClick, which would
                    immediately flip it back open. */}
                <div className="score-tip-backdrop" onClick={e=>{e.stopPropagation();setScoreInfoOpen(false);}}/>
                <div className="score-tip">
                  <div className="score-tip-arrow"/>
                  <div className="score-tip-emoji">{healthScoreEmoji(greenPct)}</div>
                  <div className="score-tip-rows">
                    {[1,2,3,4].map(h=>(
                      <div key={h} className="score-tip-row">
                        <span className={h===4?"score-tip-thriving":undefined} style={{color:HEALTH[h].color,fontWeight:700}}>{HEALTH[h].label}</span>
                        <span className="score-tip-pts">{h} {h===1?"point":"points"}</span>
                      </div>
                    ))}
                  </div>
                  <div className="score-tip-total">
                    <div className="score-tip-row">
                      <span>Your plants</span>
                      <span className="score-tip-pts">{healthScore} points</span>
                    </div>
                    <div className="score-tip-row">
                      <span>Possible</span>
                      <span className="score-tip-pts">{healthScoreMax} points</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="tab-bar" style={{display:"flex",alignItems:"center"}}>
        <button className={`tab-btn${homeTab==="plants"?" active":""}`} onClick={()=>setHomeTab("plants")}>Plants</button>
        <button className={`tab-btn${homeTab==="rooms" ?" active":""}`} onClick={()=>setHomeTab("rooms")}>Rooms</button>
        <button onClick={()=>{ if(homeTab==="plants"){ setSheetSwap(false); setEditPlant(null); setShowModal(true); } else { openNewRef.current?.(); } }}
          style={{marginLeft:4,flexShrink:0,padding:"8px 14px",borderRadius:7,background:"var(--leaf)",color:"white",border:"none",cursor:"pointer",fontSize:15,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>&#xff0b;</button>
      </div>

      <CrossFade value={`${homeTab}|${healthFilter ?? "all"}`}>{shown => {
      const [sTab, sfRaw] = shown.split("|");
      const sFilter   = sfRaw === "all" ? null : Number(sfRaw);
      const sFiltered = sFilter ? plants.filter(p=>p.health===sFilter) : plants;
      return (
      sTab==="plants" ? (
        <div className="section">
          {sFilter && (
            <div style={{fontSize:11,color:"var(--text-muted)",margin:"0 2px 8px",fontWeight:600}}>
              Showing: {HEALTH[sFilter].label} plants
              <button onClick={selectAll} style={{marginLeft:8,background:"none",border:"none",cursor:"pointer",color:"var(--leaf)",fontSize:11,fontWeight:700}}>× Clear</button>
            </div>
          )}
          {sortedRooms.map(room=>{
            const rPlants = sFiltered.filter(p=>p.roomId===room.id).sort((a,b)=>a.name.localeCompare(b.name));
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
                    onClick={()=>{setSheetSwap(false);setDetailPlant(plant);}}
                    onEdit={()=>{ beginSwap("detail", plant); setEditPlant(plant); setShowModal(true); }}
                  />
                ))}
              </div>
            );
          })}
          {sFiltered.length===0 && <div className="empty"><span className="ico">🌱</span><p>No plants match this filter.</p></div>}
        </div>
      ) : (
        <div className="section"><ManageRooms rooms={rooms} setRooms={setRooms} plants={plants} user={user} openNewRef={openNewRef} onSelectRoom={selectRoom}/></div>
      ));
      }}</CrossFade>


      {ghost && ghost.kind==="detail" && (
        <PlantDetail ghost plant={ghost.plant} rooms={rooms} plants={plants} setPlants={setPlants} user={user}
          onClose={()=>{}} onEdit={()=>{}} />
      )}
      {ghost && ghost.kind==="modal" && (
        <PlantModal ghost plant={ghost.plant} rooms={rooms}
          onSave={()=>{}} onDelete={null} onClose={()=>{}} onCancel={null} onClone={()=>{}} />
      )}
      {showModal && (
        <PlantModal enter={sheetSwap?"swap":"slide"}
          plant={editPlant} rooms={rooms}
          onSave={p=>{ if(editPlant) setPlants(ps=>ps.map(x=>x.id===p.id?p:x)); else setPlants(ps=>[...ps,{...p,id:uid()}]); setShowModal(false); setEditPlant(null); setDetailPlant(null); }}
          onDelete={editPlant?(dest)=>{ movePlantTo(setPlants, editPlant.id, dest); setShowModal(false); setEditPlant(null); setDetailPlant(null); }:null}
          onClose={()=>{ setShowModal(false); setEditPlant(null); setDetailPlant(null); }}
          onCancel={detailPlant?()=>{ beginSwap("modal", editPlant); setShowModal(false); setEditPlant(null); /* detailPlant stays, reopening detail */ }:null}
          onClone={()=>setEditPlant(null)}
        />
      )}
      {!showModal && detailPlant && (()=>{ const dp=plants.find(p=>p.id===detailPlant.id)||detailPlant; return (
        <PlantDetail enter={sheetSwap?"swap":"slide"} plant={dp} rooms={rooms} plants={plants} setPlants={setPlants} user={user}
          onClose={()=>setDetailPlant(null)}
          onEdit={()=>{ beginSwap("detail", dp); setDetailPlant(dp); setShowModal(true); setEditPlant(dp); }}
        />
      );})()}
    </>
  );
}

// ─── Plant Detail ─────────────────────────────────────────────────────────────

// ─── Custom calendar field ─────────────────────────────────────────────────────
// Replaces native <input type="date"> in the Add/Edit Plant card. Safari's
// native date picker has two quirks we can't work around with just JS: it
// doesn't commit a selection until the picker loses focus, and clicking a
// day from an adjacent month just re-navigates the calendar instead of
// selecting it. Owning the whole UI sidesteps both.
function CalendarPopup({ value, onSelect, onClose, viewHint }) {
  // With no value of its own, open on viewHint's month if given (used so the
  // To picker starts where the From date is, rather than on today).
  const seed = value || viewHint;
  const init = seed ? new Date(String(seed).slice(0,10)+"T12:00:00") : getToday();
  const [viewYear,  setViewYear]  = useState(init.getFullYear());
  const [viewMonth, setViewMonth] = useState(init.getMonth());

  const first = new Date(viewYear, viewMonth, 1);
  const startWeekday = first.getDay();
  const cells = Array.from({length:42}, (_,i) => new Date(viewYear, viewMonth, 1 - startWeekday + i));
  const todayStr = fmt(getToday());

  function nav(delta) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear()); setViewMonth(d.getMonth());
  }

  return (
    <div className="cal-popup-overlay" onClick={onClose}>
      <div className="cal-popup" onClick={e=>e.stopPropagation()}>
        <div className="cal-nav">
          <button className="cal-nav-btn" onClick={()=>nav(-1)} aria-label="Previous month">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span className="cal-nav-title">{MONTH_NAMES[viewMonth]} {viewYear}</span>
          <button className="cal-nav-btn" onClick={()=>nav(1)} aria-label="Next month">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div className="cal-weekdays">{["S","M","T","W","T","F","S"].map((d,i)=><span key={i}>{d}</span>)}</div>
        <div className="cal-grid">
          {cells.map((d,i) => {
            const dStr = fmt(d);
            const otherMonth = d.getMonth() !== viewMonth;
            const isSelected = value && dStr === value;
            const isToday = dStr === todayStr;
            return (
              <button key={i} type="button"
                className={`cal-day${otherMonth?" other-month":""}${isSelected?" selected":""}${isToday && !isSelected?" today":""}`}
                onClick={()=>onSelect(dStr)}>
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CalendarField({ value, onChange, placeholder="Select date", style, viewHint }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`cal-field-btn${value?"":" placeholder"}`} style={style} onClick={()=>setOpen(true)}>
        {value ? formatDateUS(value) : placeholder}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </button>
      {open && (
        <CalendarPopup value={value} viewHint={viewHint}
          onSelect={d=>{ onChange(d); setOpen(false); }}
          onClose={()=>setOpen(false)}
        />
      )}
    </>
  );
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────
// actions: [{ label, sub, kind: "grave"|"danger"|"go"|undefined, onClick }]
// True crossfade: the outgoing and incoming content overlap, so the area never
// dips to empty the way a fade-out-then-fade-in does. The outgoing layer is
// taken out of flow while it fades so the new content can occupy the space
// immediately. Absolute positioning is safe here; a transform would not be,
// since it would become the containing block for the fixed modal overlays
// rendered inside these screens.
function CrossFade({ value, children, ms = 90, offsetFromScroll = false, onSwapped }) {
  const [st, setSt] = useState({ cur: value, prev: null, top: 0 });
  const timer = useRef(null);
  const first = useRef(true);

  if (st.cur !== value) {
    // Derived during render on purpose: doing this in an effect would commit a
    // frame still showing the previous content, which is what produced the
    // scroll-position flash.
    setSt({ cur: value, prev: st.cur, top: offsetFromScroll ? swapScrollY : 0 });
    if (offsetFromScroll) swapScrollY = 0;
  }

  useEffect(() => {
    if (st.prev === null) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSt(p => ({ ...p, prev: null })), ms);
    return () => clearTimeout(timer.current);
  }, [st.prev, st.cur]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Runs before paint, with the new content already in the DOM.
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    onSwapped && onSwapped();
  }, [st.cur]);

  return (
    <div className="xfade">
      {st.prev !== null && <div className="xfade-out" key={"p"+st.prev} aria-hidden="true" style={{top:-st.top}}>{children(st.prev)}</div>}
      <div className="xfade-in" key={"c"+st.cur}>{children(st.cur)}</div>
    </div>
  );
}

// Collapses its content to zero height so the list below closes the gap in one
// continuous movement. Uses a measured pixel height rather than a max-height
// guess (which spends most of its duration doing nothing) or grid fr units
// (which interpolate unevenly, notably in Safari).
function CollapseSlot({ leaving, className = "", style, children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (leaving) {
      el.style.height = el.scrollHeight + "px";
      void el.offsetHeight;                 // flush, so the transition has a start value
      el.style.height = "0px";
      el.style.marginBottom = "0px";
    } else {
      el.style.height = "";
      el.style.marginBottom = "";
    }
  }, [leaving]);
  return <div ref={ref} className={`collapse-slot${leaving?" leaving":""}${className?" "+className:""}`} style={style}>{children}</div>;
}

// Lets a sheet animate itself out before the parent unmounts it. Dismissing to
// the background animates; swapping between the view and edit cards does not,
// so those swaps stay instant rather than playing a slide-down immediately
// followed by a slide-up.
const SHEET_EXIT_MS = 190;
function useSheetDismiss(onClose) {
  const [closing, setClosing] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  function dismiss() {
    if (closing) return;
    setClosing(true);
    timer.current = setTimeout(() => onClose && onClose(), SHEET_EXIT_MS);
  }
  return [closing, dismiss];
}

function ConfirmDialog({ title, message, actions, cancelLabel = "Cancel", onClose, center=false }) {
  return (
    <div className="cfm-overlay" onClick={onClose}>
      <div className="cfm-card" onClick={e => e.stopPropagation()}>
        <div className="cfm-title" style={center?{textAlign:"center",marginBottom:message?6:16}:undefined}>{title}</div>
        {message && <div className="cfm-msg" style={center?{textAlign:"center"}:undefined}>{message}</div>}
        <div className="cfm-actions">
          {actions.map((a, i) => (
            <button key={i} className={`cfm-btn ${a.kind || ""}`} onClick={a.onClick}>
              {a.label}
              {a.sub && <span className="cfm-sub">{a.sub}</span>}
            </button>
          ))}
          <button className="cfm-btn cancel" onClick={onClose}>{cancelLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Photo capture-date picker ────────────────────────────────────────────────
// Scroll wheels on touch devices, plain fields on desktop.
function PhotoDatePicker({ value, onSave, onClose }) {
  const isTouch = typeof window !== "undefined" &&
    window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const init = (() => {
    const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    const t = getToday();
    return m ? { y: +m[1], mo: +m[2], d: +m[3] }
             : { y: t.getFullYear(), mo: t.getMonth() + 1, d: t.getDate() };
  })();
  const [y,  setY]  = useState(init.y);
  const [mo, setMo] = useState(init.mo);
  const [d,  setD]  = useState(init.d);

  const thisYear = getToday().getFullYear();
  const years = [];
  for (let i = thisYear + 1; i >= thisYear - 40; i--) years.push(i);
  const daysInMonth = new Date(y, mo, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const clampedDay = Math.min(d, daysInMonth);

  function save() {
    const pad = n => String(n).padStart(2, "0");
    onSave(`${y}-${pad(mo)}-${pad(clampedDay)}`);
  }

  return (
    <div className="dp-overlay" onClick={onClose}>
      <div className="dp-card" onClick={e => e.stopPropagation()}>
        <div className="dp-title">Photo Date</div>
        {isTouch ? (
          <div className="dp-wheels">
            <div className="dp-wheel-mask"/>
            <Wheel className="month" items={MONTH_NAMES} values={MONTH_NAMES.map((_,i)=>i+1)} value={mo} onChange={setMo}/>
            <Wheel items={days.map(String)} values={days} value={clampedDay} onChange={setD}/>
            <Wheel items={years.map(String)} values={years} value={y} onChange={setY}/>
          </div>
        ) : (
          <div className="dp-fields">
            <div className="dp-field month">
              <label>Month</label>
              <select value={mo} onChange={e => setMo(Number(e.target.value))}>
                {MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
              </select>
            </div>
            <div className="dp-field">
              <label>Day</label>
              <input type="number" min="1" max={daysInMonth} value={clampedDay}
                onChange={e => setD(Math.max(1, Math.min(daysInMonth, Number(e.target.value) || 1)))}/>
            </div>
            <div className="dp-field">
              <label>Year</label>
              <input type="number" min="1900" max={thisYear + 1} value={y}
                onChange={e => setY(Number(e.target.value) || thisYear)}/>
            </div>
          </div>
        )}
        <div className="dp-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

// A single snap-scrolling wheel column
function Wheel({ items, values, value, onChange, className = "" }) {
  const ref = useRef(null);
  const ITEM = 38;
  const settle = useRef(null);
  const idx = Math.max(0, values.indexOf(value));

  // Position the wheel on the selected item when it first mounts
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = idx * ITEM;
  }, []);

  function onScroll() {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      if (!ref.current) return;
      const i = Math.round(ref.current.scrollTop / ITEM);
      const clamped = Math.max(0, Math.min(values.length - 1, i));
      if (values[clamped] !== value) onChange(values[clamped]);
    }, 90);
  }

  return (
    <div className={`dp-wheel ${className}`} ref={ref} onScroll={onScroll}>
      <div className="dp-wheel-pad"/>
      {items.map((label, i) => (
        <div key={label + i} className={`dp-wheel-item${i === idx ? " sel" : ""}`}>{label}</div>
      ))}
      <div className="dp-wheel-pad"/>
    </div>
  );
}

// ─── Photo lightbox (pinch / wheel zoom + swipe + capture date) ───────────────
// All gestures run through pointer events so touch and mouse share one code
// path — mixing touch+pointer handlers is the usual source of jitter here.
function PhotoLightbox({ photos, index, setIndex, dateAt, onDateChange, onClose }) {
  const MAX_Z = 5, DBL_Z = 2.5;
  const [z, setZ]           = useState(1);
  const [t, setT]           = useState({ x: 0, y: 0 });
  const [swipeDx, setSwipeDx] = useState(0);
  const [panning, setPanning] = useState(false);
  const [smooth, setSmooth]   = useState(false);
  const [pickDate, setPickDate] = useState(false);

  const stageRef  = useRef(null);
  const imgRef    = useRef(null);
  const baseDims  = useRef(null);           // rendered size at scale 1
  const pointers  = useRef(new Map());
  const gesture   = useRef(null);
  const lastTap   = useRef(0);
  const moved     = useRef(false);

  const zRef = useRef(z), tRef = useRef(t);
  zRef.current = z; tRef.current = t;

  const zoomed = z > 1.01;

  function resetZoom(animate) {
    setSmooth(!!animate);
    setZ(1); setT({ x: 0, y: 0 });
    if (animate) setTimeout(() => setSmooth(false), 220);
  }

  // Reset zoom whenever the visible photo changes
  useEffect(() => { resetZoom(false); }, [index]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape")     { if (zoomed) resetZoom(true); else onClose(); }
      if (e.key === "ArrowLeft"  && !zoomed) setIndex(i => (i > 0 ? i - 1 : i));
      if (e.key === "ArrowRight" && !zoomed) setIndex(i => (i < photos.length - 1 ? i + 1 : i));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed, photos.length]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  function measure() {
    const img = imgRef.current;
    if (!img) return;
    baseDims.current = { w: img.offsetWidth, h: img.offsetHeight };
  }
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Keep the image from being dragged past its own edges
  function clamp(x, y, scale) {
    const b = baseDims.current;
    if (!b) return { x, y };
    const maxX = Math.max(0, (b.w * scale - b.w) / 2);
    const maxY = Math.max(0, (b.h * scale - b.h) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, x)),
             y: Math.min(maxY, Math.max(-maxY, y)) };
  }

  // Scale about a screen point so that point stays put under the finger/cursor
  function zoomAt(clientX, clientY, nextZ, animate) {
    const stage = stageRef.current;
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const px = clientX - (r.left + r.width / 2);
    const py = clientY - (r.top + r.height / 2);
    const z0 = zRef.current, t0 = tRef.current;
    const z1 = Math.max(1, Math.min(MAX_Z, nextZ));
    const nx = px - (px - t0.x) * (z1 / z0);
    const ny = py - (py - t0.y) * (z1 / z0);
    const c = z1 <= 1.001 ? { x: 0, y: 0 } : clamp(nx, ny, z1);
    if (animate) { setSmooth(true); setTimeout(() => setSmooth(false), 220); }
    setZ(z1); setT(c);
  }

  function midpoint() {
    const pts = [...pointers.current.values()];
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }
  function spread() {
    const pts = [...pointers.current.values()];
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;

    if (pointers.current.size === 2) {
      gesture.current = { mode: "pinch", startDist: spread(), startZ: zRef.current };
    } else if (pointers.current.size === 1) {
      gesture.current = {
        mode: zRef.current > 1.01 ? "pan" : "swipe",
        startX: e.clientX, startY: e.clientY,
        startT: { ...tRef.current },
      };
    }
  }

  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;

    if (g.mode === "pinch" && pointers.current.size >= 2) {
      moved.current = true;
      const dist = spread();
      if (!g.startDist) return;
      const mp = midpoint();
      zoomAt(mp.x, mp.y, g.startZ * (dist / g.startDist), false);
      return;
    }
    if (g.mode === "pan") {
      const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { moved.current = true; setPanning(true); }
      setT(clamp(g.startT.x + dx, g.startT.y + dy, zRef.current));
      return;
    }
    if (g.mode === "swipe") {
      const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
      if (Math.abs(dx) < 4 || Math.abs(dx) < Math.abs(dy)) return;
      moved.current = true;
      const atLeft  = index === 0 && dx > 0;
      const atRight = index === photos.length - 1 && dx < 0;
      setSwipeDx(atLeft || atRight ? dx * 0.2 : dx);
    }
  }

  // Double tap/click: zoom in at the point, or reset if already zoomed.
  // This lives only in the pointer handlers — having a separate onDoubleClick
  // as well made the two fight (one reset, the other immediately re-zoomed).
  function handleTap(clientX, clientY) {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      if (zRef.current > 1.01) resetZoom(true);
      else zoomAt(clientX, clientY, DBL_Z, true);
    } else {
      lastTap.current = now;
    }
  }

  function onPointerUp(e) {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);

    if (g && g.mode === "swipe") {
      const dx = e.clientX - g.startX;
      setSwipeDx(0);
      if (Math.abs(dx) > 50) {
        if (dx < 0 && index < photos.length - 1) setIndex(i => i + 1);
        else if (dx > 0 && index > 0)            setIndex(i => i - 1);
      } else if (!moved.current) {
        handleTap(e.clientX, e.clientY);
      }
    }
    if (g && g.mode === "pan" && !moved.current) handleTap(e.clientX, e.clientY);
    setPanning(false);

    if (pointers.current.size === 0) {
      gesture.current = null;
      if (zRef.current <= 1.001) resetZoom(true);
    } else if (pointers.current.size === 1) {
      // Second finger lifted mid-pinch — continue as a pan without jumping
      const only = [...pointers.current.values()][0];
      gesture.current = { mode: zRef.current > 1.01 ? "pan" : "swipe",
        startX: only.x, startY: only.y, startT: { ...tRef.current } };
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0016);
    zoomAt(e.clientX, e.clientY, zRef.current * factor, false);
  }

  const dateStr = prettyPhotoDate(dateAt(index));

  return (
    <div className="lightbox" onClick={() => { if (!zoomed && !moved.current) onClose(); }}>
      <button className="lightbox-close" onClick={e => { e.stopPropagation(); onClose(); }}>✕</button>

      {/* Capture date — sits in the black space above the photo */}
      <button className={`lightbox-date${dateStr ? "" : " empty"}`}
        onClick={e => { e.stopPropagation(); setPickDate(true); }}>
        {dateStr || "Add date"}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" opacity=".75">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>
        </svg>
      </button>

      <div className="lightbox-inner" onClick={e => e.stopPropagation()}>
        <button className={`lightbox-arrow${index === 0 || zoomed ? " hidden" : ""}`}
          onClick={e => { e.stopPropagation(); setIndex(i => i - 1); }}>‹</button>

        <div ref={stageRef}
          className={`lightbox-stage${zoomed ? " zoomed" : ""}${panning ? " panning" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onContextMenu={e => e.preventDefault()}>
          <img ref={imgRef} src={photos[index]} alt="" onLoad={measure} draggable="false"
            style={{
              transform: `translate3d(${t.x + swipeDx}px, ${t.y}px, 0) scale(${z})`,
              transition: smooth || swipeDx === 0 ? "transform .2s cubic-bezier(.22,.61,.36,1)" : "none",
            }}/>
        </div>

        <button className={`lightbox-arrow${index === photos.length - 1 || zoomed ? " hidden" : ""}`}
          onClick={e => { e.stopPropagation(); setIndex(i => i + 1); }}>›</button>
      </div>

      {zoomed && <div className="lightbox-zoom-hint">{z.toFixed(1)}× · double-tap to reset</div>}

      {photos.length > 1 && !zoomed && (
        <div className="lightbox-dots">
          {photos.map((_, i) => (
            <div key={i} className={`lightbox-dot${i === index ? " active" : ""}`}
              onClick={e => { e.stopPropagation(); setIndex(i); }}/>
          ))}
        </div>
      )}

      {pickDate && (
        <div onClick={e => e.stopPropagation()}>
          <PhotoDatePicker value={dateAt(index)}
            onSave={d => { onDateChange(index, d); setPickDate(false); }}
            onClose={() => setPickDate(false)}/>
        </div>
      )}
    </div>
  );
}

function PlantDetail({ plant, rooms, plants, setPlants, onClose, onEdit, user, variant="active", onRestore, onSendToDeleted, enter="slide", ghost=false }) {
  const [confirm, setConfirm] = useState(null);   // "restore" | "delete"
  const [detailClosing, dismissDetail] = useSheetDismiss(onClose);
  const room    = rooms.find(r=>r.id===plant.roomId);
  const h       = HEALTH[plant.health];
  const fileRef = useRef();
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const [openMenuIdx, setOpenMenuIdx] = useState(null);

  const daysSince = daysBetween(plant.lastWatered, fmt(getToday()));
  const daysLeft  = plant.waterFreqDays - daysSince;
  const potDue    = isPotDue(plant);

  // photoDates is a parallel array to photos, so it survives reorder/delete
  // and the Supabase upload swap (which preserves order) automatically.
  function datesOf(p, len) {
    const d = Array.isArray(p.photoDates) ? [...p.photoDates] : [];
    while (d.length < len) d.push(null);
    return d.slice(0, len);
  }

  function handlePhoto(e) {
    const file=e.target.files[0]; if(!file) return;
    Promise.all([compressPhoto(file), derivePhotoDate(file)]).then(([dataUrl, date]) =>
      setPlants(ps=>ps.map(p=>{
        if(p.id!==plant.id) return p;
        const photos=[...p.photos, dataUrl];
        const photoDates=[...datesOf(p, p.photos.length), date];
        // New photo becomes primary, then everything re-sorts into date order
        const sorted=sortPhotosByDate(photos, photoDates, photos.length-1);
        return {...p, ...sorted};
      }))
    );
    e.target.value="";
  }
  function removePhoto(i) {
    const photoUrl = plant.photos[i];
    if (!PREVIEW_MODE && user && photoUrl && (photoUrl.startsWith("http://") || photoUrl.startsWith("https://"))) {
      sbDeleteSinglePhoto(user.id, plant.id, photoUrl);
    }
    setPlants(ps=>ps.map(p=>{
      if(p.id!==plant.id) return p;
      const photos=[...p.photos]; photos.splice(i,1);
      const photoDates=datesOf(p, p.photos.length); photoDates.splice(i,1);
      const wasPrimary = (p.primaryPhoto==null?0:p.primaryPhoto)===i;
      let primary=p.primaryPhoto;
      // Deleting the primary promotes the most recent photo (now the last one,
      // since photos are ordered oldest -> newest).
      if(wasPrimary) primary = photos.length ? photos.length-1 : null;
      else if(primary>i) primary=primary-1;
      return {...p,photos,photoDates,primaryPhoto:primary};
    }));
  }
  function setPrimary(i) {
    setPlants(ps=>ps.map(p=>p.id===plant.id?{...p,primaryPhoto:i}:p));
  }
  function setPhotoDate(i, date) {
    setPlants(ps=>ps.map(p=>{
      if(p.id!==plant.id) return p;
      const photoDates=datesOf(p, p.photos.length);
      photoDates[i]=date;
      // Editing a date can change where the photo belongs in the sequence
      return {...p, ...sortPhotosByDate(p.photos, photoDates, p.primaryPhoto)};
    }));
  }


  return (
    <div className={`modal-overlay${detailClosing?" closing":""}${enter==="swap"?" swap":""}${ghost?" ghost":""}`} onClick={ghost?undefined:dismissDetail}>
      <div className="modal detail-sheet" style={{padding:0,overflow:"hidden",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>

        {/* Header — health color */}
        <div style={{background:h.color,color:plant.health===3?"#1a4731":"white",padding:"14px 14px 12px",position:"relative",flexShrink:0,borderRadius:"14px 14px 0 0"}}>
          <button className="close-x-btn" onClick={e=>{e.stopPropagation();dismissDetail();}} style={{zIndex:10,background:plant.health===3?"rgba(0,0,0,.15)":"rgba(255,255,255,.22)",color:plant.health===3?"#1a4731":"white"}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <button onClick={e=>{e.stopPropagation(); if(variant==="active") onEdit(); else setConfirm("restore");}} style={{position:"absolute",top:10,right:10,zIndex:10,background:plant.health===3?"rgba(0,0,0,.15)":"rgba(255,255,255,.22)",border:"none",borderRadius:20,padding:"0 14px",height:26,minWidth:44,color:plant.health===3?"#1a4731":"white",cursor:"pointer",fontSize:11,fontFamily:"'DM Sans',sans-serif",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>
            {variant==="graveyard" ? "Revive" : variant==="deleted" ? "Restore" : "Edit"}
          </button>
          <div style={{textAlign:"center",paddingTop:4}}>
            <div style={{display:"flex",justifyContent:"center",marginBottom:4}}>
              {room?.color
                ? <span style={{background:room.color,color:roomTextColor(room.color),padding:"2px 10px",borderRadius:20,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".8px"}}>{room.name}</span>
                : <span style={{fontSize:10,opacity:plant.health===3?1:.8,color:plant.health===3?"#1a4731":"inherit",textTransform:"uppercase",letterSpacing:".8px"}}>{room?.name}</span>
              }
            </div>
            <div style={{fontSize:22,fontWeight:700,lineHeight:1.2}}>{plant.name}</div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:7,marginTop:5,flexWrap:"wrap"}}>
              <span style={{background:plant.health===3?"rgba(0,0,0,.12)":"rgba(255,255,255,.22)",padding:"3px 11px",borderRadius:20,fontSize:12,fontWeight:700}}>{h.label}</span>
              <span style={{background:plant.health===3?"rgba(0,0,0,.12)":"rgba(255,255,255,.22)",padding:"3px 11px",borderRadius:20,fontSize:12,fontWeight:700}}>Age: {plantAgeDecimal(plant.obtainedDate, ageAsOf(plant))}</span>
              {plant.diedDate && (
                <span className="died-pill" style={{background:plant.health===3?"rgba(0,0,0,.12)":"rgba(255,255,255,.22)"}}>Died: {formatDiedDate(plant.diedDate)}</span>
              )}
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
                <div className="info-val" style={{fontSize:20,fontWeight:700,color:"var(--leaf)"}}>{plant.pottedDate?new Date(plant.pottedDate+"T00:00:00").toLocaleDateString("en-US",{month:"numeric",day:"numeric",year:"2-digit"}):"-"}</div>
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
              {plant.photos.map((src, i)=>{
                const isPrimary = (plant.primaryPhoto==null?0:plant.primaryPhoto)===i;
                return (
                  <div key={i}
                    className="photo-thumb-wrap"
                    style={{width:68,height:68}}
                    onClick={()=>{ if(openMenuIdx===i) setOpenMenuIdx(null); else setLightboxIdx(i); }}>
                    <img src={src} className="photo-thumb" style={{width:68,height:68}} alt=""/>
                    {isPrimary && <span style={{position:"absolute",top:2,left:3,fontSize:20,lineHeight:1,filter:"drop-shadow(0 1px 3px rgba(0,0,0,.7))",pointerEvents:"none",color:"white"}}>★</span>}
                    <button className="photo-menu-btn" onClick={e=>{e.stopPropagation();setOpenMenuIdx(openMenuIdx===i?null:i);}}>⋯</button>
                    {openMenuIdx===i && (
                      <div className="photo-menu" onClick={e=>e.stopPropagation()}>
                        <button className="photo-menu-action" title={isPrimary?"Primary":"Set as primary"} onClick={()=>{setPrimary(i);setOpenMenuIdx(null);}}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill={isPrimary?"white":"none"} stroke="white" strokeWidth="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                          </svg>
                        </button>
                        <div style={{width:1,background:"rgba(255,255,255,.15)",margin:"5px 0"}}/>
                        <button className="photo-menu-action" title="Remove" onClick={()=>{removePhoto(i);setOpenMenuIdx(null);}}>
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="photo-add" style={{width:68,height:68}} onClick={()=>fileRef.current.click()}>+</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handlePhoto}/>
            {plant.photos.length===0 && <div style={{fontSize:11,color:"var(--text-muted)",marginTop:3}}>Tap + to add a photo.</div>}
            {plant.photos.length>1 && <div style={{fontSize:10,color:"var(--text-muted)",marginTop:5}}>Oldest to newest · tap a photo to view or change its date</div>}
          </div>

          {/* Notes */}
          {plant.notes && (
            <div className="notes-section">
              <div className="notes-section-label">Notes</div>
              <div className="notes-preview">{plant.notes}</div>
            </div>
          )}

          {/* Graveyard: permanently move this plant on to Recently Deleted */}
          {variant==="graveyard" && (
            <button className="btn btn-danger" style={{width:"100%",marginTop:4}}
              onClick={()=>setConfirm("delete")}>Delete</button>
          )}
        </div>

        {confirm==="restore" && variant==="graveyard" && (
          <ConfirmDialog
            title={`Revive ${plant.name}?`}
            message="It will return to your active plants."
            actions={[{ label:"Revive", kind:"go",
              onClick: () => { setConfirm(null); onRestore && onRestore("active"); } }]}
            onClose={()=>setConfirm(null)}
          />
        )}
        {confirm==="restore" && variant==="deleted" && (
          <ConfirmDialog
            title={`Restore ${plant.name}?`}
            center
            actions={[
              { label:"Restore", kind:"go",
                onClick: () => { setConfirm(null); onRestore && onRestore("active"); } },
              { label:"Graveyard", kind:"grave",
                onClick: () => { setConfirm(null); onRestore && onRestore("graveyard"); } },
            ]}
            onClose={()=>setConfirm(null)}
          />
        )}
        {confirm==="delete" && (
          <ConfirmDialog
            title={`Delete ${plant.name}?`}
            message="It will be permanently deleted in 30 days."
            actions={[{
              label: "Delete", kind: "danger",
              onClick: () => { setConfirm(null); onSendToDeleted && onSendToDeleted(); },
            }]}
            onClose={()=>setConfirm(null)}
          />
        )}

        {/* Lightbox */}
        {lightboxIdx!==null && plant.photos[lightboxIdx] && (
          <PhotoLightbox
            photos={plant.photos}
            index={lightboxIdx}
            setIndex={setLightboxIdx}
            dateAt={i=>(plant.photoDates||[])[i]}
            onDateChange={setPhotoDate}
            onClose={()=>setLightboxIdx(null)}
          />
        )}
        {openMenuIdx!==null && <div style={{position:"fixed",inset:0,zIndex:10}} onClick={()=>setOpenMenuIdx(null)}/>}
      </div>
    </div>
  );
}

// ─── Manage Rooms ─────────────────────────────────────────────────────────────
function ManageRooms({ rooms, setRooms, plants, user, openNewRef, onSelectRoom }) {
  const [editing,setEditing]=useState(null);
  const [formName,setFormName]=useState("");
  const [formOrder,setFormOrder]=useState("");
  const [formColor,setFormColor]=useState(null);
  const [orderError,setOrderError]=useState(false);
  const sorted=[...rooms].sort((a,b)=>(a.order??0)-(b.order??0));
  function openNew(){setEditing({});setFormName("");setFormOrder(rooms.length+1);setFormColor(null);setOrderError(false);}
  useEffect(()=>{ if(openNewRef) openNewRef.current = openNew; });
  function openEdit(r){setEditing(r);setFormName(r.name);setFormOrder(r.order);setFormColor(r.color||null);setOrderError(false);}
  function save(){
    if(!formName.trim())return;
    const orderNum = Number(formOrder);
    const taken = rooms.some(r=>r.order===orderNum && r.id!==editing.id);
    if(taken){ setOrderError(true); return; }
    if(editing.id) setRooms(rs=>rs.map(r=>r.id===editing.id?{...r,name:formName,order:orderNum,color:formColor}:r));
    else setRooms(rs=>[...rs,{id:uid(),name:formName,order:orderNum,color:formColor}]);
    setEditing(null);
  }
  function del(id){if(plants.some(p=>p.roomId===id)){alert("Move or delete this room's plants first.");return;} if(!PREVIEW_MODE&&user) sbDeleteRooms(user.id,[id]); setRooms(rs=>rs.filter(r=>r.id!==id));}
  return(<>
    {sorted.map(r=>(
      <div key={r.id} className={`room-list-item${onSelectRoom?" clickable":""}`} onClick={onSelectRoom?()=>onSelectRoom(r.id):undefined}>
        <div style={{background:r.color||"var(--bark)",color:r.color?roomTextColor(r.color):"white",borderRadius:"50%",width:25,height:25,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0}}>{r.order}</div>
        <div><div className="room-list-name" style={{fontWeight:700,fontSize:15}}>{r.name}</div><div className="room-list-count" style={{fontSize:12,color:"var(--text-muted)",marginTop:1}}>{plants.filter(p=>p.roomId===r.id).length} plants</div></div>
        <div className="room-actions">
          <button className="room-action-tile" onClick={e=>{e.stopPropagation();openEdit(r);}} title="Edit room">✎</button>
          <button className="room-action-tile room-action-tile-danger" onClick={e=>{e.stopPropagation();del(r.id);}} title="Delete room">🗑</button>
        </div>
      </div>
    ))}
    {editing!==null&&(
      <div className="modal-overlay" onClick={()=>setEditing(null)}>
        <div className="modal" onClick={e=>e.stopPropagation()}>
          <h2>{editing.id?"Edit Room":"New Room"}</h2>
          <div className="form-group"><label>Room Name</label><input value={formName} onChange={e=>setFormName(e.target.value)} placeholder="e.g. Living Room"/></div>
          <div className="form-group">
            <label>Sort Order</label>
            <input type="number" value={formOrder}
              onChange={e=>{setFormOrder(e.target.value);setOrderError(false);}}
              placeholder="1"
              className={orderError?"field-error":undefined}/>
            {orderError && <div style={{fontSize:11,color:"#c53030",marginTop:4}}>That Sort Order is already used by another room. Choose a different number.</div>}
          </div>
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
function PlantModal({ plant, rooms, onSave, onDelete, onClose, onCancel, onClone, enter="slide", ghost=false }) {
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
  const [confirmDel,setConfirmDel]=useState(false);
  const [modalClosing, dismissModal] = useSheetDismiss(onClose);

  // Browsers sometimes leave a typed leading zero ("020") on screen after a
  // number input's value is reprogrammed to "20", since the parsed number
  // didn't change — they treat it as a no-op. Forcing the DOM value directly
  // on blur (rather than relying on React's props diff) clears it reliably.
  function cleanNumberOnBlur(e) {
    const n = parseFloat(e.target.value);
    if (!isNaN(n)) e.target.value = String(n);
  }

  // Clone: carries every setting + notes forward, but never the photos, and
  // drops the id so Save creates a brand-new plant rather than overwriting
  // this one. No confirmation — it's non-destructive to the original.
  function handleClone(){
    const { id, photos, photoDates, primaryPhoto, ...rest } = form;
    const draft = { ...rest, photos:[], photoDates:[], primaryPhoto:null };
    setForm(draft);
    onClone && onClone();   // tells the parent this session is now "Add", not "Edit"
  }

  function padDates(f, len){
    const d = Array.isArray(f.photoDates) ? [...f.photoDates] : [];
    while(d.length<len) d.push(null);
    return d.slice(0,len);
  }
  function handlePhoto(e){
    const file=e.target.files[0]; if(!file) return;
    Promise.all([compressPhoto(file), derivePhotoDate(file)]).then(([dataUrl, date]) =>
      setForm(f=>{
        const photos=[...(f.photos||[]),dataUrl];
        const photoDates=[...padDates(f,(f.photos||[]).length), date];
        return {...f, ...sortPhotosByDate(photos, photoDates, photos.length-1)};
      })
    );
    e.target.value="";
  }
  function removePhoto(i){
    setForm(f=>{
      const photos=[...f.photos]; photos.splice(i,1);
      const photoDates=padDates(f,f.photos.length); photoDates.splice(i,1);
      const wasPrimary=(f.primaryPhoto==null?0:f.primaryPhoto)===i;
      let primary=f.primaryPhoto;
      if(wasPrimary) primary = photos.length ? photos.length-1 : null;
      else if(primary>i) primary=primary-1;
      return {...f,photos,photoDates,primaryPhoto:primary};
    });
  }

  return (
    <div className={`modal-overlay${modalClosing?" closing":""}${enter==="swap"?" swap":""}${ghost?" ghost":""}`} onClick={ghost?undefined:dismissModal}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:8}}>
          <h2 style={{margin:0}}>{plant?"Edit Plant":"Add Plant"}</h2>
          {plant && onClone && (
            <button type="button" className="clone-btn" onClick={handleClone}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
              Clone
            </button>
          )}
        </div>

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

        {/* Row 2: Health (full width on phones) + Date Obtained (hidden on phones) */}
        <div className="form-row health-full-row" style={{gap:7,marginBottom:7}}>
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
          <div className="form-group phone-hide" style={{marginBottom:0}}>
            <label>Date Obtained</label>
            <CalendarField value={form.obtainedDate} onChange={d=>set("obtainedDate",d)}/>
          </div>
        </div>
        {/* Date Obtained — phones only, own row, left-aligned */}
        <div className="form-group phone-only" style={{marginBottom:7}}>
          <label>Date Obtained</label>
          <CalendarField value={form.obtainedDate} onChange={d=>set("obtainedDate",d)} style={{width:"auto"}}/>
        </div>

        {/* ── Watering ── */}
        <div className="form-section" style={{background:"var(--watering-bg,#1b4d3e18)",border:"1.5px solid var(--watering-border,#1b4d3e30)"}}>
          <div className="form-section-label section-hdr-water">Watering</div>
          <div className="form-row" style={{gap:7}}>
            <div className="form-group" style={{marginBottom:0}}>
              <label>Water Every</label>
              <div className="input-suffix-wrap">
                <input type="number" min="1" value={form.waterFreqDays} onChange={e=>set("waterFreqDays",Number(e.target.value))} onBlur={cleanNumberOnBlur}/>
                <span className="input-suffix">d</span>
              </div>
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label>Last Watered</label>
              <CalendarField value={form.lastWatered} onChange={d=>set("lastWatered",d)}/>
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
                  <input type="number" min="0" value={form.potYears} onChange={e=>set("potYears",Number(e.target.value))} onBlur={cleanNumberOnBlur}/>
                  <span className="input-suffix">y</span>
                </div>
                <div className="input-suffix-wrap" style={{flex:1}}>
                  <input type="number" min="0" max="11" value={form.potMonths} onChange={e=>set("potMonths",Number(e.target.value))} onBlur={cleanNumberOnBlur}/>
                  <span className="input-suffix">m</span>
                </div>
              </div>
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label>Last Potted</label>
              <CalendarField value={form.pottedDate} onChange={d=>set("pottedDate",d)}/>
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
                  }} onBlur={cleanNumberOnBlur}/>
                <span className="input-suffix">"</span>
              </div>
              {/* Next pot size */}
              <div className="input-suffix-wrap">
                <input type="number" min="1" step="0.5" style={{minWidth:0,width:"100%"}} value={form.nextPotSize}
                  onChange={e=>set("nextPotSize",parseFloat(e.target.value)||0)} onBlur={cleanNumberOnBlur}/>
                <span className="input-suffix">"</span>
              </div>
              {/* Original pot checkbox — spans cols 3+4, centered */}
              <div style={{gridColumn:"3/5",display:"flex",alignItems:"center",gap:8,paddingLeft:4}}>
                <input type="checkbox" checked={form.originalPot} onChange={e=>set("originalPot",e.target.checked)} style={{width:18,height:18,cursor:"pointer",flexShrink:0,accentColor:"#c1603a"}}/>
              </div>
            </div>
          </div>
        </div>

        {/* Photos — hidden on phones (manage via PlantDetail instead) */}
        <div className="phone-hide">
        <div className="form-group">
          <label>Photos</label>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
            {(form.photos||[]).map((src,i)=>(
              <div key={i} style={{position:"relative",width:64,height:64,flexShrink:0}}>
                <img src={src} style={{width:64,height:64,objectFit:"cover",borderRadius:7,display:"block"}} alt=""/>
                {(form.primaryPhoto===i||(form.primaryPhoto==null&&i===0))&&<span style={{position:"absolute",top:1,left:3,fontSize:20,lineHeight:1,filter:"drop-shadow(0 1px 3px rgba(0,0,0,.7))",pointerEvents:"none",color:"white"}}>★</span>}
                <button onClick={()=>removePhoto(i)} style={{position:"absolute",top:1,right:1,background:"rgba(0,0,0,.55)",border:"none",color:"white",borderRadius:"50%",width:20,height:20,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>✕</button>
              </div>
            ))}
            <div style={{width:64,height:64,border:"2px dashed var(--border-strong,#b0a898)",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"var(--text-muted)",fontSize:22,flexShrink:0}} onClick={()=>fileRef.current.click()}>+</div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handlePhoto}/>
        </div>
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
          {onDelete&&<button className="btn btn-danger" onClick={()=>setConfirmDel(true)}>Delete</button>}
          <button className="btn btn-secondary" onClick={onCancel||onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={()=>{ if(!form.name.trim()) return alert("Plant name required."); onSave(form); }}>Save</button>
        </div>

        {confirmDel && (
          <ConfirmDialog
            title="Where should this plant go?"
            center
            actions={[
              { label:"Graveyard", sub:"Your plant has died, but its memory lives on.", kind:"grave",
                onClick:()=>{ setConfirmDel(false); onDelete("graveyard"); } },
              { label:"Delete", sub:"It will permanently delete in 30 days", kind:"danger",
                onClick:()=>{ setConfirmDel(false); onDelete("deleted"); } },
            ]}
            onClose={()=>setConfirmDel(false)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Water Screen ─────────────────────────────────────────────────────────────
function WaterScreen({ rooms, plants, setPlants, todayDate, showCardPhotos=true, user, pushUndo, canUndo, onUndo }) {
  const now = new Date(todayDate + "T00:00:00");
  const [leaving,    setLeaving]    = useState({});
  const [openFreq,   setOpenFreq]   = useState(null);
  const [freqPick,   setFreqPick]   = useState(null);
  const [freqCustom, setFreqCustom] = useState("");
  const [detailPlant,setDetailPlant]= useState(null);
  const [sheetSwap, setSheetSwap] = useState(false);
  const [ghost, setGhost] = useState(null);   // {kind:"detail"|"modal", plant} held during a swap
  const ghostTimer = useRef(null);
  useEffect(() => () => clearTimeout(ghostTimer.current), []);
  function beginSwap(kind, plant) {
    setSheetSwap(true);
    setGhost({ kind, plant });
    clearTimeout(ghostTimer.current);
    ghostTimer.current = setTimeout(() => setGhost(null), 210);
  }
  const [editPlant,  setEditPlant]  = useState(null);
  const [showModal,  setShowModal]  = useState(false);

  const sortedRooms = [...rooms].sort((a,b)=>(a.order??0)-(b.order??0));
  const due     = plants.filter(p=>isWaterDue(p,now));
  const allDone = due.length===0;
  // Counts what will remain once the in-flight rows finish leaving, so the
  // header updates on tap rather than waiting for the animation.
  const pendingDue = due.filter(p=>!leaving[p.id]).length;
  // Fade the all-clear message in only when it appears as a result of the last
  // check-off. Revisiting the screen with nothing due should just show it.
  const [doneEntering, setDoneEntering] = useState(false);
  const wasDone = useRef(allDone);
  useLayoutEffect(() => {
    let t;
    if (allDone && !wasDone.current) { setDoneEntering(true); t = setTimeout(()=>setDoneEntering(false), 700); }
    wasDone.current = allDone;
    return () => clearTimeout(t);
  }, [allDone]);

  function water(id) {
    const prev = plants.find(p=>p.id===id);
    setLeaving(l=>({...l,[id]:true}));
    setTimeout(()=>{
      setPlants(ps=>ps.map(p=>p.id===id?{...p,lastWatered:fmt(now)}:p));
      if (prev) pushUndo && pushUndo("water", id, { lastWatered: prev.lastWatered });
      setLeaving(l=>{const n={...l};delete n[id];return n;});
    },440);
  }

  function saveFreq(plantId) {
    const add = freqPick ?? (freqCustom ? parseInt(freqCustom,10) : null);
    if (!add || add <= 0) return;
    const prev = plants.find(p=>p.id===plantId);
    setOpenFreq(null); setFreqPick(null); setFreqCustom("");
    setLeaving(l=>({...l,[plantId]:true}));
    setTimeout(()=>{
      setPlants(ps=>ps.map(p=>p.id===plantId?{...p,waterFreqDays:p.waterFreqDays+add}:p));
      if (prev) pushUndo && pushUndo("water", plantId, { waterFreqDays: prev.waterFreqDays });
      setLeaving(l=>{const n={...l};delete n[plantId];return n;});
    },440);
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
      const roomEmptying = showActions && rp.every(p=>leaving[p.id]);
      return (
        <div key={room.id} className={`room-group${roomEmptying?" emptying":""}`}>
          <CollapseSlot leaving={roomEmptying}>
            <div className={`room-hdr-wrap${roomEmptying?" leaving":""}`}>
              <RoomHeader room={room} count={rp.length} />
            </div>
          </CollapseSlot>
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
                onClick={()=>{setSheetSwap(false);setDetailPlant(plant);}}
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
      const roomEmptying = rp.every(p=>leaving[p.id]);
      return (
        <div key={room.id} className="room-group" style={{marginBottom:roomEmptying?0:4}}>
          <CollapseSlot leaving={roomEmptying}>
            <div className={`room-hdr-wrap${roomEmptying?" leaving":""}`}>
              <RoomHeader room={room} count={rp.length} style={{marginBottom:4}} />
            </div>
          </CollapseSlot>
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
                onClick={()=>{setSheetSwap(false);setDetailPlant(plant);}}
                onCheck={()=>water(plant.id)}
                onFreqInc={(e)=>openTooltip(e,plant.id)}
              />
            </div>
          ))}
        </div>
      );
    });
    const dayEmptying = gPlants.length > 0 && gPlants.every(p=>leaving[p.id]);
    return (
      <CollapseSlot key={daysAway} leaving={dayEmptying} style={{marginBottom:14}}>
        <div className={`upnext-day${dayEmptying?" leaving":""}`}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <div className="upnext-lbl" style={{fontSize:13,fontWeight:700,color:"var(--leaf)",textTransform:"uppercase",letterSpacing:.5}}>
              {dayLabel(daysAway)}
            </div>
            <div style={{flex:1,height:1,background:"var(--text-muted)"}}/>
            <div style={{fontSize:13,fontWeight:700,color:"var(--text-muted)"}}>{gPlants.length} plant{gPlants.length!==1?"s":""}</div>
          </div>
          {byRoom}
        </div>
      </CollapseSlot>
    );
  }

  return(
    <>
      {/* Close tooltip on outside click */}
      {openFreq!==null && <div style={{position:"fixed",inset:0,zIndex:40}} onClick={()=>{setOpenFreq(null);setFreqPick(null);setFreqCustom("");}}/>}
      <div className="page-header teal">
        <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:8}}>
          <div style={{minWidth:0}}>
            <h1>Water</h1>
            <p>{pendingDue===0?"All plants watered today 🎉":`${pendingDue} plant${pendingDue!==1?"s":""} need${pendingDue===1?"s":""} water today`}</p>
          </div>
          {canUndo && (
            <button className="header-undo-btn" onClick={onUndo}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M4 9h10a6 6 0 1 1 0 12h-3"/></svg>
              Undo
            </button>
          )}
        </div>
      </div>
      <div className="section" style={{paddingTop:10}}>
        {/* Today's due plants — wrapped with a min-height matching the "all
            done" celebration block, so Up Next doesn't jump down when the
            last plant is watered and the content underneath it changes. */}
        <div style={{minHeight:DUE_SECTION_MIN_H}}>
          {allDone?(
            <div className={doneEntering?"all-done":undefined} style={{textAlign:"center",padding:"28px 20px 20px",color:"var(--text-muted)"}}>
              <div style={{fontSize:44,marginBottom:8}}>🌿</div>
              <div style={{fontSize:20,fontWeight:700,color:"var(--leaf)",marginBottom:6}}>All done for today!</div>
              <div style={{fontSize:14}}>Your plants are happy and hydrated.</div>
            </div>
          ):renderByRoom(due,true)}
        </div>

        {/* Up Next — always shown */}
        {upNext.length>0&&(
          <div style={{marginTop:50}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <h2 style={{fontSize:19,fontWeight:800,color:"var(--text)",margin:0}}>Up Next</h2>
              <div style={{fontSize:11,color:"var(--text-muted)"}}>next 7 days</div>
            </div>
            {upNext.map(g=>renderUpNextGroup(g))}
          </div>
        )}
        {upNext.length===0&&allDone&&(
          <div style={{textAlign:"center",fontSize:12,color:"var(--text-muted)",paddingBottom:16}}>Nothing due in the next 7 days.</div>
        )}
      </div>
      {ghost && ghost.kind==="detail" && (
        <PlantDetail ghost plant={ghost.plant} rooms={rooms} plants={plants} setPlants={setPlants} user={user}
          onClose={()=>{}} onEdit={()=>{}} />
      )}
      {showModal && <PlantModal enter={sheetSwap?"swap":"slide"} plant={editPlant} rooms={rooms}
        onSave={p=>{ if(editPlant) setPlants(ps=>ps.map(x=>x.id===p.id?p:x)); else setPlants(ps=>[...ps,{...p,id:uid()}]); setShowModal(false); setEditPlant(null); }}
        onDelete={editPlant?(dest)=>{ movePlantTo(setPlants, editPlant.id, dest); setShowModal(false); setEditPlant(null); }:null}
        onClose={()=>{ setShowModal(false); setEditPlant(null); }}
        onClone={()=>setEditPlant(null)}
      />}
      {detailPlant && (()=>{ const dp=plants.find(p=>p.id===detailPlant.id)||detailPlant; return (
        <PlantDetail enter={sheetSwap?"swap":"slide"} plant={dp} rooms={rooms} plants={plants} setPlants={setPlants} user={user}
          onClose={()=>setDetailPlant(null)}
          onEdit={()=>{ beginSwap("detail", dp); setEditPlant(dp); setDetailPlant(null); setShowModal(true); }}
        />
      );})()}
    </>
  );
}

// ─── Repot Screen ─────────────────────────────────────────────────────────────
function RepotScreen({ rooms, plants, setPlants, todayDate, showCardPhotos=true, user, pushUndo, canUndo, onUndo }) {
  const now = new Date((todayDate||fmt(getToday())) + "T00:00:00");
  const [leaving,    setLeaving]    = useState({});
  const [detailPlant,setDetailPlant]= useState(null);
  const [sheetSwap, setSheetSwap] = useState(false);
  const [ghost, setGhost] = useState(null);   // {kind:"detail"|"modal", plant} held during a swap
  const ghostTimer = useRef(null);
  useEffect(() => () => clearTimeout(ghostTimer.current), []);
  function beginSwap(kind, plant) {
    setSheetSwap(true);
    setGhost({ kind, plant });
    clearTimeout(ghostTimer.current);
    ghostTimer.current = setTimeout(() => setGhost(null), 210);
  }
  const [editPlant,  setEditPlant]  = useState(null);
  const [showModal,  setShowModal]  = useState(false);
  const sortedRooms = [...rooms].sort((a,b)=>(a.order??0)-(b.order??0));
  const due=[...plants].filter(p=>isPotDue(p,now)).sort((a,b)=>a.nextPotSize-b.nextPotSize||a.name.localeCompare(b.name));
  const allDone = due.length===0;
  // Counts what will remain once the in-flight rows finish leaving, so the
  // header updates on tap rather than waiting for the animation.
  const pendingDue = due.filter(p=>!leaving[p.id]).length;
  // Fade the all-clear message in only when it appears as a result of the last
  // check-off. Revisiting the screen with nothing due should just show it.
  const [doneEntering, setDoneEntering] = useState(false);
  const wasDone = useRef(allDone);
  useLayoutEffect(() => {
    let t;
    if (allDone && !wasDone.current) { setDoneEntering(true); t = setTimeout(()=>setDoneEntering(false), 700); }
    wasDone.current = allDone;
    return () => clearTimeout(t);
  }, [allDone]);

  function repot(id){
    const prev = plants.find(p=>p.id===id);
    setLeaving(l=>({...l,[id]:true}));
    setTimeout(()=>{
      setPlants(ps=>ps.map(p=>{
        if(p.id!==id) return p;
        const newCurrent = p.nextPotSize;
        const newNext    = Math.round((newCurrent+1)*2)/2;
        return {...p, pottedDate:fmt(now), originalPot:false, currentPotSize:newCurrent, nextPotSize:newNext};
      }));
      if (prev) pushUndo && pushUndo("repot", id, {
        pottedDate: prev.pottedDate, originalPot: prev.originalPot,
        currentPotSize: prev.currentPotSize, nextPotSize: prev.nextPotSize,
      });
      setLeaving(l=>{const n={...l};delete n[id];return n;});
    },440);
  }

  function repotDueDate(p) {
    const dd = (p.potYears*365)+(p.potMonths*30);
    if (!dd || dd<=0) return null;
    const potted = new Date(String(p.pottedDate).slice(0,10) + "T12:00:00");
    return new Date(potted.getTime() + dd*864e5);
  }

  function renderPlantGroup(plant) {
    return (
      <PlantCard key={plant.id} plant={plant} rooms={rooms} mode="repot" showCardPhotos={showCardPhotos}
        leaving={!!leaving[plant.id]}
        onClick={()=>{setSheetSwap(false);setDetailPlant(plant);}}
        onCheck={()=>repot(plant.id)}
      />
    );
  }

  // Plants due in the current month + next 3 months (not yet due), grouped by month then room
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const upNext = [];
  for (let m = 0; m <= 3; m++) {
    const target = new Date(now.getFullYear(), now.getMonth()+m, 1);
    const group = plants.filter(p => {
      if (isPotDue(p,now)) return false; // already due — shown above
      const dueDate = repotDueDate(p);
      if (!dueDate) return false;
      return dueDate.getFullYear()===target.getFullYear() && dueDate.getMonth()===target.getMonth();
    });
    if (group.length) upNext.push({ monthIndex: target.getMonth(), year: target.getFullYear(), plants: group });
  }

  function renderUpNextGroup({ monthIndex, year, plants: gPlants }) {
    const flatPlants = [...gPlants].sort((a,b) => a.name.localeCompare(b.name)).map(renderPlantGroup);
    return (
      <div key={monthIndex+"-"+year} style={{marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          <div className="upnext-lbl" style={{fontSize:13,fontWeight:700,color:"var(--leaf)",textTransform:"uppercase",letterSpacing:.5}}>
            {MONTHS[monthIndex]}
          </div>
          <div style={{flex:1,height:1,background:"var(--text-muted)"}}/>
          <div style={{fontSize:13,fontWeight:700,color:"var(--text-muted)"}}>{gPlants.length} plant{gPlants.length!==1?"s":""}</div>
        </div>
        {flatPlants}
      </div>
    );
  }

  return(
    <>
      <div className="page-header brown">
        <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:8}}>
          <div style={{minWidth:0}}>
            <h1>Repot</h1>
            <p>{pendingDue===0?"All plants repotted 🎉":`${pendingDue} plant${pendingDue!==1?"s":""} ready for a new home`}</p>
          </div>
          {canUndo && (
            <button className="header-undo-btn" onClick={onUndo}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M4 9h10a6 6 0 1 1 0 12h-3"/></svg>
              Undo
            </button>
          )}
        </div>
      </div>
      <div className="section" style={{paddingTop:10}}>
        {/* Due list / empty state — min-height matches the empty-state block
            so Up Next doesn't shift when the last plant is repotted. */}
        <div style={{minHeight:DUE_SECTION_MIN_H}}>
          {due.length===0&&(
            <div className={doneEntering?"all-done":undefined} style={{textAlign:"center",padding:"28px 20px 20px",color:"var(--text-muted)"}}>
              <div style={{fontSize:44,marginBottom:8}}>🪴</div>
              <div style={{fontSize:20,fontWeight:700,color:"var(--leaf)",marginBottom:6}}>All done!</div>
              <div style={{fontSize:14}}>No plants are due for repotting right now.</div>
            </div>
          )}
          {due.map(renderPlantGroup)}
        </div>

        {/* Up Next — always shown */}
        {upNext.length>0&&(
          <div style={{marginTop:50}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <h2 style={{fontSize:19,fontWeight:800,color:"var(--text)",margin:0}}>Up Next</h2>
              <div style={{fontSize:11,color:"var(--text-muted)"}}>next 3 months</div>
            </div>
            {upNext.map(g=>renderUpNextGroup(g))}
          </div>
        )}
      </div>
      {ghost && ghost.kind==="detail" && (
        <PlantDetail ghost plant={ghost.plant} rooms={rooms} plants={plants} setPlants={setPlants} user={user}
          onClose={()=>{}} onEdit={()=>{}} />
      )}
      {showModal && <PlantModal enter={sheetSwap?"swap":"slide"} plant={editPlant} rooms={rooms}
        onSave={p=>{ if(editPlant) setPlants(ps=>ps.map(x=>x.id===p.id?p:x)); else setPlants(ps=>[...ps,{...p,id:uid()}]); setShowModal(false); setEditPlant(null); }}
        onDelete={editPlant?(dest)=>{ movePlantTo(setPlants, editPlant.id, dest); setShowModal(false); setEditPlant(null); }:null}
        onClose={()=>{ setShowModal(false); setEditPlant(null); }}
        onClone={()=>setEditPlant(null)}
      />}
      {detailPlant && (()=>{ const dp=plants.find(p=>p.id===detailPlant.id)||detailPlant; return (
        <PlantDetail enter={sheetSwap?"swap":"slide"} plant={dp} rooms={rooms} plants={plants} setPlants={setPlants} user={user}
          onClose={()=>setDetailPlant(null)}
          onEdit={()=>{ beginSwap("detail", dp); setEditPlant(dp); setDetailPlant(null); setShowModal(true); }}
        />
      );})()}
    </>
  );
}


// ─── Utilities Screen ─────────────────────────────────────────────────────────
// ─── Graveyard / Recently Deleted ─────────────────────────────────────────────
function GraveyardScreen({ rooms, plants, setPlants, showCardPhotos, user, onBack }) {
  const [detailPlant, setDetailPlant] = useState(null);
  const [collapsedRooms, setCollapsedRooms] = useState({});
  const buried = (plants || []).filter(p => p.status === "graveyard");
  const sortedRooms = [...rooms].sort((a,b)=>(a.order??0)-(b.order??0));

  return (
    <>
      <div className="page-header slate">
        <button className="sublist-back" onClick={onBack}>‹ Utilities</button>
        <h1>Graveyard</h1>
        <p>Here lies your dearly departed. Rest in peace 😢.</p>
      </div>
      <div className="section" style={{paddingTop:12}}>
        {buried.length===0 && (
          <div className="empty"><span className="ico">🪦</span><p>No plants here for now. Enjoy it while it lasts.</p></div>
        )}
        {sortedRooms.map(room => {
          const rp = buried.filter(p => p.roomId === room.id)
                           .sort((a,b)=>a.name.localeCompare(b.name));
          if (!rp.length) return null;
          const isCollapsed = !!collapsedRooms[room.id];
          return (
            <div key={room.id} className="room-group" style={{marginBottom:8}}>
              <RoomHeader room={room} count={rp.length}
                collapsed={isCollapsed}
                onToggle={()=>setCollapsedRooms(prev=>({...prev,[room.id]:!prev[room.id]}))}
              />
              {!isCollapsed && rp.map(p => (
                <PlantCard key={p.id} plant={p} rooms={rooms} mode="graveyard"
                  showCardPhotos={showCardPhotos} onClick={()=>setDetailPlant(p)}/>
              ))}
            </div>
          );
        })}
      </div>
      {detailPlant && (()=>{ const dp = plants.find(p=>p.id===detailPlant.id) || detailPlant; return (
        <PlantDetail plant={dp} rooms={rooms} plants={plants} setPlants={setPlants} user={user}
          variant="graveyard"
          onClose={()=>setDetailPlant(null)}
          onRestore={(dest)=>{ restorePlant(setPlants, dp, dest); setDetailPlant(null); }}
          onSendToDeleted={()=>{ movePlantTo(setPlants, dp.id, "deleted"); setDetailPlant(null); }}
        />
      );})()}
    </>
  );
}

function RecentlyDeletedScreen({ rooms, plants, setPlants, showCardPhotos, user, onBack }) {
  const [detailPlant, setDetailPlant] = useState(null);
  // Soonest to be purged first
  const trashed = (plants || []).filter(p => p.status === "deleted")
    .sort((a,b) => String(a.deletedDate||"").localeCompare(String(b.deletedDate||"")) || a.name.localeCompare(b.name));

  return (
    <>
      <div className="page-header slate">
        <button className="sublist-back" onClick={onBack}>‹ Utilities</button>
        <h1>Recently Deleted</h1>
        <p>Permanently deleted after {PURGE_DAYS} days</p>
      </div>
      <div className="section" style={{paddingTop:12}}>
        {trashed.length===0 && (
          <div className="empty"><span className="ico">🗑</span><p>Nothing here.</p></div>
        )}
        {trashed.map(p => (
          <PlantCard key={p.id} plant={p} rooms={rooms} mode="deleted"
            showCardPhotos={showCardPhotos} onClick={()=>setDetailPlant(p)}/>
        ))}
      </div>
      {detailPlant && (()=>{ const dp = plants.find(p=>p.id===detailPlant.id) || detailPlant; return (
        <PlantDetail plant={dp} rooms={rooms} plants={plants} setPlants={setPlants} user={user}
          variant="deleted"
          onClose={()=>setDetailPlant(null)}
          onRestore={(dest)=>{ restorePlant(setPlants, dp, dest); setDetailPlant(null); }}
        />
      );})()}
    </>
  );
}

function NotificationsScreen({ onBack,
  waterEnabled, setWaterEnabled, waterTime, setWaterTime,
  repotEnabled, setRepotEnabled, repotTime, setRepotTime,
}) {
  const rows = [
    { key:"water", label:"Water", enabled:waterEnabled, setEnabled:setWaterEnabled, time:waterTime, setTime:setWaterTime,
      labelClass:"section-hdr-water", bg:"var(--watering-bg,#1b4d3e18)", border:"var(--watering-border,#1b4d3e30)" },
    { key:"repot", label:"Repot", enabled:repotEnabled, setEnabled:setRepotEnabled, time:repotTime, setTime:setRepotTime,
      labelClass:"section-hdr-pot", bg:"var(--potting-bg,#6b422618)", border:"var(--potting-border,#6b422630)" },
  ];
  return (
    <>
      <div className="page-header slate">
        <button className="sublist-back" onClick={onBack}>‹ Utilities</button>
        <h1>Notifications</h1>
      </div>
      <div className="section" style={{paddingTop:14}}>
        <div style={{fontSize:12,color:"var(--text-muted)",lineHeight:1.5,marginBottom:16,background:"var(--page-bg)",borderRadius:8,padding:"10px 12px"}}>
          Get notified when your plants are ready for water and a new pot.
        </div>
        {rows.map(r => (
          <div key={r.key} className="util-section" style={{marginBottom:12,background:r.bg,border:`1.5px solid ${r.border}`}}>
            <div className="util-row" style={{background:"none"}}>
              <div>
                <div className={`util-label ${r.labelClass}`}>{r.label}</div>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={r.enabled} onChange={e=>r.setEnabled(e.target.checked)}/>
                <div className="toggle-track">
                  <div className="toggle-thumb"/>
                </div>
              </label>
            </div>
            {r.enabled && (
              <div className="util-row" style={{background:"none"}}>
                <div className={`util-label ${r.labelClass}`} style={{fontWeight:600}}>Time</div>
                <input type="time" className="notif-time-input" value={r.time} onChange={e=>r.setTime(e.target.value)}
                  style={{padding:"7px 10px",borderRadius:7,border:"1.5px solid var(--border)",background:"var(--input-bg)",color:"var(--text)",fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:600}}/>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function UtilitiesScreen({ darkMode, setDarkMode, showCardPhotos, setShowCardPhotos, onOpenExport, onImport, onOpenSchedule, user, onSignOut, onDeleteAccount, rooms, plants, setPlants, sub, setSub,
  notifWaterEnabled, setNotifWaterEnabled, notifWaterTime, setNotifWaterTime,
  notifRepotEnabled, setNotifRepotEnabled, notifRepotTime, setNotifRepotTime,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const graveCount = plants ? plants.filter(p=>p.status==="graveyard").length : 0;
  const trashCount = plants ? plants.filter(p=>p.status==="deleted").length : 0;

  if (sub === "graveyard")
    return <GraveyardScreen rooms={rooms} plants={plants} setPlants={setPlants}
             showCardPhotos={showCardPhotos} user={user} onBack={()=>setSub(null)}/>;
  if (sub === "deleted")
    return <RecentlyDeletedScreen rooms={rooms} plants={plants} setPlants={setPlants}
             showCardPhotos={showCardPhotos} user={user} onBack={()=>setSub(null)}/>;
  if (sub === "notifications")
    return <NotificationsScreen onBack={()=>setSub(null)}
             waterEnabled={notifWaterEnabled} setWaterEnabled={setNotifWaterEnabled}
             waterTime={notifWaterTime} setWaterTime={setNotifWaterTime}
             repotEnabled={notifRepotEnabled} setRepotEnabled={setNotifRepotEnabled}
             repotTime={notifRepotTime} setRepotTime={setNotifRepotTime}/>;

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
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={showCardPhotos} onChange={e=>setShowCardPhotos(e.target.checked)}/>
              <div className="toggle-track">
                <div className="toggle-thumb"/>
              </div>
            </label>
          </div>
        </div>
        <div style={{fontSize:12,fontWeight:700,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:".7px",marginBottom:6,paddingLeft:2,marginTop:16}}>Plants</div>
        <div className="util-section">
          <div className="util-row tappable" onClick={()=>setSub("graveyard")}>
            <div>
              <div className="util-label">Graveyard</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:13,fontWeight:700,color:"var(--text-muted)",lineHeight:1}}>{graveCount}</span>
              <span className="util-chevron"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg></span>
            </div>
          </div>
          <div className="util-row tappable" onClick={()=>setSub("deleted")}>
            <div>
              <div className="util-label">Recently Deleted</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:13,fontWeight:700,color:"var(--text-muted)",lineHeight:1}}>{trashCount}</span>
              <span className="util-chevron"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg></span>
            </div>
          </div>
          <div className="util-row">
            <div>
              <div className="util-label">OOT Water Schedule</div>
              <div className="util-sublabel">A plant caretaker watering guide while you're traveling</div>
            </div>
            <button className="util-btn secondary" onClick={onOpenSchedule}>Create</button>
          </div>
        </div>
        <div style={{fontSize:12,fontWeight:700,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:".7px",marginBottom:6,paddingLeft:2,marginTop:16}}>Data</div>
        <div className="util-section">
          <div className="util-row">
            <div>
              <div className="util-label">Export Plants</div>
              <div className="util-sublabel">Export your plants as a spreadsheet or a full backup</div>
            </div>
            <button className="util-btn secondary" onClick={onOpenExport}>Export</button>
          </div>
          <div className="util-row">
            <div>
              <div className="util-label">Import Plants</div>
              <div className="util-sublabel">Add or update plants in bulk, or restore a backup</div>
            </div>
            <button className="util-btn secondary" onClick={onImport}>Import</button>
          </div>
        </div>

        {user && <>
          <div style={{fontSize:12,fontWeight:700,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:".7px",marginBottom:6,paddingLeft:2,marginTop:16}}>Account</div>
          <div className="util-section">
            <div className="util-row tappable" onClick={()=>setSub("notifications")}>
              <div>
                <div className="util-label">Notifications</div>
              </div>
              <span className="util-chevron"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg></span>
            </div>
            <div className="util-row">
              <div>
                <div className="util-label">Feedback</div>
              </div>
              <a className="util-btn secondary" style={{textDecoration:"none",display:"inline-flex",alignItems:"center",justifyContent:"center"}}
                href="mailto:matt@plantalog.com?subject=Plantalog%20Feedback">Send</a>
            </div>
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

// Mount
const __root = document.getElementById('root');
if (__root) ReactDOM.createRoot(__root).render(React.createElement(App));
