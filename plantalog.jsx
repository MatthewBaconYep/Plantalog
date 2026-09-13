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

// Undated photos come first, keeping their existing relative order, then
// dated ones oldest -> newest, so a plant's growth reads left to right. Most
// undated photos predate date recording, so a fresh auto-dated photo belongs
// at the end, not ahead of them. Sorting the stored arrays rather than just
// the display keeps primaryPhoto indexes valid everywhere.
function sortPhotosByDate(photos, photoDates, primaryPhoto) {
  if (!photos || !photos.length) return { photos: [], photoDates: [], primaryPhoto: null };
  const dates = Array.isArray(photoDates) ? photoDates : [];
  const primary = primaryPhoto == null ? 0 : primaryPhoto;
  const order = photos.map((_, i) => i);
  order.sort((a, b) => {
    const da = dates[a] || null, db = dates[b] || null;
    if (da && db) return da < db ? -1 : da > db ? 1 : a - b;  // ties keep original order
    if (da) return 1;
    if (db) return -1;
    return a - b;
  });
  const newPrimary = order.indexOf(primary);
  return {
    photos:       order.map(i => photos[i]),
    photoDates:   order.map(i => dates[i] || null),
    primaryPhoto: newPrimary < 0 ? null : newPrimary,
  };
}

// Applied on load so plants saved under an earlier sort order show in the
// current one. The card thumbnail stays the same photo, since primaryPhoto
// follows it to its new index.
function withSortedPhotos(plant) {
  if (!plant || !plant.photos || !plant.photos.length) return plant;
  return { ...plant, ...sortPhotosByDate(plant.photos, plant.photoDates, plant.primaryPhoto) };
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
    "lastWatered": "2026-07-19",
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
    "lastWatered": "2026-08-04",
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
    "lastWatered": "2026-08-11",
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
    "lastWatered": "2026-08-10",
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
    "lastWatered": "2026-08-09",
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
    "lastWatered": "2026-07-08",
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
    "lastWatered": "2026-08-08",
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
    "lastWatered": "2026-08-07",
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
    "lastWatered": "2026-08-06",
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
    "lastWatered": "2026-07-23",
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
    "lastWatered": "2026-08-10",
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
    "lastWatered": "2026-08-08",
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
    "lastWatered": "2026-08-11",
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
    "lastWatered": "2026-07-29",
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
    "lastWatered": "2026-08-10",
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
    "lastWatered": "2026-08-09",
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
    "lastWatered": "2026-08-05",
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
    "lastWatered": "2026-08-08",
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
    "lastWatered": "2026-08-07",
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
    "lastWatered": "2026-08-07",
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
    "lastWatered": "2026-07-21",
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
    "lastWatered": "2026-08-10",
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
// §6 rule 1: names cap at 60 characters; the counter only appears from 45.
const NAME_MAX = 60;
const NAME_COUNTER_AT = 45;

const HEALTH = {
  // `deep`/`deepInk` are the selected pair (§3.5). `deep` is always the
  // band ink, never the bar colour.
  1: { label:"Dying",    color:"#e0483a", bg:"#ffd7d2", text:"#97281d", deep:"#97281d", deepInk:"#fdeceb" },
  2: { label:"Caution",  color:"#f2a13b", bg:"#ffe6c0", text:"#8a4c06", deep:"#8a4c06", deepInk:"#fff8f2" },
  3: { label:"Good",     color:"#7cc63f", bg:"#e4f7c8", text:"#3f6b16", deep:"#3f6b16", deepInk:"#f6faee" },
  4: { label:"Thriving", color:"#0f9d58", bg:"#c8f2d9", text:"#0a5c34", deep:"#0a7a43", deepInk:"#f2fbf5" },
};
// Dark-mode tints and inks for the same four bands (§2).
const HEALTH_DARK = {
  1: { bg:"#5e211a", text:"#ff9d92" },
  2: { bg:"#5a3a08", text:"#ffc879" },
  3: { bg:"#334a15", text:"#c3ee85" },
  4: { bg:"#0f4a30", text:"#86ecad" },
};
// Health tints are applied inline from this map, so a CSS override can't
// reach them; this resolves the right band for the active theme instead.
function useIsDark() {
  const read = () => typeof document !== "undefined" &&
    !!document.querySelector(".app.dark");
  const [dark, setDark] = useState(read);
  useLayoutEffect(() => {
    setDark(read());
    if (typeof MutationObserver === "undefined") return;
    const root = document.getElementById("root");
    if (!root) return;
    const ob = new MutationObserver(() => setDark(read()));
    ob.observe(root, { attributes:true, subtree:true, attributeFilter:["class"] });
    return () => ob.disconnect();
  }, []);
  return dark;
}

function healthTint(band, dark) {
  const base = HEALTH[band];
  return dark ? { ...base, ...HEALTH_DARK[band] } : base;
}

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
// §11.2: the guide is set in the app's own faces. Each file is fetched once
// and cached; any failure leaves FONTS null and the generator falls back to
// Helvetica, because a font must never be the reason a guide won't print.
const PDF_FONT_URLS = {
  caprasimo: "https://cdn.jsdelivr.net/fontsource/fonts/caprasimo@latest/latin-400-normal.ttf",
  figtreeNormal: "https://cdn.jsdelivr.net/fontsource/fonts/figtree@latest/latin-400-normal.ttf",
  figtreeBold: "https://cdn.jsdelivr.net/fontsource/fonts/figtree@latest/latin-700-normal.ttf",
};
let pdfFontCache;
async function loadPdfFonts() {
  if (pdfFontCache !== undefined) return pdfFontCache;
  try {
    const keys = Object.keys(PDF_FONT_URLS);
    const bufs = await Promise.all(keys.map(async k => {
      const res = await fetch(PDF_FONT_URLS[k]);
      if (!res.ok) throw new Error("font " + k);
      const buf = new Uint8Array(await res.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
      return btoa(bin);
    }));
    pdfFontCache = {}; keys.forEach((k, i) => { pdfFontCache[k] = bufs[i]; });
  } catch (e) {
    pdfFontCache = null;   // Helvetica it is
  }
  return pdfFontCache;
}

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
  const fonts = await loadPdfFonts();
  let DISPLAY = "helvetica", UI = "helvetica";
  if (fonts) {
    try {
      doc.addFileToVFS("Caprasimo.ttf", fonts.caprasimo);
      doc.addFont("Caprasimo.ttf", "caprasimo", "normal");
      doc.addFileToVFS("Figtree.ttf", fonts.figtreeNormal);
      doc.addFont("Figtree.ttf", "figtree", "normal");
      doc.addFileToVFS("Figtree-Bold.ttf", fonts.figtreeBold);
      doc.addFont("Figtree-Bold.ttf", "figtree", "bold");
      DISPLAY = "caprasimo"; UI = "figtree";
    } catch (e) { DISPLAY = "helvetica"; UI = "helvetica"; }
  }
  // Caprasimo has one weight; asking for bold would synthesise one.
  const display = size => { doc.setFont(DISPLAY, "normal"); doc.setFontSize(size); };
  const ui = (size, weight) => { doc.setFont(UI, weight === "bold" ? "bold" : "normal"); doc.setFontSize(size); };
  const M = 40;                                   // 12a: 40pt side margin
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const CONTENT_W = PAGE_W - M * 2;
  const BOTTOM = PAGE_H - M;
  // Concept markup is a 612x792 mock at 1px=1pt, so its literal pixel values
  // are used directly as point sizes/colours below (final design, per 12a-c).
  const LEAF = [45,106,79], INK = [36,29,24], MUTED = [122,96,85];
  const LINE = [230,219,199], LINE_LT = [239,230,212], CHECK_LN = [168,157,139];

  const COLS = 3, GAP = 19;
  const TILE_W = (CONTENT_W - GAP * (COLS - 1)) / COLS;      // ~158pt at 0.5in margins
  const IMG_W = TILE_W, IMG_H = 100;
  const NAME_H = 15, FREQ_H = 12, CHK_H = 15;
  const TILE_H = NAME_H + FREQ_H + CHK_H;                     // text sits under the photo
  const ROW_H = IMG_H + TILE_H + 14;                          // one tile row incl. photo
  const ROOM_H = 23, DATE_H = 19;

  function rgb(hex) {
    const h = String(hex || "").replace("#","");
    if (h.length !== 6) return [92,64,51];
    return [0,2,4].map(i => parseInt(h.slice(i,i+2),16));
  }
  function need(h) {
    if (y + h <= BOTTOM) return false;
    doc.addPage();
    y = M;
    return true;
  }
  // A 13x13 rounded square with its label to the right (12a-c).
  function checkbox(x, cy, label) {
    const s = 13;
    doc.setDrawColor(...CHECK_LN); doc.setLineWidth(1.6);
    doc.roundedRect(x, cy - s + 3, s, s, 6, 6, "S");
    ui(9,"bold"); doc.setTextColor(...MUTED);
    doc.text(label, x + s + 5, cy);
  }
  function roomBar(room, contDay) {
    const light = roomTextColor(room.color || "#5c4033") === "#ffffff";
    doc.setFillColor(...rgb(room.color));
    doc.roundedRect(M, y, CONTENT_W, ROOM_H, 12, 12, "F");
    doc.setTextColor(...(light ? [255,253,248] : [30,20,16]));
    ui(11.5,"bold");
    doc.text(room.name, M + 11, y + 15);
    if (contDay) {
      ui(9.5,"bold");
      doc.setTextColor(...(light ? [255,253,248] : [30,20,16]));
      doc.text(`${contDay} continues`, M + CONTENT_W - 11, y + 14.5, { align:"right" });
    }
    y += ROOM_H + 9;
  }

  let y = M;

  // ── Title block (12a: no summary stat, no intro paragraph) ──
  display(32); doc.setTextColor(...LEAF);
  doc.text("OOT Water Schedule", M, y + 24);
  y += 32;
  ui(13,"bold"); doc.setTextColor(...MUTED);
  doc.text(`${shortDate(from)} to ${shortDate(to)}  ·  ${rangeLengthDays(from,to)} days`, M, y + 7);
  y += 14;
  doc.setFillColor(...LINE);
  doc.roundedRect(M, y, CONTENT_W, 2, 1, 1, "F");
  y += 18;

  if (!schedule.length) {
    ui(11,"normal"); doc.setTextColor(...MUTED);
    doc.text("No plants need water in this date range.", M, y + 10);
    return doc;
  }

  schedule.forEach(day => {
    need(DATE_H + ROOM_H + ROW_H);
    display(19); doc.setTextColor(...INK);
    doc.text(prettyLongDate(day.date), M, y + 10);
    const count = day.rooms.reduce((n,g) => n + g.plants.length, 0);
    ui(10,"bold"); doc.setTextColor(...MUTED);
    doc.text(`${count} plant${count===1?"":"s"}`, M + CONTENT_W, y + 10, { align:"right" });
    y += 14;
    doc.setDrawColor(...LINE_LT); doc.setLineWidth(1);
    doc.line(M, y, M + CONTENT_W, y);
    y += 12;

    const dayLabel = prettyLongDate(day.date).split(",")[0];

    day.rooms.forEach(group => {
      need(ROOM_H + ROW_H);
      roomBar(group.room, null);

      for (let i = 0; i < group.plants.length; i += COLS) {
        const rowPlants = group.plants.slice(i, i + COLS);
        const willBreak = y + ROW_H > BOTTOM;
        if (willBreak) {
          // A room's plants split across a page: note it on the page being
          // left, then repeat the room bar with a "cont." marker on the new
          // one, so a reader never loses track of which room they're in (12b/12c).
          doc.setDrawColor(...LINE_LT); doc.setLineWidth(1);
          doc.line(M, y, M + CONTENT_W, y - 4 > M ? y : y);
          ui(9.5,"bold"); doc.setTextColor(...MUTED);
          doc.text(`${dayLabel.toUpperCase()} CONTINUES`, M + CONTENT_W, y - 4, { align:"right" });
          doc.line(M, y - 4, M + CONTENT_W - 118, y - 4);
          doc.addPage(); y = M;
          roomBar(group.room, dayLabel);
        }
        const rowTop = y;

        rowPlants.forEach((p, col) => {
          const x = M + col * (TILE_W + GAP);
          const imgTop = rowTop;
          const src = photos[getPrimaryPhoto(p)];
          let drew = false;
          if (src) {
            try {
              doc.saveGraphicsState();
              doc.roundedRect(x, imgTop, IMG_W, IMG_H, 12, 12, null);
              doc.clip(); doc.discardPath();
              doc.addImage(src, dataUrlImageFormat(src), x, imgTop, IMG_W, IMG_H);
              doc.restoreGraphicsState();
              drew = true;
            } catch (e) {
              try { doc.restoreGraphicsState(); } catch (e2) {}
              drew = false;
            }
          }
          if (!drew) {
            doc.setDrawColor(...LINE); doc.setLineWidth(0.8);
            doc.roundedRect(x, imgTop, IMG_W, IMG_H, 12, 12, "S");
          }

          const textTop = imgTop + IMG_H;
          ui(12,"bold"); doc.setTextColor(...INK);
          const lines = doc.splitTextToSize(String(p.name || ""), TILE_W).slice(0, 1);
          doc.text(lines[0] || "", x, textTop + 10);

          ui(10,"bold"); doc.setTextColor(...MUTED);
          doc.text(`every ${p.waterFreqDays}d`, x, textTop + 22);

          checkbox(x, textTop + 36, "Watered");
          checkbox(x + TILE_W/2 + 4, textTop + 36, "Not ready");
        });

        y = rowTop + ROW_H;
      }
    });
    y += 26;
  });

  // Footer page numbers
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    ui(9.5,"bold"); doc.setTextColor(...MUTED);
    doc.text(`Plantalog  ·  ${shortDate(from)} – ${shortDate(to)}`, M, PAGE_H - 26);
    doc.text(`Page ${i} of ${pages}`, M + CONTENT_W, PAGE_H - 26, { align:"right" });
  }
  return doc;
}

// Copy for the push notification payload. Intentionally retained while push
// delivery is unbuilt — this is reviewed wording, not dead code.
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
function formatDateUS(s) { if(!s)return""; const d=new Date(s+"T00:00:00"); return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`; }
function uid()           { return Math.random().toString(36).slice(2,10); }
// Display a YYYY-MM-DD string as M/D/YY (no leading zeros)
// Parse M/D/YY or M/D/YYYY back to YYYY-MM-DD
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

// Selected state for the Edit sheet's room chips and health tiles: the
// button keeps its own fill and gets a ring, separated from it by a sliver
// of card colour, in a shade of the button's own colour - darker in light
// mode, lighter in dark. The very first version used the colour itself,
// which vanished against the chip it belonged to.
function selectRing(color, dark) {
  const shade = dark ? `color-mix(in oklab, ${color} 45%, #fff)`
                     : `color-mix(in oklab, ${color} 55%, #000)`;
  return `0 0 0 2px var(--surface), 0 0 0 4px ${shade}`;
}

// Returns white or dark text depending on background luminance
// Room card icons (reorder grip, edit pencil) are one soft black on every room
// colour. The count takes the name's colour (roomTextColor) instead.
const ROOM_ICON_INK = "rgba(0,0,0,.45)";

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
  if (color) {
    const textColor = roomTextColor(color);
    return (
      <div className="room-header colored" style={{background:color,color:textColor,...(onToggle?{cursor:"pointer"}:{}),...(style||{})}} onClick={onToggle}>
        <h3>{room.name}</h3>
        <span className="room-count" style={{marginLeft:"auto"}}>{count}</span>
      </div>
    );
  }
  return (
    <div className="room-header" style={{...(onToggle?{cursor:"pointer"}:{}),...(style||{})}} onClick={onToggle}>
      <h3>{room.name}</h3>
      <span className="room-count">{count}</span>
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;500;600;700;800;900&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  html{-webkit-text-size-adjust:100%;text-size-adjust:100%;}
  /* ── Design tokens (redesign spec §2, §3) ───────────────────────────────
     The existing variable names are kept and remapped to the new palette
     rather than renamed, so every existing rule picks up the new colours
     without a file-wide find/replace. New names are added alongside. */
  :root{
    /* App column width and whole-UI scale. Both change only in the laptop
       block below; everything sized in viewport units divides by --zoom
       because zoom multiplies those too (a 100dvh box measured 960px in an
       800px WebKit window at zoom 1.2). */
    --col:480px;
    --zoom:1;
    /* Core surfaces */
    --ground:#f5ead8; --surface:#fffdf8;
    --text:#201e1d;   --text-muted:#6f6658;
    --border:#e6dbc7; --border-strong:#c9bda6;
    --primary:#0f4438; --primary-ink:#f2f0d8;
    --accent:#a3450a;  --sand:#efe4cd;

    /* Legacy aliases, remapped to the new palette */
    --cream:#f5ead8; --page-bg:#f5ead8; --card-bg:#fffdf8; --input-bg:#fffdf8;
    --leaf:#0f4438;  --leaf-light:#15644a; --leaf-pale:#e6f2f8;
    --bark:#6f6658;  --bark-light:#8a7f6d; --soil:#201e1d;
    --teal:#17627f;  --brown:#a3450a;

    /* Domain colour (§2) */
    --water:#17627f;      --water-tint:#e6f2f8;  --water-ink:#12556e;
    --potting:#fbe6d6;    --potting-ink:#5c2a08; --potting-head:#8c3f07;
    /* --potting is nearly --page-bg in light mode (#fbe6d6 on #f5ead8), so a
       panel filled with it reads as no panel at all. Deeper peach for the pot
       panels in View, Edit and Notifications; chips and pills keep --potting. */
    --potting-panel:#f7d9c2;
    --danger:#a32e22;     --danger-tint:#fbe0dc;
    --warn:#8a4c06;       --warn-tint:#ffe6c0;

    /* Radius scale (§3) — five steps plus the pill. No other values. */
    --r-xs:6px; --r-sm:12px; --r-md:16px; --r-lg:22px; --r-xl:30px; --r-pill:999px;
    --radius:16px;   /* legacy alias -> md */

    /* Elevation (§3), light only */
    /* Verbatim from _ds/organic-.../styles.css lines 61-63. */
    --shadow-sm:0 1px 2px rgba(46,43,37,.14);
    --shadow:0 1px 2px rgba(46,43,37,.14);
    --shadow-md:0 3px 10px rgba(46,43,37,.16);
    --shadow-lg:0 12px 32px rgba(46,43,37,.22);

    /* Motion curves (§4) — four, and nothing outside them */
    --ease-enter:cubic-bezier(.16,.84,.44,1);
    --ease-exit:cubic-bezier(.4,0,1,1);
    --ease-collapse:cubic-bezier(.22,.61,.36,1);
    --ease-arrive:cubic-bezier(.34,1.28,.64,1);

    /* Type (§1) */
    --water-header-ink:#eaf6fc; --accent-header-ink:#fff8f2;
    --graveyard:#56633f; --graveyard-ink:#f6faee; --graveyard-sub:#d5dfc0;
    --charcoal:#474238; --charcoal-ink:#f0e9dc; --charcoal-sub:#c2b9a8;
    --btn-ink:#474238; --btn-border:#c9bda6; --btn-bg:#fffdf8;
    --font-display:'Caprasimo',Georgia,serif;
    --font-ui:'Figtree',-apple-system,BlinkMacSystemFont,sans-serif;
  }
  .dark{
    --ground:#1f1d1a; --surface:#2b2823;
    --text:#f0e9dc;   --text-muted:#a99e8c;
    --border:#3a352d; --border-strong:#544e43;
    --primary:#15644a;

    /* --card-bg was only ~12 points off --page-bg, so cards barely separated
       from the page in dark. Lifted. */
    --cream:#1f1d1a; --page-bg:#1f1d1a; --card-bg:#35302a; --input-bg:#3b362f;
    --leaf:#15644a;  --leaf-light:#1c7a5c; --leaf-pale:#143543;
    --sand:#3c3830;  --bark:#a99e8c; --bark-light:#8a8071;

    --water:#134b64;      --water-tint:#173f52;  --water-ink:#a5cfe3;
    --water-solid:#5aa8cc; --water-solid-ink:#04212e;
    --potting:#5c2e10;    --potting-ink:#fbdcc4; --potting-head:#f7c9a3;
    --potting-panel:#5c2e10;
    --danger:#ffb3a8;     --danger-tint:#4a1f1a;

    /* Dark mode separates with surface colour, not shadow (§7) */
    --shadow-sm:none; --shadow:none; --shadow-md:none; --shadow-lg:none;
  }
  .dark .plant-name{color:var(--text);}
  .dark .room-header h3{color:var(--text-muted);}
  .dark .icon-btn{color:var(--text);opacity:.7;}
  .dark .btn-secondary{background:var(--input-bg);color:var(--text);border:1.5px solid var(--border);}
  .dark body, .dark{background:#1f1d1a;}
  /* The tab bar is transparent in light and should be in dark too. It was
     pinned to --card-bg, which used to be close enough to the page to pass
     unnoticed; lifting --card-bg turned it into a visible lighter strip. */

  .dark .dash-card .lbl{color:var(--text);}
  .dark .tab-btn{color:var(--text);}
  .dark .good-health-lbl{color:var(--text)!important;}
  .dark .good-health-pct{color:var(--leaf-light)!important;}
  .dark .section-hdr-photos{color:var(--text)!important;}
  .dark{--pot-due-bg:#3b1212;--pot-due-border:#7f1d1d;--pot-due-text:#fca5a5;--charcoal:#33302a;--charcoal-sub:#a99e8c;
    --btn-ink:#e8dfcd; --btn-border:#5a5346; --btn-bg:transparent;
    /* 20.4: dark's affirmative action is a bright fill with dark ink. Kept
       separate from --primary, which is also the nav, headers and auth
       ground and stays the deep green. */
    --primary-btn:#3f9d6d; --primary-btn-ink:#04210f;}
  .app{}
  html{background:#1a1a1a;}
  /* 17.1: Organic sets body{line-height:1.55} and every comp inherits it.
     Without this the app computes normal (~1.15) and every block that
     doesn't declare its own line-height renders ~25% short. */
  body{font-family:var(--font-ui);font-weight:600;line-height:1.55;color:var(--text);transition:color .3s;margin:0;padding:0;}
  .app{max-width:var(--col);margin:0 auto;min-height:calc(100vh / var(--zoom));min-height:calc(100dvh / var(--zoom));display:flex;flex-direction:column;background:var(--cream);}

  /* Nav */
  .nav-wrap{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:var(--col);box-sizing:border-box;padding:10px 14px 20px;z-index:100;pointer-events:none;}
  /* Sized to the iOS tab bar rather than 13b, at the user's call (with
     Crumbl's as the reference): 13b's 9px labels, 20px icons and 36px-tall
     columns read as a mockup on a real phone and sat under Apple's 44pt
     target and 11pt text minimums. Now a ~60px pill, 24px icons, 11px
     labels, and a tinted capsule for the selected tab that is also its tap
     area (~86x50). Stroke 2.3 at 24px keeps 13b's 2.75-at-20px weight. */
  .nav{pointer-events:auto;background:var(--primary);display:flex;gap:2px;border-radius:var(--r-pill);padding:5px;box-shadow:var(--shadow-md);}
  .nav-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0 5px;border-radius:var(--r-pill);line-height:1.2;color:rgba(242,240,216,.78);cursor:pointer;border:none;background:none;font-family:var(--font-ui);font-size:11px;letter-spacing:normal;font-weight:700;transition:color .2s, background-color .2s;position:relative;-webkit-tap-highlight-color:transparent;}
  @keyframes tabPick{0%{transform:none;}45%{transform:translateY(-3px) scale(1.12);}100%{transform:none;}}
  .nav-btn.active svg{animation:tabPick .26s var(--ease-arrive);}
  .nav-btn.active{color:var(--primary-ink);background:rgba(242,240,216,.14);}
  .nav-btn svg{width:28px;height:28px;}
  /* Icon-only (no labels): the icon fills the capsule, about the same bar
     height as with labels, and each tab stays a ~86x48 tap target. */
  .nav-btn{padding:10px 0;gap:0;}
  /* Against the icon: top 2px above it (icon starts at the 6px padding),
     left edge 1px clear of its right edge (50% + 12 + 1). */
  .nav-badge{position:absolute;top:4px;left:calc(50% + 12px);background:#e0483a;color:#fffdf8;
    border-radius:999px;height:17px;min-width:17px;padding:0 4px;box-sizing:border-box;
    font-family:var(--font-ui);font-size:10px;font-weight:800;line-height:17px;text-align:center;
    display:flex;align-items:center;justify-content:center;}

  /* Header. 102px in the design, which includes a mock status bar: 12px of
     padding plus a 12px row at the design system's 1.55 line-height, ~31px.
     Below it is a ~71px content area. On a phone that draws under the real
     status bar (59px on an iPhone 15 Pro) the header is that real bar plus
     the same 71px, so every title sits where the design puts it relative to
     the bar. 102 + 59 (161) doubled the bar; 120 put subtitled titles (Water,
     Repot, Utilities) under the bar strip, which clipped them. */
  .page-header{height:max(102px, calc(env(safe-area-inset-top,0px) + 71px));box-sizing:border-box;padding:max(12px, env(safe-area-inset-top,0px)) 18px 15px;color:var(--primary-ink);background:var(--primary);display:flex;flex-direction:column;justify-content:flex-end;}
  .page-header .hdr-lockup{display:flex;align-items:flex-end;gap:12px;height:46px;margin-top:auto;}
  .page-header .hdr-mark{width:30px;height:46px;object-fit:contain;flex-shrink:0;}
  /* Watermark (HdrTitle): a 100px window at the header's lower-right corner
     showing the mark cropped at its right and bottom, the mockup's geometry
     at every header height. On a phone it reaches up behind the status bar,
     which nothing covers. The window clips it, so nothing overflows. */
  .page-header{position:relative;}
  .page-header .hdr-watermark{position:absolute;right:0;bottom:0;height:100px;
    aspect-ratio:.7;overflow:hidden;pointer-events:none;}
  .page-header .hdr-watermark img{position:absolute;right:-8px;bottom:-18px;height:calc(100% + 18px);width:auto;opacity:.16;}
  .header-undo-btn{position:relative;}
  .page-header.green,
  .page-header.slate{background:var(--primary);}
  .page-header.teal{background:var(--water);color:var(--water-header-ink);}
  .page-header.brown{background:var(--accent);color:var(--accent-header-ink);}
  .dark .page-header.brown{background:#5c2e10;}
  .page-header.teal p{color:#c3e3f2;}
  .page-header.brown p{color:#f7d3b5;}

  /* No band across the status bar: the page scrolls under it in full view,
     and iOS picks a legible clock/battery colour for whatever is behind
     them. An opaque band (page ground, and header colour before that) hid
     whatever passed beneath it. */

  /* The column is a fixed 390 at every size, so the phone layout is the
     only layout. These were viewport-keyed and silently stopped applying
     on desktop, which is where the fourth stat column came from. */
  .phone-hide { display: none !important; }
  /* Water cards have room for Home's Every tile beside the add-days button on
     a desktop viewport, but not on a phone, which keeps the inline "every Nd"
     under the name instead. Keyed on the viewport, not the app column, since
     the column is a fixed width at every size. !important because the
     Every tile's own .stat-tile{display:flex} comes later in the sheet and
     was winning, so phones showed the tile and the inline text both. */
  .desktop-only{display:none!important;}
  /* Laptop: the phone design, at the design's own 390px column, scaled up
     so type and targets read at laptop distance. At 480px unscaled every
     row's label and control drifted 72px further apart than 6b. Mouse and
     trackpad only, so phones and touch tablets are untouched. */
  @media (min-width:700px) and (min-height:600px) and (hover:hover) and (pointer:fine){
    :root{--col:390px;--zoom:1.2;}
  }
  /* Phones get their --zoom inline from index.html: screen width / 390, so a
     wider phone shows the 390pt design scaled up rather than stretched. */
  html{zoom:var(--zoom);}
  /* Cancel that zoom on the boot splash (index.html), but only here, once the
     zoom itself exists: applied from first paint it shrank the splash ~1% and
     moved the logo off the launch image's position, then snapped back. */
  #boot-splash{zoom:calc(1 / var(--zoom, 1));}
  /* No rubber-band bounce past the ends of a scroll on desktop, on the page or
     any inner scroller. Phones keep their native overscroll. */
  @media (hover:hover) and (pointer:fine){
    html, body, *{overscroll-behavior:none;}
  }
  @media (min-width:700px){
    .desktop-only{display:flex!important;}
    .desktop-hide{display:none;}
  }
  /* Removed: .nav{padding-bottom:4px} and .nav-btn{padding:5px 0}. Measured
     against 13b, those put the icon 14px below the nav's top edge where the
     design has 9px, and made the pill 57px tall against the design's 52px with
     asymmetric 9/4 padding. The design's columns carry no padding of their own,
     so the pill's own symmetric 9px is what centres them. */

  /* A standalone-only .nav{padding-bottom:max(20px, safe-area)} lived here.
     It padded the pill itself (not its wrapper) and would have pushed the
     tab capsules off-centre; the wrapper's 20px already clears the home
     indicator. */

  /* The line a header used to carry as its subtitle, now just below it so
     every header is title-only and the titles align (Graveyard, Recently
     Deleted). */
  /* Sync flags. On phones the routine ones (Syncing, Saved) are hidden: they
     sat over the status bar's battery for a second after every save. The
     error flag stays, below the status bar. */
  .sync-flag{position:fixed;top:calc(8px + env(safe-area-inset-top,0px));right:12px;font-size:11px;z-index:999;font-family:var(--font-ui);}
  @media (pointer:coarse){ .sync-flag.quiet{display:none;} }
  .page-sub{font-size:13px;font-weight:600;line-height:1.45;color:var(--text-muted);margin:0 4px 12px;}
  .page-header h1{font-family:var(--font-display);font-weight:400;font-size:30px;letter-spacing:0;line-height:1;}
  .page-header .hdr-lockup h1{font-size:33px;}
  .page-header p{font-size:13px;font-weight:600;margin-top:4px;}
  @keyframes barFill{from{width:0;}}
  @keyframes undoIn{from{opacity:0;transform:translateY(3px);}to{opacity:1;transform:none;}}
  /* Solid, not see-through: the header's own colour (--hdr-bg, set per
     render) lifted a shade by the inset tint. Transparent, it sat over the
     watermark and read as a smudge. */
  .header-undo-btn{animation:undoIn .22s var(--ease-enter) .12s backwards;display:flex;align-items:center;gap:6px;background:var(--hdr-bg, transparent);box-shadow:inset 0 0 0 999px rgba(255,255,255,.16);border:1.5px solid color-mix(in oklab, currentColor 50%, transparent);color:inherit;font-family:var(--font-ui);font-size:12px;font-weight:800;padding:6px 14px;border-radius:var(--r-pill);cursor:pointer;flex-shrink:0;transition:background .15s;}
  @media (hover:hover) and (pointer:fine) { .header-undo-btn:hover{box-shadow:inset 0 0 0 999px rgba(255,255,255,.30);} }

  /* Dashboard */
  .dashboard{padding:12px 14px 8px;display:flex;flex-direction:column;gap:10px;}  /* 13a/13b declare gap:10px */
  .dashboard .score-tiles{margin-bottom:0;}
  .dash-card.selected{outline-color:var(--leaf);}
  .dash-card .lbl{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-top:2px;font-weight:600;text-align:center;}
  .dark .dash-card.selected{outline-width:3px;}
  /* Health score explainer, revealed by tapping the tile */
  @keyframes scoreTipIn{from{opacity:0;transform:translate(-50%,5px) scale(.975);}to{opacity:1;transform:translate(-50%,0) scale(1);}}
  /* Thriving's colour (#276749) is a dark forest green meant for a light
     pill background — on the tooltip's dark card-bg it's only ~1.7:1
     contrast, nearly unreadable. Brightened just here, not globally, since
     the original colour still works fine everywhere it's normally used. */

  /* Tab bar */
  .tab-bar{display:flex;align-items:center;gap:7px;padding:4px 14px 7px;}
  .tab-add-btn{flex-shrink:0;width:32px;height:32px;border-radius:var(--r-pill);background:var(--primary);color:var(--primary-ink);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-sm);}
  .tab-btn{border:none;background:transparent;border-radius:var(--r-pill);padding:7px 13px;cursor:pointer;font-family:var(--font-ui);font-size:13px;font-weight:800;color:var(--text-muted);transition:all .18s;}
  .tab-btn.active{background:var(--primary);color:var(--primary-ink);padding:7px 17px;}
  .tab-btn.active.rooms{background:var(--accent);color:#fff;}

  /* Plant list */
  .section{padding:0 14px 112px;}
  .firstrun-card{background:var(--surface);border-radius:var(--r-xl);box-shadow:var(--shadow-sm);padding:32px 26px 30px;text-align:center;width:100%;}
  .firstrun-head{font-family:var(--font-display);font-weight:400;font-size:25px;line-height:1.15;color:var(--text);}
  .firstrun-body{margin:10px 0 0;font-size:13.5px;line-height:1.55;color:#565043;}
  .dark .firstrun-body{color:var(--text-muted);}
  .firstrun-actions{margin-top:20px;display:flex;gap:8px;align-items:stretch;}
  .firstrun-btn{flex:1;border:none;font-family:var(--font-ui);font-size:13px;font-weight:800;line-height:1.2;
    padding:12px 8px;border-radius:var(--r-pill);cursor:pointer;display:flex;align-items:center;
    justify-content:center;gap:6px;white-space:nowrap;}
  .firstrun-btn.secondary{background:var(--sand);color:#5d5546;}
  .dark .firstrun-btn.secondary{color:#cfc5b4;}
  .firstrun-btn.primary{background:var(--primary);color:var(--primary-ink);}
  .firstrun-note{font-size:11.5px;color:#8a8071;font-weight:600;padding:16px 6px 0;line-height:1.5;}
  .list-footnote{font-size:10.5px;color:#8a8071;font-weight:600;padding:6px 4px 0;line-height:1.45;}
  .dark .firstrun-note,.dark .list-footnote{color:var(--text-muted);}
  .list-footnote.rooms{padding:4px 4px 0;}
  .room-group{margin-bottom:6px;transition:margin-bottom .34s var(--ease-enter) .05s;}
  .room-group.emptying{margin-bottom:0;}
  .room-header{display:flex;align-items:center;gap:5px;margin-bottom:5px;padding:0 12px;min-height:24px;background:#efe4cd;border-radius:var(--r-sm);}
  .dark .room-header{background:var(--sand);}
  .room-header h3{font-size:13px;font-weight:700;color:var(--bark);text-transform:uppercase;letter-spacing:.7px;}
  .room-count{font-size:12px;color:var(--text-muted);margin-left:auto;font-weight:700;}
  .room-header.colored{padding:0 12px;min-height:26px;border-radius:var(--r-sm);margin-bottom:6px;}
  .room-header.colored h3{color:inherit;font-family:var(--font-display);font-weight:400;font-size:13px;text-transform:none;letter-spacing:0;line-height:1;}
  .room-header.colored .room-count{color:inherit;font-size:10px;font-weight:800;opacity:1;}
  .room-header.colored .room-count{color:inherit;opacity:.85;}

  /* Compact plant card */
  .plant-card{background:var(--card-bg);border-radius:var(--r-md);margin-bottom:6px;box-shadow:var(--shadow);cursor:pointer;display:flex;overflow:hidden;transition:box-shadow .15s;}
  .plant-card > .health-edge,
  .water-card > .health-edge,
  .repot-card > .health-edge{width:5px;flex-shrink:0;}
  .pc-body{flex:1;min-width:0;display:flex;align-items:center;gap:9px;padding:7px 10px 7px 9px;flex:1;min-width:0;}
  .plant-card:hover{box-shadow:0 3px 12px rgba(60,30,10,.13);}
  .plant-thumb{width:42px;height:42px;border-radius:var(--r-sm);flex-shrink:0;background:var(--leaf-pale);display:flex;align-items:center;justify-content:center;font-size:19px;overflow:hidden;}
  .plant-initial{font-family:var(--font-display);font-weight:400;font-size:19px;line-height:1;}
  .name-counter{font-size:11px;font-weight:700;color:var(--text-muted);text-align:right;margin-top:3px;}
  .name-counter.at-cap{color:#e0483a;}
  .form-group input.at-cap{border-color:#e0483a;}
  .sheet-grab{position:absolute;top:0;left:0;right:0;height:22px;display:flex;align-items:center;justify-content:center;z-index:5;pointer-events:none;}
  .sheet-grab span{display:block;width:38px;height:4px;border-radius:var(--r-pill);background:#d8cbb4;margin-top:12px;}
  .detail-hero{position:relative;flex-shrink:0;border-radius:35px 35px 0 0;overflow:hidden;
    background:var(--primary);color:var(--primary-ink);padding:14px 16px 14px;display:flex;flex-direction:column;justify-content:flex-end;}
  .detail-hero.has-photo{height:216px;background-size:cover;background-position:center;padding:0;
    filter:saturate(.92) contrast(.97);}
  /* With no photo the hero collapses to its content, and the absolutely
     positioned close button (top:8px, 34px tall) then overlaps the room and
     name. Reserve clearance for it above the text. */
  .detail-hero:not(.has-photo){padding-top:52px;}
  .detail-hero-scrim{position:absolute;inset:0;background:linear-gradient(to top,rgba(15,68,56,.94) 0%,rgba(15,68,56,.3) 48%,rgba(15,68,56,0) 78%);}
  .detail-hero-content{position:relative;z-index:2;}
  .detail-hero.has-photo .detail-hero-content{position:absolute;left:20px;right:20px;bottom:14px;color:#fff;}
  /* Wraps to three lines, then truncates (§6 rule 2). */
  .detail-hero-name{font-family:var(--font-display);font-weight:400;line-height:1.12;
    display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
  .hero-pill{background:rgba(255,255,255,.22);padding:3px 11px;border-radius:var(--r-pill);font-size:12px;font-weight:700;}
  .detail-hero:not(.has-photo) .hero-pill{background:rgba(255,255,255,.16);}
  /* ── Home waking up (§4). One stagger, not five bounces; the bar fills
     last, alone; and nothing here gates a tap — the entrance is abandoned
     the moment the user interacts. ─────────────────────────────────────── */
  @keyframes wakeFade{from{opacity:0;}to{opacity:1;}}
  @keyframes wakeRise{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:none;}}
  @keyframes wakeTile{from{opacity:0;transform:translateY(8px) scale(.9);}to{opacity:1;transform:none;}}
  .wake-header{animation:wakeFade .26s var(--ease-enter) backwards;}
  /* ── Toast (§6.4) ─────────────────────────────────────────────────────── */
  @keyframes toastIn{from{opacity:0;transform:translate(-50%,14px);}to{opacity:1;transform:translate(-50%,0);}}
  .toast{position:fixed;left:50%;bottom:78px;transform:translateX(-50%);z-index:300;
    display:flex;align-items:center;gap:14px;max-width:min(432px,calc(100vw / var(--zoom) - 28px));
    background:var(--text);color:var(--ground);padding:11px 14px;border-radius:var(--r-sm);
    box-shadow:var(--shadow-lg);font-size:13px;font-weight:600;animation:toastIn .22s var(--ease-arrive) both;}
  .toast-undo{background:none;border:none;color:var(--leaf-light);font-family:var(--font-ui);
    font-size:13px;font-weight:800;cursor:pointer;padding:4px 2px;flex-shrink:0;}

  /* ── Status strips (§6.7): above the list, never blocking ─────────────── */
  .status-strip{display:flex;align-items:center;gap:10px;border-radius:12px;margin:0 0 6px;}
  .status-strip svg{flex-shrink:0;}
  .status-strip .strip-head{font-size:13px;font-weight:800;line-height:1.25;}
  .status-strip .strip-sub{font-size:11.5px;font-weight:600;margin-top:1px;}
  .status-strip.offline{background:#ffe6c0;color:#8a4c06;padding:10px 13px;}
  .status-strip.offline .strip-sub{color:#a3450a;}
  .status-strip.syncfail{background:#ffd7d2;color:#97281d;padding:10px 12px 10px 13px;}
  .status-strip.syncfail .strip-sub{color:#a3372a;}
  .dark .status-strip.offline{background:#5a3607;color:#ffcb85;}
  .dark .status-strip.offline .strip-sub{color:#e0ac6e;}
  .dark .status-strip.syncfail{background:#5e1c14;color:#ffb3a8;}
  .dark .status-strip.syncfail .strip-sub{color:#e08d80;}
  .dark .status-strip .strip-retry{background:#c0392b;color:#fff2f0;}
  .status-strip .strip-retry{margin-left:auto;background:#97281d;border:none;color:#fff;
    font-family:var(--font-ui);font-size:12px;font-weight:800;
    padding:7px 14px;border-radius:var(--r-pill);cursor:pointer;flex-shrink:0;}

  /* ── Notification primer (§5): popup over Home, not a screen ──────────── */
  .primer-card{background:var(--surface);border-radius:var(--r-xl);padding:30px 26px 24px;
    width:min(338px,calc(100vw / var(--zoom) - 40px));box-shadow:var(--shadow-lg);text-align:left;}
  .primer-icon{width:62px;height:62px;border-radius:999px;background:var(--primary);color:var(--primary-ink);
    display:flex;align-items:center;justify-content:center;margin-bottom:12px;}
  .primer-head{font-family:var(--font-display);font-weight:400;font-size:23px;line-height:1.15;
    color:var(--text);margin-bottom:9px;}
  .primer-body{font-size:13.5px;line-height:1.5;color:var(--text-muted);margin-bottom:18px;}
  .primer-not-now{display:block;margin:11px auto 0;background:none;border:none;
    color:var(--text-muted);font-family:var(--font-ui);font-size:13px;font-weight:700;cursor:pointer;}
  /* ── Summary tiles + health score (13a) ─────────────────────────────────── */
  .score-tiles{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:10px;}
  .score-tile{border-radius:var(--r-md);padding:8px 4px 7px;text-align:center;box-shadow:var(--shadow-sm);cursor:pointer;outline:2px solid transparent;outline-offset:-1px;transition:outline-color .15s;background:var(--surface);min-height:52px;box-sizing:border-box;}
  .score-tile.all{background:var(--primary);}
  .score-tile-num{font-family:var(--font-display);font-weight:400;font-size:21px;line-height:1;color:var(--text);}
  .score-tile.all .score-tile-num{color:var(--primary-ink);}
  .score-tile-lbl{font-size:8px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--text-muted);margin-top:4px;}
  .score-tile.all .score-tile-lbl{color:rgba(242,240,216,.78);}

  .score-bar-wrap{padding:0 3px;position:relative;}
  .good-health-lbl{font-size:9px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:var(--text-muted);}
  .good-health-pct{font-size:13px;font-weight:800;color:#0c6b3c;}
  .dark .good-health-pct{color:#86ecad;}
  .score-bar{display:flex;height:7px;gap:2px;}
  .score-bar > div{border-radius:var(--r-pill);}

  .score-scrim{position:fixed;top:0;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:var(--col);background:rgba(31,29,26,.5);z-index:59;}
  .score-tip{position:absolute;left:50%;top:calc(100% + 14px);transform:translateX(-50%);z-index:60;
    width:min(300px,calc(100vw / var(--zoom) - 60px));background:var(--tip-bg);border-radius:var(--r-lg);
    box-shadow:var(--shadow-lg);padding:15px 16px 14px;animation:scoreTipIn .18s var(--ease-enter);}
  .score-tip-arrow{position:absolute;top:-8px;left:50%;transform:translateX(-50%);width:0;height:0;
    border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:8px solid var(--tip-bg);}
  .score-tip{--tip-bg:var(--surface);}
  /* Dark --surface (#2b2823) measured 1.02:1 against the scrim-dimmed cards
     behind it, so the tip dissolved into them. Lifted above the cards, with
     a hairline edge; --leaf on it was 2.06:1, the Thriving ink is 7.5:1. */
  .dark .score-tip{--tip-bg:#433d35;box-shadow:0 0 0 1px rgba(255,255,255,.07);}
  .dark .score-tip-pts, .dark .score-tip-total-val.muted{color:#bcb19e;}
  .dark .score-tip-big-pct{color:#86ecad;}
  .score-tip-title{font-family:var(--font-display);font-weight:400;font-size:18px;color:var(--text);margin-bottom:11px;}
  .score-tip-grid{display:grid;grid-template-columns:1fr 68px;gap:5px 10px;font-size:13px;}
  .score-tip-grid.totals{margin-top:0;}
  .score-tip-pts{font-size:12.5px;font-weight:700;color:var(--text-muted);}
  .score-tip-divider{height:1px;background:var(--border);margin:11px 0 9px;}
  .score-tip-total-lbl{font-size:13px;font-weight:700;color:var(--text);}
  .score-tip-total-val{font-size:12.5px;font-weight:800;color:var(--text);}
  .score-tip-total-val.muted{color:var(--text-muted);}
  .score-tip-reaction{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:12px;}
  .score-tip-big-pct{font-family:var(--font-display);font-weight:400;font-size:32px;color:var(--leaf);line-height:1;}
  .score-tip-big-pct span{font-size:19px;}
  .score-tip-emoji{font-size:30px;line-height:1;}
  .score-tip-gotit{margin-top:12px;width:100%;border:none;background:var(--primary);color:var(--primary-ink);
    font-family:var(--font-ui);font-size:13px;font-weight:800;padding:10px 0;border-radius:var(--r-pill);cursor:pointer;}

  .wake .score-tile{animation:wakeTile .26s var(--ease-arrive) backwards;}
  .wake .score-tile:nth-child(1){animation-delay:.06s;}
  .wake .score-tile:nth-child(2){animation-delay:.1s;}
  .wake .score-tile:nth-child(3){animation-delay:.14s;}
  .wake .score-tile:nth-child(4){animation-delay:.18s;}
  .wake .score-tile:nth-child(5){animation-delay:.22s;}
  .wake .good-health-lbl,
  .wake .good-health-pct{animation:wakeFade .24s var(--ease-enter) .3s backwards;}
  @keyframes barReveal{from{transform:scaleX(0);}to{transform:scaleX(1);}}
  .wake .score-bar > div{transform-origin:left;animation:barReveal .52s var(--ease-collapse) .3s backwards;}
  /* Water/Repot card sub-lines and actions (7a/7c) */
  .card-status-pill{font-size:10px;font-weight:800;padding:2px 8px;border-radius:var(--r-pill);flex-shrink:0;}
  .card-status-pill.due{background:var(--water-tint);color:var(--water-ink);}
  .card-status-pill.late{background:var(--danger-tint);color:var(--danger);}
  .card-room-pill{font-size:10px;font-weight:800;padding:2px 8px;border-radius:var(--r-pill);flex-shrink:0;background:var(--warn-tint);color:var(--warn);}
  /* Repot's room + "potted Ny ago" line stays one row. A long room name
     beside a two-digit pot size ran it out of width and wrapped "potted",
     growing the card; now the room pill gives way with an ellipsis. */
  .repot-sub-row{flex-wrap:nowrap;min-width:0;}
  .repot-sub-row .card-room-pill{flex-shrink:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .repot-sub-row .card-sub-text{flex-shrink:0;white-space:nowrap;}
  .card-sub-text{font-size:11px;color:var(--text-muted);font-weight:600;}
  /* Water/Repot celebration + empty states (7b/7d) */
  .celebration{position:relative;overflow:hidden;background:var(--surface);border-radius:var(--r-lg);
    box-shadow:var(--shadow-sm);padding:26px 20px 24px;text-align:center;}
  /* In light this is white on beige and reads as a raised tile. In dark,
     --surface and --ground are only a few points apart, so it flattened into
     the page. Lift it - and bring the accents with it: the headline was a dark
     #0a7a43 and the pill a navy --leaf-pale, both of which fought the lifted
     warm grey. Mint on a mint tint keeps the tile one colour family. */
  .dark .celebration{background:#39342c;}
  .dark .celebration .celebration-head{color:#7fd6a0!important;}
  /* Blue capsule, mirroring light mode, where it is a --leaf-pale tint with
     green text. Dark's --leaf-pale is a near-black navy that sat heavy on the
     lifted surface, so this is the water ink at a low tint instead. */
  .dark .celebration-pill.water{background:rgba(165,207,227,.16)!important;color:#a5cfe3!important;}
  .celebration.all-done{animation:allDoneIn .26s var(--ease-enter) .2s both;}
  .celebration-head{font-family:var(--font-display);font-weight:400;font-size:26px;line-height:1.1;margin-top:2px;}
  .celebration-pill{display:inline-flex;align-items:center;gap:7px;margin-top:15px;font-size:12px;font-weight:800;padding:7px 15px;border-radius:var(--r-pill);}
  @keyframes drip{0%{transform:translateY(0);opacity:.9;}70%{opacity:.6;}100%{transform:translateY(14px);opacity:0;}}
  .drip{position:absolute;width:6px;height:8px;border-radius:0 0 99px 99px;background:#c3e3f2;animation:drip 2s ease-in-out infinite;}
  .drip.d1{top:18px;left:34px;width:7px;height:9px;background:#9ccfe4;}
  .drip.d2{top:26px;right:44px;animation-delay:.4s;}
  .drip.d3{bottom:22px;left:56px;width:5px;height:7px;background:#c8f2d9;animation-delay:.9s;animation-duration:2.1s;}
  .pot-size-badge{background:var(--potting);border-radius:var(--r-sm);padding:5px 10px;text-align:center;flex-shrink:0;}
  .pot-size-badge-val{font-family:var(--font-display);font-weight:400;font-size:15px;color:var(--potting-head);line-height:1;}
  .pot-size-badge-lbl{font-size:8px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--potting-head);margin-top:2px;}
  .plant-age-sub{font-size:11px;color:var(--text-muted);margin-top:1px;font-weight:600;}
  /* View Plant panels (5b) */
  /* Drag zones: a pull anywhere on these panels moves the card (see
     useSheetDrag). touch-action:none stops iOS scrolling the list on its own
     thread before the drag can claim the gesture. */
  .detail-sheet .detail-panel{touch-action:none;}
  .detail-panel{border-radius:var(--r-lg);padding:13px 16px 14px;}
  .detail-panel.water{background:var(--water);color:var(--water-header-ink);}
  .detail-panel.potting{background:var(--potting-panel);color:var(--potting-ink);}
  /* Light View card only: #f7d9c2 sat 1.13:1 against the card and blended in.
     A step darker (1.33:1); the Pot title and values stay above 4.5:1. */
  .app:not(.dark) .detail-sheet .detail-panel.potting{background:#efc6a6;}
  .detail-panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:11px;}
  .detail-panel-title{font-family:var(--font-display);font-weight:400;font-size:16px;}
  .detail-panel.potting .detail-panel-title{color:var(--potting-head);}
  .detail-panel-pill{background:rgba(255,255,255,.22);font-size:11px;font-weight:800;padding:4px 11px;border-radius:var(--r-pill);}
  .detail-panel-pill.outline{background:none;border:1.5px solid var(--accent);color:var(--potting-head);}
  .detail-panel-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}
  .detail-panel-val{font-family:var(--font-display);font-weight:400;font-size:23px;line-height:1;}
  .detail-panel-lbl{font-size:9px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;margin-top:4px;}
  .detail-panel.water .detail-panel-lbl{color:#d6ecf7;}
  .detail-panel.potting .detail-panel-val{color:var(--potting-head);}
  .detail-panel.potting .detail-panel-lbl{color:var(--potting-ink);}

  /* Hero room label + pill variants (5b) */
  .detail-hero-room{display:flex;align-items:center;gap:7px;margin-bottom:2px;}
  .detail-hero-room-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;}
  .detail-hero-room span:last-child{font-size:10px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#fbd9ad;}
  .hero-pill.filled{color:#f2fbf5;}
  /* ── Add/Edit Plant form (6a/6b) ─────────────────────────────────────────── */
  /* Two layers so the top edge reads dark right at the card but still falls
     off softly instead of ending in a visible band. */
  .modal.pm-modal{padding:0!important;overflow:hidden;display:flex;flex-direction:column;max-height:calc(96vh / var(--zoom) - env(safe-area-inset-top,0px));max-height:calc(96dvh / var(--zoom) - env(safe-area-inset-top,0px));border-radius:35px 35px 0 0;box-shadow:0 -10px 26px rgba(0,0,0,.40), 0 -28px 68px rgba(0,0,0,.34);}
  .pm-header{background:var(--primary);color:var(--primary-ink);padding:12px 16px 13px;flex-shrink:0;display:flex;align-items:center;gap:12px;}
  .pm-icon-btn{border:none;width:32px;height:32px;border-radius:var(--r-pill);background:rgba(242,240,216,.16);color:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .pm-title{font-family:var(--font-display);font-weight:400;font-size:21px;line-height:1;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .hero-accent-btn{border:none;background:var(--accent);color:#fff;border-radius:var(--r-pill);
    padding:8px 20px;min-width:44px;height:30px;display:flex;align-items:center;justify-content:center;
    font-family:var(--font-ui);font-size:12px;font-weight:800;cursor:pointer;}
  .dark .hero-accent-btn{background:#f2a13b;color:#3a1d05;}
  .dark .pm-save-btn{background:#f2a13b;color:#3a1d05;}
  .pm-save-btn{border:none;background:var(--accent);color:#fff;font-family:var(--font-ui);font-size:13px;font-weight:800;padding:8px 20px;border-radius:var(--r-pill);cursor:pointer;flex-shrink:0;}
  .pm-body{flex:1;overflow-y:auto;padding:11px 14px 16px;display:flex;flex-direction:column;gap:7px;}
  .pm-got-card{padding:9px 12px 10px!important;}
  /* 6b centres both cards in this row vertically, not just the Got one. */
  .pm-name-card{display:flex;flex-direction:column;justify-content:center;gap:3px;}
  .pm-got-card{display:flex;flex-direction:column;justify-content:center;gap:3px;}
  .notes-card{height:84px;flex:0 0 84px;overflow:hidden;}
  /* 84px is the resting size in 6b. The editor (a 72px textarea plus its
     delete/Save row) does not fit in it, so the card sizes to its content
     while editing instead of clipping the bottom of the box and the buttons. */
  .notes-card.editing{height:auto;flex:0 0 auto;overflow:visible;}
  .pm-card{background:var(--surface);border-radius:var(--r-md);box-shadow:var(--shadow-sm);padding:9px 14px 10px;}
  .pm-lbl{font-size:9px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:var(--text-muted);}
  /* div/control mismatch: 13c and 6a draw this value as a div inheriting
     1.55; the build substitutes an <input>, which takes the UA default. Not
     a blanket control rule -- comp controls really are at normal. */
  .pm-name-input{border:none;background:none;font-family:var(--font-display);font-weight:400;font-size:20px;color:var(--text);width:100%;padding:0;margin-top:2px;line-height:1.55;}
  .pm-name-input:focus{outline:none;}
  /* 6a draws the rule as its own 2px pill under the value, not as a border. */
  .pm-name-rule{display:block;height:2px;border-radius:999px;background:#17627f;margin-top:3px;}
  .pm-name-rule.at-cap{background:#e0483a;}
  .pm-got-caption{font-size:10px;font-weight:700;color:var(--bark-light);margin-top:2px;}
  .pm-date-chip.cal-field-btn{font-size:13px;font-weight:800;color:var(--text);border:none;background:none;padding:0;gap:5px;justify-content:flex-start;}
  /* CalendarField ships a 15px icon; every date control in 6b draws it at 12. */
  .pm-date-chip svg,.pm-date-pill svg{width:12px;height:12px;}

  .pm-room-scroll{display:flex;gap:6px;overflow-x:auto;padding:6px 14px 7px;scrollbar-width:none;}
  .pm-room-scroll::-webkit-scrollbar{display:none;}
  .pm-stepper-lbl{display:inline-flex;align-items:center;gap:7px;}
  .tip-q{border:none;width:17px;height:17px;border-radius:var(--r-pill);background:#17627f;color:#fff;
    font-family:var(--font-ui);font-size:11px;font-weight:800;line-height:1;cursor:pointer;
    display:flex;align-items:center;justify-content:center;flex-shrink:0;
    box-shadow:0 0 0 2.5px #e6f2f8, 0 0 0 4.5px #17627f;}
  .dark .tip-q{box-shadow:0 0 0 2.5px #173f52, 0 0 0 4.5px #a5cfe3;background:#a5cfe3;color:#04212e;}
  .tip-scrim{position:fixed;top:0;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:var(--col);background:rgba(31,29,26,.5);z-index:560;display:flex;
    align-items:center;justify-content:center;padding:16px;box-sizing:border-box;}
  .tip-card{background:var(--surface);border-radius:var(--r-lg);box-shadow:var(--shadow-lg);
    padding:16px 17px 15px;width:100%;max-width:358px;}
  .tip-head{font-family:var(--font-display);font-weight:400;font-size:18px;line-height:1.15;color:#12556e;}
  .dark .tip-head{color:#a5cfe3;}
  .tip-body{margin:8px 0 0;font-size:13px;line-height:1.55;color:#474238;}
  .dark .tip-body{color:#c2b9a8;}
  .tip-btn{margin-top:15px;width:100%;border:none;background:#17627f;color:#fff;
    font-family:var(--font-ui);font-size:13px;font-weight:800;padding:10px 0;
    border-radius:var(--r-pill);cursor:pointer;}
  .dark .tip-btn{background:#5aa8cc;color:#04212e;}
  .pm-room-chip{flex-shrink:0;font-size:12px;font-weight:800;padding:6px 15px;border-radius:var(--r-pill);cursor:pointer;white-space:nowrap;}

  .pm-health-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;}
  .pm-health-tile{border-radius:var(--r-sm);padding:9px 2px;text-align:center;font-size:11px;font-weight:800;cursor:pointer;}

  .pm-panel{border-radius:var(--r-md);padding:9px 14px 11px;}
  .pm-panel.water{background:var(--water-tint);}
  .pm-panel.potting{background:var(--potting-panel);}
  .pm-panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
  .pm-panel-title{font-family:var(--font-display);font-weight:400;font-size:15px;}
  .pm-panel.water .pm-panel-title{color:var(--water-ink);}
  .pm-panel.potting .pm-panel-title{color:var(--potting-head);}
  .pm-panel-badge{background:var(--water);color:#fff;font-size:11px;font-weight:800;padding:4px 11px;border-radius:var(--r-pill);}
  /* Dark --water (#134b64) sits almost on the #173f52 panel. A clearly
     lighter blue lifts the badge off it. */
  .dark .pm-panel-badge{background:#467690;color:#f2f9fc;}
  .pm-stepper-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;font-size:13px;font-weight:700;}
  .pm-panel.water .pm-stepper-row{color:var(--water-ink);}
  .pm-panel.potting .pm-stepper-row{color:var(--potting-head);}
  .pm-row-between{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:700;}
  .pm-panel.water .pm-row-between{color:var(--water-ink);}
  .pm-panel.potting .pm-row-between{color:var(--potting-head);}
  .pm-stepper{display:flex;align-items:center;gap:11px;}
  .pm-step{border:none;width:30px;height:30px;border-radius:var(--r-pill);font-size:19px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;}
  /* Wide enough for the longest value any of the three steppers can show, so
     the minus buttons stay put instead of shifting when the text grows. At
     22px Caprasimo the worst cases are 12.5y (59.7), 10.5" (54.9) and 365d
     (53.9); 44 was narrower than 2.5y (46.6), which is what moved it. */
  .pm-stepper-val{font-family:var(--font-display);font-weight:400;font-size:22px;min-width:62px;text-align:center;}
  /* .cal-field-btn is a full-width form control; as a pill it has to stop
     being one, or it stretches across the row with the icon pushed to the far
     edge instead of sitting next to the date (6b). */
  .pm-date-pill.cal-field-btn{background:var(--surface);font-size:12px;font-weight:800;padding:7px 14px;border-radius:var(--r-pill);border:none;gap:7px;width:auto;justify-content:center;flex-shrink:0;}
  .pm-date-pill.cal-field-btn.water{color:var(--water-ink);flex-direction:row-reverse;}
  .pm-date-pill.cal-field-btn.potting{color:var(--potting-head);flex-direction:row-reverse;}

  .pm-toggle-row{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:800;color:var(--potting-head);cursor:pointer;}
  .pm-toggle{width:34px;height:19px;border-radius:var(--r-pill);background:var(--border-strong);display:inline-flex;align-items:center;padding:2px;cursor:pointer;transition:background .15s;}
  .pm-toggle.on{background:var(--accent);justify-content:flex-end;}
  .pm-toggle-knob{width:15px;height:15px;border-radius:50%;background:#fff;display:block;}


  .pm-photo-strip{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:2px;}
  .pm-photo-strip-thumb{position:relative;width:48px;height:48px;flex-shrink:0;}
  .pm-photo-strip-thumb img{width:48px;height:48px;object-fit:cover;border-radius:var(--r-md);display:block;}
  .pm-photo-strip-thumb button{position:absolute;top:-5px;right:-5px;width:17px;height:17px;border:none;
    border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font-size:10px;cursor:pointer;
    display:flex;align-items:center;justify-content:center;padding:0;}
  .pm-photo-add{width:48px;height:48px;flex-shrink:0;border-radius:var(--r-md);border:2px dashed #c0b6a5;
    background:var(--surface);display:flex;align-items:center;justify-content:center;color:#8a8071;cursor:pointer;}
  .dark .pm-photo-add{border-color:var(--border-strong);}
  .pm-photo-add-lbl{font-size:11px;font-weight:700;color:#6f6658;line-height:1.4;}
  .dark .pm-photo-add-lbl{color:var(--text-muted);}
  .pm-photo-add-lbl em{font-style:normal;font-weight:600;color:#8a8071;}


  .pm-bottom-btn{flex:1;border:none;font-family:var(--font-ui);font-size:13px;font-weight:800;padding:10px 0;border-radius:var(--r-pill);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;}
  .pm-bottom-btn.clone{background:var(--sand);color:var(--text);}
  .pm-bottom-btn.danger{background:var(--danger-tint);color:var(--danger);}
  /* --sand/--danger-tint sit too close to --page-bg in light mode to read as
     buttons (same issue already fixed for .btn-secondary/.btn-danger). */
  .app:not(.dark) .pm-bottom-btn.clone{background:#cec5b5;}
  .app:not(.dark) .pm-bottom-btn.danger{background:#f5b8b8;}
  /* Rooms tab (13b/13c) */
  .room-bar{display:flex;align-items:center;gap:10px;padding:7px 13px 8px;border-radius:var(--r-sm);box-shadow:var(--shadow-sm);margin-bottom:7px;}
  .room-bar.clickable{cursor:pointer;}
  .room-bar-info{flex:1;min-width:0;display:flex;align-items:baseline;gap:8px;}
  .room-bar-name{font-family:var(--font-display);font-weight:400;font-size:16px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .room-bar-count{font-size:11px;font-weight:700;flex-shrink:0;}
  .room-drag{border:none;background:none;padding:0;width:18px;height:18px;flex-shrink:0;
    cursor:grab;display:flex;align-items:center;justify-content:center;touch-action:none;}
  .room-drag:active{cursor:grabbing;}
  .room-bar.dragging{box-shadow:var(--shadow-md);z-index:5;position:relative;
    transition:box-shadow .16s var(--ease-enter);}
  .room-bar.displaced{transition:transform .2s var(--ease-arrive);}
  @media (prefers-reduced-motion: reduce){
    .room-bar.dragging,.room-bar.displaced{transition:none!important;}
  }
  .room-bar-edit{width:28px;height:28px;border-radius:var(--r-pill);border:none;display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;}

  .room-edit-card{width:100%;max-width:346px;background:#f2e6d2;border-radius:var(--r-lg);padding:18px 16px 14px;
    box-shadow:0 18px 50px rgba(28,25,20,.42);display:flex;flex-direction:column;gap:12px;}
  .dark .room-edit-card{background:var(--surface);}
  /* 13c: overlay is the dialog scrim at .52 with a 22px inset. */
  .room-edit-overlay{background:rgba(28,25,20,.52)!important;padding:22px;align-items:center!important;}
  .room-name-rule{display:block;height:2px;border-radius:999px;background:#a3450a;margin-top:4px;}
  .room-edit-title{font-family:var(--font-display);font-weight:400;font-size:20px;line-height:1.15;color:var(--text);text-align:center;}
  .room-swatch-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:9px;justify-items:center;}
  .room-swatch{width:26px;height:26px;border-radius:50%;border:none;cursor:pointer;padding:0;}
  .room-swatch.none{background:var(--ground);border:2px dashed var(--border-strong);box-sizing:border-box;}
  .room-chip-preview{border-radius:var(--r-sm);padding:3px 12px;display:flex;align-items:center;justify-content:space-between;}
  .room-chip-preview span:first-child{font-family:var(--font-display);font-weight:400;font-size:13px;}
  .room-chip-preview span:last-child{font-size:10px;font-weight:800;}
  .room-edit-cancel{border:none;background:transparent;color:var(--text-muted);font-family:var(--font-ui);font-size:13.5px;font-weight:800;padding:2px 0;cursor:pointer;align-self:center;}
  .pm-bottom-btn.save{background:var(--primary);color:var(--primary-ink);}
  /* Icon-tile destination choice (8a) */
  .cfm-choice-row{width:100%;text-align:left;background:var(--surface);border:none;border-radius:var(--r-md);box-shadow:var(--shadow-sm);padding:11px 13px;display:flex;align-items:center;gap:11px;cursor:pointer;font-family:var(--font-ui);}
  .cfm-choice-icon{width:38px;height:38px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .cfm-choice-icon.grave{background:#e9f0e0;color:#3f5427;}
  .cfm-choice-icon.danger{background:var(--danger-tint);color:var(--danger);}
  .cfm-choice-text{flex:1;min-width:0;display:block;}
  .cfm-choice-label{display:block;font-family:var(--font-display);font-weight:400;font-size:15px;line-height:1.15;}
  .cfm-choice-label.grave{color:#2f4a1c;}
  .cfm-choice-label.danger{color:var(--danger);}
  .cfm-choice-sub{display:block;font-size:11px;color:var(--text-muted);font-weight:600;margin-top:3px;line-height:1.35;}
  /* Graveyard (8b) */
  .page-header.graveyard{background:var(--graveyard);color:var(--graveyard-ink);}
  .page-header.graveyard p{color:var(--graveyard-sub);opacity:1;}
  .dark .grave-stat-val{color:#b9c79a;}
  .dark .grave-stat-lbl{color:#8d9a76;}
  .dark .grave-year-row span:first-child{color:#b9c79a;}
  .dark .grave-lived-val{color:#b9c79a;}
  .dark .grave-lived-lbl{color:#8d9a76;}
  .dark .cfm-choice-icon.grave{background:#2b3a1f;color:#b9c79a;}
  .dark .cfm-choice-label.grave{color:#c6d4a7;}
  .dark .rd-restore-btn{background:#2b3a1f;color:#b9c79a;}
  .grave-stat{flex:1;background:var(--surface);border-radius:var(--r-md);box-shadow:var(--shadow-sm);padding:9px 12px 10px;}
  .grave-stat-val{font-family:var(--font-display);font-weight:400;font-size:22px;line-height:1;color:#4b5735;}
  .grave-stat-lbl{font-size:9px;font-weight:800;letter-spacing:.9px;text-transform:uppercase;color:#7e8a68;margin-top:3px;}
  .grave-year-row{display:flex;align-items:center;gap:8px;padding:0 2px 2px;}
  .grave-year-row span:first-child{font-size:11px;font-weight:800;letter-spacing:.9px;text-transform:uppercase;color:#4b5735;}
  .grave-year-line{flex:1;height:1px;background:#ddd0b8;}
  .grave-year-count{font-size:11px;font-weight:800;color:var(--text-muted);}
  .grave-row{background:var(--surface);border-radius:var(--r-md);box-shadow:var(--shadow-sm);display:flex;align-items:center;gap:11px;padding:8px 12px 8px 8px;margin-bottom:6px;cursor:pointer;}
  .grave-photo{width:46px;height:46px;border-radius:var(--r-sm);object-fit:cover;flex-shrink:0;filter:grayscale(.72) contrast(.92);}
  .grave-photo-blank{background:var(--sand);color:var(--text-muted);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-weight:400;font-size:19px;}
  .grave-lived-val{font-family:var(--font-display);font-weight:400;font-size:15px;color:#56633f;line-height:1;}
  .grave-lived-lbl{font-size:8px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#7e8a68;margin-top:2px;}
  /* Recently Deleted (8c) */
  .page-header.charcoal{background:var(--charcoal);color:var(--charcoal-ink);}
  /* dark already drops --charcoal to #33302a; this just documents it stays
     tied to that token rather than needing its own dark rule. */
  .page-header.charcoal p{color:var(--charcoal-sub);opacity:1;margin-top:3px;font-weight:600;}

  .rd-row{background:var(--surface);border-radius:var(--r-md);box-shadow:var(--shadow-sm);display:flex;align-items:center;gap:11px;padding:8px 12px 8px 8px;margin-bottom:6px;cursor:pointer;}
  .rd-photo{width:46px;height:46px;border-radius:var(--r-sm);object-fit:cover;flex-shrink:0;opacity:.72;}
  .rd-photo-blank{background:var(--sand);color:var(--text-muted);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-weight:400;font-size:19px;}
  .rd-days-left{background:#efe6d4;color:#5d5546;font-size:10px;font-weight:800;padding:4px 9px;border-radius:var(--r-pill);white-space:nowrap;}
  .rd-restore-btn{border:none;background:#e9f0e0;color:#3f5427;width:32px;height:32px;border-radius:var(--r-pill);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  /* Auth (19a/19e/20a) — full green ground, cream wordmark stays cream */
  .auth-screen{position:fixed;inset:0;background:var(--primary);display:flex;flex-direction:column;overflow-y:auto;box-sizing:border-box;}
  /* Was a mock "9:41" status bar lifted from the design frames; on a phone it
     sat under the real one. Kept as the same 27px of space, plus the real
     status bar's height where the app draws under it. */
  .auth-statusbar{flex-shrink:0;height:calc(27px + env(safe-area-inset-top,0px));}
  .auth-content{flex:1;display:flex;flex-direction:column;padding:0 26px 30px;max-width:440px;width:100%;margin:0 auto;box-sizing:border-box;}
  .auth-spacer{height:64px;flex-shrink:0;}
  .auth-lockup{display:flex;align-items:flex-end;gap:12px;margin-top:88px;}
  .auth-wordmark{font-family:var(--font-display);font-weight:400;font-size:42px;line-height:1;color:var(--primary-ink);}
  .auth-mark{width:38px;height:58px;object-fit:contain;flex-shrink:0;}
  .auth-tagline{font-size:15px;line-height:1.5;color:rgba(242,240,216,.82);margin-top:12px;max-width:270px;margin-bottom:38px;}
  .auth-tagline.one-line{max-width:none;}
  .auth-gap{height:26px;flex-shrink:0;}
  .auth-banner{border-radius:var(--r-sm);padding:10px 14px;margin-bottom:14px;font-size:13px;line-height:1.4;}
  .auth-banner.info{background:rgba(200,242,217,.16);color:#c8f2d9;border:1px solid rgba(200,242,217,.3);}
  .auth-banner.error{background:rgba(255,215,210,.16);color:#ffd7d2;border:1px solid rgba(255,215,210,.3);}
  .auth-fields{display:flex;flex-direction:column;gap:14px;}
  .auth-field-lbl{font-size:9px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:rgba(242,240,216,.78);margin-bottom:6px;}
  .auth-field-input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.1);border:1.5px solid rgba(242,240,216,.3);border-radius:var(--r-pill);padding:14px 20px;font-size:15px;font-weight:600;color:var(--primary-ink);font-family:var(--font-ui);}
  .auth-field-input::placeholder{color:rgba(242,240,216,.45);}
  .auth-field-input:focus{outline:none;border-color:rgba(242,240,216,.6);}
  .auth-submit{margin-top:20px;width:100%;border:none;background:var(--primary-ink);color:var(--primary);font-family:var(--font-ui);font-size:15px;font-weight:800;padding:16px 0;border-radius:var(--r-pill);cursor:pointer;}
  .auth-submit.disabled{background:rgba(242,240,216,.22);color:rgba(242,240,216,.55);cursor:not-allowed;}
  .auth-submit:disabled{opacity:.7;cursor:default;}
  .auth-link-row{text-align:center;margin-top:14px;}
  .auth-link{background:none;border:none;font-family:var(--font-ui);font-size:13px;font-weight:700;color:#ffcb85;cursor:pointer;padding:0;}
  .auth-link.strong{font-weight:800;}
  .auth-terms{font-size:12px;line-height:1.5;color:rgba(242,240,216,.72);font-weight:600;margin-top:16px;text-align:center;}
  .auth-footer{margin-top:auto;padding:22px 0 26px;text-align:center;font-size:13px;color:rgba(242,240,216,.82);font-weight:600;}
  /* Reset password flow + field-level errors (20a/20b/20d) */
  .auth-content.auth-center{align-items:center;justify-content:center;text-align:center;flex:1;position:relative;}
  .auth-back-btn{border:none;background:rgba(255,255,255,.1);color:var(--primary-ink);width:38px;height:38px;border-radius:var(--r-pill);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:34px;}
  .auth-content.auth-center .auth-back-btn{margin-top:0;}
  .auth-back-fixed{position:absolute;top:26px;left:0;}
  .auth-big-title{font-family:var(--font-display);font-weight:400;font-size:34px;line-height:1.08;color:var(--primary-ink);margin-top:34px;}
  .auth-icon-circle{width:82px;height:82px;border-radius:50%;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;color:var(--primary-ink);margin-top:60px;}
  .auth-outline-btn{margin-top:26px;border:1.5px solid rgba(242,240,216,.3);background:transparent;color:var(--primary-ink);font-family:var(--font-ui);font-size:14px;font-weight:800;padding:13px 28px;border-radius:var(--r-pill);cursor:pointer;}
  .auth-field-lbl.error{color:#ffb3a8;}
  .auth-field-input.error{border-color:#ffb3a8;}
  .auth-field-error{display:flex;align-items:center;gap:6px;margin:7px 0 0 20px;font-size:12.5px;font-weight:700;color:#ffb3a8;}
  /* Notifications (9c) */
  .notif-panel{border-radius:var(--r-md);overflow:hidden;}
  .notif-panel.water .notif-row:not(:last-child){position:relative;}
  .notif-panel.water .notif-row:not(:last-child)::after{content:"";position:absolute;left:14px;right:14px;bottom:0;height:1px;background:rgba(23,98,127,.14);}
  .notif-panel.potting .notif-row:not(:last-child){position:relative;}
  .notif-panel.potting .notif-row:not(:last-child)::after{content:"";position:absolute;left:14px;right:14px;bottom:0;height:1px;background:rgba(163,69,10,.14);}
  /* Two capsules side by side rather than two full-width rows, which left a
     long gap between each label and its control. */
  .notif-grid{display:flex;gap:11px;align-items:flex-start;margin-bottom:11px;}
  .notif-grid > .notif-panel{flex:1;min-width:0;}
  .notif-head-row{padding:10px 12px;gap:8px;}
  .notif-head-row .util-label{font-size:13px;line-height:1.25;min-width:0;}
  .notif-time-row{padding:9px 12px;gap:8px;}
  .notif-time-pill{background:#fffdf8;padding:7px 15px;border-radius:var(--r-pill);font-size:13px;font-weight:800;}
  /* The pill background is a hardcoded near-white, so in dark mode the light
     domain ink sat on white and was unreadable. */
  .dark .notif-time-pill{background:rgba(0,0,0,.34);}
  .notif-time-pill input[type="time"]{border:none;background:none;font:inherit;color:inherit;padding:0;width:auto;min-width:0;}
  .notif-time-pill input[type="time"]::-webkit-calendar-picker-indicator{display:none;}
  .notif-time-pill input[type="time"]:disabled{opacity:1;-webkit-text-fill-color:currentColor;}
  .notif-footnote{display:flex;align-items:flex-start;gap:9px;padding:14px 4px 0;color:var(--bark-light);}
  .notif-footnote span{font-size:11.5px;color:var(--text-muted);font-weight:600;line-height:1.45;}
  /* Data action sheets: Export / Import / Schedule (10b/10c) */
  .data-sheet-handle{width:42px;height:4px;border-radius:var(--r-pill);background:#cfc0a6;display:block;
    margin:0 auto;flex:none;}
  .dark .data-sheet-handle{background:#4a4539;}
  .data-sheet-title{font-family:var(--font-display);font-weight:400;font-size:22px;line-height:1.1;color:var(--text);}
  .seg-tabs{display:flex;gap:4px;background:#e6dbc7;border-radius:var(--r-md);padding:4px;margin-bottom:0;}
  .dark .seg-tabs{background:#1f1d1a;}
  .seg-tab{flex:1;text-align:center;font-size:13px;font-weight:800;padding:8px 0;border-radius:var(--r-sm);background:transparent;border:none;color:#5d5546;cursor:pointer;font-family:var(--font-ui);box-shadow:none;transition:all .15s;}
  .dark .seg-tab{color:#a99e8c;}
  .dark .seg-tabs{background:var(--ground);}
  .dark .seg-tabs{background:#1f1d1a;}
  .dark .seg-tab.active{background:#3a352d;color:#8fd6ac;box-shadow:none;}
  .seg-tab.active{background:var(--surface);color:var(--primary);box-shadow:0 1px 4px rgba(28,25,20,.12);}
  .dashed-cta{width:100%;border:1.5px dashed #7fae8b;background:#e9f0e0;color:#2f5c34;font-family:var(--font-ui);font-size:13px;font-weight:800;padding:12px 0;border-radius:var(--r-md);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;}
  .dashed-cta:disabled{opacity:.6;cursor:default;}
  .dark .dashed-cta{background:rgba(127,174,139,.14);border-color:#4d7a5a;color:#a8d4b3;}
  .then-divider{text-align:center;font-size:11px;font-weight:700;color:var(--text-muted);}
  .file-drop-label{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;padding:17px 10px;border-radius:var(--r-sm);border:2px dashed var(--border-strong);background:var(--surface);color:var(--text-muted);font-size:13px;font-weight:700;cursor:pointer;box-sizing:border-box;}
  .sheet-close-btn{width:100%;border:1.5px solid var(--btn-border);background:var(--btn-bg);color:var(--btn-ink);font-family:var(--font-ui);font-size:13.5px;font-weight:800;padding:12px 0;border-radius:var(--r-pill);cursor:pointer;}
  .dark .sheet-close-btn{background:#231f1b;border-color:#4a463d;}
  /* OOT Water Schedule sheet (10a) */

  .sched-count-line{font-size:11.5px;font-weight:700;color:#6f6658;padding:0 2px;}
  .dark .sched-count-line{color:var(--text-muted);}
  .plant-initial{font-family:var(--font-display);font-weight:400;font-size:19px;line-height:1;color:var(--text-muted);}
  .plant-thumb img{width:100%;height:100%;object-fit:cover;}
  .plant-name-col{flex:1;min-width:0;}
  .plant-name{font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

  /* Stat tiles */
  .stat-tiles{display:flex;gap:11px;align-items:center;flex-shrink:0;}
  /* Repot cards render it empty, and an empty flex item still costs the row
     a 10px gap that the room/potted line needs. */
  .stat-tiles:empty{display:none;}
  .imp-stack{display:grid;}
  .imp-stack > .imp-pane{grid-area:1 / 1;min-width:0;}
  .imp-stack > .imp-pane.off{visibility:hidden;}
  /* JSON is the shorter tab, so its Cancel sat mid-card under the picker and
     read as gone after XLS's bottom Cancel. Pinned to the bottom it lands
     where XLS's is. */
  .imp-pane.imp-json{display:flex;flex-direction:column;}
  /* Cancel is the same full-width pill as XLS's (and Export's Close, 10b),
     so it is one identical button in one place across both tabs. */
  .imp-json-actions{margin-top:auto;padding-top:12px;display:flex;flex-direction:column;gap:10px;}
  .imp-json-actions .pm-bottom-btn{flex:none;padding:13.5px 0;}
  /* Controls in the tab being hidden must vanish at once. .btn and others
     carry transition:all, which animates the inherited visibility too, so
     XLS's Cancel lingered for 0.15s over JSON's buttons on every switch. */
  .imp-pane.off, .imp-pane.off *{transition:none!important;}
  .stat-tile{display:flex;flex-direction:column;align-items:center;justify-content:center;width:33px;text-align:center;}
  .stat-tile .st-lbl{font-size:8px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--text-muted);}
  .stat-tile .st-val{font-size:14px;font-weight:800;margin-top:1px;color:#3d472b;}
  .stat-tile:nth-child(2) .st-val{color:#1a6b8f;}
  .stat-tile:nth-child(3) .st-val{color:#645c50;}
  .dark .stat-tile .st-val{color:#c3d6a6;}
  .dark .stat-tile:nth-child(2) .st-val{color:#7fc8e8;}
  .dark .stat-tile:nth-child(3) .st-val{color:#a99e8c;}

  /* Check button (water/repot) */
  .check-btn{width:34px;height:34px;border-radius:50%;border:none;background:var(--water);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;transition:all .18s;}
  .dark .check-btn{background:var(--water-solid);color:var(--water-solid-ink);}
  .check-btn.brown{background:var(--accent);}
  /* :hover is scoped to devices that actually have a pointer that can hover.
     On touch devices, tapping the check button removes the card (it "leaves"),
     the layout reshuffles, and the next card's button ends up under the
     finger — mobile Safari then applies :hover to it and never clears it
     since there's no real mouse to move away. Without this guard, that
     highlight sticks until the page repaints (e.g. backgrounding the app). */
  @media (hover:hover) and (pointer:fine) {
    /* Every variant lifts its fill a step on hover, the way dark Water always
       did. Light mode used to "hover" to its own resting colour, so nothing
       changed; dark Repot only flipped the check to white. */
    .check-btn:hover{background:#2379a0;color:white;border-color:#2379a0;}
    .dark .check-btn:hover{background:var(--water-ink);color:#0c1a1f;border-color:var(--water-ink);}
    .check-btn.brown:hover{background:#bd5714;color:white;border-color:#bd5714;}
    .dark .check-btn.brown:hover{background:#e08a52;color:#1f0e03;border-color:#e08a52;}
  }

  /* Freq increase button */
  .freq-inc-btn{width:34px;height:34px;border-radius:50%;border:none;background:var(--water-tint);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--water);transition:all .18s;font-size:15px;font-weight:700;font-family:var(--font-ui);}
  .freq-inc-btn:hover{background:var(--water);color:white;}
  .dark .freq-inc-btn{background:rgba(255,255,255,.12);color:var(--water-ink);}
  .dark .freq-inc-btn:hover{background:var(--water-ink);color:#0c1a1f;}
  /* Add days popup, screen 16a: light card, three preset pills, then a
     stepper to nudge the value and a round commit button. */
  .freq-tooltip{position:absolute;bottom:calc(100% + 10px);right:2px;width:252px;background:var(--card-bg);border-radius:16px;padding:12px 13px 13px;box-shadow:var(--shadow-lg);z-index:50;}
  .freq-tooltip::after{content:'';position:absolute;bottom:-4px;right:60px;width:11px;height:11px;background:var(--card-bg);transform:rotate(45deg);border-radius:6px;}
  .freq-tooltip-title{font-size:10px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:var(--water-header-ink-on-light,#17627f);margin-bottom:8px;}
  .dark .freq-tooltip-title{color:#a5cfe3;}
  .freq-presets{display:flex;gap:7px;}
  .freq-opt{flex:1;background:#e6f2f8;border:none;color:#12556e;border-radius:var(--r-pill);padding:9px 0;font-size:13.5px;font-weight:800;cursor:pointer;font-family:var(--font-ui);transition:background .15s,color .15s;}
  .freq-opt.active{background:#17627f;color:#fff;}
  .dark .freq-opt{background:#173f52;color:#a5cfe3;}
  .dark .freq-opt.active{background:#a5cfe3;color:#04212e;}
  .freq-step-row{margin-top:9px;display:flex;align-items:center;gap:8px;}
  .freq-stepper{flex:1;background:#e6f2f8;border-radius:var(--r-pill);padding:3px;display:flex;align-items:center;justify-content:space-between;gap:6px;}
  .dark .freq-stepper{background:#173f52;}
  .freq-step-btn{border:none;width:31px;height:31px;border-radius:var(--r-pill);cursor:pointer;font-size:19px;font-weight:800;line-height:1;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--card-bg);color:#12556e;}
  .freq-step-btn.plus{background:#17627f;color:#fff;}
  .dark .freq-step-btn{background:#0d2b38;color:#a5cfe3;}
  .dark .freq-step-btn.plus{background:#a5cfe3;color:#04212e;}
  .freq-step-val{font-family:var(--font-display);font-weight:400;font-size:16px;line-height:1;color:#12556e;}
  .dark .freq-step-val{color:#a5cfe3;}
  .freq-commit{border:none;background:#17627f;color:#fff;width:37px;height:37px;border-radius:var(--r-pill);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .dark .freq-commit{background:#a5cfe3;color:#04212e;}
  .freq-custom:focus{outline:none;background:rgba(255,255,255,.22);}

  /* Water cards */
  .water-card{background:var(--card-bg);border-radius:var(--r-md);box-shadow:var(--shadow);display:flex;align-items:stretch;overflow:hidden;transition:opacity .24s var(--ease-exit),transform .24s var(--ease-exit);}
  .water-card.leaving{opacity:0;transform:translateX(-108%);}
  .dark .upnext-lbl{color:var(--leaf-light)!important;}

  /* Repot cards */
  .repot-empty-card{background:var(--surface);border-radius:var(--r-lg);box-shadow:var(--shadow-sm);padding:26px 22px 24px;text-align:center;}
  .repot-empty-icon{width:52px;height:52px;border-radius:var(--r-pill);background:var(--potting);color:var(--potting-head);
    display:flex;align-items:center;justify-content:center;margin:0 auto 13px;}
  .repot-empty-head{font-family:var(--font-display);font-weight:400;font-size:19px;line-height:1.2;color:var(--potting-head);}
  .repot-empty-body{margin:8px 0 0;font-size:13px;line-height:1.5;color:#565043;}
  .dark .repot-empty-body{color:var(--text-muted);}
  .repot-card{background:var(--card-bg);border-radius:var(--r-md);box-shadow:var(--shadow);display:flex;align-items:stretch;overflow:hidden;transition:opacity .24s var(--ease-exit),transform .24s var(--ease-exit);}
  /* 7c/14c draw Repot rows larger than Water's (verified by measurement). */
  .repot-card .pc-body{padding:8px 11px 8px 9px;gap:10px;}
  .repot-card .plant-thumb{width:46px;height:46px;}
  .repot-card.leaving{opacity:0;transform:translateX(-108%);}
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
  /* margin (not transform) to center: a transform here would make this the
     containing block for any position:fixed descendant (e.g. the photo
     viewer opened from the plant detail sheet), trapping it at 480px
     instead of the true viewport. */
  /* The element spans the whole viewport so a click in the black margin beside
     the app closes the sheet, but the dimming itself is painted by ::before,
     which stays inside the app column - the margins are meant to hold still at
     black no matter what the app is doing. Keep this on margin rather than a
     transform: a transform here becomes the containing block for any
     position:fixed descendant and traps it at 480px. Centred with auto
     margins: calc(min(100%, var(--col)) / -2) was tried and WebKit applies
     the laptop zoom to it twice, leaving the dim 47px off the column. */
  .modal-overlay{position:fixed;inset:0;background:transparent;z-index:200;display:flex;align-items:flex-end;justify-content:center;}
  .modal-overlay::before{content:'';position:absolute;top:0;bottom:0;left:0;right:0;margin:0 auto;width:100%;max-width:var(--col);background:rgba(0,0,0,.48);animation:veilIn .26s var(--ease-enter) both;pointer-events:none;
    /* --veil-k lightens the dim as a drag pulls the sheet down (set inline
       by the drag); the transition covers the snap back and the slide out. */
    opacity:var(--veil-k,1);transition:opacity .24s var(--ease-enter);}
  .modal-overlay.closing::before{animation:veilOut .22s var(--ease-exit) both;}
  @keyframes sheetFade{ from { opacity:0; } to { opacity:1; } }
  @keyframes sheetFadeOut{ from { opacity:1; } to { opacity:0; } }
  .modal-overlay.ghost{background:transparent;pointer-events:none;z-index:201;}
  .modal-overlay.ghost::before{animation:none;background:transparent;}
  .modal-overlay.ghost > .modal{animation:sheetFadeOut .18s var(--ease-exit) both;}
  .modal-overlay.swap:not(.closing)::before{animation:none;}  /* backdrop is already dark, but must still fade on close */
  .modal-overlay.swap > .modal{animation:sheetFade .15s var(--ease-enter) both;}
  /* The dim is painted by ::before, which is absolutely positioned and would
     otherwise paint over the overlay's statically positioned content and tint
     it. Lift every direct child above it - not just .modal, since overlays
     also carry the notification primer and the room editor. The pseudo-element
     is not matched by the child selector, so it stays underneath. */
  .modal-overlay > *{position:relative;z-index:1;}
  .modal-overlay > .modal{animation:sheetIn .34s var(--ease-enter) backwards;}
  .modal-overlay.closing > .modal{animation:sheetOut .26s var(--ease-exit) both;}
  /* Fade-through swap. Opacity only, never transform: a transformed ancestor
     becomes the containing block for position:fixed descendants, which would
     detach the modal overlays rendered inside these screens from the viewport
     and strand the card below the fold. */
  @keyframes xfadeOut{from{opacity:1;}to{opacity:0;}}
  @keyframes xfadeIn{from{opacity:0;}to{opacity:1;}}
  /* Collapses to the element's real height, so the list closes the gap smoothly
     for the whole duration instead of sitting still and then snapping shut. */
  /* overflow is clipped only while actually collapsing. Left on permanently it
     also clipped the add-days tooltip, which opens upward out of the first
     rows of a group and was being cut off at the group header above it.
     CollapseSlot only pins a height while leaving, so at rest there is nothing
     to contain. */
  .collapse-slot{margin-bottom:4px;
    transition:height .34s var(--ease-collapse) .1s,margin-bottom .34s var(--ease-collapse) .1s;}
  .collapse-slot.leaving{overflow:hidden;}
  .room-hdr-wrap{transition:opacity .24s var(--ease-exit),transform .24s var(--ease-exit);}
  .upnext-day{transition:opacity .22s ease-in;}
  .upnext-day.leaving{opacity:0;}
  .room-hdr-wrap.leaving{opacity:0;transform:translateX(-108%);}
  .collapse-slot.leaving > *{margin-top:0;margin-bottom:0;}
  @keyframes allDoneIn{from{opacity:0;}to{opacity:1;}}
  @keyframes allDoneMark{from{opacity:0;transform:scale(.86);}to{opacity:1;transform:scale(1);}}
  /* Scales the headline in as the mark; waits for the last row to collapse. */
  .celebration.all-done .celebration-head{animation:allDoneMark .3s var(--ease-arrive) .12s backwards;}
  /* Clips the outgoing layer, which is offset upward by the old scroll
     position (top:-swapScrollY) so it stays where it visually was. Without
     this it paints above the crossfade box and over the header, flashing
     the page background there for the length of the fade. Modals inside are
     position:fixed with no transformed ancestor, so they are not clipped. */
  .xfade{position:relative;overflow:hidden;}
  .xfade-out{position:absolute;top:0;left:0;right:0;z-index:1;pointer-events:none;animation:xfadeOut .16s var(--ease-exit) both;}
  /* The incoming screen is NOT faded in. It used to be, with a .06s delay and
     a backwards fill, which pins it at opacity 0 for that whole delay - and
     because the outgoing layer is offset upward by the old scroll position it
     does not cover the top of the content area, so the page background showed
     through under the header for the length of the delay. That was the
     transition flicker. Leaving the incoming opaque underneath and only fading
     the outgoing out on top of it is still a crossfade, and makes a gap
     impossible. It also stops the two layers double-fading into a muddy mix. */
  @media (prefers-reduced-motion: reduce) {
    .modal-overlay::before, .modal-overlay > .modal,
    .modal-overlay.closing::before, .modal-overlay.closing > .modal { animation:none !important; }
    .xfade-out { display:none !important; }
    .header-undo-btn { animation:none !important; }
    .celebration.all-done, .celebration.all-done .celebration-head { animation:none !important; }

    .water-card, .repot-card, .collapse-slot { transition:none !important; }

    /* Everything added during the redesign: the Home wake-up sequence, the
       score bar reveal, the incoming crossfade layer, the toast, the tab pop
       and the celebration drips. Without these the preference is only half
       honoured — the biggest motion on the app's first screen still played. */
    .xfade-in, .wake-header,
    .wake .score-tile, .wake .good-health-lbl, .wake .good-health-pct,
    .wake .score-bar > div,
    .toast, .drip, .nav-btn.active svg,
    .score-tip, .primer-card { animation:none !important; }
    .detail-sheet { transition:none !important; }
  }
  .modal{background:var(--page-bg);border-radius:var(--r-lg) var(--r-lg) 0 0;width:100%;max-width:var(--col);max-height:calc(88vh / var(--zoom) - env(safe-area-inset-top,0px));max-height:calc(88dvh / var(--zoom) - env(safe-area-inset-top,0px));overflow-y:auto;padding:12px 12px 20px;box-shadow:0 26px 0 var(--page-bg);}
  .modal.data-sheet{box-shadow:0 -14px 40px rgba(28,25,20,.32);}
  .data-sheet{background:#f2e6d2;border-radius:var(--r-xl) var(--r-xl) 0 0;padding:15px 16px 20px;
    box-sizing:border-box;display:flex;flex-direction:column;gap:10px;
    box-shadow:0 -14px 40px rgba(28,25,20,.32);}
  .dark .data-sheet{background:#2b2823;}
  .modal{padding-bottom:max(20px,env(safe-area-inset-bottom,20px));}
  @media (max-width:480px){
    /* Health row: span full width when Date Obtained is hidden */
  }
  /* Date inputs: tighten on any phone-sized screen (portrait or landscape) */
  @media (max-width:900px) and (pointer:coarse){
  }
  .modal h2{font-size:20px;font-weight:700;margin-bottom:8px;color:var(--leaf);}
  .dark .modal h2{color:var(--leaf-light);}
  .form-group input.field-error{border-color:var(--danger);background:var(--danger-tint);color:#7a1a1a;}
  .dark .form-group input.field-error{background:#3a1d1d;color:#ff9b9b;}
  /* Input with suffix: input shrinks to content width, suffix sits right next to value */
  .input-suffix-wrap{display:flex;align-items:center;justify-content:center;background:var(--input-bg);border:1.5px solid var(--border);border-radius:var(--r-sm);overflow:hidden;text-align:center;}
  .input-suffix-wrap:focus-within{border-color:var(--leaf-light);}
  .input-suffix-wrap input{border:none!important;outline:none!important;background:transparent;padding:8px 0 8px 4px;font-family:var(--font-ui);font-size:15px;font-weight:600;color:var(--text);width:4ch;min-width:2ch;max-width:5ch;text-align:center;flex-shrink:0;}
  .input-suffix-wrap input::-webkit-outer-spin-button,
  .input-suffix-wrap input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}
  .input-suffix-wrap input[type=number]{-moz-appearance:textfield;}
  .input-suffix{font-size:15px;font-weight:700;color:var(--text-muted);padding:8px 4px 8px 0;flex-shrink:0;}
  .dark .input-suffix{color:var(--text);}
  .health-opt.selected{border-width:2px;}
  .btn{padding:11px 14px;border-radius:var(--r-sm);border:none;cursor:pointer;font-family:var(--font-ui);font-size:15px;font-weight:700;transition:all .15s;}
  .btn-primary{background:var(--primary);color:var(--primary-ink);flex:1;}
  .dark .btn-primary,
  .dark .pm-bottom-btn.save,
  .dark .score-tip-gotit,
  .dark .firstrun-btn.primary{background:var(--primary-btn);color:var(--primary-btn-ink);}
  .btn-primary:hover{filter:brightness(1.08);}
  .btn-secondary{background:var(--sand);color:var(--text);}
  .app:not(.dark) .btn-secondary{background:#cec5b5;}
  .btn-danger{background:var(--danger-tint);color:var(--danger);}
  .app:not(.dark) .btn-danger{background:#f5b8b8;}



  /* Detail */
  .modal.detail-sheet{max-height:calc(96vh / var(--zoom) - env(safe-area-inset-top,0px));max-height:calc(96dvh / var(--zoom) - env(safe-area-inset-top,0px));border-radius:35px;box-shadow:0 26px 0 var(--page-bg), 0 -10px 26px rgba(0,0,0,.40), 0 -28px 68px rgba(0,0,0,.34);}
  .close-x-btn{position:absolute;top:8px;left:8px;background:rgba(255,255,255,.22);border:none;border-radius:50%;width:34px;height:34px;color:white;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;}
  .info-card .val{font-size:17px;font-weight:700;color:var(--leaf);}
  .info-card .key{font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-top:1px;font-weight:500;}

  /* Photo lightbox */
  .lightbox{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:300;display:flex;flex-direction:column;align-items:center;justify-content:center;}
  .lightbox img{max-width:calc(95vw / var(--zoom));max-height:calc(78vh / var(--zoom));max-height:calc(78dvh / var(--zoom));object-fit:contain;border-radius:var(--r-sm);user-select:none;}
  /* Zoom stage: clips the scaled image and owns all pointer gestures */
  .lightbox-stage{position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;touch-action:none;max-width:100%;max-height:100%;border-radius:var(--r-lg);}
  .viewer .lightbox-arrow{display:none;}
  /* Filmstrip: slides one page (fit width + 20px) apart, the track follows
     the finger; neighbours sit just off screen until a swipe brings them in. */
  .viewer{overflow:hidden;}
  .viewer-pager{position:relative;flex:1 1 auto;min-height:0;touch-action:none;}
  .viewer-track{position:absolute;inset:0;will-change:transform;}
  .viewer-slide{position:absolute;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;}
  .lightbox-stage img{display:block;-webkit-user-drag:none;transform-origin:center center;will-change:transform;}
  .lightbox-stage.zoomed{cursor:grab;}
  .lightbox-stage.panning{cursor:grabbing;}
  /* Capture date shown in the black space above the photo */
  .lightbox-date{background:none;border:none;color:rgba(255,255,255,.9);font-family:var(--font-ui);font-size:14px;font-weight:600;letter-spacing:.2px;cursor:pointer;padding:6px 14px;border-radius:var(--r-pill);margin-bottom:10px;transition:background .15s,color .15s;display:flex;align-items:center;gap:6px;}
  .lightbox-date:hover{background:rgba(255,255,255,.14);color:white;}
  .lightbox-date.empty{color:rgba(255,255,255,.45);font-weight:500;font-style:italic;}
  .lightbox-zoom-hint{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.55);color:rgba(255,255,255,.85);font-size:11px;font-weight:600;padding:3px 10px;border-radius:var(--r-pill);pointer-events:none;}
  /* Calendar field (custom, replaces native input[type=date] for reliable
     cross-browser click-to-select behavior — Safari's native picker doesn't
     commit a date until the picker closes, and re-navigates on out-of-month
     day clicks instead of selecting them) */
  .cal-field-btn{width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:var(--r-sm);font-family:var(--font-ui);font-size:15px;background:var(--input-bg);color:var(--text);font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:6px;text-align:left;}
  .cal-field-btn.placeholder{color:var(--text-muted);font-weight:500;}
  .cal-field-btn svg{flex-shrink:0;opacity:.55;}
  .cal-popup-overlay{position:fixed;top:0;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:var(--col);background:rgba(28,25,20,.52);z-index:520;display:flex;align-items:center;justify-content:center;padding:22px;box-sizing:border-box;}
  .cal-popup{background:#f2e6d2;border-radius:var(--r-lg);padding:16px 14px;width:100%;box-shadow:0 18px 50px rgba(28,25,20,.42);}
  .cal-nav{display:flex;align-items:center;gap:10px;margin-bottom:12px;}
  .cal-nav-btn{background:var(--surface);border:none;color:var(--text);cursor:pointer;width:30px;height:30px;border-radius:var(--r-pill);display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-sm);flex-shrink:0;}
  .cal-nav-btn:hover{background:var(--page-bg);}
  .cal-nav-titles{flex:1;text-align:center;}
  .cal-nav-context{font-size:9px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:var(--text-muted);}
  .cal-nav-title{font-family:var(--font-display);font-weight:400;font-size:20px;line-height:1.1;color:var(--text);margin-top:3px;}
  .cal-weekdays{display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:4px;}
  .cal-weekdays span{text-align:center;font-size:10px;font-weight:800;color:#8a8071;text-transform:uppercase;}
  .dark .cal-popup{background:var(--surface);}
  .dark .cal-weekdays span{color:var(--text-muted);}
  /* Light mode stacks these popup < other-month < current-month, lightest last,
     so the current month reads as raised tiles. Dark had it inverted: the popup
     is --surface and .cal-day defaults to --surface too, so the current month
     disappeared into the card, while other-month sat on the lighter --sand and
     was the only thing that looked like a tile. Restore the same ordering. */
  .dark .cal-day{background:#45403a;}
  .dark .cal-day.other-month{background:#232019;box-shadow:none;color:var(--text-muted);}
  .dark .rd-days-left{background:var(--sand);color:var(--text-muted);}
  .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;}
  /* Every cell is a filled tile (13h), not a bare number — current-month
     days sit on the surface colour with a light shadow; other-month days
     use a dimmer, unshadowed fill so they read as outside the month without
     disappearing. */
  .cal-day{height:34px;display:flex;align-items:center;justify-content:center;border:none;background:var(--surface);box-shadow:var(--shadow-sm);border-radius:var(--r-sm);font-family:var(--font-ui);font-size:13px;font-weight:700;color:var(--text);cursor:pointer;}
  .cal-day:hover{background:var(--page-bg);}
  .cal-day.other-month{background:#f7eeda;box-shadow:none;color:#b8ac97;}
  .cal-day.today{box-shadow:var(--shadow-sm),inset 0 0 0 1.5px var(--primary);}
  .cal-day.selected{background:var(--primary);color:var(--primary-ink);box-shadow:var(--shadow-sm);}
  .cal-day.selected:hover{background:var(--primary);}
  /* Import preview + warning boxes.
     These need explicit dark variants: the default --leaf and --bark text
     colours sit almost on top of --leaf-pale and --sand once dark mode swaps
     those backgrounds, which left the text all but unreadable. */
  .imp-summary{background:#e9f7ef;border-radius:var(--r-md);padding:12px 14px;}
  .imp-summary-title{font-family:var(--font-display);font-weight:400;font-size:17px;color:#0a5c34;line-height:1.15;margin-bottom:4px;}
  .imp-summary-names{font-size:12px;color:#3f6b4e;font-weight:600;line-height:1.4;}
  .imp-summary-note{font-size:11px;color:#5d7a68;font-weight:600;margin-top:4px;}
  .dark .imp-summary{background:#0f2419;}
  .dark .imp-summary-title,.dark .imp-summary-names{color:#8ee0ad;}
  .imp-warn{background:#fdeceb;border:1.5px solid #e0483a;border-radius:var(--r-md);padding:11px 13px;max-height:90px;overflow-y:auto;}
  .imp-warn-title{font-size:12.5px;font-weight:800;color:#9b1c1c;margin-bottom:4px;}
  .imp-warn-item{font-size:11.5px;color:#9b1c1c;font-weight:600;line-height:1.45;}
  .dark .imp-warn{background:#000;border-color:#ff6b6b;}
  .dark .imp-warn-title,.dark .imp-warn-item{color:#ff9b9b;}
  .imp-error{font-size:11px;margin-top:8px;line-height:1.5;color:var(--danger);}
  .dark .imp-error{color:#ff9b9b;}
  /* The native time-input's clock icon renders black by default (a browser
     built-in, not something we draw), which disappears against a dark input
     background. Inverting it makes it white in dark mode only. */
  /* Watering schedule PDF preview thumbnail */
  /* util-10a, 19.3 */
  .sched-desc{font-size:12.5px;font-weight:600;line-height:1.5;color:#5d5546;}
  .dark .sched-desc{color:var(--text-muted);}
  .sched-range{display:flex;gap:8px;}
  .sched-date-card{flex:1;background:#fffdf8;border-radius:var(--r-md);box-shadow:var(--shadow-sm);padding:9px 13px 10px;}
  .dark .sched-date-card{background:#3a352d;}
  .sched-date-card .pm-lbl{font-size:9px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:#6f6658;}
  /* buttons don't inherit body line-height, so 1.55 has to be stated. */
  .sched-date-card .cal-field-btn{margin-top:3px;gap:7px;font-size:14px;font-weight:800;line-height:1.55;}
  .sched-date-card .cal-field-btn svg{width:13px;height:13px;}
  .sched-preview{background:#efe6d4;border:1.5px solid #e0d4bd;border-radius:16px;padding:10px;display:flex;align-items:center;justify-content:center;height:150px;}
  .dark .sched-preview{background:#211d19;border-color:#3a352d;}
  .sched-preview svg{width:100%;height:100%;}
  /* Confirm dialog */
  .cfm-overlay{position:fixed;top:0;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:var(--col);background:rgba(0,0,0,.55);z-index:500;display:flex;align-items:center;justify-content:center;padding:22px;box-sizing:border-box;}
  .cfm-card{background:var(--card-bg);border-radius:var(--r-md);padding:18px;width:100%;max-width:340px;box-shadow:0 12px 44px rgba(0,0,0,.42);}
  .cfm-title{font-size:17px;font-weight:800;color:var(--text);margin-bottom:6px;}
  .cfm-msg{font-size:13px;color:var(--text-muted);line-height:1.45;margin-bottom:15px;}
  .cfm-actions{display:flex;flex-direction:column;gap:7px;}
  .cfm-btn{width:100%;padding:11px 12px;border-radius:var(--r-sm);border:1.5px solid var(--border);background:var(--page-bg);color:var(--text);font-family:var(--font-ui);font-size:14px;font-weight:700;cursor:pointer;transition:filter .15s,border-color .15s;}
  .cfm-btn:hover{border-color:var(--border-strong);}
  .cfm-btn.grave{background:#4a5568;border-color:#4a5568;color:white;}
  .cfm-btn.danger{background:var(--danger);border-color:var(--danger);color:white;}
  .cfm-btn.go{background:var(--leaf);border-color:var(--leaf);color:white;}
  .cfm-btn.grave:hover,.cfm-btn.danger:hover,.cfm-btn.go:hover{filter:brightness(1.08);}
  .cfm-btn.cancel{background:none;border-color:transparent;color:var(--text-muted);}
  /* Graveyard / Recently Deleted */
  .util-row.tappable{cursor:pointer;}
  .util-chevron{color:var(--text-muted);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .util-count-badge{background:var(--sand);color:var(--text-muted);font-size:11px;font-weight:800;padding:3px 10px;border-radius:var(--r-pill);}

  .purge-label{color:var(--danger);font-size:10px;font-weight:700;letter-spacing:.2px;white-space:nowrap;}
  .dark .purge-label{color:#ff8080;}
  .died-pill{padding:3px 11px;border-radius:var(--r-pill);font-size:12px;font-weight:700;}
  /* Date picker */
  /* Only ever used inside the (now full-bleed) photo viewer, so this dims
     the whole screen too rather than just the 480px app column. */
  .dp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:400;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;}
  .dp-card{background:var(--card-bg);border-radius:var(--r-md);padding:16px;width:100%;max-width:330px;box-shadow:0 10px 40px rgba(0,0,0,.4);}
  .dp-title{font-size:15px;font-weight:700;color:var(--text);margin-bottom:12px;}
  .dp-fields{display:flex;gap:8px;}
  .dp-field{flex:1;display:flex;flex-direction:column;gap:4px;}
  .dp-field label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--text-muted);}
  .dp-field input,.dp-field select{box-sizing:border-box;width:100%;height:38px;padding:8px 8px;border:1.5px solid var(--border);border-radius:var(--r-sm);font-family:var(--font-ui);font-size:15px;font-weight:600;background:var(--input-bg);color:var(--text);}
  .dp-field select{-webkit-appearance:none;appearance:none;padding-right:24px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23948b7e' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 6px center;background-size:14px 14px;}
  .dp-field.month{flex:1.5;}
  /* Scroll wheels (touch) */
  .dp-wheels{display:flex;gap:8px;position:relative;}
  .dp-wheel{flex:1;height:150px;overflow-y:scroll;overflow-x:hidden;touch-action:pan-y;scroll-snap-type:y mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch;position:relative;z-index:2;}
  .dp-wheel::-webkit-scrollbar{display:none;}
  .dp-wheel.month{flex:1.5;}
  .dp-wheel-item{height:38px;display:flex;align-items:center;justify-content:center;scroll-snap-align:center;font-size:17px;font-weight:600;color:var(--text-muted);transition:color .15s,transform .15s;}
  .dp-wheel-item.sel{color:var(--leaf);font-weight:800;transform:scale(1.08);}
  .dp-wheel-pad{height:56px;}
  .dp-wheel-mask{position:absolute;left:0;right:0;top:56px;height:38px;border-top:1.5px solid var(--border);border-bottom:1.5px solid var(--border);background:var(--page-bg);opacity:.5;border-radius:var(--r-sm);pointer-events:none;z-index:1;}
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
  .photo-row{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;position:relative;user-select:none;}
  .photo-row > *{width:100%!important;height:auto!important;aspect-ratio:1;}
  .photo-row .photo-add{border-radius:var(--r-md);font-size:24px;}
  .photo-thumb-wrap{position:relative;width:68px;height:68px;cursor:pointer;border-radius:var(--r-md);overflow:hidden;transition:transform .15s,box-shadow .15s;user-select:none;-webkit-user-select:none;}
  .photo-thumb-wrap:hover{transform:scale(1.04);box-shadow:0 2px 10px rgba(0,0,0,.22);}
  .photo-thumb{width:68px;height:68px;object-fit:cover;border-radius:var(--r-sm);display:block;pointer-events:none;user-select:none;-webkit-user-select:none;}
  /* 13d full-screen viewer */
  .viewer{position:fixed;inset:0;z-index:600;background:#141310;display:flex;flex-direction:column;}
  .viewer-top{display:flex;align-items:center;justify-content:space-between;padding:calc(14px + env(safe-area-inset-top,0px)) 16px 4px;flex-shrink:0;width:100%;max-width:var(--col);margin:0 auto;box-sizing:border-box;}
  .viewer-close{width:32px;height:32px;border:none;border-radius:var(--r-pill);background:rgba(240,233,220,.14);
    color:#f0e9dc;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;}
  .viewer-top-spacer{width:32px;height:32px;flex-shrink:0;}
  .viewer-mid{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:12px;padding:4px 12px 0;position:relative;}
  .viewer-date{display:inline-flex;align-items:center;gap:6px;border:none;border-radius:var(--r-pill);
    background:rgba(240,233,220,.14);color:#f0e9dc;font-family:var(--font-ui);font-size:12px;font-weight:800;
    padding:6px 14px;cursor:pointer;flex-shrink:0;}
  .viewer-date.placeholder{color:rgba(240,233,220,.6);}
  .viewer-main-badge{position:absolute;left:10px;bottom:10px;background:rgba(15,68,56,.92);color:#f2f0d8;
    font-family:var(--font-ui);font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;
    padding:5px 11px;border-radius:var(--r-pill);pointer-events:none;}
  .viewer-bottom{flex-shrink:0;display:flex;flex-direction:column;gap:11px;padding:16px 16px calc(8px + env(safe-area-inset-bottom,0px));width:100%;max-width:var(--col);margin:0 auto;box-sizing:border-box;}
  .viewer-name{font-family:var(--font-display);font-weight:400;font-size:21px;line-height:1;color:#f0e9dc;}
  .viewer-strip{display:flex;gap:10px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;padding:5px;margin:-5px;}
  .viewer-strip::-webkit-scrollbar{display:none;}
  /* transform:translateZ(0) forces each thumb onto its own compositing
     layer - without it, the ring's box-shadow (which extends past the
     thumb's own box) can leave a ghost behind in Chromium/WebKit when the
     .current class moves to a different thumb inside this scrolling row. */
  .viewer-strip-thumb{width:52px;height:52px;border-radius:var(--r-sm);object-fit:cover;flex-shrink:0;
    opacity:.55;cursor:pointer;transition:opacity .15s;transform:translateZ(0);}
  .viewer-strip-thumb.current{opacity:1;box-shadow:0 0 0 2.5px #141310, 0 0 0 4.5px #f2a13b;}
  .viewer-actions{display:flex;gap:7px;}
  .viewer-setmain{flex:1;background:transparent;border:1.5px solid rgba(240,233,220,.28);color:#f0e9dc;
    font-family:var(--font-ui);font-size:12.5px;font-weight:800;padding:10px 0;border-radius:var(--r-pill);cursor:pointer;}
  .viewer-setmain:disabled{opacity:.5;cursor:default;}
  .viewer-delete{width:44px;flex-shrink:0;background:#4a1f1a;border:none;color:#ffb3a8;
    border-radius:var(--r-pill);display:flex;align-items:center;justify-content:center;cursor:pointer;}
  .photo-menu-btn{position:absolute;top:2px;right:2px;background:rgba(0,0,0,.5);border:none;color:white;border-radius:50%;width:22px;height:22px;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;}
  .photo-menu{position:absolute;top:20px;right:2px;background:#2e2018;border-radius:var(--r-sm);box-shadow:0 3px 12px rgba(0,0,0,.35);z-index:20;display:flex;flex-direction:row;gap:0;overflow:hidden;}
  .photo-menu-action{background:none;border:none;cursor:pointer;padding:7px 10px;display:flex;align-items:center;justify-content:center;transition:background .15s;}
  .photo-menu-action:hover{background:rgba(255,255,255,.12);}
  @media (pointer:coarse) {
    .photo-menu-btn{width:26px;height:26px;font-size:17px;top:3px;right:3px;}
    .photo-menu{border-radius:var(--r-sm);box-shadow:0 4px 20px rgba(0,0,0,.5);}
    .photo-menu-action{padding:13px 18px;}
    .photo-menu-action svg{width:20px;height:20px;}
  }
  /* --sand sits almost on top of --page-bg in light mode, so the dashed slot
     was invisible on the very screen where it is the only way to add a first
     photo. --border-strong is the token meant to actually read as an edge. */
  .photo-add{width:68px;height:68px;border:2px dashed var(--border-strong);border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-muted);font-size:20px;}
  .photo-add:hover{border-color:var(--leaf-light);color:var(--leaf);}

  /* Manage Rooms */
  .color-swatch-btn.selected{border-color:var(--soil);}
  .icon-btn{background:none;border:none;cursor:pointer;font-size:18px;padding:5px;opacity:.5;transition:opacity .2s;}
  .icon-btn:hover{opacity:1;}
  .room-list-item.clickable{cursor:pointer;}
  .room-list-item.clickable:hover{box-shadow:0 2px 8px rgba(60,30,10,.15);}

  /* drag-over highlight */

  .empty{text-align:center;padding:44px 20px;color:var(--text-muted);}
  .empty .ico{font-size:40px;display:block;margin-bottom:10px;}
  .empty p{font-size:13px;}
  /* Dark mode toggle */
  .toggle-switch{position:relative;width:44px;height:26px;flex-shrink:0;}
  .toggle-switch input{opacity:0;width:0;height:0;position:absolute;}
  .toggle-track{position:absolute;inset:0;background:#d8ccb6;border-radius:var(--r-pill);cursor:pointer;transition:background .3s;}
  .toggle-switch input:checked+.toggle-track{background:var(--primary);}
  .dark .toggle-switch input:checked+.toggle-track{background:#5aa8cc;}
  .toggle-thumb{position:absolute;top:3px;left:3px;width:20px;height:20px;background:#fffdf8;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.22);transition:transform .3s;pointer-events:none;}
  .toggle-switch input:checked~.toggle-track .toggle-thumb{transform:translateX(18px);}
  /* Notes */
  .notes-section{background:var(--card-bg);border-radius:var(--r-sm);padding:12px;box-shadow:var(--shadow);}
  .notes-section-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--bark);margin-bottom:7px;}
  .dark .notes-section-label{color:var(--text);}
  .notes-preview{font-size:13px;color:var(--text);line-height:1.45;white-space:pre-wrap;word-break:break-word;}
  .dark .notes-preview{color:var(--text);}
  .notes-add-btn{background:none;border:1.5px dashed var(--border-strong,#b0a898);border-radius:var(--r-sm);padding:7px 12px;width:100%;text-align:left;color:var(--text-muted);font-family:var(--font-ui);font-size:13px;cursor:pointer;}
  .notes-add-btn:hover{border-color:var(--leaf-light);color:var(--leaf);}
  .notes-editor{background:var(--input-bg);border:1.5px solid var(--border);border-radius:var(--r-sm);padding:8px 10px;font-family:var(--font-ui);font-size:13px;color:var(--text);width:100%;min-height:72px;resize:vertical;line-height:1.45;}
  .notes-editor:focus{outline:none;border-color:var(--leaf-light);}
  .notes-editor-actions{display:flex;gap:7px;margin-top:7px;justify-content:flex-end;}
  /* Utilities screen */
  .util-section{background:var(--surface);border-radius:var(--r-md);box-shadow:var(--shadow-sm);margin-bottom:21px;overflow:hidden;}
  /* Divider is inset 14px from each edge (9a), not full-bleed — a plain
     border-bottom would run edge to edge regardless of the row's own
     padding, so this uses a positioned pseudo-element instead. */
  .util-row{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px;}
  /* Rows in the Utils list sit at a uniform height whether or not they carry a
     count badge, which is what was making the badge-less ones read short.
     Scoped to .util-section so the notification capsules stay compact. */
  .util-section .util-row{min-height:48px;}
  .util-row:not(:last-child)::after{content:"";position:absolute;left:14px;right:14px;bottom:0;height:1px;background:var(--border);}
  .util-row:last-child{border-bottom:none;}
  .util-label{font-size:14px;font-weight:700;color:var(--text);}
  .util-sublabel{font-size:11px;color:var(--text-muted);font-weight:600;margin-top:2px;line-height:1.35;}
  .util-btn{background:var(--btn-bg);color:var(--btn-ink);border:1.5px solid var(--btn-border);border-radius:var(--r-pill);padding:7px 17px;font-family:var(--font-ui);font-size:12.5px;font-weight:800;cursor:pointer;min-width:0;text-align:center;}
  .util-btn.secondary{background:var(--btn-bg);color:var(--btn-ink);border:1.5px solid var(--btn-border);}


  /* ── Touch pass ─────────────────────────────────────────────────────────
     The design's controls and type were drawn at mockup scale: on a real
     phone many taps sat under Apple's 44pt minimum and a lot of text under
     11pt. Everything here overrides the rules above on purpose; it is kept
     in one block so it can be read (and tuned) as a whole.

     1. Tap areas. Each small control gets an invisible ::after that grows
        its hit box to at least 44x44 around its centre; what you see does
        not change. (close-x-btn and the photo-strip remove button are
        already absolutely positioned, so they skip position:relative.) */
  .tab-btn, .tab-add-btn, .check-btn, .freq-inc-btn, .hero-accent-btn, .cal-nav-btn,
  .cal-field-btn, .cal-day, .pm-step, .pm-icon-btn, .pm-save-btn, .room-bar-edit, .room-drag,
  .room-edit-cancel, .room-swatch, .seg-tab, .tip-q, .util-btn, .notes-add-btn{position:relative;}
  .tab-btn::after, .tab-add-btn::after, .check-btn::after, .freq-inc-btn::after, .hero-accent-btn::after,
  .cal-nav-btn::after, .cal-field-btn::after, .cal-day::after, .pm-step::after, .pm-icon-btn::after,
  .pm-save-btn::after, .room-bar-edit::after, .room-drag::after, .room-edit-cancel::after,
  .room-swatch::after, .seg-tab::after, .tip-q::after, .util-btn::after, .notes-add-btn::after,
  .close-x-btn::after, .pm-photo-strip-thumb button::after{
    content:"";position:absolute;left:50%;top:50%;width:max(100%,44px);height:max(100%,44px);
    transform:translate(-50%,-50%);}
  /* Text inputs cannot carry ::after; padding outside the text, handed back
     with a matching negative margin, grows the tap box without moving it. */
  .pm-name-input{padding-top:7px;padding-bottom:7px;margin-top:-7px;margin-bottom:-7px;}
  .notif-time-pill input[type="time"]{padding-top:10px;padding-bottom:10px;margin-top:-10px;margin-bottom:-10px;}

  /* 2. Controls that read as tiny get visibly larger too. */
  .tab-btn{padding:10px 16px;min-height:36px;}
  .tab-btn.active{padding:10px 20px;}
  .tab-add-btn{width:40px;height:40px;}
  .check-btn, .freq-inc-btn{width:40px;height:40px;}
  .close-x-btn{width:36px;height:36px;}
  .hero-accent-btn{height:36px;}
  .cal-day{height:40px;}
  .cal-nav-btn{width:36px;height:36px;}
  .pm-step{width:36px;height:36px;}
  .pm-icon-btn{width:36px;height:36px;}
  .room-bar-edit{width:32px;height:32px;}
  .room-swatch{width:32px;height:32px;}
  .seg-tab{min-height:38px;}
  .room-bar{min-height:44px;box-sizing:border-box;}
  .pm-bottom-btn, .score-tip-gotit, .sheet-close-btn, .dashed-cta{min-height:44px;box-sizing:border-box;}
  /* Photo viewer and its date picker, and the confirm dialog's buttons. */
  .btn, .cfm-btn, .viewer-setmain, .viewer-delete{min-height:44px;box-sizing:border-box;}
  .dp-field input, .dp-field select{height:44px;}
  .viewer-close{width:36px;height:36px;}
  .viewer-close, .viewer-date{position:relative;}
  .viewer-close::after, .viewer-date::after{content:"";position:absolute;left:50%;top:50%;
    width:max(100%,44px);height:max(100%,44px);transform:translate(-50%,-50%);}

  /* 3. Type. Nothing under 11px, except small tracked capitals labels,
     which read larger than their size and stop at 10px. */
  .score-tile-lbl, .stat-tile .st-lbl, .pot-size-badge-lbl, .grave-lived-lbl{font-size:10px;}
  .detail-panel-lbl, .pm-lbl, .sched-date-card .pm-lbl, .cal-nav-context, .grave-stat-lbl,
  .auth-field-lbl, .info-card .key{font-size:10px;}
  .good-health-lbl{font-size:11px;}
  .card-status-pill, .card-room-pill, .nav-badge, .pm-got-caption, .detail-hero-room span:last-child,
  .rd-days-left, .purge-label, .dp-field label, .freq-tooltip-title, .cal-weekdays span,
  .pm-photo-strip-thumb button{font-size:11px;}
  .room-count, .room-header.colored .room-count, .room-chip-preview span:last-child{font-size:12px;}
  .list-footnote{font-size:12px;}
`;

// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [mode, setMode]       = useState("login"); // "login" | "signup" | "reset"
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]     = useState("");
  const [info, setInfo]       = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleEmail(e) {
    e.preventDefault();
    setError(""); setInfo("");
    // Reset mode has no password field at all — requiring one made the
    // reset flow permanently unreachable; every submission failed validation
    // before the Supabase call was ever made.
    if (mode === "reset") {
      if (!email) { setError("Please enter your email."); return; }
    } else if (!email || !password) {
      setError("Please enter your email and password."); return;
    }
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
        setResetSent(true);
      }
    } catch(err) {
      const m = String(err && err.message || "");
      setError(/invalid login credentials/i.test(m)
        ? "That password does not match this email"
        : (m || "Something went wrong."));
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

  // Wrong-password style errors belong under the password field itself
  // (20d) rather than in a banner; anything else (network issues, signup
  // conflicts) still uses the banner, since there is no single field to
  // pin it to.
  const passwordError = mode==="login" && error && /password|credential/i.test(error) ? error : null;
  const bannerError = error && !passwordError ? error : null;

  // 20b: a dedicated confirmation screen once the reset email is away,
  // rather than silently dropping back into the login form.
  if (mode==="reset" && resetSent) {
    return (
      <div className="auth-screen">
        <div className="auth-statusbar"/>
        <div className="auth-content auth-center">
          <button type="button" className="auth-back-btn auth-back-fixed" onClick={()=>{setMode("login");setResetSent(false);setError("");setInfo("");}}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <div className="auth-icon-circle">
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M3 7l9 6 9-6"/></svg>
          </div>
          <div className="auth-big-title" style={{marginTop:22,fontSize:30}}>Check your email</div>
          <div className="auth-tagline" style={{marginTop:11}}>We sent a reset link to <strong style={{color:"var(--primary-ink)"}}>{email}</strong>. It expires in an hour.</div>
          <button type="button" className="auth-outline-btn" onClick={()=>{ if (window.location) window.location.href = "mailto:"; }}>Open mail app</button>
          <div className="auth-footer" style={{marginTop:18,paddingTop:0}}>
            No email yet? <button type="button" className="auth-link strong" onClick={()=>{setResetSent(false);}}>Send it again</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-statusbar"/>
      <div className="auth-content">
        {mode==="reset" ? (
          /* 20a: reset gets its own header — a back arrow and a big
             headline, not the main lockup. */
          <>
            <div style={{height:26}}/>
            <button type="button" className="auth-back-btn" onClick={()=>{setMode("login");setError("");setInfo("");}}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <div className="auth-big-title">Reset your password</div>
            <div className="auth-tagline">Tell us the email on your account and we will send a link to set a new password.</div>
            <div style={{height:26}}/>
          </>
        ) : (
          <>
            <div className="auth-spacer"/>
            <div className="auth-lockup">
              <div className="auth-wordmark">Plantalog</div>
              <img className="auth-mark" src="logo-mark.png" alt="" onError={e=>{e.target.style.display="none";}}/>
            </div>
            {mode==="login" && <div className="auth-tagline one-line">Tracking your green family, made simple.</div>}
            {mode==="signup" && <div className="auth-tagline">One place for every plant you love.</div>}
            <div className="auth-gap"/>
          </>
        )}

        {info && <div className="auth-banner info">{info}</div>}
        {bannerError && <div className="auth-banner error">{bannerError}</div>}

        <form onSubmit={e=>{e.preventDefault();handleEmail(e);}} className="auth-fields">
          <div className="auth-field">
            <div className="auth-field-lbl">Email</div>
            <input className="auth-field-input" value={email} onChange={e=>setEmail(e.target.value)}
              type="email" placeholder="you@example.com" autoComplete="email"/>
          </div>
          {mode !== "reset" && (
            <div className="auth-field">
              <div className={`auth-field-lbl${passwordError?" error":""}`}>Password</div>
              <input className={`auth-field-input${passwordError?" error":""}`} value={password} onChange={e=>setPassword(e.target.value)}
                type="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
                autoComplete={mode==="signup"?"new-password":"current-password"}/>
              {passwordError && (
                <div className="auth-field-error">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>
                  {passwordError}
                </div>
              )}
            </div>
          )}
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? "..." : mode==="login" ? "Sign in" : mode==="signup" ? "Create account" : "Send reset link"}
          </button>
        </form>

        {mode==="login" && (
          <div className="auth-link-row">
            <button type="button" className="auth-link" onClick={()=>{setMode("reset");setError("");setInfo("");setResetSent(false);}}>Forgot your password?</button>
          </div>
        )}

        <div className="auth-footer">
          {mode==="signup" && <div className="auth-terms">By creating an account you agree to the terms and privacy policy.</div>}
          {mode==="login" && <>New here? <button type="button" className="auth-link strong" onClick={()=>{setMode("signup");setError("");setInfo("");}}>Create account</button></>}
          {mode==="signup" && <>Already have an account? <button type="button" className="auth-link strong" onClick={()=>{setMode("login");setError("");setInfo("");}}>Sign in</button></>}
          {mode==="reset" && <>Remembered it? <button type="button" className="auth-link strong" onClick={()=>{setMode("login");setError("");setInfo("");}}>Sign in</button></>}
        </div>
      </div>
    </div>
  );
}

// Reached only via a Supabase password-recovery session (20c). Live mismatch
// check; the submit button stays visibly disabled until both fields are at
// least 8 characters and match, exactly as the concept specifies rather than
// letting the person submit and then telling them it failed.
function SetNewPasswordScreen({ onDone, onCancel }) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [touched2, setTouched2] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const tooShort = pw1.length > 0 && pw1.length < 8;
  const mismatch = touched2 && pw2.length > 0 && pw1 !== pw2;
  const ready = pw1.length >= 8 && pw1 === pw2;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!ready || loading) return;
    setError(""); setLoading(true);
    try {
      const sb = await initSupabase();
      const { error: err } = await sb.auth.updateUser({ password: pw1 });
      if (err) throw err;
      onDone();
    } catch (err) {
      setError(err.message || "Could not update your password. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-statusbar"/>
      <div className="auth-content">
        <div style={{height:26}}/>
        <button type="button" className="auth-back-btn" onClick={onCancel} title="Cancel and sign out">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div className="auth-big-title">Set a new password</div>
        <div style={{height:26}}/>

        {error && <div className="auth-banner error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-fields">
          <div className="auth-field">
            <div className="auth-field-lbl">New password</div>
            <input className="auth-field-input" value={pw1} onChange={e=>setPw1(e.target.value)}
              type="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;" autoComplete="new-password" autoFocus/>
            {tooShort && (
              <div className="auth-field-error">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>
                At least 8 characters
              </div>
            )}
          </div>
          <div className="auth-field">
            <div className={`auth-field-lbl${mismatch?" error":""}`}>Confirm password</div>
            <input className={`auth-field-input${mismatch?" error":""}`} value={pw2}
              onChange={e=>setPw2(e.target.value)} onBlur={()=>setTouched2(true)}
              type="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;" autoComplete="new-password"/>
            {mismatch && (
              <div className="auth-field-error">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>
                Passwords do not match yet
              </div>
            )}
          </div>
          <button type="submit" className={`auth-submit${ready?"":" disabled"}`} disabled={!ready || loading}>
            {loading ? "..." : "Save and sign in"}
          </button>
        </form>

        <div className="auth-footer" style={{marginTop:14,paddingTop:0,textAlign:"left"}}>
          At least 8 characters. The button wakes up when both match.
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const [screen,  setScreen]  = useState("home");
  const [utilsSub, setUtilsSub] = useState(null); // "graveyard" | "deleted" | null, lifted so Nav can reset it
  // Where the Utilities menu was scrolled when a sub-screen (Graveyard,
  // Recently Deleted, Notifications) opened. Tapping Utils from that
  // sub-screen returns to it; leaving for any other screen discards it.
  const utilsMenuScroll = useRef(null);
  const utilsRestore    = useRef(null);
  function openUtilsSub(name) {
    if (name && utilsSub == null) utilsMenuScroll.current = window.scrollY || 0;
    setUtilsSub(name);
    // A sub-screen starts at its own top, not at the menu's offset.
    if (name) window.scrollTo({ top: 0, behavior: "instant" });
  }
  function backToUtilsMenu() {
    if (screen === "utils" && utilsSub != null) utilsRestore.current = utilsMenuScroll.current ?? 0;
    utilsMenuScroll.current = null;
    setUtilsSub(null);
  }
  useEffect(() => { if (screen !== "utils") utilsMenuScroll.current = null; }, [screen]);
  // Layout effect: the menu is in the DOM (so the page is tall enough) but
  // not yet painted, so there is no frame at the sub-screen's offset.
  useLayoutEffect(() => {
    if (utilsSub == null && utilsRestore.current != null) {
      window.scrollTo({ top: utilsRestore.current, behavior: "instant" });
      utilsRestore.current = null;
    }
  }, [utilsSub]);
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
  // §6.4: deleting is reversible, so it reports rather than asks. §6.7:
  // offline and sync failure are strips above the list, never dialogs —
  // neither blocks logging, because a plant is thirsty regardless.
  const [toast, setToast] = useState(null);      // {msg, onUndo}
  const toastTimer = useRef(null);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  function showToast(msg, onUndo) {
    clearTimeout(toastTimer.current);
    setToast({ msg, onUndo });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }
  const [isOffline, setIsOffline] = useState(typeof navigator!=="undefined" && navigator.onLine===false);
  useEffect(() => {
    const on = () => setIsOffline(false), off = () => setIsOffline(true);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  const [syncFailCount, setSyncFailCount] = useState(0);
  // §5: the primer fires before the OS prompt, because the OS prompt is
  // one-shot and a "no" is permanent.
  const [showPrimer, setShowPrimer] = useState(false);
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
  const [darkMode,   setDarkMode]   = useState(false);
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
  // True only while the person arrived via a password-reset email link.
  // Supabase signs them into a real session for this (so updateUser works),
  // but that session must not be treated as a normal login — it should show
  // the set-new-password screen and nothing else until they've done that.
  const [passwordRecovery, setPasswordRecovery] = useState(false);
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
        if (_event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
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
        // Real users keep whatever they last chose. The preview deliberately
        // ignores a stored dark-mode preference so it always opens light —
        // otherwise a single toggle while evaluating the design sticks in the
        // browser and every later preview opens dark for no obvious reason.
        // Toggling still works normally within a preview session.
        if (dm  !== null && !PREVIEW_MODE) setDarkMode(dm);
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
          setPlants(plantsWithPhotos.map(withSortedPhotos));
          if (!sbRooms)  await sbSaveRooms(user.id, DEFAULT_ROOMS);
          if (!sbPlants) await sbSavePlants(user.id, DEFAULT_PLANTS);

          // Migrate any remaining IndexedDB photos to Supabase in the background
          const photoMap = await loadAllPhotos();
          if (photoMap && Object.keys(photoMap).length > 0) {
            migratePhotosToSupabase(user.id, plantsWithPhotos, setPlants);
          }
        } else {
          // Preview mode is a fixed design fixture: never read stored data,
          // or the seeded photos are lost the moment the app saves back.
          const r = PREVIEW_MODE ? null : await loadData("pt_rooms");
          const p = PREVIEW_MODE ? null : await loadData("pt_plants");
          const photoMap = await loadAllPhotos();
          const rooms  = r || SEED_ROOMS;
          const plants = (p || SEED_PLANTS).map(plant => {
            const stored = photoMap[plant.id];
            if (!stored || !(stored.photos || []).length) return plant;
            return {...plant, photos: stored.photos, primaryPhoto: stored.primaryPhoto};
          });
          setRooms(rooms);
          setPlants(plants.map(withSortedPhotos));
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
    if (!loaded) return;
    saveData("pt_showcardphotos", showCardPhotos);
    if (!PREVIEW_MODE && user) sbSaveSettings(user.id, { dark_mode: darkMode, show_photos: showCardPhotos });
  }, [showCardPhotos, loaded]);
  useEffect(() => { if (loaded) saveData("pt_notif_water_enabled", notifWaterEnabled); }, [notifWaterEnabled, loaded]);

  // The primer is shown once, only after there is something worth being
  // notified about, and never again once answered either way — a "no" here
  // should be as durable as the OS one it stands in for.
  useEffect(() => {
    if (!loaded || PREVIEW_MODE) return;
    if (notifWaterEnabled || notifRepotEnabled) return;
    if (!plants || plants.length === 0) return;
    let cancelled = false;
    (async () => {
      const asked = await loadData("pt_notif_primer_asked");
      if (!cancelled && !asked) setShowPrimer(true);
    })();
    return () => { cancelled = true; };
  }, [loaded, plants ? plants.length : 0]);

  function answerPrimer(turnOn) {
    saveData("pt_notif_primer_asked", true);
    setShowPrimer(false);
    if (turnOn) { setNotifWaterEnabled(true); setScreen("utils"); setUtilsSub("notifications"); }
  }
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

  // Live "N waterings across M rooms" line (10a) — reuses the same schedule
  // builder the PDF itself uses, so the preview and the document can never
  // disagree about what a range will actually contain.
  const schedPreviewCounts = React.useMemo(() => {
    if (!schedRangeValid) return null;
    const sched = buildWateringSchedule(plants, rooms, schedFrom, schedTo);
    const roomIds = new Set();
    let occurrences = 0;
    sched.forEach(day => day.rooms.forEach(g => {
      occurrences += g.plants.length;
      roomIds.add(g.room.id);
    }));
    return { occurrences, rooms: roomIds.size };
  }, [schedRangeValid, schedFrom, schedTo, plants, rooms]);

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

  // Fade the boot splash out the moment there is a real screen to show: the
  // login (or password reset) screen, or the app once its data has loaded.
  const bootReady = authLoaded && (loaded || (!PREVIEW_MODE && (!user || passwordRecovery)));
  useLayoutEffect(() => {
    if (!bootReady) return;
    const el = document.getElementById("boot-splash");
    if (!el || el.classList.contains("done")) return;
    el.classList.add("done");
    setTimeout(() => { el.remove(); document.documentElement.classList.add("booted"); }, 260);
  }, [bootReady]);

  // What a rubber-band scroll shows is the page's background colour: iOS
  // paints the overscroll with it and ignores anything positioned above or
  // below the page. One colour cannot serve both ends, so it switches at the
  // half-way mark, where the page covers it: header colour in the top half,
  // app ground in the bottom half. (Switching at the very top edge left the
  // ground on screen for the first frame of a stretch.) theme-color follows
  // the header for Safari's own chrome.
  function paintOverscroll() {
    const root = document.documentElement;
    const hdr = document.querySelector(".page-header, .auth-screen");
    const app = document.querySelector(".app");
    const top = hdr ? getComputedStyle(hdr).backgroundColor : "";
    const ground = app ? getComputedStyle(app).backgroundColor : "";
    // The header's colour, for anything that has to sit opaquely on it (the
    // Undo button). Set everywhere; the overscroll colours below are phones.
    if (top && root.style.getPropertyValue("--hdr-bg") !== top) root.style.setProperty("--hdr-bg", top);
    if (!window.matchMedia || !matchMedia("(pointer: coarse)").matches) return;
    const maxScroll = root.scrollHeight - window.innerHeight;
    const want = ((maxScroll <= 0 || window.scrollY < maxScroll / 2) && top) ? top : ground;
    if (want && document.body.style.backgroundColor !== want) {
      root.style.backgroundColor = want;
      document.body.style.backgroundColor = want;
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && top && meta.getAttribute("content") !== top) meta.setAttribute("content", top);
  }
  // On every render as well as on scroll: a tab change swaps the header (and
  // its colour) without scrolling, and pulling down right after showed the
  // previous screen's colour until the next scroll event.
  useLayoutEffect(() => { paintOverscroll(); });
  useEffect(() => {
    let raf = 0;
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paintOverscroll(); }); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(raf); };
  }, []);

  // Still starting up: render nothing; index.html's boot splash covers the
  // screen until useLayoutEffect above hides it.
  if (!authLoaded) return null;

  // A recovery link signs the person into a real session so updateUser can
  // work, but that session must never be treated as a normal login — this
  // check sits ahead of the login gate so it wins even though `user` is set.
  if (!PREVIEW_MODE && passwordRecovery) return (<><style>{styles}</style>
    <SetNewPasswordScreen
      onDone={() => setPasswordRecovery(false)}
      onCancel={async () => { await handleSignOut(); setPasswordRecovery(false); }}
    /></>);

  // Show login screen if not authenticated (skipped in preview mode).
  // The stylesheet is injected further below in the main render, which these
  // early returns skip entirely — so each one carries its own copy. Without
  // this, a logged-out visitor gets a login screen with no CSS at all: every
  // className on it resolves to nothing, since the <style> tag that defines
  // them was never added to the document.
  if (!PREVIEW_MODE && !user) return (<><style>{styles}</style><LoginScreen onLogin={u => { setUser(u); setScreen("home"); }} /></>);

  // Show loading spinner while data loads after login
  if (!loaded) return <style>{styles}</style>;

  return (
    <>
      <style>{styles}</style>
      <div className={`app${darkMode?" dark":""}`}>
        {/* Sync status indicator */}
        {syncStatus==="saving" && <div className="sync-flag quiet" style={{color:"rgba(255,255,255,0.6)"}}>Syncing…</div>}
        {syncStatus==="saved"  && <div className="sync-flag quiet" style={{color:"rgba(74,222,128,0.8)"}}>✓ Saved</div>}
        {syncStatus==="error"  && <div className="sync-flag" style={{color:"rgba(252,129,129,0.9)"}}>⚠ Sync error</div>}

        {/* Rendered outside CrossFade, keyed directly on `screen` (not the
            crossfaded shownScreen), so it switches instantly instead of
            cross-dissolving. Each screen's header used to be its own solid
            colour (green/teal/brown/charcoal), and opacity-blending two of
            those together during a tab switch produced a muddy flash - this
            is only avoidable by not animating the header's opacity at all. */}
        {(() => {
          // Water, Repot and Utilities carry just their title (no subtitle), so
          // every main header's title sits on the same line as Home's.
          if (screen === "home") return (
            <div className="page-header green">
              <div className="hdr-lockup">
                <h1>Plantalog</h1>
                <img className="hdr-mark" src="logo-mark.png" alt="" onError={e=>{e.target.style.display="none";}}/>
              </div>
            </div>
          );
          if (screen === "water") return (
            <div className="page-header teal">
              <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:8}}>
                <div style={{minWidth:0}}>
                  <HdrTitle>Water</HdrTitle>
                </div>
                {canUndo && (
                  <button className="header-undo-btn" onClick={performUndo}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M4 9h10a6 6 0 1 1 0 12h-3"/></svg>
                    Undo
                  </button>
                )}
              </div>
            </div>
          );
          if (screen === "repot") return (
            <div className="page-header brown">
              <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:8}}>
                <div style={{minWidth:0}}>
                  <HdrTitle>Repot</HdrTitle>
                </div>
                {canUndo && (
                  <button className="header-undo-btn" onClick={performUndo}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M4 9h10a6 6 0 1 1 0 12h-3"/></svg>
                    Undo
                  </button>
                )}
              </div>
            </div>
          );
          // Utils' own sub-screens (Graveyard, Recently Deleted, Notifications)
          // render their own header inline, unchanged - this only covers the
          // main Utilities view.
          if (screen === "utils" && utilsSub == null) return (
            <div className="page-header charcoal">
              <HdrTitle>Utilities</HdrTitle>
            </div>
          );
          return null;
        })()}

        <CrossFade value={screen} offsetFromScroll onSwapped={()=>window.scrollTo({top:0,behavior:"instant"})}>{shownScreen => (<>
        {shownScreen==="home"  && <HomeScreen  rooms={rooms} setRooms={setRooms} plants={livePlants} setPlants={setPlants} todayDate={todayDate} showCardPhotos={showCardPhotos} user={user}
          onDeleted={(name,undo)=>showToast(`${name} moved to Recently Deleted`, undo)}
          strips={(isOffline || syncFailCount > 0) ? <>
            {isOffline && (
              <div className="status-strip offline">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3l18 18"/><path d="M9.5 6.2A5.5 5.5 0 0 1 18 10.5a3.8 3.8 0 0 1 2.6 6"/><path d="M16.5 19H7a4 4 0 0 1-.9-7.9"/>
                </svg>
                <div style={{minWidth:0}}>
                  <div className="strip-head">You are offline</div>
                  <div className="strip-sub">Waterings you log now will sync when you are back.</div>
                </div>
              </div>
            )}
            {syncFailCount > 0 && (
              <div className="status-strip syncfail">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 8v5"/><path d="M12 16.5v.01"/><path d="M10.3 3.9 2.4 17.6A1.9 1.9 0 0 0 4 20.5h16a1.9 1.9 0 0 0 1.6-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z"/>
                </svg>
                <div style={{minWidth:0}}>
                  <div className="strip-head">{syncFailCount} watering{syncFailCount!==1?"s":""} did not sync</div>
                  <div className="strip-sub">They are saved on this phone.</div>
                </div>
                <button className="strip-retry" onClick={()=>setSyncFailCount(0)}>Retry</button>
              </div>
            )}
          </> : null} />}
        {shownScreen==="water" && <WaterScreen rooms={rooms} plants={livePlants} setPlants={setPlants} todayDate={todayDate} showCardPhotos={showCardPhotos} user={user} pushUndo={pushUndo} />}
        {shownScreen==="repot" && <RepotScreen rooms={rooms} plants={livePlants} setPlants={setPlants} todayDate={todayDate} showCardPhotos={showCardPhotos} user={user} pushUndo={pushUndo} />}
        {shownScreen==="utils" && <UtilitiesScreen darkMode={darkMode} setDarkMode={setDarkMode} showCardPhotos={showCardPhotos} setShowCardPhotos={setShowCardPhotos} onOpenExport={()=>setShowExport(true)} onImport={()=>setShowImport(true)} onOpenSchedule={()=>setShowSchedule(true)} user={user || (PREVIEW_MODE ? {email:"preview@plantalog.app"} : null)} onSignOut={handleSignOut} onDeleteAccount={handleDeleteAccount} rooms={rooms} plants={plants} setPlants={setPlants} sub={utilsSub} setSub={openUtilsSub}
          notifWaterEnabled={notifWaterEnabled} setNotifWaterEnabled={setNotifWaterEnabled} notifWaterTime={notifWaterTime} setNotifWaterTime={setNotifWaterTime}
          notifRepotEnabled={notifRepotEnabled} setNotifRepotEnabled={setNotifRepotEnabled} notifRepotTime={notifRepotTime} setNotifRepotTime={setNotifRepotTime} />}
        </>)}</CrossFade>
        {/* Toast — reports a reversible action, never asks (§6.4) */}
        {toast && (
          <div className="toast" role="status">
            <span style={{flex:1,minWidth:0}}>{toast.msg}</span>
            {toast.onUndo && (
              <button className="toast-undo" onClick={()=>{ toast.onUndo(); setToast(null); }}>Undo</button>
            )}
          </div>
        )}

        {/* Notification primer — asked before the OS prompt, since that one
            is one-shot and a no is permanent (§5) */}
        {showPrimer && (
          <div className="modal-overlay" style={{alignItems:"center"}} onClick={()=>answerPrimer(false)}>
            <div className="primer-card" onClick={e=>e.stopPropagation()}>
              <div className="primer-icon">🔔</div>
              <div className="primer-head">Plantalog remembers so you don't have to</div>
              <div className="primer-body">
                Want Plantalog to tell you when you have plants due for water or a new pot?
                You can change notification timing or turn them off any time in Utilities.
              </div>
              <button className="btn btn-primary" style={{width:"100%"}}
                onClick={()=>answerPrimer(true)}>
                Turn on notifications
              </button>
              <button className="primer-not-now" onClick={()=>answerPrimer(false)}>Not now</button>
            </div>
          </div>
        )}

        <Nav screen={screen} setScreen={setScreen} plants={livePlants} todayDate={todayDate} onUtilsClick={backToUtilsMenu} />

        {/* Import modal — inside .app so dark class applies */}
        {showImport && (
        <div className={`modal-overlay${closingSheet==="import"?" closing":""}`} onClick={()=>dismissSheet("import", closeImport)}>
          <div className="modal data-sheet" onClick={e=>e.stopPropagation()}>
            <span className="data-sheet-handle"/>
            <div className="data-sheet-title">Import Plants</div>

            {/* Tabs (10c) */}
            <div className="seg-tabs">
              {[["xls","XLS"],["json","JSON"]].map(([id,label])=>(
                <button key={id} className={`seg-tab${importTab===id?" active":""}`}
                  onClick={()=>{setImportTab(id);setImportError("");setXlsPreview(null);setJsonPreview(null);}}>{label}</button>
              ))}
            </div>

            {/* Both tabs are laid out in the same grid cell and the inactive
                one is only hidden, so the card is always as tall as the taller
                tab and never jumps on a switch. A fixed min-height (325, the
                XLS tab measured at 480px) did this until the column narrowed:
                at 390px the XLS copy wraps taller and the card shrank again. */}
            <div className="imp-stack">

            <div className={`imp-pane${importTab==="xls"?"":" off"}`} aria-hidden={importTab!=="xls"}>
            {/* ── Excel tab ── */}
            {!xlsPreview && (
              <>
                <p style={{fontSize:"12.5px",color:"var(--bark-light)",fontWeight:600,marginBottom:8,lineHeight:1.5}}>
                  Download and complete the blank template to add a batch of new plants. If you have an export with plant updates, import the file here to save those updates in bulk.
                </p>
                <p style={{fontSize:"12.5px",color:"var(--bark-light)",fontWeight:600,marginBottom:12,lineHeight:1.5}}>
                  Rows with an ID update that plant. Rows without one are added as a new plant. Photos are never affected. Make sure to check the import tool's summary and warnings before importing.
                </p>
                <button className="dashed-cta" onClick={exportXlsTemplate} disabled={!excelJsReady} style={{marginBottom:10,opacity:excelJsReady?1:0.6}}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download Template (.xlsx)
                </button>
                <div className="then-divider">then</div>
                <label className="file-drop-label" style={{marginTop:10,opacity:xlsxReady?1:0.6,cursor:xlsxReady?"pointer":"default"}}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  {xlsLoading ? "Reading file…" : "Tap to choose your XLS file"}
                  <input type="file" style={{display:"none"}} disabled={!xlsxReady} onChange={handleXlsFile}/>
                </label>
                {importTab==="xls" && importError && <div className="imp-error">{importError}</div>}
              </>
            )}

            {/* ── Excel preview / confirm ── */}
            {xlsPreview && (()=>{
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
                  <button className="sheet-close-btn" onClick={()=>setXlsPreview(null)} style={{flex:"none",padding:"0 20px",width:"auto"}}>&larr; Back</button>
                  <button className="pm-bottom-btn save" onClick={confirmXlsImport} style={{flex:1}}
                    disabled={xlsPreview.toAdd.length===0 && changedUpdates.length===0}>Import</button>
                </div>
              </>
              );
            })()}

            {!xlsPreview && (
              <div style={{marginTop:14}}>
                <button className="sheet-close-btn" onClick={()=>dismissSheet("import", closeImport)}>Cancel</button>
              </div>
            )}
            </div>

            <div className={`imp-pane imp-json${importTab==="json"?"":" off"}`} aria-hidden={importTab!=="json"}>
            {/* ── JSON tab: file picker ── */}
            {!jsonPreview && (
              <>
                <p style={{fontSize:"12.5px",color:"var(--bark-light)",fontWeight:600,marginBottom:12,lineHeight:1.5}}>Restore from a previously exported backup of your plant data.</p>
                <label className="file-drop-label">
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
                {importTab==="json" && importError && <div className="imp-error">{importError}</div>}
                <div className="imp-json-actions">
                  <button className="pm-bottom-btn save" onClick={checkJsonImport} style={{opacity:importText?1:0.5,pointerEvents:importText?"auto":"none"}}>Check Import</button>
                  <button className="sheet-close-btn" onClick={()=>dismissSheet("import", closeImport)}>Cancel</button>
                </div>
              </>
            )}

            {/* ── JSON tab: preview / confirm ── */}
            {jsonPreview && (()=>{
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
                  <button className="sheet-close-btn" onClick={()=>setJsonPreview(null)} style={{flex:"none",padding:"0 20px",width:"auto"}}>&larr; Back</button>
                  <button className="pm-bottom-btn save" onClick={confirmJsonImport} style={{flex:1}}
                    disabled={jsonPreview.toAdd.length===0 && changedUpdates.length===0}>Restore</button>
                </div>
              </>
              );
            })()}
            </div>

            </div>{/* end imp-stack */}
          </div>
        </div>
        )}

        {/* ── Export modal — same card/tab styling as Import ── */}
        {showExport && (
        <div className={`modal-overlay${closingSheet==="export"?" closing":""}`} onClick={()=>dismissSheet("export", ()=>setShowExport(false))}>
          <div className="modal data-sheet" onClick={e=>e.stopPropagation()}>
            <span className="data-sheet-handle"/>
            <div className="data-sheet-title">Export Plants</div>

            {/* Tabs (10b) */}
            <div className="seg-tabs">
              {[["xls","XLS"],["json","JSON"]].map(([id,label])=>(
                <button key={id} className={`seg-tab${exportTab===id?" active":""}`} onClick={()=>setExportTab(id)}>{label}</button>
              ))}
            </div>

            {/* Tab content — fixed min-height to match Import's card sizing */}
            <div style={{minHeight:190}}>

            {/* ── Excel tab ── */}
            {exportTab==="xls" && (
              <>
                <p style={{fontSize:"12.5px",color:"var(--bark-light)",fontWeight:600,marginBottom:14,lineHeight:1.5}}>
                  All of your plant data in a nice lookin' spreadsheet. You can make edits to your plants and import them back in to make bulk updates. For example, to change your plant rooms after a move. It's also yours to keep if you ever stop using Plantalog.
                </p>
                <button className="dashed-cta" onClick={exportXlsx} disabled={!excelJsReady} style={{opacity:excelJsReady?1:0.6}}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download Plants (.xlsx)
                </button>
              </>
            )}

            {/* ── JSON tab ── */}
            {exportTab==="json" && (
              <>
                <p style={{fontSize:"12.5px",color:"var(--bark-light)",fontWeight:600,marginBottom:14,lineHeight:1.5}}>
                  A complete backup of your plant data, including photos. A safety net in case anything ever goes wrong.
                </p>
                <button className="dashed-cta" onClick={exportData}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download Backup (.json)
                </button>
              </>
            )}

            <div style={{marginTop:14}}>
              <button className="sheet-close-btn" onClick={()=>dismissSheet("export", ()=>setShowExport(false))}>Close</button>
            </div>

            </div>{/* end fixed-height tab content */}
          </div>
        </div>
        )}

        {/* ── OOT Water Schedule modal ── */}
        {showSchedule && (
        <div className={`modal-overlay${closingSheet==="schedule"?" closing":""}`} onClick={()=>dismissSheet("schedule", ()=>setShowSchedule(false))}>
          <div className="modal data-sheet" onClick={e=>e.stopPropagation()}>
            <span className="data-sheet-handle"/>
            <div className="data-sheet-title">OOT Water Schedule</div>

            {/* util-10a: the finished artwork, verbatim. Same in both modes —
                only the surrounding box (.sched-preview) changes for dark. */}
            <div className="sched-preview">
              <svg viewBox="0 0 200 116" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
<rect x="58.5" y="3.5" width="86" height="112" rx="2" fill="#000" opacity=".07"></rect>
              <rect x="57" y="2" width="86" height="112" rx="2" fill="#fffdf8" stroke="#ddd0b8" strokeWidth=".8"></rect>
              <rect x="63" y="8" width="46" height="5.5" rx="2" fill="#2d6a4f"></rect>
              <rect x="63" y="16.5" width="26" height="2.4" rx="1.2" fill="#b9ae9b"></rect>
              <line x1="63" y1="22" x2="137" y2="22" stroke="#ddd0b8" strokeWidth=".8"></line>

              <rect x="63" y="26" width="30" height="3.4" rx="1.4" fill="#241d18"></rect>
              <rect x="125" y="26.5" width="12" height="2.4" rx="1.2" fill="#b9ae9b"></rect>
              <line x1="63" y1="32.5" x2="137" y2="32.5" stroke="#e6dbc7" strokeWidth=".6"></line>
              <rect x="63" y="35.5" width="74" height="5" rx="2" fill="#f2a13b"></rect><rect x="66" y="37.1" width="16" height="2" rx="1" fill="rgba(255,255,255,.85)"></rect>
              <rect x="63.0" y="43.5" width="18.7" height="2" rx="1" fill="#3a332a"></rect>
              <rect x="63.0" y="46.5" width="23.3" height="23.3" rx="2" fill="#e2e8d5"></rect>
              <rect x="63.0" y="70.8" width="3" height="3" rx=".7" fill="none" stroke="#b9ae9b" strokeWidth=".6"></rect>
              <rect x="68.0" y="70.8" width="3" height="3" rx=".7" fill="none" stroke="#b9ae9b" strokeWidth=".6"></rect>
              <rect x="88.3" y="43.5" width="18.7" height="2" rx="1" fill="#3a332a"></rect>
              <rect x="88.3" y="46.5" width="23.3" height="23.3" rx="2" fill="#e2e8d5"></rect>
              <rect x="88.3" y="70.8" width="3" height="3" rx=".7" fill="none" stroke="#b9ae9b" strokeWidth=".6"></rect>
              <rect x="93.3" y="70.8" width="3" height="3" rx=".7" fill="none" stroke="#b9ae9b" strokeWidth=".6"></rect>
              <rect x="113.7" y="43.5" width="18.7" height="2" rx="1" fill="#3a332a"></rect>
              <rect x="113.7" y="46.5" width="23.3" height="23.3" rx="2" fill="#e2e8d5"></rect>
              <rect x="113.7" y="70.8" width="3" height="3" rx=".7" fill="none" stroke="#b9ae9b" strokeWidth=".6"></rect>
              <rect x="118.7" y="70.8" width="3" height="3" rx=".7" fill="none" stroke="#b9ae9b" strokeWidth=".6"></rect>
              <rect x="63" y="70" width="74" height="5" rx="2" fill="#17627f"></rect><rect x="66" y="71.6" width="16" height="2" rx="1" fill="rgba(255,255,255,.85)"></rect>
              <rect x="63.0" y="78" width="18.7" height="2" rx="1" fill="#3a332a"></rect>
              <rect x="63.0" y="81" width="23.3" height="23.3" rx="2" fill="#e2e8d5"></rect>
              <rect x="63.0" y="105.3" width="3" height="3" rx=".7" fill="none" stroke="#b9ae9b" strokeWidth=".6"></rect>
              <rect x="68.0" y="105.3" width="3" height="3" rx=".7" fill="none" stroke="#b9ae9b" strokeWidth=".6"></rect>
              <rect x="88.3" y="78" width="18.7" height="2" rx="1" fill="#3a332a"></rect>
              <rect x="88.3" y="81" width="23.3" height="23.3" rx="2" fill="#e2e8d5"></rect>
              <rect x="88.3" y="105.3" width="3" height="3" rx=".7" fill="none" stroke="#b9ae9b" strokeWidth=".6"></rect>
              <rect x="93.3" y="105.3" width="3" height="3" rx=".7" fill="none" stroke="#b9ae9b" strokeWidth=".6"></rect>
              <rect x="113.7" y="78" width="18.7" height="2" rx="1" fill="#3a332a"></rect>
              <rect x="113.7" y="81" width="23.3" height="23.3" rx="2" fill="#e2e8d5"></rect>
              <rect x="113.7" y="105.3" width="3" height="3" rx=".7" fill="none" stroke="#b9ae9b" strokeWidth=".6"></rect>
              <rect x="118.7" y="105.3" width="3" height="3" rx=".7" fill="none" stroke="#b9ae9b" strokeWidth=".6"></rect>

              <rect x="63" y="104" width="20" height="2.2" rx="1.1" fill="#e0d4bd"></rect>
              </svg>
            </div>

            <p className="sched-desc">
              A printable guide for whoever is looking after your plants while you're away. Every day in the range gets its own section listing the plants due for water that day, grouped by room, with a photo and a box to tick once it's done.
            </p>

            <div style={{display:"flex",gap:8}}>
              <div className="sched-date-card">
                <div className="pm-lbl">From</div>
                <CalendarField className="pm-date-chip" label="From" value={schedFrom} onChange={d=>{setSchedFrom(d);setSchedError("");}}/>
              </div>
              <div className="sched-date-card">
                <div className="pm-lbl">To</div>
                <CalendarField className="pm-date-chip" label="To" value={schedTo} viewHint={schedFrom} onChange={d=>{setSchedTo(d);setSchedError("");}}/>
              </div>
            </div>

            {/* Live count once a valid range is picked (10a) */}
            {schedRangeValid && schedPreviewCounts && (
              <div className="sched-count-line">
                {schedRangeDays} day{schedRangeDays===1?"":"s"} &middot; {schedPreviewCounts.occurrences} watering{schedPreviewCounts.occurrences===1?"":"s"} across {schedPreviewCounts.rooms} room{schedPreviewCounts.rooms===1?"":"s"}
              </div>
            )}
            <div style={{minHeight:schedRangeValid?0:18}}>
              {schedRangeMessage && !schedRangeValid && (
                <div style={{fontSize:11,fontWeight:600,color:"var(--danger)"}}>
                  {schedRangeMessage}
                </div>
              )}
            </div>

            {schedError && <div className="imp-error" style={{marginTop:0,marginBottom:8}}>{schedError}</div>}

            <div style={{display:"flex",gap:8}}>
              <button className="sheet-close-btn" onClick={()=>dismissSheet("schedule", ()=>setShowSchedule(false))} style={{flex:"none",padding:"0 20px",width:"auto"}}>Cancel</button>
              <button className="pm-bottom-btn save" style={{flex:1,padding:"12px 0",fontSize:13.5}}
                onClick={createSchedulePdf}
                disabled={!schedRangeValid || schedBusy || !jsPdfReady}
                >
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

// Screen title for every header except Home's, with the logo mark as a large
// faded watermark in the header's lower-right corner (option C). The mark is
// positioned against .page-header, so it can sit inside the title's wrapper.
function HdrTitle({ children }) {
  return (
    <>
      <h1>{children}</h1>
      <span className="hdr-watermark" aria-hidden="true">
        <img src="logo-mark.png" alt="" onError={e=>{e.target.style.display="none";}}/>
      </span>
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

// Icon-only tab bar: the current tab's icon is solid, the rest outline (as
// iOS does), inside the selected capsule. Labels live in aria-label now.
const NAV_ICONS = {
  home: {
    outline: <><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></>,
    solid:   <path fill="currentColor" stroke="none" d="M3 10.2L12 3l9 7.2V20a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1z"/>,
  },
  water: {
    outline: <path d="M12 2C6 9 4 13.5 4 16a8 8 0 0016 0c0-2.5-2-7-8-14z"/>,
    solid:   <path fill="currentColor" stroke="none" d="M12 2.2C6.3 9 4.5 13.2 4.5 15.8a7.5 7.5 0 0 0 15 0c0-2.6-1.8-6.8-7.5-13.6z"/>,
  },
  repot: {   // a plain pot: rim and tapered body
    outline: <><path d="M3.5 5.5h17v4h-17z" strokeLinejoin="round"/><path d="M5.5 9.5l1.6 10.4a1.2 1.2 0 0 0 1.2 1.1h7.4a1.2 1.2 0 0 0 1.2-1.1l1.6-10.4"/></>,
    solid:   <path fill="currentColor" stroke="none" d="M3 4.8h18a.9.9 0 0 1 .9.9v3.5a.9.9 0 0 1-.9.9H3a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9zM4.9 11.3h14.2l-1.55 9A1.3 1.3 0 0 1 16.3 21.4H7.7a1.3 1.3 0 0 1-1.25-1.1z"/>,
  },
  utils: {
    outline: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></>,
    solid:   <path fill="currentColor" stroke="none" fillRule="evenodd" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1zM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0z"/>,
  },
};
function NavIcon({ name, active }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {active ? NAV_ICONS[name].solid : NAV_ICONS[name].outline}
    </svg>
  );
}

function Nav({ screen, setScreen, plants, todayDate, onUtilsClick }) {
  const now = todayDate ? new Date(todayDate+"T00:00:00") : getToday();
  const due = plants ? plants.filter(p=>isWaterDue(p,now)).length : 0;
  return (
    <div className="nav-wrap">
    <nav className="nav">
      <button className={`nav-btn home${screen==="home" ?" active":""}`} aria-label="Home" onClick={()=>{ setScreen("home"); navCaptureScroll(); }}>
        <NavIcon name="home" active={screen==="home"}/>
      </button>
      <button className={`nav-btn water${screen==="water"?" active water":""}`} aria-label={due>0?`Water, ${due} due`:"Water"} onClick={()=>{ setScreen("water"); navCaptureScroll(); }}>
        {due>0 && <span className="nav-badge">{due>99?"99+":due}</span>}
        <NavIcon name="water" active={screen==="water"}/>
      </button>
      <button className={`nav-btn repot${screen==="repot"?" active repot":""}`} aria-label="Repot" onClick={()=>{ setScreen("repot"); navCaptureScroll(); }}>
        <NavIcon name="repot" active={screen==="repot"}/>
      </button>
      <button className={`nav-btn utils${screen==="utils"?" active utils":""}`} aria-label="Utilities" onClick={()=>{ setScreen("utils"); onUtilsClick && onUtilsClick(); navCaptureScroll(); }}>
        <NavIcon name="utils" active={screen==="utils"}/>
      </button>
    </nav>
    </div>
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
  const showRoomPill = mode==="deleted";
  const showAgeSub    = mode==="home";
  const collapsible  = mode==="water" || mode==="repot";
  const isDark = useIsDark();
  const initTint = healthTint(plant.health, isDark);

  const card = (
    <div className={cardClass} onClick={onClick} style={{cursor:"pointer"}}>
      {/* Health colour runs down the leading edge (§5) */}
      <span className="health-edge" style={{background:h.color}} title={h.label}/>
      <div className="pc-body">
      {/* Thumbnail, or an initial tile when there is no photo (§6 rule 3).
          The tile is tinted by the plant's health, same as the pills (24a). */}
      {showCardPhotos && (
      <div className="plant-thumb" style={photo?undefined:{background:isDark?"#334a15":"#e4f7c8"}}>
        {photo
          ? <img src={photo} alt={plant.name}/>
          : <span className="plant-initial" style={{color:isDark?"#c3ee85":"#3f6b16"}}>{(plant.name||"?").trim().charAt(0).toUpperCase()}</span>}
      </div>
      )}

      {/* Name + sub — on Home the subtitle is the plant's age (24a) */}
      <div className="plant-name-col">
        <div className="plant-name">{plant.name}</div>
        {showAgeSub && (
          <div className="plant-age-sub">{plantAgeDecimal(plant.obtainedDate, ageAsOf(plant))}</div>
        )}
        {mode==="water" && (
          <div style={{display:"flex",alignItems:"center",gap:6,marginTop:2}}>
            {daysLeft<=0 && (
              <span className={`card-status-pill ${daysLeft<0?"late":"due"}`}>
                {daysLeft<0 ? `${-daysLeft} day${-daysLeft===1?"":"s"} late` : "Due today"}
              </span>
            )}
            <span className="card-sub-text"><span className="desktop-hide">every {plant.waterFreqDays}d</span>{daysLeft>0?<span className="desktop-hide"> · </span>:null}{daysLeft>0?`in ${daysLeft}d`:""}</span>
          </div>
        )}
        {mode==="repot" && room && (
          <div className="repot-sub-row" style={{display:"flex",alignItems:"center",gap:6,marginTop:2}}>
            <span className="card-room-pill" title={room.name} style={room.color
              ? {background:room.color, color:roomTextColor(room.color)}
              : {background:"var(--sand)", color:"var(--text)"}}>{room.name}</span>
            <span className="card-sub-text">potted {plantAgeDecimal(plant.pottedDate)} ago</span>
          </div>
        )}
        {showRoomPill && mode!=="repot" && room && (
          <div style={{display:"flex",gap:4,alignItems:"center",marginTop:2,flexWrap:"wrap"}}>
            {room.color
              ? <span style={{background:room.color,color:roomTextColor(room.color),padding:"1px 8px",borderRadius:20,fontSize:11,fontWeight:700,whiteSpace:"nowrap",display:"inline-block"}}>{room.name}</span>
              : <span style={{fontSize:11,fontWeight:700,color:"var(--text-muted)"}}>{room.name}</span>
            }
            {mode==="repot" && plant.originalPot && <span style={{background:"transparent",color:"var(--accent)",border:"1.5px solid var(--accent)",padding:"1px 8px",borderRadius:20,fontSize:11,fontWeight:700,whiteSpace:"nowrap",display:"inline-block",letterSpacing:".3px"}}>ORIGINAL</span>}
          </div>
        )}
        {mode==="deleted" && (
          <div className="purge-label" style={{marginTop:3}}>
            {Math.max(0,purgeDays)} day{Math.max(0,purgeDays)===1?"":"s"}
          </div>
        )}
        {mode==="graveyard" && plant.diedDate && (
          <div style={{fontSize:11,fontWeight:700,color:"var(--text-muted)",marginTop:3}}>
            Died {formatDiedDate(plant.diedDate)}
          </div>
        )}
      </div>

      {/* Stat tiles */}
      <div className="stat-tiles">
        {/* HOME tiles */}
        {mode==="home" && <>
          <div className="stat-tile" title="Watering frequency">
            <div className="st-lbl">Every</div>
            <div className="st-val">{plant.waterFreqDays}d</div>
          </div>
          <div className="stat-tile" title="Days until next watering">
            <div className="st-lbl">Next</div>
            <div className="st-val" style={{color:daysLeft<0?"var(--danger)":daysLeft===0?"var(--water)":undefined}}>
              {daysLeft<0?`${daysLeft}d`:daysLeft===0?"Now":`${daysLeft}d`}
            </div>
          </div>
          <div className="stat-tile" title={potDue?"Due for repotting":"Pot age"}>
            <div className="st-lbl">Pot</div>
            <div className="st-val" style={potDue?{color:"var(--danger)"}:undefined}>{plantAgeDecimal(plant.pottedDate)}</div>
          </div>
          <div className="stat-tile phone-hide" title="Plant age">
            <div className="st-lbl">Age</div>
            <div className="st-val">{plantAgeDecimal(plant.obtainedDate)}</div>
          </div>
        </>}

        {/* GRAVEYARD / RECENTLY DELETED tiles — same as home minus the watering
            countdown, and with ages frozen at the date the plant died. */}
        {(mode==="graveyard"||mode==="deleted") && <>
          <div className="stat-tile" title="Watering frequency">
            <div className="st-lbl">Every</div>
            <div className="st-val">{plant.waterFreqDays}d</div>
          </div>
          <div className="stat-tile" title="Pot age">
            <div className="st-lbl">Pot Age</div>
            <div className="st-val">{plantAgeDecimal(plant.pottedDate, frozenAt)}</div>
          </div>
          <div className="stat-tile phone-hide" title="Plant age">
            <div className="st-lbl">Age</div>
            <div className="st-val">{plantAgeDecimal(plant.obtainedDate, frozenAt)}</div>
          </div>
        </>}

        {mode==="water" && (
          <div className="stat-tile desktop-only" title="Watering frequency">
            <div className="st-lbl">Every</div>
            <div className="st-val">{plant.waterFreqDays}d</div>
          </div>
        )}
      </div>

      {/* Repot pot-size badge sits with the actions, not in the stat row (7c) */}
      {mode==="repot" && (
        <div className="pot-size-badge" title="Current to next pot size">
          <div className="pot-size-badge-val">{plant.currentPotSize}&rarr;{plant.nextPotSize}"</div>
          <div className="pot-size-badge-lbl">Pot size</div>
        </div>
      )}

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
    </div>
  );
  return collapsible
    ? <CollapseSlot leaving={!!leaving}>{card}</CollapseSlot>
    : card;
}

// ─── Home Screen ──────────────────────────────────────────────────────────────
// Cold start is a module-level flag: it is true for the first mount after the
// process starts and never again, which is exactly what "cold start" means.
let homeColdStart = true;

function useHomeWake() {
  const [wake, setWake] = useState(false);
  useEffect(() => {
    const today = fmt(getToday());
    // Guarded: rAF is absent in some non-browser hosts, and this must never
    // be the thing that stops Home rendering.
    const nextFrame = fn => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 16));
    const fire = () => { setWake(false); nextFrame(() => setWake(true)); };
    if (homeColdStart) { homeColdStart = false; fire(); saveData("pt_last_foreground", today); }
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      const last = await loadData("pt_last_foreground");
      const now = fmt(getToday());
      if (last !== now) { fire(); saveData("pt_last_foreground", now); }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return wake;
}

function HomeScreen({ rooms, setRooms, plants, setPlants, showCardPhotos=true, user, strips=null, onDeleted }) {
  const homeWake = useHomeWake();
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
  const isDark = useIsDark();
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
      {/* §6.7: strips sit above the list and never block logging */}
      {strips && <div style={{padding:"10px 14px 0"}}>{strips}</div>}

      <div className={`dashboard${homeWake?" wake":""}`}>
        {/* 5-tile summary grid: All, then best to worst (13a) */}
        <div className="score-tiles">
          <div className={`score-tile all${healthFilter===null?" selected":""}`} onClick={selectAll}>
            <div className="score-tile-num">{plants.length}</div>
            <div className="score-tile-lbl">All</div>
          </div>
          {[4,3,2,1].map(h=>(
            <div key={h}
              className={`score-tile${healthFilter===h?" selected":""}`}
              style={{background:healthFilter===h?HEALTH[h].deep:healthTint(h,isDark).bg}}
              onClick={()=>selectHealth(h)}
            >
              <div className="score-tile-num" style={{color:healthFilter===h?HEALTH[h].deepInk:healthTint(h,isDark).text}}>{healthCounts[h-1]}</div>
              <div className="score-tile-lbl" style={{color:healthFilter===h?HEALTH[h].deepInk:healthTint(h,isDark).text}}>{HEALTH[h].label}</div>
            </div>
          ))}
        </div>

        {/* Segmented health score bar (13a) */}
        <div className="score-bar-wrap" onClick={()=>setScoreInfoOpen(o=>!o)}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:6}}>
            <span className="good-health-lbl">Health score</span>
            <span className="good-health-pct" style={{color:greenPct>=75?"var(--leaf)":greenPct>=50?"#c47a12":"var(--danger)"}}>{greenPct}%</span>
          </div>
          <div className="score-bar">
            {[4,3,2,1].map(h=> healthCounts[h-1]>0 &&
              <div key={h} style={{flex:healthCounts[h-1],background:HEALTH[h].color}}/>
            )}
          </div>

          {scoreInfoOpen && (
            <>
              {/* Full scrim, per 13a — dismissing is the Got it button or the
                  scrim itself, not an invisible full-screen catcher. */}
              <div className="score-scrim" onClick={e=>{e.stopPropagation();setScoreInfoOpen(false);}}/>
              <div className="score-tip" onClick={e=>e.stopPropagation()}>
                <div className="score-tip-arrow"/>
                <div className="score-tip-title">Health Score</div>
                <div className="score-tip-grid">
                  {[1,2,3,4].map(h=>(
                    <React.Fragment key={h}>
                      <span style={{color:HEALTH[h].color,fontWeight:800}}>{HEALTH[h].label}</span>
                      <span className="score-tip-pts">{h} {h===1?"point":"points"}</span>
                    </React.Fragment>
                  ))}
                </div>
                <div className="score-tip-divider"/>
                <div className="score-tip-grid totals">
                  <span className="score-tip-total-lbl">Your plants</span>
                  <span className="score-tip-total-val">{healthScore} pts</span>
                  <span className="score-tip-total-lbl">Possible</span>
                  <span className="score-tip-total-val muted">{healthScoreMax} pts</span>
                </div>
                <div className="score-tip-reaction">
                  <span className="score-tip-big-pct">{greenPct}<span>%</span></span>
                  <span className="score-tip-emoji">{healthScoreEmoji(greenPct)}</span>
                </div>
                <button className="score-tip-gotit" onClick={()=>setScoreInfoOpen(false)}>Got it</button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="tab-bar">
        <button className={`tab-btn${homeTab==="plants"?" active":""}`} onClick={()=>setHomeTab("plants")}>Plants</button>
        <button className={`tab-btn${homeTab==="rooms" ?" active rooms":""}`} onClick={()=>setHomeTab("rooms")}>Rooms</button>
        <div style={{flex:1}}/>
        <button className="tab-add-btn" style={homeTab==="rooms"?{background:"var(--accent)"}:undefined} title={homeTab==="plants"?"Add plant":"Add room"}
          onClick={()=>{ if(homeTab==="plants"){ setSheetSwap(false); setEditPlant(null); setShowModal(true); } else { openNewRef.current?.(); } }}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>

      <CrossFade value={`${homeTab}|${healthFilter ?? "all"}`}>{shown => {
      const [sTab, sfRaw] = shown.split("|");
      const sFilter   = sfRaw === "all" ? null : Number(sfRaw);
      const sFiltered = sFilter ? plants.filter(p=>p.health===sFilter) : plants;
      return (
      sTab==="plants" ? (
        <div className="section">
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
          {sFiltered.length===0 && (plants.length===0 && !sFilter ? (
            <>
              <div className="firstrun-card">
                <div className="firstrun-head">Nothing planted yet</div>
                <p className="firstrun-body">Add your first plant and Plantalog will start tracking its watering and repotting schedule.</p>
                <div className="firstrun-actions">
                  <button className="firstrun-btn secondary" onClick={()=>{setHomeTab("rooms");setTimeout(()=>openNewRef.current?.(),0);}}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>Add a room
                  </button>
                  <button className="firstrun-btn primary" onClick={()=>{setSheetSwap(false);setEditPlant(null);setShowModal(true);}}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>Add a plant
                  </button>
                </div>
              </div>
              <div className="firstrun-note">Want to import your plants in bulk? Head over to Utilities to download the XLS import template!</div>
            </>
          ) : <div className="empty"><span className="ico">🌱</span><p>No plants match this filter.</p></div>)}
        </div>
      ) : (
        <div className="section">
          <ManageRooms rooms={rooms} setRooms={setRooms} plants={plants} user={user} openNewRef={openNewRef} onSelectRoom={selectRoom}/>
          <div className="list-footnote rooms">Tap a room to see only its plants. Drag to reorder. Deleting a room moves its plants to Unassigned.</div>
        </div>
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
          onDelete={editPlant?(dest)=>{
            const gone = editPlant;
            movePlantTo(setPlants, gone.id, dest);
            setShowModal(false); setEditPlant(null); setDetailPlant(null);
            if (dest==="deleted" && onDeleted)
              onDeleted(gone.name, ()=>restorePlant(setPlants, gone, "active"));
          }:null}
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
function CalendarPopup({ value, onSelect, onClose, viewHint, label }) {
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
    <div className="cal-popup-overlay" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="cal-popup" onClick={e=>e.stopPropagation()}>
        <div className="cal-nav">
          <button className="cal-nav-btn" onClick={()=>nav(-1)} aria-label="Previous month">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div className="cal-nav-titles">
            {label && <div className="cal-nav-context">{label}</div>}
            <div className="cal-nav-title">{MONTH_NAMES[viewMonth]} {viewYear}</div>
          </div>
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

function CalendarField({ value, onChange, placeholder="Select date", style, viewHint, className, label, short=false }) {
  const [open, setOpen] = useState(false);
  // 6b shows the pill as an abbreviated "Jul 27" rather than a full date.
  const shownDate = (() => {
    if (!value) return placeholder;
    if (!short) return formatDateUS(value);
    const d = new Date(String(value).slice(0,10) + "T12:00:00");
    return isNaN(d) ? formatDateUS(value) : `${MONTH_NAMES[d.getMonth()].slice(0,3)} ${d.getDate()}`;
  })();
  return (
    <>
      <button type="button" className={`cal-field-btn${value?"":" placeholder"}${className?" "+className:""}`} style={style} onClick={()=>setOpen(true)}>
        {shownDate}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </button>
      {open && (
        <CalendarPopup value={value} viewHint={viewHint} label={label}
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
function CrossFade({ value, children, ms = 160, offsetFromScroll = false, onSwapped }) {
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
      {/* Keyed by the value alone, not by which slot it is in. With "p"/"c"
          prefixes a screen moving from the incoming slot to the outgoing one
          changed key, so React unmounted and remounted it and it lost its
          state: leaving Home while on the Rooms tab re-rendered the outgoing
          layer as the full Plants list, a big content swap mid-transition.
          prev and cur are never equal, so the keys cannot collide. */}
      {st.prev !== null && <div className="xfade-out" key={st.prev} aria-hidden="true" style={{top:-st.top}}>{children(st.prev)}</div>}
      <div className="xfade-in" key={st.cur}>{children(st.cur)}</div>
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
const SHEET_EXIT_MS = 260;
function useSheetDismiss(onClose) {
  const [closing, setClosing] = useState(false);
  const timer = useRef(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => () => {
    clearTimeout(timer.current);
    // If the owning screen unmounts (e.g. a tab change) while this sheet was
    // mid-close, its own timer is cancelled by this cleanup and onClose would
    // otherwise never fire. Flush it now rather than lose it (§12.8).
    if (closingRef.current) onCloseRef.current && onCloseRef.current();
  }, []);
  // { instant:true } skips the exit animation, for a sheet a swipe has
  // already carried off screen: playing sheetOut then would restart it from
  // the open position, and it flashed open and slid down a second time.
  function dismiss(opts) {
    if (closing) return;
    if (opts && opts.instant) { onCloseRef.current && onCloseRef.current(); return; }
    setClosing(true);
    closingRef.current = true;
    timer.current = setTimeout(() => onCloseRef.current && onCloseRef.current(), SHEET_EXIT_MS);
  }
  return [closing, dismiss];
}

function ConfirmDialog({ title, message, actions, cancelLabel = "Cancel", onClose, center=false }) {
  return (
    <div className="cfm-overlay" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="cfm-card" onClick={e => e.stopPropagation()}>
        <div className="cfm-title" style={center?{textAlign:"center",marginBottom:message?6:16}:undefined}>{title}</div>
        {message && <div className="cfm-msg" style={center?{textAlign:"center"}:undefined}>{message}</div>}
        <div className="cfm-actions">
          {actions.map((a, i) => (
            a.sub ? (
              /* Icon-tile choice row (8a) — used for genuine destination
                 choices, where each option needs room to explain itself. */
              <button key={i} className="cfm-choice-row" onClick={a.onClick}>
                <span className={`cfm-choice-icon ${a.kind||""}`}>
                  {a.kind==="danger"
                    ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/></svg>
                    : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 20.5h17"/><path d="M6 20.5V9a6 6 0 0 1 12 0v11.5"/><path d="M12 11.5v5.5M9.5 13.8h5"/></svg>}
                </span>
                <span className="cfm-choice-text">
                  <span className={`cfm-choice-label ${a.kind||""}`}>{a.label}</span>
                  <span className="cfm-choice-sub">{a.sub}</span>
                </span>
              </button>
            ) : (
              <button key={i} className={`cfm-btn ${a.kind || ""}`} onClick={a.onClick}>{a.label}</button>
            )
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
    <div className="dp-overlay" onClick={e => { e.stopPropagation(); onClose(); }}>
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
function PhotoLightbox({ photos, index, setIndex, dateAt, onDateChange, onClose,
                         plantName, mainIndex, onSetMain, onDelete }) {
  const isMain = (mainIndex == null ? 0 : mainIndex) === index;
  // Dark mode lives on .app, and the portal below lands outside it, so the
  // theme's custom properties and .dark descendant rules have to be re-rooted
  // here or the date picker renders light while the app is dark.
  const viewerDark = useIsDark();
  const MAX_Z = 5, DBL_Z = 2.5;
  const [z, setZ]           = useState(1);
  const [t, setT]           = useState({ x: 0, y: 0 });
  // Swiping moves a filmstrip (previous, current, next photo side by side,
  // one page apart) that follows the finger 1:1 and then glides to the next
  // page or springs back. It replaced a single image sliding inside its own
  // clipped frame, which snapped back and swapped photos instantly.
  const [trackX, setTrackX]       = useState(0);
  const [trackAnim, setTrackAnim] = useState(false);
  const trackXRef = useRef(0); trackXRef.current = trackX;
  const settleTimer = useRef(null);
  const settlePending = useRef(0);
  const SLIDE_MS = 280, PAGE_GAP = 20;
  const [panning, setPanning] = useState(false);
  const [smooth, setSmooth]   = useState(false);
  const [pickDate, setPickDate] = useState(false);

  const stageRef  = useRef(null);
  const imgRef    = useRef(null);
  const baseDims  = useRef(null);           // rendered size at scale 1
  // The box a photo may fill: the middle band minus its padding and the
  // date button above the photo. Without it the image rendered at its
  // stored size (800px+) inside a phone-width stage that cropped it to
  // ~46%, so every photo looked zoomed in.
  const midRef    = useRef(null);
  const [fit, setFit] = useState(null);
  useLayoutEffect(() => {
    const mid = midRef.current;
    if (!mid) return;
    const calc = () => {
      const cs = getComputedStyle(mid);
      const date = mid.querySelector(".viewer-date");
      const gap = parseFloat(cs.rowGap) || 0;
      const w = mid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = mid.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
              - (date ? date.offsetHeight + gap : 0);
      setFit(f => (f && f.w === Math.floor(w) && f.h === Math.floor(h)) ? f : { w: Math.max(0, Math.floor(w)), h: Math.max(0, Math.floor(h)) });
    };
    calc();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(calc) : null;
    if (ro) ro.observe(mid);
    return () => ro && ro.disconnect();
  }, []);
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
      if (e.key === "ArrowLeft")  goRef.current(-1);
      if (e.key === "ArrowRight") goRef.current(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed, photos.length]);

  useScrollLock();
  const goRef = useRef(() => {});

  function measure() {
    const img = imgRef.current;
    if (!img) return;
    baseDims.current = { w: img.offsetWidth, h: img.offsetHeight };
  }
  // Pan limits come from the fitted size, so re-measure when the fit box moves
  // or a neighbour (already loaded, so no onLoad) becomes the current photo.
  useEffect(() => { measure(); }, [fit]);
  useLayoutEffect(() => { measure(); }, [index]);
  useEffect(() => { goRef.current = go; });
  const pageW = fit ? fit.w + PAGE_GAP : 0;

  // Glide the strip to the previous (-1) or next (+1) page, or back (0), then
  // make that photo current and zero the strip in the same render, so the
  // slides (positioned relative to the current index) do not move on screen.
  function settle(dir) {
    clearTimeout(settleTimer.current);
    settlePending.current = dir;
    setTrackAnim(true);
    setTrackX(dir === 0 ? 0 : -dir * pageW);
    settleTimer.current = setTimeout(finishSettle, SLIDE_MS);
  }
  function finishSettle() {
    clearTimeout(settleTimer.current);
    settleTimer.current = null;
    const dir = settlePending.current;
    settlePending.current = 0;
    setTrackAnim(false);
    if (dir) setIndex(i => Math.max(0, Math.min(photos.length - 1, i + dir)));
    setTrackX(0);
  }
  useEffect(() => () => clearTimeout(settleTimer.current), []);
  function go(dir) {
    if (zoomed) return;
    if (dir < 0 && index === 0) return;
    if (dir > 0 && index === photos.length - 1) return;
    settle(dir);
  }
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Belt-and-suspenders for the same "native control steals the pointer"
  // problem the buttons===0 check above targets: if a stray pointer is
  // still marked down when the mouse button comes up ANYWHERE on the page
  // (not just over the stage), drop it. Pointer capture is supposed to
  // route the real pointerup to the stage regardless of where the cursor
  // ends up, but that guarantee is exactly what a native <select> popup
  // can break, which is why the earlier per-element handlers alone weren't
  // enough.
  useEffect(() => {
    function forceRelease() {
      if (pointers.current.size === 0) return;
      pointers.current.clear();
      const wasSwipe = gesture.current && gesture.current.mode === "swipe";
      gesture.current = null;
      if (wasSwipe && trackXRef.current !== 0 && !settleTimer.current) { setTrackAnim(true); setTrackX(0); setTimeout(() => setTrackAnim(false), SLIDE_MS); }
      setPanning(false);
    }
    window.addEventListener("pointerup", forceRelease);
    window.addEventListener("pointercancel", forceRelease);
    window.addEventListener("mouseup", forceRelease);
    return () => {
      window.removeEventListener("pointerup", forceRelease);
      window.removeEventListener("pointercancel", forceRelease);
      window.removeEventListener("mouseup", forceRelease);
    };
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
    const r = stage.getBoundingClientRect(), k = uiZoom();
    const px = (clientX - (r.left + r.width / 2)) / k;
    const py = (clientY - (r.top + r.height / 2)) / k;
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
    if (settleTimer.current) finishSettle();
    const onPhoto = !!(stageRef.current && stageRef.current.contains(e.target));
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
        onPhoto, lastX: e.clientX, lastT: performance.now(), v: 0,
      };
    }
  }

  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return;
    // A native control (e.g. the month <select>) can steal the pointer
    // without ever sending this element a pointerup/pointercancel, which
    // left the image sliding with the cursor until the next click. If the
    // mouse button is no longer down, treat it as a release now.
    if (e.pointerType === "mouse" && e.buttons === 0) { onPointerUp(e); return; }
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
      const dx = e.clientX - g.startX, dy = e.clientY - g.startY, k = uiZoom();
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { moved.current = true; setPanning(true); }
      setT(clamp(g.startT.x + dx / k, g.startT.y + dy / k, zRef.current));
      return;
    }
    if (g.mode === "swipe") {
      const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
      const now = performance.now(), k = uiZoom();
      if (now > g.lastT) { g.v = (e.clientX - g.lastX) / k / (now - g.lastT); g.lastX = e.clientX; g.lastT = now; }
      if (!moved.current && (Math.abs(dx) < 4 || Math.abs(dx) < Math.abs(dy))) return;
      moved.current = true;
      const atLeft  = index === 0 && dx > 0;
      const atRight = index === photos.length - 1 && dx < 0;
      const cssDx = dx / k;
      setTrackAnim(false);
      setTrackX(atLeft || atRight ? cssDx * 0.3 : cssDx);   // resist past the ends
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
      if (moved.current) {
        // Past a fifth of a page, or a quick flick that travelled at least a
        // little, goes to the neighbour; anything else springs back.
        const dx = (e.clientX - g.startX) / uiZoom();
        const dir = dx < 0 ? 1 : -1;
        const far = Math.abs(dx) > pageW * 0.2;
        const flick = Math.abs(g.v) > 0.35 && Math.sign(g.v) === Math.sign(dx) && Math.abs(dx) > 16;
        const canGo = dir > 0 ? index < photos.length - 1 : index > 0;
        settle(canGo && (far || flick) ? dir : 0);
      } else if (!g.onPhoto) {
        onClose();                       // a tap beside the photo closes, as before
        return;
      } else {
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

  // Portalled to <body> rather than left where it is rendered, which is inside
  // the detail sheet. As a DOM descendant of the sheet it inherited two
  // problems: any transform on the sheet (the drag applies one) becomes the
  // containing block for this position:fixed element, collapsing it into the
  // sheet's 480px column - visible as a flash of the photo at app width before
  // it snaps to full size - and its pointer events reached the sheet's
  // swipe-to-dismiss handlers. A portal keeps React state and context intact
  // and only changes where the nodes land.
  //
  // Clicking any empty surround closes. Testing target===currentTarget rather
  // than moved.current: the rows below already stop propagation, so this only
  // ever sees a genuine backdrop click, and moved.current was stale from the
  // last swipe, which silently blocked closing this way.
  return ReactDOM.createPortal((
    <div className={`viewer${viewerDark ? " dark" : ""}`} onClick={e => { if (e.target === e.currentTarget && !zoomed) onClose(); }}>
      {/* 13d: top row, 32px close at 14% ink, then a matching spacer so the
          close reads optically left of centre. */}
      <div className="viewer-top" onClick={e => e.stopPropagation()}>
        <button className="viewer-close" onClick={e => { e.stopPropagation(); onClose(); }} aria-label="Close">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
        <span className="viewer-top-spacer"/>
      </div>

      <div className="viewer-mid" ref={midRef} onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget && !zoomed) onClose(); }}>
        <button className={`viewer-date${dateStr ? "" : " placeholder"}`}
          onClick={e => { e.stopPropagation(); setPickDate(true); }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>
          {dateStr || "Add date"}
        </button>

        <button className={`lightbox-arrow${index === 0 || zoomed ? " hidden" : ""}`}
          onClick={e => { e.stopPropagation(); go(-1); }}>‹</button>

        <div className="viewer-pager"
          style={fit ? { width: fit.w, height: fit.h } : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onLostPointerCapture={onPointerUp}
          onWheel={onWheel}
          onContextMenu={e => e.preventDefault()}>
          <div className="viewer-track" style={{
              transform: `translate3d(${trackX}px, 0, 0)`,
              transition: trackAnim ? `transform ${SLIDE_MS}ms cubic-bezier(.22,.8,.26,1)` : "none",
            }}>
            {[index - 1, index, index + 1].filter(i => i >= 0 && i < photos.length).map(i => {
              const current = i === index;
              const main = (mainIndex == null ? 0 : mainIndex) === i;
              return (
                <div key={i} className="viewer-slide" style={{ left: (i - index) * pageW }}>
                  <div ref={current ? stageRef : undefined}
                    className={`lightbox-stage${current && zoomed ? " zoomed" : ""}${current && panning ? " panning" : ""}`}>
                    <img ref={current ? imgRef : undefined} src={photos[i]} alt=""
                      onLoad={current ? measure : undefined} draggable="false"
                      style={{
                        maxWidth: fit ? fit.w : undefined, maxHeight: fit ? fit.h : undefined,
                        transform: current ? `translate3d(${t.x}px, ${t.y}px, 0) scale(${z})` : undefined,
                        transition: current && smooth ? "transform .2s var(--ease-collapse)" : "none",
                      }}/>
                    {main && !(current && zoomed) && <span className="viewer-main-badge">Main</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <button className={`lightbox-arrow${index === photos.length - 1 || zoomed ? " hidden" : ""}`}
          onClick={e => { e.stopPropagation(); go(1); }}>›</button>

      </div>

      {zoomed && <div className="lightbox-zoom-hint">{z.toFixed(1)}× · double-tap to reset</div>}

      <div className="viewer-bottom" onClick={e => e.stopPropagation()}>
        {plantName && <div className="viewer-name">{plantName}</div>}

        {photos.length > 1 && (
          <div className="viewer-strip">
            {photos.map((src, i) => (
              <img key={i} src={src} alt=""
                className={`viewer-strip-thumb${i === index ? " current" : ""}`}
                onClick={e => { e.stopPropagation(); setIndex(i); }}/>
            ))}
          </div>
        )}

        <div className="viewer-actions">
          <button className="viewer-setmain" disabled={isMain}
            onClick={e => { e.stopPropagation(); onSetMain && onSetMain(index); }}>
            {isMain ? "Main photo" : "Set as main"}
          </button>
          <button className="viewer-delete" aria-label="Delete photo"
            onClick={e => { e.stopPropagation(); onDelete && onDelete(index); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>

      {pickDate && (
        <div onClick={e => e.stopPropagation()}>
          <PhotoDatePicker value={dateAt(index)}
            onSave={d => { onDateChange(index, d); setPickDate(false); }}
            onClose={() => setPickDate(false)}/>
        </div>
      )}
    </div>
  ), document.body);
}

// §9 swipe down to close. The detail arrives as a sheet, so it leaves like
// one. Drag starts on the hero or header, or in the body only when it is
// already scrolled to the top — once the body has scrolled, vertical drags
// belong to the scroller and we do not fight it.
// Stops the page behind a sheet or the photo viewer from scrolling. Counted
// rather than save-and-restore, because these stack and overlap: the viewer
// opens over View, and View and Edit are both briefly mounted during a swap.
// With save-and-restore, whichever closed first could hand scrolling back
// while another was still open.
// The laptop layout zooms the whole page (see --zoom). Pointer coordinates and
// getBoundingClientRect stay in screen pixels while transforms, offsetWidth
// and the like are in the app's own pixels, so a drag has to divide its
// pointer movement by this or the element outruns the cursor.
function uiZoom() {
  return parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
}

let scrollLocks = 0;
function useScrollLock() {
  useEffect(() => {
    if (scrollLocks++ === 0) {
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    }
    return () => {
      if (--scrollLocks === 0) {
        document.documentElement.style.overflow = "";
        document.body.style.overflow = "";
      }
    };
  }, []);
}

function useSheetDrag(onCommit, enabled = true, dragZone = null) {
  const sheetRef = useRef(null);
  const bodyRef = useRef(null);
  const st = useRef({ active:false, startY:0, lastY:0, lastT:0, v:0, dy:0 });
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);

  const reduced = typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Where a drag may begin. Outside the scroller (the header) always; inside
  // it, only in a drag zone - elements the sheet marks with dragZone, given
  // touch-action:none in CSS so iOS hands the gesture to us instead of
  // scrolling on its own thread, which is why a pull below the header used to
  // do nothing. Those zones scroll by hand below (there is nothing for the
  // browser to do there), so an upward drag still moves the list.
  function zoneOf(e) {
    const body = bodyRef.current;
    if (!body || !body.contains(e.target)) return "header";
    return dragZone && e.target.closest && e.target.closest(dragZone) ? "zone" : "native";
  }
  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!enabled) return;
    const where = zoneOf(e);
    if (where === "native") return;              // the browser scrolls it
    const body = bodyRef.current;
    const y = e.clientY / uiZoom();
    st.current = { active:true, startY:y, lastY:y, lastT:performance.now(), v:0, dy:0,
      // In a zone the sheet only moves while the list is at its top; otherwise
      // the gesture scrolls the list.
      mode: (where === "zone" && body && body.scrollTop > 0) ? "scroll" : "sheet",
      zone: where === "zone", startScroll: body ? body.scrollTop : 0 };
  }
  function onPointerMove(e) {
    const c = st.current;
    if (!c.active) return;
    // A drag can lose its pointerup: a native <select> popup swallows it, and
    // so does any element that moves out from under the cursor mid-drag (this
    // sheet's own transform re-parents fixed descendants, which can do exactly
    // that). Without this the drag stays armed and the sheet keeps tracking
    // the cursor with no button held.
    if (e.pointerType === "mouse" && e.buttons === 0) { onPointerUp(); return; }
    const y = e.clientY / uiZoom();
    let raw = y - c.startY;
    const body = bodyRef.current;
    // In a drag zone an upward pull scrolls the list (by hand, since the
    // browser will not), and it becomes a sheet drag again at the top.
    if (c.zone && body) {
      if (c.mode === "sheet" && raw < -3 && body.scrollHeight > body.clientHeight + 1) {
        c.mode = "scroll"; c.startScroll = 0; c.startY = y; raw = 0;
        if (dragging) setDragging(false);
        if (c.dy !== 0) { c.dy = 0; setDy(0); }
      }
      if (c.mode === "scroll") {
        const next = Math.max(0, c.startScroll - raw);
        body.scrollTop = next;
        if (next === 0 && raw > 0) { c.mode = "sheet"; c.startY = y; c.dy = 0; }
        return;
      }
    }
    // Upward past the open position is rubber-banded so it resists, not sticks.
    const next = raw >= 0 ? raw : -Math.sqrt(-raw) * 3;
    const now = performance.now();
    const dt = now - c.lastT;
    if (dt > 0) c.v = (y - c.lastY) / dt;
    c.lastY = y; c.lastT = now; c.dy = next;
    if (!dragging && Math.abs(raw) > 3) setDragging(true);
    setDy(next);
  }
  function onPointerUp() {
    const c = st.current;
    if (!c.active) return;
    c.active = false;
    if (c.mode === "scroll") { setDragging(false); setDy(0); return; }
    setDragging(false);
    const h = sheetRef.current ? sheetRef.current.offsetHeight : 1;
    // Velocity matters more than distance: a fast flick from near the top
    // should close, and a slow drag past a quarter should also close. The
    // flick still needs to have travelled a real distance though - velocity
    // is px/ms, so a 3px twitch over 2ms reads as 1.5 and would otherwise
    // dismiss the sheet on what the user experienced as a plain tap.
    const commit = c.dy > h * 0.25 || (c.v > 0.5 && c.dy > 48);
    if (commit) {
      if (reduced) { setDy(0); onCommit(); return; }
      // Close only once the .24s slide below has actually finished; an
      // earlier close cut the sheet off part way down.
      setDy(h);
      setTimeout(onCommit, 250);
    } else {
      setDy(0);
    }
  }
  // How much of the backdrop dim remains, 1 open to 0 fully dragged down.
  const veil = (() => {
    const h = sheetRef.current ? sheetRef.current.offsetHeight : 1;
    return Math.max(0, 1 - Math.min(1, Math.max(0, dy) / h));
  })();
  return { sheetRef, bodyRef, dy, dragging, veil,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel:onPointerUp } };
}

function PlantDetail({ plant, rooms, plants, setPlants, onClose, onEdit, user, variant="active", onRestore, onSendToDeleted, enter="slide", ghost=false }) {
  useScrollLock();
  const [confirm, setConfirm] = useState(null);   // "restore" | "delete"
  const [detailClosing, dismissDetail] = useSheetDismiss(onClose);
  const heroPhoto = getPrimaryPhoto(plant);
  const room    = rooms.find(r=>r.id===plant.roomId);
  const h       = HEALTH[plant.health];
  const fileRef = useRef();
  const [lightboxIdx, setLightboxIdx] = useState(null);
  // The photo viewer sits on top of this sheet but is still a DOM descendant
  // of it, so its taps and swipes reach the sheet's drag handlers. Nothing in
  // the viewer should ever be able to dismiss the card underneath it.
  const drag = useSheetDrag(() => dismissDetail({ instant:true }), !ghost && lightboxIdx === null, ".detail-panel");
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
    <div className={`modal-overlay${detailClosing?" closing":""}${enter==="swap"?" swap":""}${ghost?" ghost":""}`}
      onClick={ghost?undefined:dismissDetail}
      style={drag.dy>0?{"--veil-k":drag.veil}:undefined}>
      <div className="modal detail-sheet" ref={drag.sheetRef} {...drag.handlers}
        style={{padding:0,overflow:"hidden",display:"flex",flexDirection:"column",
          transform:drag.dy?`translateY(${drag.dy}px)`:undefined,
          transition:drag.dragging?"none":"transform .24s var(--ease-enter)",
          touchAction:"pan-y"}}
        onClick={e=>e.stopPropagation()}>
        {/* The only affordance saying this can be dragged (§9) */}
        <div className="sheet-grab"><span/></div>

        {/* Header — health color */}
        <div className={`detail-hero${heroPhoto?" has-photo":""}`}
          style={heroPhoto?{backgroundImage:`url(${heroPhoto})`}:undefined}>
          {heroPhoto && <div className="detail-hero-scrim"/>}
          <button className="close-x-btn" onClick={e=>{e.stopPropagation();dismissDetail();}} style={{zIndex:10,background:"rgba(255,255,255,.22)",backdropFilter:"blur(6px)",WebkitBackdropFilter:"blur(6px)",color:"#fff"}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <button onClick={e=>{e.stopPropagation(); if(variant==="active") onEdit(); else setConfirm("restore");}} className="hero-accent-btn" style={{position:"absolute",top:16,right:16,zIndex:10}}>
            {variant==="graveyard" ? "Revive" : variant==="deleted" ? "Restore" : "Edit"}
          </button>
          <div className="detail-hero-content">
            {room && (
              <div className="detail-hero-room">
                <span className="detail-hero-room-dot" style={{background:room.color||"var(--accent)"}}/>
                <span>{room.name}</span>
              </div>
            )}
            <div className="detail-hero-name" style={{fontSize:heroPhoto?31:28}}>{plant.name}</div>
            <div style={{display:"flex",alignItems:"center",gap:7,marginTop:5,flexWrap:"wrap"}}>
              <span className="hero-pill filled" style={{background:h.color}}>{h.label}</span>
              <span className="hero-pill">{plantAgeDecimal(plant.obtainedDate, ageAsOf(plant))} old</span>
              {plant.diedDate && (
                <span className="died-pill hero-pill">Died: {formatDiedDate(plant.diedDate)}</span>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div ref={drag.bodyRef} style={{overflowY:"auto",padding:"10px 12px 80px",display:"flex",flexDirection:"column",gap:6}}>

          {/* Watering section (5b) */}
          <div className="detail-panel water">
            <div className="detail-panel-head">
              <span className="detail-panel-title">Water</span>
              <span className="detail-panel-pill">{daysLeft<=0?"due now":`next in ${daysLeft} day${daysLeft===1?"":"s"}`}</span>
            </div>
            <div className="detail-panel-grid">
              <div><div className="detail-panel-val">{plant.waterFreqDays}d</div><div className="detail-panel-lbl">Every</div></div>
              <div><div className="detail-panel-val">{daysSince}d ago</div><div className="detail-panel-lbl">Last</div></div>
              <div><div className="detail-panel-val">{plant.lastWatered ? MONTH_NAMES[new Date(addDaysStr(plant.lastWatered, plant.waterFreqDays)+"T12:00:00").getMonth()].slice(0,3)+" "+new Date(addDaysStr(plant.lastWatered, plant.waterFreqDays)+"T12:00:00").getDate() : "-"}</div><div className="detail-panel-lbl">Next</div></div>
            </div>
          </div>

          {/* Potting section (5b) */}
          <div className="detail-panel potting">
            <div className="detail-panel-head">
              <span className="detail-panel-title">Pot</span>
              {plant.originalPot && <span className="detail-panel-pill outline">Original pot</span>}
            </div>
            <div className="detail-panel-grid">
              <div><div className="detail-panel-val">{plantAgeDecimal(plant.pottedDate)}</div><div className="detail-panel-lbl">Pot age</div></div>
              <div><div className="detail-panel-val">{repotEveryLabel(plant)}</div><div className="detail-panel-lbl">Repot every</div></div>
              <div><div className="detail-panel-val">{plant.currentPotSize}&rarr;{plant.nextPotSize}"</div><div className="detail-panel-lbl">Pot size</div></div>
            </div>
          </div>

          {/* Photos */}
          <div>
            <div className="photo-row">
              {plant.photos.map((src, i)=>{
                const isPrimary = (plant.primaryPhoto==null?0:plant.primaryPhoto)===i;
                return (
                  <div key={i}
                    className="photo-thumb-wrap"
                    style={{width:68,height:68}}
                    onClick={()=>setLightboxIdx(i)}>
                    <img src={src} className="photo-thumb" style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>
                  </div>
                );
              })}
              <div className="photo-add" style={{width:68,height:68}} onClick={()=>fileRef.current.click()}>+</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handlePhoto}/>
            {plant.photos.length===0 && <div style={{fontSize:12.5,lineHeight:1.45,fontWeight:600,color:"var(--text-muted)",marginTop:7}}>No photos yet. The first one becomes the card thumbnail.</div>}
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
            plantName={plant.name}
            mainIndex={plant.primaryPhoto}
            onSetMain={i=>setPrimary(i)}
            onDelete={i=>{ removePhoto(i); setLightboxIdx(null); }}
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
  const [formColor,setFormColor]=useState(null);
  const sorted=[...rooms].sort((a,b)=>(a.order??0)-(b.order??0));
  // 18.5: reorder by dragging the handle. `order` stays the stored field --
  // it's written by the drag now instead of typed into the dialog. Home,
  // Water and Repot all already sort by it, so they pick this up for free.
  const [dragId,setDragId]=useState(null);
  const [dragDelta,setDragDelta]=useState(0);
  const [dropIndex,setDropIndex]=useState(null);
  const listRef=useRef(null);
  const dragRef=useRef(null);
  function commitOrder(ids){
    // contiguous indices from 0, no gaps (18.5)
    setRooms(rs=>rs.map(r=>{const i=ids.indexOf(r.id);return i<0?r:{...r,order:i};}));
  }
  function moveRoom(id,dir){
    const ids=sorted.map(r=>r.id); const from=ids.indexOf(id); const to=from+dir;
    if(from<0||to<0||to>=ids.length) return;
    ids.splice(to,0,ids.splice(from,1)[0]);
    commitOrder(ids);
  }
  function startDrag(e,id){
    e.preventDefault(); e.stopPropagation();
    const rowEls=Array.from(listRef.current?.querySelectorAll('.room-bar')||[]);
    const idx=sorted.findIndex(r=>r.id===id);
    const h=rowEls[idx]?.offsetHeight||43;
    const step=h+7;  // row height + list gap, both in app pixels
    const k=uiZoom();
    dragRef.current={id,idx,step,k,startY:e.clientY};
    setDragId(id); setDropIndex(idx); setDragDelta(0);
    const move=ev=>{
      const d=(ev.clientY-dragRef.current.startY)/dragRef.current.k;
      setDragDelta(d);
      let ni=dragRef.current.idx+Math.round(d/dragRef.current.step);
      ni=Math.max(0,Math.min(sorted.length-1,ni));
      setDropIndex(ni);
    };
    const up=()=>{
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',up);
      const st=dragRef.current;
      setDragId(null); setDragDelta(0); setDropIndex(null);
      if(!st) return;
      const ids=sorted.map(r=>r.id);
      let ni=st.idx+Math.round((window.__lastDragD||0)/st.step);
      ni=Math.max(0,Math.min(ids.length-1,ni));
      if(ni!==st.idx){ ids.splice(ni,0,ids.splice(st.idx,1)[0]); commitOrder(ids); }
      dragRef.current=null;
    };
    window.__lastDragD=0;
    const move2=ev=>{ window.__lastDragD=(ev.clientY-dragRef.current.startY)/dragRef.current.k; move(ev); };
    window.addEventListener('pointermove',move2);
    window.addEventListener('pointerup',up,{once:true});
  }
  function openNew(){setEditing({});setFormName("");setFormColor(null);}
  useEffect(()=>{ if(openNewRef) openNewRef.current = openNew; });
  function openEdit(r){setEditing(r);setFormName(r.name);setFormColor(r.color||null);}
  function save(){
    if(!formName.trim())return;
    if(editing.id) setRooms(rs=>rs.map(r=>r.id===editing.id?{...r,name:formName,color:formColor}:r));
    else setRooms(rs=>[...rs,{id:uid(),name:formName,order:rooms.length,color:formColor}]);
    setEditing(null);
  }
  function del(id){if(plants.some(p=>p.roomId===id)){alert("Move or delete this room's plants first.");return;} if(!PREVIEW_MODE&&user) sbDeleteRooms(user.id,[id]); setRooms(rs=>rs.filter(r=>r.id!==id));}
  return(<>
    <div ref={listRef}>
    {sorted.map((r,rowIdx)=>{
      const tint = r.color ? { background:r.color, color:roomTextColor(r.color) } : { background:"var(--bark)", color:"#fff" };
      const isDragging = dragId===r.id;
      const dragIdx = dragId ? sorted.findIndex(x=>x.id===dragId) : -1;
      let shift = 0;
      if(dragId && !isDragging && dropIndex!==null){
        const step = (dragRef.current?.step)||50;
        if(rowIdx>dragIdx && rowIdx<=dropIndex) shift = -step;
        else if(rowIdx<dragIdx && rowIdx>=dropIndex) shift = step;
      }
      return (
      <div key={r.id}
        className={`room-bar${onSelectRoom?" clickable":""}${isDragging?" dragging":""}${(!isDragging&&dragId)?" displaced":""}`}
        style={{...tint, transform: isDragging?`translateY(${dragDelta}px) scale(1.03)`:(shift?`translateY(${shift}px)`:undefined)}}
        onClick={onSelectRoom?()=>onSelectRoom(r.id):undefined}>
        <div className="room-bar-info">
          <span className="room-bar-name">{r.name}</span>
          <span className="room-bar-count" style={{color:tint.color}}>{(()=>{const n=plants.filter(p=>p.roomId===r.id).length;return `${n} ${n===1?"plant":"plants"}`;})()}</span>
        </div>
        <button className="room-drag" style={{color:ROOM_ICON_INK}}
          aria-label={`Reorder ${r.name}`}
          onPointerDown={e=>startDrag(e,r.id)}
          onClick={e=>e.stopPropagation()}
          onKeyDown={e=>{ if(e.key==="ArrowUp"||e.key==="ArrowDown"){ e.preventDefault(); e.stopPropagation(); moveRoom(r.id, e.key==="ArrowUp"?-1:1); } }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round"><path d="M4 9h16M4 15h16"/></svg>
        </button>
        <button className="room-bar-edit" style={{background:"rgba(0,0,0,.14)",color:ROOM_ICON_INK}}
          onClick={e=>{e.stopPropagation();openEdit(r);}} title="Edit room">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20z"/></svg>
        </button>
      </div>
      );
    })}
    </div>
    {editing!==null&&(
      <div className="modal-overlay room-edit-overlay" onClick={()=>setEditing(null)}>
        <div className="room-edit-card" onClick={e=>e.stopPropagation()}>
          <div className="room-edit-title">{editing.id?"Edit Room":"New Room"}</div>

          <div className="pm-card" style={{padding:"9px 14px 11px"}}>
            <div className="pm-lbl">Name</div>
            <input className="pm-name-input room-name-input" value={formName} onChange={e=>setFormName(e.target.value)} placeholder="e.g. Living Room"/>
            <span className="room-name-rule"/>
          </div>

          <div className="pm-card" style={{padding:"9px 14px 13px"}}>
            <div className="pm-lbl" style={{marginBottom:9}}>Colour</div>
            <div className="room-swatch-grid">
              {ROOM_COLORS.map((c,i)=>(
                <button key={i} type="button"
                  className={`room-swatch${c===null?" none":""}`}
                  style={c?{background:c,boxShadow:formColor===c?`0 0 0 2.5px var(--surface), 0 0 0 5px ${c}`:undefined}:undefined}
                  title={c||"No color"}
                  onClick={()=>setFormColor(c)}
                />
              ))}
            </div>
          </div>

          <div className="pm-card" style={{padding:"9px 14px 12px"}}>
            <div className="pm-lbl" style={{marginBottom:8}}>Preview</div>
            <div className="room-chip-preview" style={formColor?{background:formColor,color:roomTextColor(formColor)}:{background:"var(--bark)",color:"#fff"}}>
              <span>{formName||"Room Name"}</span>
              <span>{plants.filter(p=>p.roomId===(editing.id)).length}</span>
            </div>
          </div>

          <div style={{display:"flex",gap:7}}>
            {editing.id && (
              <button type="button" className="pm-bottom-btn danger" style={{padding:"11px 0"}} onClick={()=>del(editing.id)}>Delete Room</button>
            )}
            <button type="button" className="pm-bottom-btn save" style={{flex:editing.id?1.2:1,padding:"11px 0"}} onClick={save}>Save</button>
          </div>
          <button type="button" className="room-edit-cancel" onClick={()=>setEditing(null)}>Cancel</button>
        </div>
      </div>
    )}
  </>);
}

// ─── Plant Modal ──────────────────────────────────────────────────────────────
function PlantModal({ plant, rooms, onSave, onDelete, onClose, onCancel, onClone, enter="slide", ghost=false }) {
  useScrollLock();
  const blank = {
    roomId:rooms[0]?.id||"", name:"", obtainedDate:fmt(getToday()), pottedDate:fmt(getToday()),
    originalPot:true, potMonths:0, potYears:2, currentPotSize:6, nextPotSize:7,
    waterFreqDays:7, lastWatered:fmt(getToday()), health:3, photos:[], primaryPhoto:null, notes:"" ,
  };
  const [form,setForm] = useState(plant?{...plant}:blank);
  const [tipOpen,setTipOpen] = useState(false);   // 14d watering tip
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  // Repot cadence is edited as a single number of years in half-year steps,
  // but stored as years + months so the due calculation is unchanged.
  const potEvery = (Number(form.potYears)||0) + (Number(form.potMonths)||0)/12;
  function setPotEvery(v){
    const snapped = Math.max(0, Math.round(v*2)/2);
    const years = Math.floor(snapped);
    setForm(f=>({...f, potYears:years, potMonths:Math.round((snapped-years)*12)}));
  }
  const sortedRooms=[...rooms].sort((a,b)=>(a.order??0)-(b.order??0));
  const fileRef=useRef();
  const [editingNotes,setEditingNotes]=useState(false);
  const [notesDraft,setNotesDraft]=useState("");
  const [confirmDel,setConfirmDel]=useState(false);
  const isDark = useIsDark();
  const [modalClosing, dismissModal] = useSheetDismiss(onClose);

  // Browsers sometimes leave a typed leading zero ("020") on screen after a
  // number input's value is reprogrammed to "20", since the parsed number
  // didn't change — they treat it as a no-op. Forcing the DOM value directly
  // on blur (rather than relying on React's props diff) clears it reliably.
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

  const selRoom = sortedRooms.find(r=>r.id===form.roomId);
  const stepBtn = (dir, onClick, tint) => (
    <button type="button" className={`pm-step ${dir}`} style={{background:dir==="dec"?"var(--surface)":tint,color:dir==="dec"?tint:"#fff"}} onClick={onClick}>{dir==="dec"?"\u2212":"+"}</button>
  );

  return (
    <div className={`modal-overlay${modalClosing?" closing":""}${enter==="swap"?" swap":""}${ghost?" ghost":""}`} onClick={ghost?undefined:dismissModal}>
      <div className="modal pm-modal" onClick={e=>e.stopPropagation()}>
        {/* Header (6a/6b) */}
        <div className="pm-header">
          <button type="button" className="pm-icon-btn" onClick={onCancel||onClose}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
          <div className="pm-title">{plant?`Edit ${plant.name||""}`:"New Plant"}</div>
          <button type="button" className="pm-save-btn" onClick={()=>{ if(!form.name.trim()) return alert("Plant name required."); onSave(form); }}>Save</button>
        </div>

        <div className="pm-body">
          {/* Name + Got (date obtained) */}
          <div style={{display:"flex",gap:7}}>
            <div className="pm-card pm-name-card" style={{flex:1}}>
              <div className="pm-lbl">Name</div>
              <input className="pm-name-input" value={form.name} maxLength={NAME_MAX}
                onChange={e=>set("name",e.target.value.slice(0,NAME_MAX))} placeholder="e.g. Monstera"/>
              <span className={`pm-name-rule${form.name.length>=NAME_MAX?" at-cap":""}`}/>
              {form.name.length>=NAME_COUNTER_AT && (
                <div className={`name-counter${form.name.length>=NAME_MAX?" at-cap":""}`}>{form.name.length} / {NAME_MAX}</div>
              )}
            </div>
            <div className="pm-card pm-got-card" style={{width:136,flexShrink:0}}>
              <div className="pm-lbl">Got</div>
              <CalendarField value={form.obtainedDate} onChange={d=>set("obtainedDate",d)} className="pm-date-chip" label="Date obtained"/>
              <div className="pm-got-caption">{form.obtainedDate===fmt(getToday())?"age starts now":`${plantAgeDecimal(form.obtainedDate)} ago`}</div>
            </div>
          </div>

          {tipOpen && (
            <div className="tip-scrim" onClick={()=>setTipOpen(false)}>
              <div className="tip-card" onClick={e=>e.stopPropagation()}>
                <div className="tip-head">Not sure how often to water?</div>
                <p className="tip-body">Start at <strong>7 days</strong>. When it comes due, check the soil first: if the top inch or two is dry, water it. If it’s still moist, add a few days and check again. Repeat and you’ll land on the right frequency for your plant.</p>
                <button className="tip-btn" onClick={()=>setTipOpen(false)}>Got it</button>
              </div>
            </div>
          )}

          {/* Room — horizontal scroll, own colors, selected gets a ring (6a) */}
          <div className="pm-card" style={{padding:"9px 0 10px"}}>
            <div className="pm-lbl" style={{padding:"0 14px",marginBottom:5}}>Room</div>
            <div className="pm-room-scroll">
              {sortedRooms.map(r=>{
                const sel = form.roomId===r.id;
                const tint = r.color ? { background:r.color, color:roomTextColor(r.color) } : { background:"var(--sand)", color:"var(--text)" };
                return (
                  <span key={r.id} className={`pm-room-chip${sel?" selected":""}`} style={{...tint, boxShadow:sel?selectRing(r.color||"var(--sand)", isDark):undefined}}
                    onClick={()=>set("roomId",r.id)}>{r.name}</span>
                );
              })}
            </div>
          </div>

          {/* Health — 4-tile grid, selected gets a ring (6a) */}
          <div className="pm-card">
            <div className="pm-lbl" style={{marginBottom:8}}>Health</div>
            <div className="pm-health-grid">
              {[1,2,3,4].map(h=>{
                const sel = form.health===h;
                const t = healthTint(h,isDark);
                return (
                  <div key={h} className={`pm-health-tile${sel?" selected":""}`}
                    style={{background:t.bg,color:t.text,boxShadow:sel?selectRing(HEALTH[h].color, isDark):undefined}}
                    onClick={()=>set("health",h)}>{HEALTH[h].label}</div>
                );
              })}
            </div>
          </div>

          {/* Watering panel (6a) */}
          <div className="pm-panel water">
            <div className="pm-panel-head">
              <span className="pm-panel-title">Water</span>
              <span className="pm-panel-badge">{form.lastWatered===fmt(getToday())?"starts today":`last ${plantAgeDecimal(form.lastWatered)} ago`}</span>
            </div>
            <div className="pm-stepper-row">
              <span className="pm-stepper-lbl">Water every
                <button type="button" className="tip-q" aria-label="Watering guidance"
                  onClick={()=>setTipOpen(true)}>?</button>
              </span>
              <div className="pm-stepper">
                {stepBtn("dec",()=>set("waterFreqDays",Math.max(1,(Number(form.waterFreqDays)||1)-1)),"var(--water)")}
                <span className="pm-stepper-val">{form.waterFreqDays}d</span>
                {stepBtn("inc",()=>set("waterFreqDays",(Number(form.waterFreqDays)||0)+1),"var(--water)")}
              </div>
            </div>
            <div className="pm-row-between">
              <span>Last watered</span>
              <CalendarField value={form.lastWatered} onChange={d=>set("lastWatered",d)} className="pm-date-pill water" label="Last watered" short/>
            </div>
          </div>

          {/* Potting panel (6a) */}
          <div className="pm-panel potting">
            <div className="pm-panel-head">
              <span className="pm-panel-title">Pot</span>
              <label className="pm-toggle-row">
                Original pot
                <span className={`pm-toggle${form.originalPot?" on":""}`} onClick={()=>set("originalPot",!form.originalPot)}><span className="pm-toggle-knob"/></span>
              </label>
            </div>
            <div className="pm-stepper-row">
              <span>Size</span>
              <div className="pm-stepper">
                {stepBtn("dec",()=>setForm(f=>{const v=Math.max(0.5,(Number(f.currentPotSize)||0)-0.5);return {...f,currentPotSize:v,nextPotSize:Math.round((v+1)*2)/2};}),"var(--accent)")}
                <span className="pm-stepper-val">{form.currentPotSize}&quot;</span>
                {stepBtn("inc",()=>setForm(f=>{const v=(Number(f.currentPotSize)||0)+0.5;return {...f,currentPotSize:v,nextPotSize:Math.round((v+1)*2)/2};}),"var(--accent)")}
              </div>
            </div>
            {/* Stepping Pot size still pre-fills this to one inch larger; this
                stepper overrides it when the next pot is a different jump. */}
            <div className="pm-stepper-row">
              <span>Next size</span>
              <div className="pm-stepper">
                {stepBtn("dec",()=>set("nextPotSize",Math.max(0.5,(Number(form.nextPotSize)||0)-0.5)),"var(--accent)")}
                <span className="pm-stepper-val">{form.nextPotSize}&quot;</span>
                {stepBtn("inc",()=>set("nextPotSize",(Number(form.nextPotSize)||0)+0.5),"var(--accent)")}
              </div>
            </div>
            {/* One stepper in years moving in half-year steps, rather than a
                years and a months stepper side by side. Storage stays
                potYears + potMonths, so isPotDue and any value already saved
                with an odd number of months keep working; a step just snaps to
                the nearest half year from wherever it is. */}
            <div className="pm-stepper-row">
              <span>Repot every</span>
              <div className="pm-stepper">
                {stepBtn("dec",()=>setPotEvery(potEvery-0.5),"var(--accent)")}
                <span className="pm-stepper-val">{potEvery?repotEveryLabel(form):"0y"}</span>
                {stepBtn("inc",()=>setPotEvery(potEvery+0.5),"var(--accent)")}
              </div>
            </div>
            <div className="pm-row-between">
              <span>Last potted</span>
              <CalendarField value={form.pottedDate} onChange={d=>set("pottedDate",d)} className="pm-date-pill potting" label="Last potted" short/>
            </div>
          </div>

          {/* Notes */}
          <div className={`pm-card notes-card${editingNotes?" editing":""}`}>
            <div className="pm-lbl" style={{marginBottom:5}}>Notes</div>
            {editingNotes?(
              <>
                <textarea className="notes-editor" value={notesDraft} onChange={e=>setNotesDraft(e.target.value)} placeholder="Add any notes about this plant..." autoFocus/>
                <div className="notes-editor-actions">
                  <button title="Delete note" onClick={()=>{set("notes","");setNotesDraft("");setEditingNotes(false);}} style={{background:"none",border:"none",cursor:"pointer",color:"var(--text-muted)",padding:"4px 6px",fontSize:18,lineHeight:1}}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                  </button>
                  <button title="Save note" onClick={()=>{set("notes",notesDraft.trim());setEditingNotes(false);}} style={{background:"var(--leaf)",border:"none",borderRadius:7,padding:"5px 14px",cursor:"pointer",color:"white",fontFamily:"var(--font-ui)",fontSize:13,fontWeight:700}}>
                    Save
                  </button>
                </div>
              </>
            ):(
              form.notes
                ? <div style={{position:"relative",cursor:"pointer"}} onClick={()=>{setNotesDraft(form.notes);setEditingNotes(true);}}>
                    <div className="notes-preview">{form.notes.length>120?form.notes.slice(0,120)+"…":form.notes}</div>
                  </div>
                : <button className="notes-add-btn" onClick={()=>{setNotesDraft("");setEditingNotes(true);}}>+ Add a note…</button>
            )}
          </div>

          {/* 6a: a plain strip, no card/label/shadow. Add only: in Edit,
              photos are managed from the View card (add from its grid, set
              main or delete in the viewer), so this is not shown there. The
              form still carries the plant's photos, so saving an edit keeps
              them untouched. */}
          {!plant && <div className="pm-photo-strip">
            {(form.photos||[]).map((src,i)=>(
              <div key={i} className="pm-photo-strip-thumb">
                <img src={src} alt=""/>
                <button type="button" onClick={()=>removePhoto(i)} aria-label="Remove photo">✕</button>
              </div>
            ))}
            <div className="pm-photo-add" onClick={()=>fileRef.current.click()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5A2 2 0 0 1 5 6.5h1.6l1-2h4.8l1 2H15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="10" cy="12.5" r="3"/></svg>
            </div>
            <div className="pm-photo-add-lbl">Add photos<br/><em>first one becomes the main shot</em></div>
            <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handlePhoto}/>
          </div>}

          {/* Clone + Delete sit together at the bottom (6b) */}
          {(onDelete || (plant && onClone)) && (
            <div style={{display:"flex",gap:8}}>
              {plant && onClone && (
                <button type="button" className="pm-bottom-btn clone" onClick={handleClone}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
                  Clone
                </button>
              )}
              {onDelete && (
                <button type="button" className="pm-bottom-btn danger" onClick={()=>setConfirmDel(true)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/></svg>
                  Delete
                </button>
              )}
            </div>
          )}
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
function WaterScreen({ rooms, plants, setPlants, todayDate, showCardPhotos=true, user, pushUndo }) {
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
    const add = freqPick;
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
    else { setOpenFreq(plantId); setFreqPick(7); setFreqCustom(""); }   // 7d preselected, per 16a
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
                  <div className="freq-tooltip-title">Add days</div>
                  <div className="freq-presets">
                    {[3,7,10].map(d=>(
                      <button key={d} className={`freq-opt${freqPick===d?" active":""}`}
                        onClick={()=>setFreqPick(d)}>
                        {d}d
                      </button>
                    ))}
                  </div>
                  <div className="freq-step-row">
                    <div className="freq-stepper">
                      <button className="freq-step-btn" aria-label="One day fewer"
                        onClick={()=>setFreqPick(v=>Math.max(1,(v||1)-1))}>&minus;</button>
                      <span className="freq-step-val">{freqPick||1} day{(freqPick||1)===1?"":"s"}</span>
                      <button className="freq-step-btn plus" aria-label="One day more"
                        onClick={()=>setFreqPick(v=>(v||0)+1)}>+</button>
                    </div>
                    <button className="freq-commit" aria-label="Add days"
                      onClick={()=>saveFreq(plant.id)}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
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
                  <div className="freq-tooltip-title">Add days</div>
                  <div className="freq-presets">
                    {[3,7,10].map(d=>(
                      <button key={d} className={`freq-opt${freqPick===d?" active":""}`}
                        onClick={()=>setFreqPick(d)}>
                        {d}d
                      </button>
                    ))}
                  </div>
                  <div className="freq-step-row">
                    <div className="freq-stepper">
                      <button className="freq-step-btn" aria-label="One day fewer"
                        onClick={()=>setFreqPick(v=>Math.max(1,(v||1)-1))}>&minus;</button>
                      <span className="freq-step-val">{freqPick||1} day{(freqPick||1)===1?"":"s"}</span>
                      <button className="freq-step-btn plus" aria-label="One day more"
                        onClick={()=>setFreqPick(v=>(v||0)+1)}>+</button>
                    </div>
                    <button className="freq-commit" aria-label="Add days"
                      onClick={()=>saveFreq(plant.id)}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
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
      <div className="section" style={{paddingTop:10}}>
        {/* Today's due plants — wrapped with a min-height matching the "all
            done" celebration block, so Up Next doesn't jump down when the
            last plant is watered and the content underneath it changes. */}
        <div style={{minHeight:DUE_SECTION_MIN_H}}>
          {allDone?(
            <div className={`celebration${doneEntering?" all-done":""}`}>
              <span className="drip d1"/><span className="drip d2"/><span className="drip d3"/>
              <div className="celebration-head" style={{color:"#0a7a43"}}>All done for today!</div>
              <div className="celebration-pill water" style={{background:"var(--leaf-pale)",color:"var(--leaf)"}}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                {plants.filter(p=>!p.status && p.lastWatered===todayDate).length} watered today
              </div>
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
          <div className="repot-empty-card">
            <div className="repot-empty-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>
            </div>
            <div className="repot-empty-head">{nextRepot ? `Nothing due for ${nextRepotAway}` : "Nothing due to repot"}</div>
            {nextRepot && <p className="repot-empty-body">Next up is <strong>{nextRepot.name}</strong> in {nextRepotMonth}. It’ll show up here when it’s close.</p>}
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

// ─── Repot Screen ─────────────────────────────────────────────────────────────
function RepotScreen({ rooms, plants, setPlants, todayDate, showCardPhotos=true, user, pushUndo }) {
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

  // 14c: the empty state names the next plant due and roughly when.
  const upcoming = plants.map(p=>({p, d:repotDueDate(p)})).filter(x=>x.d && x.d>now)
    .sort((a,b)=>a.d-b.d)[0];
  const nextRepot = upcoming ? upcoming.p : null;
  const nextRepotMonth = upcoming ? MONTH_NAMES[upcoming.d.getMonth()] : "";
  const nextRepotAway = (() => {
    if (!upcoming) return "";
    const days = Math.round((upcoming.d - now) / 864e5);
    if (days < 31) return `${days} day${days===1?"":"s"}`;
    const months = Math.round(days/30);
    if (months < 12) return `${months} month${months===1?"":"s"}`;
    const years = Math.round(days/365);
    return `${years} year${years===1?"":"s"}`;
  })();

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
      <div className="section" style={{paddingTop:10}}>
        {/* Due list / empty state — min-height matches the empty-state block
            so Up Next doesn't shift when the last plant is repotted. */}
        <div style={{minHeight:DUE_SECTION_MIN_H}}>
          {due.length===0&&(
            <div className={`celebration${doneEntering?" all-done":""}`}>
              <div className="celebration-head" style={{color:"var(--potting-head)"}}>Everyone&rsquo;s happy!</div>
              <div className="celebration-pill" style={{background:"var(--potting)",color:"var(--potting-head)"}}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v10M8 6l4-4 4 4M5 14h14l-2 7H7l-2-7z"/></svg>
                {plants.filter(p=>!p.status && p.pottedDate && new Date(p.pottedDate).getFullYear()===new Date(todayDate).getFullYear()).length} repotted this year
              </div>
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
// Lived duration as "Xy Ym" / "Xm", never zero — even a plant that died the
// same month it arrived gets credit for at least a month (8b).
function livedLabel(obtained, died) {
  if (!obtained || !died) return "-";
  const a = new Date(obtained+"T12:00:00"), b = new Date(died+"T12:00:00");
  let months = (b.getFullYear()-a.getFullYear())*12 + (b.getMonth()-a.getMonth());
  months = Math.max(1, months);
  const y = Math.floor(months/12), m = months%12;
  return y>0 ? `${y}y${m?` ${m}m`:""}` : `${m}m`;
}
function monthDay(d) {
  if (!d) return "-";
  const dt = new Date(d+"T12:00:00");
  return `${MONTH_NAMES[dt.getMonth()].slice(0,3)} ${dt.getDate()}`;
}
function monthYear(d) {
  if (!d) return "-";
  const dt = new Date(d+"T12:00:00");
  return `${MONTH_NAMES[dt.getMonth()].slice(0,3)} ${dt.getFullYear()}`;
}

function GraveyardScreen({ rooms, plants, setPlants, showCardPhotos, user }) {
  const [detailPlant, setDetailPlant] = useState(null);
  const buried = (plants || []).filter(p => p.status === "graveyard");
  const roomById = Object.fromEntries(rooms.map(r=>[r.id,r]));

  // Grouped by the year the plant died, most recent year first (8b).
  const byYear = {};
  buried.forEach(p => {
    const y = p.diedDate ? new Date(p.diedDate+"T12:00:00").getFullYear() : "Unknown";
    (byYear[y] ||= []).push(p);
  });
  const years = Object.keys(byYear).sort((a,b)=>Number(b)-Number(a));
  years.forEach(y => byYear[y].sort((a,b)=>a.name.localeCompare(b.name)));

  const avgMonths = buried.length ? Math.round(
    buried.reduce((sum,p) => {
      if (!p.obtainedDate || !p.diedDate) return sum;
      const a=new Date(p.obtainedDate+"T12:00:00"), b=new Date(p.diedDate+"T12:00:00");
      return sum + Math.max(1,(b.getFullYear()-a.getFullYear())*12+(b.getMonth()-a.getMonth()));
    }, 0) / buried.length
  ) : 0;
  const avgLabel = avgMonths >= 12 ? `${(avgMonths/12).toFixed(1)}y` : `${avgMonths}m`;

  return (
    <>
      <div className="page-header graveyard">
        <HdrTitle>Graveyard</HdrTitle>
      </div>
      <div className="section" style={{paddingTop:12}}>
        <p className="page-sub">Here lies your dearly departed. Rest in peace 😢.</p>
        {buried.length===0 && (
          <div className="empty"><span className="ico">🪦</span><p>No plants here for now. Enjoy it while it lasts.</p></div>
        )}
        {buried.length>0 && (
          <div style={{display:"flex",gap:6,marginBottom:11}}>
            <div className="grave-stat"><div className="grave-stat-val">{buried.length}</div><div className="grave-stat-lbl">Remembered</div></div>
            <div className="grave-stat"><div className="grave-stat-val">{avgLabel}</div><div className="grave-stat-lbl">Average life</div></div>
          </div>
        )}
        {years.map(y => (
          <div key={y}>
            <div className="grave-year-row">
              <span>{y}</span><span className="grave-year-line"/><span className="grave-year-count">{byYear[y].length}</span>
            </div>
            {byYear[y].map(p => {
              const room = roomById[p.roomId];
              const photo = getPrimaryPhoto(p);
              return (
                <div key={p.id} className="grave-row" onClick={()=>setDetailPlant(p)}>
                  {photo
                    ? <img src={photo} className="grave-photo" alt=""/>
                    : <div className="grave-photo grave-photo-blank">{(p.name||"?").trim().charAt(0).toUpperCase()}</div>}
                  <div style={{flex:1,minWidth:0}}>
                    <div className="plant-name">{p.name}</div>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginTop:3}}>
                      {room && (room.color
                        ? <span className="card-room-pill" style={{background:room.color,color:roomTextColor(room.color)}}>{room.name}</span>
                        : <span className="card-room-pill" style={{background:"var(--sand)",color:"var(--text)"}}>{room.name}</span>)}
                      <span className="card-sub-text">{monthYear(p.obtainedDate)} &ndash; {monthYear(p.diedDate)}</span>
                    </div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div className="grave-lived-val">{livedLabel(p.obtainedDate,p.diedDate)}</div>
                    <div className="grave-lived-lbl">Lived</div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
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

function RecentlyDeletedScreen({ rooms, plants, setPlants, showCardPhotos, user }) {
  const [detailPlant, setDetailPlant] = useState(null);
  // Soonest to be purged first
  const trashed = (plants || []).filter(p => p.status === "deleted")
    .sort((a,b) => String(a.deletedDate||"").localeCompare(String(b.deletedDate||"")) || a.name.localeCompare(b.name));
  const roomById = Object.fromEntries(rooms.map(r=>[r.id,r]));

  return (
    <>
      <div className="page-header charcoal">
        <HdrTitle>Recently Deleted</HdrTitle>
      </div>
      <div className="section" style={{paddingTop:12}}>
        <p className="page-sub">{trashed.length} plant{trashed.length!==1?"s":""} &middot; Permanently deleted after {PURGE_DAYS} days</p>
        {trashed.length===0 && (
          <div className="empty"><span className="ico">🗑</span><p>Nothing here.</p></div>
        )}
        {trashed.map(p => {
          const room = roomById[p.roomId];
          const photo = getPrimaryPhoto(p);
          const daysLeft = daysUntilPurge(p);
          return (
            <div key={p.id} className="rd-row" onClick={()=>setDetailPlant(p)}>
              {photo
                ? <img src={photo} className="rd-photo" alt=""/>
                : <div className="rd-photo rd-photo-blank">{(p.name||"?").trim().charAt(0).toUpperCase()}</div>}
              <div style={{flex:1,minWidth:0}}>
                <div className="plant-name">{p.name}</div>
                <div style={{display:"flex",alignItems:"center",gap:6,marginTop:3}}>
                  {room && (room.color
                    ? <span className="card-room-pill" style={{background:room.color,color:roomTextColor(room.color)}}>{room.name}</span>
                    : <span className="card-room-pill" style={{background:"var(--sand)",color:"var(--text)"}}>{room.name}</span>)}
                  <span className="card-sub-text">deleted {monthDay(p.deletedDate)}</span>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                <span className="rd-days-left">{daysLeft} day{daysLeft===1?"":"s"} left</span>
                <button className="rd-restore-btn" title="Restore"
                  onClick={e=>{e.stopPropagation(); restorePlant(setPlants, p, "active");}}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.9" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M4 9h10a6 6 0 1 1 0 12h-3"/></svg>
                </button>
              </div>
            </div>
          );
        })}
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

function NotificationsScreen({
  waterEnabled, setWaterEnabled, waterTime, setWaterTime,
  repotEnabled, setRepotEnabled, repotTime, setRepotTime,
}) {
  // Domain colours per row (9c): each panel uses its own tint, ink, and "on"
  // colour rather than one shared treatment.
  const rows = [
    { key:"water", label:"Water Reminder", enabled:waterEnabled, setEnabled:setWaterEnabled, time:waterTime, setTime:setWaterTime,
      bg:"var(--water-tint)", ink:"var(--water-ink)", on:"var(--water)", divider:"rgba(23,98,127,.14)" },
    { key:"repot", label:"Repot Reminder", enabled:repotEnabled, setEnabled:setRepotEnabled, time:repotTime, setTime:setRepotTime,
      bg:"var(--potting-panel)", ink:"var(--potting-head)", on:"var(--accent)", divider:"rgba(163,69,10,.14)" },
  ];
  return (
    <>
      <div className="page-header charcoal">
        <HdrTitle>Notifications</HdrTitle>
      </div>
      <div className="section" style={{paddingTop:12}}>
        <div className="notif-grid">
        {rows.map(r => (
          <div key={r.key} className={`notif-panel ${r.key==="repot"?"potting":"water"}`} style={{background:r.bg}}>
            <div className="util-row notif-head-row">
              <div className="util-label" style={{color:r.ink}}>{r.label}</div>
              <label className="toggle-switch">
                <input type="checkbox" checked={r.enabled} onChange={e=>r.setEnabled(e.target.checked)}/>
                <div className="toggle-track" style={{background:r.enabled?r.on:undefined}}>
                  <div className="toggle-thumb"/>
                </div>
              </label>
            </div>
            <div style={{height:1,background:r.divider,margin:"0 12px"}}/>
            {/* Time always shows, dimmed rather than hidden when off (9c) —
                the schedule is still there, just not acting on it yet. */}
            <div className="util-row notif-time-row" style={{opacity:r.enabled?1:.45}}>
              <div className="util-label" style={{color:r.ink,fontSize:12.5}}>Time</div>
              <div className="notif-time-pill" style={{color:r.ink}}>
                <input type="time" value={r.time} onChange={e=>r.setTime(e.target.value)} disabled={!r.enabled}/>
              </div>
            </div>
          </div>
        ))}
        </div>
        <div className="notif-footnote">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4.5M12 8h.01"/></svg>
          <span>Reminders are sent once per day and only when something is actually due.</span>
        </div>
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

  // No in-header back button on these: the Utils nav button resets sub to null,
  // which is the way back.
  if (sub === "graveyard")
    return <GraveyardScreen rooms={rooms} plants={plants} setPlants={setPlants}
             showCardPhotos={showCardPhotos} user={user}/>;
  if (sub === "deleted")
    return <RecentlyDeletedScreen rooms={rooms} plants={plants} setPlants={setPlants}
             showCardPhotos={showCardPhotos} user={user}/>;
  if (sub === "notifications")
    return <NotificationsScreen
             waterEnabled={notifWaterEnabled} setWaterEnabled={setNotifWaterEnabled}
             waterTime={notifWaterTime} setWaterTime={setNotifWaterTime}
             repotEnabled={notifRepotEnabled} setRepotEnabled={setNotifRepotEnabled}
             repotTime={notifRepotTime} setRepotTime={setNotifRepotTime}/>;

  return (
    <>
      <div className="section" style={{paddingTop:14}}>
        <div style={{fontSize:11,fontWeight:800,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"1.2px",marginBottom:11,paddingLeft:4}}>Appearance</div>
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
        <div style={{fontSize:11,fontWeight:800,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"1.2px",marginBottom:11,paddingLeft:4}}>Plants</div>
        <div className="util-section">
          <div className="util-row tappable" onClick={()=>setSub("graveyard")}>
            <div>
              <div className="util-label">Graveyard</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span className="util-count-badge">{graveCount}</span>
              <span className="util-chevron"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg></span>
            </div>
          </div>
          <div className="util-row tappable" onClick={()=>setSub("deleted")}>
            <div>
              <div className="util-label">Recently Deleted</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span className="util-count-badge">{trashCount}</span>
              <span className="util-chevron"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg></span>
            </div>
          </div>
          <div className="util-row">
            <div>
              <div className="util-label">OOT Water Schedule</div>
              <div className="util-sublabel">A caretaker watering guide while you're traveling</div>
            </div>
            <button className="util-btn secondary" onClick={onOpenSchedule}>Create</button>
          </div>
        </div>
        <div style={{fontSize:11,fontWeight:800,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"1.2px",marginBottom:11,paddingLeft:4}}>Data</div>
        <div className="util-section">
          <div className="util-row">
            <div>
              <div className="util-label">Export Plants</div>
              <div className="util-sublabel">As a spreadsheet or a full backup</div>
            </div>
            <button className="util-btn secondary" onClick={onOpenExport}>Export</button>
          </div>
          <div className="util-row">
            <div>
              <div className="util-label">Import Plants</div>
              <div className="util-sublabel">Add or update in bulk, or restore a backup</div>
            </div>
            <button className="util-btn secondary" onClick={onImport}>Import</button>
          </div>
        </div>

        {user && <>
          <div style={{fontSize:11,fontWeight:800,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"1.2px",marginBottom:11,paddingLeft:4}}>Account</div>
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
                <div className="util-label" style={{color:"var(--danger)"}}>Delete Account</div>
                <div className="util-sublabel">Permanently remove all your data</div>
              </div>
              {!confirmDelete
                ? <button className="util-btn" style={{border:"none",background:"var(--danger-tint)",color:"var(--danger)"}} onClick={()=>setConfirmDelete(true)}>Delete</button>
                : <div style={{display:"flex",gap:6}}>
                    <button className="util-btn secondary" onClick={()=>setConfirmDelete(false)}>Cancel</button>
                    <button className="util-btn" style={{background:"var(--danger)",color:"white"}} onClick={onDeleteAccount}>Confirm</button>
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
