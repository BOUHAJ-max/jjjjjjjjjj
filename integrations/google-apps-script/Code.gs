/**
 * BOUHAJ Landing Builder 0.1.1 — Google Apps Script Order Receiver
 * Deploy as Web app: Execute as Me / Who has access: Anyone.
 * Every order becomes ONE row in the "Orders" sheet of the spreadsheet "BOUHAJ Orders".
 */
const CONFIG = {
  spreadsheetProperty: 'BOUHAJ_SPREADSHEET_ID',
  sheetName: 'Orders',
  maxBodyBytes: 100000,
  rateLimitSeconds: 60,
  maxRequestsPerWindow: 5,
  inventorySheet: 'Inventory',   // optional: create it (run setupInventory) to make THIS sheet the authoritative stock
  maxQuantity: 20,
  globalMaxPerMinute: 30,        // all visitors together: slows a script that rotates phone numbers to drain stock (it cannot stop a determined attacker; use Turnstile)
  onPriceMismatch: 'flag',       // 'flag' = accept, store the SERVER price and mark the order needs-review | 'reject' = refuse with PRICE_MISMATCH
  leadsSheet: 'Leads',            // CPA pages (type:'lead') write here, one row per lead
  requireConsent: false,         // true = refuse leads whose payload lacks consent.privacy === true
  turnstileSecretProperty: 'TURNSTILE_SECRET'   // Script Properties: when set, every NEW order must carry a valid Cloudflare Turnstile token
};
const HEADERS = ['order_id','created_at','name','phone','city','address','note','product','amount','currency','sku','quantity','page','product_id','variant_id','variant','unit_price','inventory_key','inventory','status','price_check','amount_server'];
const INVENTORY_HEADERS = ['inventory_key','stock','label','price'];
const LEAD_HEADERS = ['lead_id','created_at','offer_id','family','category','name','email','phone','city','address','message','date','time','service','quantity','zip','country','age','answers','utm','click_id','sub_ids','page','consent','status'];
const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}:([a-z0-9][a-z0-9_-]{0,63}|-)$/;

function doGet(e){
  // ?action=stock -> {ok:true,stock:{key:n}}: ONLY tracked keys, counts capped at maxQuantity. No personal data, no spreadsheet id.
  if(e && e.parameter && e.parameter.action === 'stock') return jsonResponse_({ok:true,stock:readStock_()});
  // Health check. Never expose the spreadsheet id / url publicly.
  return jsonResponse_({ok:true,service:'BOUHAJ Orders',version:'0.1.1'});
}

function doPost(e){
  try{
    const raw = e && e.postData ? String(e.postData.contents || '') : '';
    if(raw.length > CONFIG.maxBodyBytes) return jsonResponse_({ok:false,error:'Payload too large'});
    const data = parsePayload_(raw);
    if(!data || typeof data !== 'object') return jsonResponse_({ok:false,error:'Invalid payload'});
    if(String(data.website || data.company || '').trim()) return jsonResponse_({ok:true,ignored:true});

    if(String(data.type || '') === 'lead') return handleLead_(data);

    const phone = normalizePhone_(data.phone);
    if(!validPhone_(phone)) return jsonResponse_({ok:false,error:'Invalid phone'});
    const name = clean_(data.name,200);
    const city = clean_(data.city,120);
    const address = clean_(data.address,500);
    if(!name || !city || !address) return jsonResponse_({ok:false,error:'Required fields missing'});

    const orderId = normalizeOrderId_(data.order_id) || ('BH-' + Utilities.getUuid());
    // The inventory key must describe the product/variant the browser says it is ordering (the browser still cannot be trusted for the value of either).
    const claimedKey = String(data.inventory_key || '').trim();
    if(claimedKey && data.product_id && claimedKey !== String(data.product_id).trim() + ':' + (String(data.variant_id || '').trim() || '-')) return jsonResponse_({ok:false,error:'Invalid inventory key'});
    // A retry of an order that is already saved must succeed even though its one-time Turnstile token is spent.
    if(findOrder_(getSheet_(),orderId)) return jsonResponse_({ok:true,duplicate:true,order_id:orderId});
    const human = verifyHuman_(data.turnstile_token);
    if(!human.ok) return jsonResponse_({ok:false,error:human.error});
    const lock = LockService.getScriptLock();
    if(!lock.tryLock(15000)) return jsonResponse_({ok:false,error:'Server busy, retry'});
    try{
      const sheet = getSheet_();
      // A retry of an order that was already saved is a success, not an error.
      if(findOrder_(sheet,orderId)) return jsonResponse_({ok:true,duplicate:true,order_id:orderId});
      if(!rateLimit_(phone) || !globalThrottle_()) return jsonResponse_({ok:false,error:'Too many requests'});
      ensureHeaders_(sheet);
      const qty = Math.max(1, Math.min(CONFIG.maxQuantity, parseInt(data.quantity,10) || 1));
      const key = String(data.inventory_key || '').trim();
      if(key && !KEY_RE.test(key)) return jsonResponse_({ok:false,error:'Invalid inventory key'});
      // Authoritative stock check + decrement happen inside the SAME lock as the order insert.
      const res = reserve_(key, qty, toNumber_(data.unit_price), toNumber_(data.amount));
      if(res.tracked && !res.ok && res.priceMismatch) return jsonResponse_({ok:false,error:'PRICE_MISMATCH'});
      if(res.tracked && !res.ok) return jsonResponse_({ok:false,error:'OUT_OF_STOCK',available:Math.min(res.available,CONFIG.maxQuantity)});
      const row = [
        orderId, clean_(data.created_at,60) || new Date().toISOString(),
        name, phone, city, address, clean_(data.note,1000), clean_(data.product,300),
        clean_(data.amount,40), clean_(data.currency,20), clean_(data.sku,100),
        String(qty), cleanUrl_(data.page,1000),
        clean_(data.product_id,64), clean_(data.variant_id,64), clean_(data.variant,200), clean_(data.unit_price,40), key,
        res.tracked ? 'decremented:' + qty : 'untracked',
        res.priceCheck === 'mismatch' ? 'needs-review' : 'new',
        res.priceCheck || 'unverified',
        res.serverAmount == null ? '' : String(res.serverAmount)
      ];
      // Text format first: formulas (=,+,-,@) stay plain text and "+212..." / "06..." keep their exact form.
      const target = sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length);
      try{
        target.setNumberFormat('@');
        target.setValues([row]);
        SpreadsheetApp.flush();
      }catch(writeErr){
        release_(res);                       // never keep a reservation for an order that was not recorded
        throw writeErr;
      }
      return jsonResponse_({ok:true,order_id:orderId,inventory:res.tracked?{remaining:Math.min(res.remaining,CONFIG.maxQuantity)}:'untracked'});
    } finally { lock.releaseLock(); }
  }catch(err){
    console.error(err && err.stack ? err.stack : err);
    return jsonResponse_({ok:false,error:'Server error'});
  }
}

/* ---------------- CPA leads (type:'lead') ----------------
 * A lead is NOT a sale and NOT a network-confirmed conversion: it only means "this form was received and stored".
 * The page may report a confirmed *lead* after ok:true; verified/purchase events need an external postback (see docs/CPA-TRACKING.md). */
const LEAD_ID_RE = /^LD-[a-f0-9]{16,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function getLeadsSheet_(){
  const ss = getSpreadsheet_(); let sh = ss.getSheetByName(CONFIG.leadsSheet);
  if(!sh) sh = ss.insertSheet(CONFIG.leadsSheet);
  if(sh.getLastRow() === 0){ const h = sh.getRange(1,1,1,LEAD_HEADERS.length); h.setNumberFormat('@'); h.setValues([LEAD_HEADERS]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
function json_(v,max){ try{ const s = JSON.stringify(v == null ? '' : v); return s.length > max ? s.slice(0,max) : s; }catch(_){ return ''; } }
function handleLead_(data){
  const leadId = String(data.lead_id || '').trim();
  if(!LEAD_ID_RE.test(leadId)) return jsonResponse_({ok:false,error:'Invalid lead id'});
  const email = clean_(data.email,200).toLowerCase();
  const phone = data.phone ? normalizePhone_(data.phone) : '';
  if(!email && !phone) return jsonResponse_({ok:false,error:'Contact required'});
  if(email && !EMAIL_RE.test(email)) return jsonResponse_({ok:false,error:'Invalid email'});
  if(phone && !validPhone_(phone)) return jsonResponse_({ok:false,error:'Invalid phone'});
  const consent = data.consent && typeof data.consent === 'object' ? data.consent : {};
  if(CONFIG.requireConsent && consent.privacy !== true) return jsonResponse_({ok:false,error:'Consent required'});
  // retry of a stored lead succeeds even though its one-time Turnstile token is spent
  if(findRow_(getLeadsSheet_(),leadId)) return jsonResponse_({ok:true,duplicate:true,lead_id:leadId});
  const human = verifyHuman_(data.turnstile_token);
  if(!human.ok) return jsonResponse_({ok:false,error:human.error});
  const lock = LockService.getScriptLock();
  if(!lock.tryLock(15000)) return jsonResponse_({ok:false,error:'Server busy, retry'});
  try{
    const sh = getLeadsSheet_();
    if(findRow_(sh,leadId)) return jsonResponse_({ok:true,duplicate:true,lead_id:leadId});
    if(!rateLimit_(email || phone) || !globalThrottle_()) return jsonResponse_({ok:false,error:'Too many requests'});
    const answers = Array.isArray(data.answers) ? data.answers.slice(0,10).map(a => ({q:clean_(a && a.q,200),a:clean_(a && a.a,200)})) : [];
    const row = [
      leadId, clean_(data.created_at,60) || new Date().toISOString(), clean_(data.offer_id,60), clean_(data.family,40), clean_(data.category,40),
      clean_(data.name,200), email, phone, clean_(data.city,120), clean_(data.address,500), clean_(data.message,1000), clean_(data.date,30), clean_(data.time,30),
      clean_(data.service,120), clean_(data.quantity,10), clean_(data.zip,20), clean_(data.country,60), clean_(data.age,5),
      json_(answers,3000), json_(cleanMap_(data.utm,12,100),1000), clean_(data.click_id,200), json_(cleanMap_(data.sub_ids,12,100),1000), cleanUrl_(data.page,1000),
      json_({privacy:consent.privacy === true,terms:consent.terms === true,contact:consent.contact === true,age:consent.age === true,at:clean_(consent.at,60)},300),
      'new'
    ];
    const target = sh.getRange(sh.getLastRow() + 1, 1, 1, row.length);
    target.setNumberFormat('@'); target.setValues([row]); SpreadsheetApp.flush();
    return jsonResponse_({ok:true,lead_id:leadId});
  } finally { lock.releaseLock(); }
}
function cleanMap_(m,maxKeys,maxLen){
  const out = {}; if(!m || typeof m !== 'object') return out; let n = 0;
  Object.keys(m).forEach(k => { if(n >= maxKeys || !/^[A-Za-z][A-Za-z0-9_.\-]{0,39}$/.test(k)) return; out[k] = clean_(m[k],maxLen); n++; });
  return out;
}
function findRow_(sheet,id){
  const last = sheet.getLastRow(); if(last < 2) return false;
  return sheet.getRange(2,1,last-1,1).getDisplayValues().some(r => String(r[0]) === id);
}

/** Run once from the editor (Run > setup) and authorize Google. */
function setup(){
  const ss = getSpreadsheet_();
  const sheet = getSheet_();
  const info = {spreadsheetId:ss.getId(),spreadsheetUrl:ss.getUrl(),sheet:sheet.getName()};
  console.log(JSON.stringify(info));
  return info;
}

function getSpreadsheet_(){
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(CONFIG.spreadsheetProperty);
  if(id){ try{ return SpreadsheetApp.openById(id); }catch(_){} }
  const ss = SpreadsheetApp.create('BOUHAJ Orders');
  props.setProperty(CONFIG.spreadsheetProperty, ss.getId());
  return ss;
}
function getSheet_(){
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(CONFIG.sheetName);
  if(!sheet){
    sheet = ss.insertSheet(CONFIG.sheetName);
    const first = ss.getSheetByName('Sheet1') || ss.getSheetByName('Feuille 1') || ss.getSheetByName('ورقة1');
    if(first && ss.getSheets().length > 1 && first.getLastRow() === 0) ss.deleteSheet(first);
  }
  if(sheet.getLastRow() === 0){
    const head = sheet.getRange(1,1,1,HEADERS.length);
    head.setNumberFormat('@'); head.setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}
function findOrder_(sheet,id){
  const last = sheet.getLastRow();
  if(last < 2) return false;
  const values = sheet.getRange(2,1,last-1,1).getDisplayValues();
  return values.some(r => String(r[0]) === id);
}
function rateLimit_(phone){
  const key = 'BOUHAJ_RATE_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,phone));
  const cache = CacheService.getScriptCache();
  const raw = cache.get(key); const count = raw ? Number(raw) : 0;
  if(count >= CONFIG.maxRequestsPerWindow) return false;
  cache.put(key, String(count+1), CONFIG.rateLimitSeconds);
  return true;
}
function normalizePhone_(v){ return String(v==null?'':v).replace(/[\u200e\u200f\u202a-\u202e]/g,'').replace(/[\s.\-()]+/g,'').slice(0,30); }
function validPhone_(phone){ return /^\+?[0-9]{7,20}$/.test(phone); }
function normalizeOrderId_(v){ const s = String(v||'').trim(); return /^BH-[A-Za-z0-9_-]{8,80}$/.test(s) ? s : ''; }
function parsePayload_(raw){
  try{ return JSON.parse(raw); }catch(_){
    const out = {};
    String(raw).split('&').forEach(part => {
      const i = part.indexOf('='); if(i < 0) return;
      const k = part.slice(0,i), v = part.slice(i+1);
      try{ if(k) out[decodeURIComponent(k.replace(/\+/g,' '))] = decodeURIComponent(v.replace(/\+/g,' ')); }catch(_){}
    });
    return out;
  }
}
function clean_(v,max){ return String(v==null?'':v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,max); }
function cleanUrl_(v,max){ const s = clean_(v,max); return /^https?:\/\//i.test(s) ? s : ''; }
function jsonResponse_(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/* ---------------- inventory (optional, authoritative when the 'Inventory' sheet exists) ---------------- */
function inventorySheet_(){ return getSpreadsheet_().getSheetByName(CONFIG.inventorySheet); }
function readStock_(){
  const sh = inventorySheet_(); const out = {};
  if(!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2,1,sh.getLastRow()-1,2).getValues().forEach(r => {
    const k = String(r[0]).trim(), n = Number(r[1]);
    if(KEY_RE.test(k) && isFinite(n)) out[k] = Math.max(0, Math.min(CONFIG.maxQuantity, Math.floor(n)));
  });
  return out;
}
/** Must be called while holding the script lock. Untracked keys (no row / no sheet / blank stock) are accepted and reported as untracked.
 *  If the Inventory row has a numeric 'price' it is the AUTHORITY: the browser's unit_price / amount are only compared against it. */
function reserve_(key, qty, clientUnit, clientAmount){
  if(!key) return {tracked:false};
  const sh = inventorySheet_(); if(!sh || sh.getLastRow() < 2) return {tracked:false};
  const vals = sh.getRange(2,1,sh.getLastRow()-1,4).getValues();
  for(let i = 0; i < vals.length; i++){
    if(String(vals[i][0]).trim() !== key) continue;
    const cur = Number(vals[i][1]);
    if(vals[i][1] === '' || !isFinite(cur)) return {tracked:false};
    const price = vals[i][3] === '' ? NaN : Number(vals[i][3]);
    let priceCheck = 'unverified', serverAmount = null;
    if(isFinite(price) && price > 0){
      serverAmount = Math.round(price * qty * 100) / 100;
      const unitOk = clientUnit == null || Math.abs(clientUnit - price) < 0.005;
      const amountOk = clientAmount == null || Math.abs(clientAmount - serverAmount) < 0.01;
      priceCheck = (unitOk && amountOk) ? 'verified' : 'mismatch';
      if(priceCheck === 'mismatch' && CONFIG.onPriceMismatch === 'reject') return {tracked:true,ok:false,priceMismatch:true,available:Math.max(0,Math.floor(cur))};
    }
    if(cur < qty) return {tracked:true,ok:false,available:Math.max(0,Math.floor(cur))};
    sh.getRange(i+2,2).setValue(cur - qty);
    return {tracked:true,ok:true,remaining:cur - qty,row:i+2,previous:cur,priceCheck:priceCheck,serverAmount:serverAmount};
  }
  return {tracked:false};
}
function toNumber_(v){ if(v == null || v === '') return null; const n = Number(String(v).replace(',', '.').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : null; }
/** All visitors together. Not a defence against a determined attacker (Apps Script sees no IP addresses) - a speed bump plus an alarm. */
function globalThrottle_(){
  const cache = CacheService.getScriptCache(); const key = 'BOUHAJ_GLOBAL_' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(key) || 0); if(n >= CONFIG.globalMaxPerMinute) return false;
  cache.put(key, String(n + 1), 120); return true;
}
/** Cloudflare Turnstile. The SECRET lives only in Script Properties (never in the page). With no secret configured, orders are accepted as before. */
function verifyHuman_(token){
  const secret = PropertiesService.getScriptProperties().getProperty(CONFIG.turnstileSecretProperty);
  if(!secret) return {ok:true,skipped:true};
  const t = String(token || '').trim();
  if(!t || t.length > 2048) return {ok:false,error:'HUMAN_CHECK_REQUIRED'};
  try{
    const r = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'post',payload:{secret:secret,response:t},muteHttpExceptions:true});
    const j = JSON.parse(r.getContentText());
    return j && j.success === true ? {ok:true} : {ok:false,error:'HUMAN_CHECK_FAILED'};
  }catch(_){ return {ok:false,error:'HUMAN_CHECK_UNAVAILABLE'}; }
}
/** Seller tool: run from the editor with the order id, e.g. cancelOrder('BH-xxxx'). Restores the stock that order reserved and marks it cancelled. */
function cancelOrder(orderId){
  const id = normalizeOrderId_(orderId); if(!id) return {ok:false,error:'Invalid order id'};
  const lock = LockService.getScriptLock(); if(!lock.tryLock(15000)) return {ok:false,error:'Server busy, retry'};
  try{
    const sheet = getSheet_(); const last = sheet.getLastRow(); if(last < 2) return {ok:false,error:'Order not found'};
    const rows = sheet.getRange(2,1,last-1,HEADERS.length).getValues();
    for(let i = 0; i < rows.length; i++){
      if(String(rows[i][0]) !== id) continue;
      const iStatus = HEADERS.indexOf('status'), iInv = HEADERS.indexOf('inventory'), iKey = HEADERS.indexOf('inventory_key'), iQty = HEADERS.indexOf('quantity');
      if(String(rows[i][iStatus]) === 'cancelled') return {ok:true,already:true};
      let restored = 0;
      if(String(rows[i][iInv]).indexOf('decremented:') === 0){
        const sh = inventorySheet_(); const key = String(rows[i][iKey]).trim(); const qty = parseInt(rows[i][iQty],10) || 0;
        if(sh && sh.getLastRow() > 1 && qty > 0){
          const vals = sh.getRange(2,1,sh.getLastRow()-1,2).getValues();
          for(let k = 0; k < vals.length; k++) if(String(vals[k][0]).trim() === key){ sh.getRange(k+2,2).setValue(Number(vals[k][1]) + qty); restored = qty; break; }
        }
      }
      sheet.getRange(i+2, iStatus+1).setValue('cancelled');
      return {ok:true,restored:restored};
    }
    return {ok:false,error:'Order not found'};
  } finally { lock.releaseLock(); }
}
function release_(res){ if(res && res.tracked && res.ok){ inventorySheet_().getRange(res.row,2).setValue(res.previous); } }
function ensureHeaders_(sheet){
  const have = sheet.getLastColumn();
  if(have >= HEADERS.length) return;
  const missing = HEADERS.slice(have);                    // append only: never rewrite or reorder existing columns
  const r = sheet.getRange(1, have + 1, 1, missing.length);
  r.setNumberFormat('@'); r.setValues([missing]).setFontWeight('bold');
}
/** Run once to create the Inventory sheet. Fill 'stock' with your REAL quantities; delete the sheet to stop tracking. */
function setupInventory(){
  const ss = getSpreadsheet_(); let sh = ss.getSheetByName(CONFIG.inventorySheet);
  if(!sh){ sh = ss.insertSheet(CONFIG.inventorySheet); sh.getRange(1,1,1,INVENTORY_HEADERS.length).setValues([INVENTORY_HEADERS]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return {sheet:sh.getName(),url:ss.getUrl()};
}
/** Adds rows that do not exist yet (see Inventory-seed.gs generated by BOUHAJ). Existing live STOCK is never overwritten;
 *  the declared PRICE column is refreshed so the sheet follows the price you set in the builder. */
function addInventoryRows_(rows){
  setupInventory(); const sh = inventorySheet_(); const have = {}; let priceUpdates = 0;
  if(sh.getLastRow() > 1) sh.getRange(2,1,sh.getLastRow()-1,1).getValues().forEach((r,i) => have[String(r[0]).trim()] = i + 2);
  const add = [];
  rows.forEach(r => {
    if(!KEY_RE.test(r[0])) return;
    const price = r.length > 3 && r[3] !== '' ? Number(r[3]) : '';
    if(have[r[0]]){ if(price !== '' && isFinite(price)){ sh.getRange(have[r[0]],4).setValue(price); priceUpdates++; } }
    else add.push([r[0],r[1],r[2],price === '' || !isFinite(price) ? '' : price]);
  });
  if(add.length) sh.getRange(sh.getLastRow()+1,1,add.length,4).setValues(add);
  return {added:add.length,skipped:rows.length-add.length-priceUpdates,pricesUpdated:priceUpdates};
}
