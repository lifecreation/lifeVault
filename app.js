/* ============================================================
   LifeVault — Application Logic
   Storage: localStorage for account/auth/pin metadata,
            IndexedDB for actual file/image blobs (handles large data
            safely, unlike localStorage which silently fails >5MB).
   NOTE: This is a static front-end build (GitHub Pages, no server).
         OTP is SIMULATED on-screen (no real SMS gateway wired up).
         Swap simulateSendOtp() for a real API call when you add a backend.
   ============================================================ */

(function(){
"use strict";

/* ---------------- CONSTANTS ---------------- */
const DB_NAME = "lifevault_db";
const DB_VERSION = 1;
const STORE_FILES = "files";
const LS_USERS = "lv_users";          // registered accounts
const LS_SESSION = "lv_session";      // current logged in user id
const LS_DOCS = "lv_documents";       // document metadata (per user)
const LS_PIN_PREFIX = "lv_pin_";      // pin hash per user
const LS_LOCK_STATE = "lv_lock_state";

const CATEGORIES = [
  { id:"aadhaar", name:"Aadhaar Card", icon:"id", color:"#d4a843" },
  { id:"pan", name:"PAN Card", icon:"card", color:"#4fae8a" },
  { id:"voter", name:"Voter ID", icon:"vote", color:"#7a8fd6" },
  { id:"student", name:"Student ID", icon:"book", color:"#d67ab8" },
  { id:"office", name:"Office ID", icon:"briefcase", color:"#e2a14f" },
  { id:"important", name:"Important Documents", icon:"folder", color:"#e2604f" },
  { id:"photos", name:"Photos", icon:"image", color:"#4fb3d6" },
];

const ICONS = {
  id:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2"/><line x1="14" y1="9" x2="19" y2="9"/><line x1="14" y1="13" x2="19" y2="13"/></svg>',
  card:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
  vote:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z"/></svg>',
  book:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  briefcase:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
  folder:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  image:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  doc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};

/* ---------------- STATE ---------------- */
let state = {
  currentUser: null,
  documents: [],
  currentView: "home",
  currentCategory: null,
  pinSetupBuffer: "",
  pinSetupFirstEntry: null,
  pinLockBuffer: "",
  pinAttempts: 0,
  cameraStream: null,
  capturedBlob: null,
  pendingSaveBlob: null,
  pendingSaveIsImage: true,
  pendingSaveCategory: null,
  forgotPhone: "",
  pendingOtp: "",
  otpPurpose: "", // 'reset'
  currentViewerDocId: null,
  shareTargetDocId: null,
  deleteTargetDocId: null,
  searchQuery: "",
};

/* ---------------- INDEXEDDB ---------------- */
let dbPromise = null;
function openDB(){
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_FILES)){
        db.createObjectStore(STORE_FILES, { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

async function dbPutFile(id, blob){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, "readwrite");
    tx.objectStore(STORE_FILES).put({ id, blob });
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function dbGetFile(id){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, "readonly");
    const req = tx.objectStore(STORE_FILES).get(id);
    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function dbDeleteFile(id){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, "readwrite");
    tx.objectStore(STORE_FILES).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

/* blob URL cache so we don't re-read IndexedDB constantly */
const blobUrlCache = new Map();
async function getDocObjectUrl(docId){
  if (blobUrlCache.has(docId)) return blobUrlCache.get(docId);
  try{
    const blob = await dbGetFile(docId);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    blobUrlCache.set(docId, url);
    return url;
  }catch(e){
    console.error("getDocObjectUrl failed", e);
    return null;
  }
}

/* ---------------- UTIL ---------------- */
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,9); }

function showScreen(id){
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
}

function showToast(msg, type="info"){
  const stack = document.getElementById("toastStack");
  const icons = {
    success:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    info:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.innerHTML = (icons[type]||icons.info) + "<span>"+escapeHtml(msg)+"</span>";
  stack.appendChild(t);
  setTimeout(()=> t.remove(), 2900);
}

function escapeHtml(str){
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function timeAgo(ts){
  const diff = Date.now() - ts;
  const m = Math.floor(diff/60000), h = Math.floor(diff/3600000), d = Math.floor(diff/86400000);
  if (m < 1) return "Just now";
  if (m < 60) return m + "m ago";
  if (h < 24) return h + "h ago";
  if (d < 7) return d + "d ago";
  return new Date(ts).toLocaleDateString();
}

function fileSizeLabel(bytes){
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024*1024) return (bytes/1024).toFixed(0) + " KB";
  return (bytes/(1024*1024)).toFixed(1) + " MB";
}

/* simple hash (demo-grade, not cryptographic) for local-only password/pin storage */
function simpleHash(str){
  let h = 0;
  for (let i=0;i<str.length;i++){ h = (Math.imul(31,h) + str.charCodeAt(i)) | 0; }
  return "h"+h.toString(36)+"_"+str.length;
}

/* ---------------- USERS / AUTH ---------------- */
function getUsers(){
  try { return JSON.parse(localStorage.getItem(LS_USERS) || "[]"); }
  catch(e){ return []; }
}
function saveUsers(users){ localStorage.setItem(LS_USERS, JSON.stringify(users)); }

function normalizePhone(p){ return (p||"").replace(/[^\d+]/g,""); }
function normalizeEmail(e){ return (e||"").trim().toLowerCase(); }

function findUserByIdentifier(identifier, method){
  const users = getUsers();
  if (method === "phone"){
    const n = normalizePhone(identifier);
    return users.find(u => u.phone && normalizePhone(u.phone) === n);
  } else {
    const n = normalizeEmail(identifier);
    return users.find(u => u.email && normalizeEmail(u.email) === n);
  }
}

let authMode = "login"; // login | signup
let authMethod = "phone"; // phone | email

function switchAuthTab(mode){
  authMode = mode;
  document.getElementById("tabLogin").classList.toggle("active", mode==="login");
  document.getElementById("tabSignup").classList.toggle("active", mode==="signup");
  document.getElementById("nameField").style.display = mode==="signup" ? "block" : "none";
  document.getElementById("forgotRow").style.display = mode==="login" ? "block" : "none";
  document.getElementById("authTitle").textContent = mode==="login" ? "Welcome back" : "Create your vault";
  document.getElementById("authSub").textContent = mode==="login" ? "Log in to access your secured vault" : "Sign up to start securing your documents";
  document.getElementById("authSubmitBtn").textContent = mode==="login" ? "Log In" : "Create Account";
  document.getElementById("authFootLink").innerHTML = mode==="login"
    ? `Don't have an account? <b onclick="switchAuthTab('signup')" style="cursor:pointer;">Sign up</b>`
    : `Already have an account? <b onclick="switchAuthTab('login')" style="cursor:pointer;">Log in</b>`;
  hideAuthError();
}
window.switchAuthTab = switchAuthTab;

function switchAuthMethod(method){
  authMethod = method;
  document.getElementById("methodPhoneBtn").classList.toggle("active", method==="phone");
  document.getElementById("methodEmailBtn").classList.toggle("active", method==="email");
  document.getElementById("phoneField").style.display = method==="phone" ? "block" : "none";
  document.getElementById("emailField").style.display = method==="email" ? "block" : "none";
  hideAuthError();
}
window.switchAuthMethod = switchAuthMethod;

function showAuthError(msg){
  const box = document.getElementById("authError");
  document.getElementById("authErrorText").textContent = msg;
  box.classList.add("show");
}
function hideAuthError(){ document.getElementById("authError").classList.remove("show"); }

function togglePasswordVisibility(){
  const input = document.getElementById("passwordInput");
  input.type = input.type === "password" ? "text" : "password";
}
window.togglePasswordVisibility = togglePasswordVisibility;

function handleAuthSubmit(e){
  e.preventDefault();
  hideAuthError();

  const password = document.getElementById("passwordInput").value;
  const identifier = authMethod === "phone"
    ? document.getElementById("phoneInput").value.trim()
    : document.getElementById("emailInput").value.trim();

  if (!identifier){
    showAuthError(authMethod === "phone" ? "Please enter your phone number" : "Please enter your email address");
    return;
  }
  if (authMethod === "phone" && normalizePhone(identifier).replace("+","").length < 7){
    showAuthError("Please enter a valid phone number");
    return;
  }
  if (authMethod === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)){
    showAuthError("Please enter a valid email address");
    return;
  }
  if (!password || password.length < 4){
    showAuthError("Password must be at least 4 characters");
    return;
  }

  if (authMode === "signup"){
    const name = document.getElementById("nameInput").value.trim();
    if (!name){ showAuthError("Please enter your name"); return; }
    const existing = findUserByIdentifier(identifier, authMethod);
    if (existing){
      showAuthError("An account already exists with this " + (authMethod==="phone"?"phone number":"email") + ". Try logging in.");
      return;
    }
    const user = {
      id: uid(),
      name,
      phone: authMethod === "phone" ? identifier : "",
      email: authMethod === "email" ? identifier : "",
      passwordHash: simpleHash(password),
      pinSet: false,
      createdAt: Date.now(),
    };
    const users = getUsers();
    users.push(user);
    saveUsers(users);
    loginAsUser(user);
    showToast("Account created", "success");
    goToPinSetup(true);
  } else {
    const user = findUserByIdentifier(identifier, authMethod);
    if (!user){
      showAuthError("No account found with this " + (authMethod==="phone"?"phone number":"email") + ". Please sign up.");
      return;
    }
    if (user.passwordHash !== simpleHash(password)){
      showAuthError("Incorrect password. Please try again.");
      return;
    }
    loginAsUser(user);
    showToast("Welcome back, " + user.name.split(" ")[0], "success");
    if (user.pinSet){
      goToPinLock();
    } else {
      goToPinSetup(true);
    }
  }
}
window.handleAuthSubmit = handleAuthSubmit;

function loginAsUser(user){
  state.currentUser = user;
  localStorage.setItem(LS_SESSION, user.id);
  loadDocumentsForCurrentUser();
}

function logoutCompletely(){
  localStorage.removeItem(LS_SESSION);
  localStorage.removeItem(LS_LOCK_STATE);
  state.currentUser = null;
  state.documents = [];
  resetAuthForm();
  showScreen("authScreen");
}
window.logoutCompletely = logoutCompletely;

function resetAuthForm(){
  document.getElementById("authForm").reset();
  hideAuthError();
  switchAuthTab("login");
}

/* ---------------- FORGOT PASSWORD / OTP FLOW ---------------- */
function goToForgotPassword(){
  document.getElementById("forgotPhoneInput").value = document.getElementById("phoneInput").value || "";
  document.getElementById("forgotError").classList.remove("show");
  showScreen("forgotScreen");
}
window.goToForgotPassword = goToForgotPassword;

function backToLogin(){ showScreen("authScreen"); }
window.backToLogin = backToLogin;
function backToForgot(){ showScreen("forgotScreen"); }
window.backToForgot = backToForgot;

function sendResetOtp(){
  const phone = document.getElementById("forgotPhoneInput").value.trim();
  const errBox = document.getElementById("forgotError");
  const errText = document.getElementById("forgotErrorText");
  errBox.classList.remove("show");

  if (!phone || normalizePhone(phone).replace("+","").length < 7){
    errText.textContent = "Please enter a valid phone number";
    errBox.classList.add("show");
    return;
  }
  const user = findUserByIdentifier(phone, "phone");
  if (!user){
    errText.textContent = "No account is registered with this phone number";
    errBox.classList.add("show");
    return;
  }
  state.forgotPhone = phone;
  state.otpPurpose = "reset";
  simulateSendOtp(phone);
  document.getElementById("otpPhoneDisplay").textContent = phone;
  clearOtpBoxes();
  showScreen("otpScreen");
}
window.sendResetOtp = sendResetOtp;

function simulateSendOtp(phone){
  /* DEMO ONLY: generates a code and displays it on-screen.
     Replace this with a real backend call (e.g. Twilio/MSG91) that
     actually texts the user, then have verifyOtp() check server-side. */
  const code = String(Math.floor(100000 + Math.random()*900000));
  state.pendingOtp = code;
  document.getElementById("otpDemoCode").textContent = code;
}

function resendOtp(){
  simulateSendOtp(state.forgotPhone);
  clearOtpBoxes();
  showToast("New code sent", "success");
}
window.resendOtp = resendOtp;

function clearOtpBoxes(){
  document.querySelectorAll("#otpBoxes input").forEach(i => i.value = "");
  document.getElementById("otpError").classList.remove("show");
  const first = document.querySelector("#otpBoxes input[data-i='0']");
  if (first) setTimeout(()=>first.focus(), 100);
}

function verifyOtp(){
  const boxes = Array.from(document.querySelectorAll("#otpBoxes input"));
  const entered = boxes.map(b => b.value).join("");
  const errBox = document.getElementById("otpError");
  if (entered.length < 6){
    document.getElementById("otpErrorText").textContent = "Please enter the full 6-digit code";
    errBox.classList.add("show");
    return;
  }
  if (entered !== state.pendingOtp){
    document.getElementById("otpErrorText").textContent = "Incorrect code. Please try again.";
    errBox.classList.add("show");
    boxes.forEach(b=>b.value="");
    boxes[0].focus();
    return;
  }
  errBox.classList.remove("show");
  if (state.otpPurpose === "reset"){
    showScreen("newPasswordScreen");
  }
}
window.verifyOtp = verifyOtp;

function submitNewPassword(){
  const pw = document.getElementById("newPasswordInput").value;
  const cpw = document.getElementById("confirmPasswordInput").value;
  const errBox = document.getElementById("newPwError");
  const errText = document.getElementById("newPwErrorText");
  errBox.classList.remove("show");

  if (!pw || pw.length < 4){
    errText.textContent = "Password must be at least 4 characters";
    errBox.classList.add("show");
    return;
  }
  if (pw !== cpw){
    errText.textContent = "Passwords do not match";
    errBox.classList.add("show");
    return;
  }
  const user = findUserByIdentifier(state.forgotPhone, "phone");
  if (!user){
    errText.textContent = "Something went wrong. Please try again.";
    errBox.classList.add("show");
    return;
  }
  const users = getUsers();
  const idx = users.findIndex(u => u.id === user.id);
  users[idx].passwordHash = simpleHash(pw);
  saveUsers(users);
  showToast("Password updated. Please log in.", "success");
  resetAuthForm();
  showScreen("authScreen");
}
window.submitNewPassword = submitNewPassword;

/* OTP input auto-advance */
document.addEventListener("input", function(e){
  if (e.target.matches("#otpBoxes input")){
    const i = parseInt(e.target.dataset.i, 10);
    e.target.value = e.target.value.replace(/[^0-9]/g,"").slice(0,1);
    if (e.target.value && i < 5){
      const next = document.querySelector(`#otpBoxes input[data-i='${i+1}']`);
      if (next) next.focus();
    }
  }
});
document.addEventListener("keydown", function(e){
  if (e.target.matches("#otpBoxes input") && e.key === "Backspace" && !e.target.value){
    const i = parseInt(e.target.dataset.i, 10);
    if (i > 0){
      const prev = document.querySelector(`#otpBoxes input[data-i='${i-1}']`);
      if (prev) prev.focus();
    }
  }
});

/* ---------------- PIN SETUP & LOCK ---------------- */
function buildKeypad(containerId, onKey, onBackspace){
  const keys = ["1","2","3","4","5","6","7","8","9","","0","back"];
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  keys.forEach(k => {
    const btn = document.createElement("button");
    if (k === ""){
      btn.className = "pin-key empty";
    } else if (k === "back"){
      btn.className = "pin-key fn";
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>';
      btn.onclick = onBackspace;
    } else {
      btn.className = "pin-key";
      btn.textContent = k;
      btn.onclick = () => onKey(k);
    }
    el.appendChild(btn);
  });
}

function renderPinDots(containerId, count){
  const el = document.getElementById(containerId);
  el.querySelectorAll(".pin-dot").forEach((dot,i) => {
    dot.classList.toggle("filled", i < count);
  });
}

function goToPinSetup(firstTime){
  state.pinSetupBuffer = "";
  state.pinSetupFirstEntry = null;
  document.getElementById("pinSetupTitle").textContent = "Create your PIN";
  document.getElementById("pinSetupSub").textContent = "This 6-digit PIN will lock your vault";
  renderPinDots("pinSetupDots", 0);
  buildKeypad("pinSetupKeypad", handlePinSetupKey, handlePinSetupBackspace);
  showScreen("pinSetupScreen");
}
window.goToPinSetup = goToPinSetup;

function handlePinSetupKey(digit){
  if (state.pinSetupBuffer.length >= 6) return;
  state.pinSetupBuffer += digit;
  renderPinDots("pinSetupDots", state.pinSetupBuffer.length);
  if (state.pinSetupBuffer.length === 6){
    setTimeout(processPinSetupComplete, 180);
  }
}
function handlePinSetupBackspace(){
  state.pinSetupBuffer = state.pinSetupBuffer.slice(0,-1);
  renderPinDots("pinSetupDots", state.pinSetupBuffer.length);
}

function processPinSetupComplete(){
  if (state.pinSetupFirstEntry === null){
    state.pinSetupFirstEntry = state.pinSetupBuffer;
    state.pinSetupBuffer = "";
    renderPinDots("pinSetupDots", 0);
    document.getElementById("pinSetupTitle").textContent = "Confirm your PIN";
    document.getElementById("pinSetupSub").textContent = "Enter the same 6-digit PIN again";
  } else {
    if (state.pinSetupBuffer === state.pinSetupFirstEntry){
      const users = getUsers();
      const idx = users.findIndex(u => u.id === state.currentUser.id);
      users[idx].pinSet = true;
      saveUsers(users);
      state.currentUser.pinSet = true;
      localStorage.setItem(LS_PIN_PREFIX + state.currentUser.id, simpleHash(state.pinSetupBuffer));
      localStorage.setItem(LS_LOCK_STATE, "unlocked");
      showToast("PIN set successfully", "success");
      enterApp();
    } else {
      showToast("PINs didn't match. Try again.", "error");
      state.pinSetupBuffer = "";
      state.pinSetupFirstEntry = null;
      renderPinDots("pinSetupDots", 0);
      document.getElementById("pinSetupTitle").textContent = "Create your PIN";
      document.getElementById("pinSetupSub").textContent = "This 6-digit PIN will lock your vault";
    }
  }
}

function goToPinLock(){
  state.pinLockBuffer = "";
  state.pinAttempts = 0;
  document.getElementById("pinLockError").textContent = "";
  renderPinDots("pinLockDots", 0);
  buildKeypad("pinLockKeypad", handlePinLockKey, handlePinLockBackspace);
  showScreen("pinScreen");
}
window.goToPinLock = goToPinLock;

function handlePinLockKey(digit){
  if (state.pinLockBuffer.length >= 6) return;
  state.pinLockBuffer += digit;
  renderPinDots("pinLockDots", state.pinLockBuffer.length);
  if (state.pinLockBuffer.length === 6){
    setTimeout(processPinLockComplete, 150);
  }
}
function handlePinLockBackspace(){
  state.pinLockBuffer = state.pinLockBuffer.slice(0,-1);
  renderPinDots("pinLockDots", state.pinLockBuffer.length);
}

function processPinLockComplete(){
  const storedHash = localStorage.getItem(LS_PIN_PREFIX + state.currentUser.id);
  if (simpleHash(state.pinLockBuffer) === storedHash){
    localStorage.setItem(LS_LOCK_STATE, "unlocked");
    document.getElementById("pinLockError").textContent = "";
    enterApp();
  } else {
    state.pinAttempts++;
    const dotsEl = document.getElementById("pinLockDots");
    dotsEl.classList.add("shake");
    setTimeout(()=>dotsEl.classList.remove("shake"), 400);
    document.getElementById("pinLockError").textContent = "Incorrect PIN. Try again.";
    state.pinLockBuffer = "";
    setTimeout(()=> renderPinDots("pinLockDots", 0), 150);
  }
}

function logoutFromPinLock(){
  logoutCompletely();
}
window.logoutFromPinLock = logoutFromPinLock;

function lockVaultNow(){
  localStorage.setItem(LS_LOCK_STATE, "locked");
  goToPinLock();
}
window.lockVaultNow = lockVaultNow;

/* ---------------- DOCUMENT DATA ---------------- */
function docsKeyForUser(){ return LS_DOCS + "_" + state.currentUser.id; }

function loadDocumentsForCurrentUser(){
  try{
    state.documents = JSON.parse(localStorage.getItem(docsKeyForUser()) || "[]");
  }catch(e){
    state.documents = [];
  }
}

function persistDocuments(){
  try{
    localStorage.setItem(docsKeyForUser(), JSON.stringify(state.documents));
  }catch(e){
    console.error("persistDocuments failed", e);
    showToast("Could not save document list — storage may be full", "error");
  }
}

function getCategoryById(id){ return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length-1]; }

function docCountForCategory(catId){
  return state.documents.filter(d => d.category === catId).length;
}

/* ---------------- ENTER APP / ROUTING ---------------- */
function enterApp(){
  showScreen("appScreen");
  document.getElementById("appScreen").classList.add("active");
  goToView("home");
}

function goToView(view, payload){
  state.currentView = view;
  if (view === "category") state.currentCategory = payload;
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  if (view === "home") document.getElementById("navHome").classList.add("active");
  if (view === "allDocs" || view === "category") document.getElementById("navAll").classList.add("active");
  if (view === "recent") document.getElementById("navRecent").classList.add("active");
  if (view === "settings") document.getElementById("navSettings").classList.add("active");
  renderCurrentView();
  document.getElementById("appMain").scrollTop = 0;
}
window.goToView = goToView;

function handleSearch(q){
  state.searchQuery = q.trim().toLowerCase();
  if (state.searchQuery && state.currentView !== "search"){
    state.currentView = "search";
  } else if (!state.searchQuery && state.currentView === "search"){
    state.currentView = "home";
  }
  renderCurrentView();
}
window.handleSearch = handleSearch;

function renderCurrentView(){
  const main = document.getElementById("appMain");
  if (state.currentView === "home") main.innerHTML = renderHomeView();
  else if (state.currentView === "allDocs") main.innerHTML = renderAllDocsView();
  else if (state.currentView === "category") main.innerHTML = renderCategoryView(state.currentCategory);
  else if (state.currentView === "recent") main.innerHTML = renderRecentView();
  else if (state.currentView === "settings") main.innerHTML = renderSettingsView();
  else if (state.currentView === "search") main.innerHTML = renderSearchView();
  hydrateThumbnails();
}

/* ---------------- RENDER: HOME ---------------- */
function renderHomeView(){
  const catCards = CATEGORIES.map(cat => {
    const count = docCountForCategory(cat.id);
    return `
    <button class="cat-card" style="--cat-bg:${hexA(cat.color,0.13)};--cat-border:${hexA(cat.color,0.3)};--cat-fg:${cat.color};--cat-glow:${hexA(cat.color,0.18)};" onclick="goToView('category','${cat.id}')">
      <div class="cat-icon-wrap"><div style="color:${cat.color};">${ICONS[cat.icon]}</div></div>
      <div class="cat-card-name">${escapeHtml(cat.name)}</div>
      <div class="cat-card-count">${count} document${count===1?"":"s"}</div>
    </button>`;
  }).join("");

  const recent = [...state.documents].sort((a,b)=>b.createdAt-a.createdAt).slice(0,8);
  const recentHtml = recent.length ? `
    <div class="doc-strip">
      ${recent.map(d => renderDocStripCard(d)).join("")}
    </div>` : renderEmptyState("No documents yet", "Tap the + button below to scan or upload your first document.");

  return `
    <div class="section-title-row">
      <div class="section-title">Categories</div>
    </div>
    <div class="cat-grid">${catCards}</div>

    <div class="section-title-row">
      <div class="section-title">Recently Viewed</div>
      <div class="section-count">${state.documents.length} total</div>
    </div>
    ${recentHtml}
  `;
}

function hexA(hex, alpha){
  const h = hex.replace("#","");
  const r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function renderDocStripCard(d){
  const cat = getCategoryById(d.category);
  return `
  <button class="doc-card" onclick="openViewer('${d.id}')">
    <div class="doc-thumb" data-thumb-for="${d.id}">
      <div style="color:var(--ink-faint);">${d.isImage ? ICONS.image : ICONS.doc}</div>
      ${d.secured ? `<div class="doc-thumb-badge">SECURED</div>` : ""}
    </div>
    <div class="doc-card-body">
      <div class="doc-card-name">${escapeHtml(d.name)}</div>
      <div class="doc-card-meta">${escapeHtml(cat.name)} · ${timeAgo(d.createdAt)}</div>
    </div>
  </button>`;
}

function renderEmptyState(title, sub){
  return `<div class="empty-state">
    ${ICONS.folder.replace("currentColor","var(--ink-faint)")}
    <div style="font-weight:700;color:var(--ink-dim);margin-bottom:4px;">${escapeHtml(title)}</div>
    <div>${escapeHtml(sub)}</div>
  </div>`;
}

/* ---------------- RENDER: ALL DOCS ---------------- */
function renderAllDocsView(){
  const docs = [...state.documents].sort((a,b)=>b.createdAt-a.createdAt);
  return `
    <div class="section-title-row">
      <div class="section-title">All Documents</div>
      <div class="section-count">${docs.length} total</div>
    </div>
    ${docs.length ? `<div class="doc-grid">${docs.map(d=>renderDocGridCard(d)).join("")}</div>` : renderEmptyState("No documents yet","Tap the + button below to scan or upload your first document.")}
  `;
}

function renderDocGridCard(d){
  const cat = getCategoryById(d.category);
  return `
  <button class="doc-grid-card" onclick="openViewer('${d.id}')">
    <div class="doc-grid-thumb" data-thumb-for="${d.id}">
      <div style="color:var(--ink-faint);">${d.isImage ? ICONS.image : ICONS.doc}</div>
    </div>
    <div class="doc-grid-body">
      <div class="doc-grid-name">${escapeHtml(d.name)}</div>
      <div class="doc-grid-meta">${escapeHtml(cat.name)}</div>
    </div>
    ${d.secured ? `<div class="doc-grid-menu-btn">${ICONS.lock}</div>` : ""}
  </button>`;
}

/* ---------------- RENDER: CATEGORY ---------------- */
function renderCategoryView(catId){
  const cat = getCategoryById(catId);
  const docs = state.documents.filter(d=>d.category===catId).sort((a,b)=>b.createdAt-a.createdAt);
  return `
    <div class="back-row" onclick="goToView('home')" style="cursor:pointer;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      All categories
    </div>
    <div class="section-title-row">
      <div class="section-title">${escapeHtml(cat.name)}</div>
      <div class="section-count">${docs.length} document${docs.length===1?"":"s"}</div>
    </div>
    ${docs.length ? `<div class="doc-grid">${docs.map(d=>renderDocGridCard(d)).join("")}</div>` : renderEmptyState("Nothing here yet", `Add a ${cat.name} to this category using the + button below.`)}
  `;
}

/* ---------------- RENDER: RECENT ---------------- */
function renderRecentView(){
  const docs = [...state.documents].sort((a,b)=>b.createdAt-a.createdAt).slice(0,30);
  return `
    <div class="section-title-row"><div class="section-title">Recently Viewed</div></div>
    ${docs.length ? `<div class="doc-grid">${docs.map(d=>renderDocGridCard(d)).join("")}</div>` : renderEmptyState("Nothing recent","Documents you add or open will show up here.")}
  `;
}

/* ---------------- RENDER: SEARCH ---------------- */
function renderSearchView(){
  const q = state.searchQuery;
  const docs = state.documents.filter(d => d.name.toLowerCase().includes(q) || getCategoryById(d.category).name.toLowerCase().includes(q));
  return `
    <div class="section-title-row">
      <div class="section-title">Search results</div>
      <div class="section-count">${docs.length} found</div>
    </div>
    ${docs.length ? `<div class="doc-grid">${docs.map(d=>renderDocGridCard(d)).join("")}</div>` : renderEmptyState("No matches", `Nothing found for "${q}"`)}
  `;
}

/* ---------------- RENDER: SETTINGS ---------------- */
function renderSettingsView(){
  const u = state.currentUser;
  const initial = (u.name||"?").trim().charAt(0).toUpperCase();
  return `
    <div class="section-title-row"><div class="section-title">Settings</div></div>
    <div class="profile-card">
      <div class="profile-avatar">${escapeHtml(initial)}</div>
      <div class="profile-info">
        <b>${escapeHtml(u.name)}</b>
        <span>${escapeHtml(u.phone || u.email || "")}</span>
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-row" onclick="goToPinSetup(false)" style="cursor:pointer;">
        <div class="settings-row-icon">${ICONS.lock}</div>
        <div class="settings-row-text"><b>Change app PIN</b><span>Update your 6-digit lock PIN</span></div>
        <svg class="settings-row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="settings-row" onclick="lockVaultNow()" style="cursor:pointer;">
        <div class="settings-row-icon">${ICONS.lock}</div>
        <div class="settings-row-text"><b>Lock vault now</b><span>Require PIN immediately</span></div>
        <svg class="settings-row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-row">
        <div class="settings-row-icon">${ICONS.folder}</div>
        <div class="settings-row-text"><b>Storage used</b><span id="storageUsedLabel">Calculating...</span></div>
      </div>
      <div class="settings-row">
        <div class="settings-row-icon">${ICONS.doc}</div>
        <div class="settings-row-text"><b>Total documents</b><span>${state.documents.length} saved</span></div>
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-row danger" onclick="logoutCompletely()" style="cursor:pointer;">
        <div class="settings-row-icon">${ICONS.lock}</div>
        <div class="settings-row-text"><b>Log out</b><span>You'll need your password to log back in</span></div>
      </div>
    </div>
  `;
}

/* lazy-load thumbnails from IndexedDB without blocking render */
async function hydrateThumbnails(){
  const nodes = document.querySelectorAll("[data-thumb-for]");
  for (const node of nodes){
    const id = node.getAttribute("data-thumb-for");
    const doc = state.documents.find(d=>d.id===id);
    if (!doc || !doc.isImage) continue;
    const url = await getDocObjectUrl(id);
    if (url){
      node.innerHTML = `<img src="${url}" alt="${escapeHtml(doc.name)}">` + (doc.secured ? `<div class="doc-thumb-badge">SECURED</div>` : "");
    }
  }
  computeStorageUsed();
}

async function computeStorageUsed(){
  const label = document.getElementById("storageUsedLabel");
  if (!label) return;
  if (navigator.storage && navigator.storage.estimate){
    try{
      const est = await navigator.storage.estimate();
      label.textContent = fileSizeLabel(est.usage) + " used";
      return;
    }catch(e){/* fall through */}
  }
  label.textContent = state.documents.length + " files stored";
}

/* ---------------- ADD DOCUMENT SHEET ---------------- */
function openAddSheet(){
  document.getElementById("addSheetOverlay").classList.add("show");
  document.getElementById("addSheet").classList.add("show");
}
window.openAddSheet = openAddSheet;

function closeAddSheet(){
  document.getElementById("addSheetOverlay").classList.remove("show");
  document.getElementById("addSheet").classList.remove("show");
}
window.closeAddSheet = closeAddSheet;

function openUploadFromSheet(){
  closeAddSheet();
  document.getElementById("fileUploadInput").click();
}
window.openUploadFromSheet = openUploadFromSheet;

function openScanFromSheet(){
  closeAddSheet();
  openScanScreen();
}
window.openScanFromSheet = openScanFromSheet;

/* ---------------- FILE UPLOAD ---------------- */
function handleFileUpload(e){
  const file = e.target.files[0];
  e.target.value = ""; // reset so same file can be selected again later
  if (!file) return;

  const maxBytes = 25 * 1024 * 1024;
  if (file.size > maxBytes){
    showToast("File is too large (max 25MB)", "error");
    return;
  }

  const isImage = file.type.startsWith("image/");
  state.pendingSaveBlob = file;
  state.pendingSaveIsImage = isImage;
  openSaveSheet(file.name.replace(/\.[^/.]+$/, ""));
}
window.handleFileUpload = handleFileUpload;

/* ---------------- CAMERA / SCAN ---------------- */
async function openScanScreen(){
  showScreen("scanScreen");
  document.getElementById("scanScreen").classList.add("active");
  document.getElementById("scanViewport").innerHTML = `
    <video id="scanVideo" autoplay playsinline muted></video>
    <canvas id="scanCanvas"></canvas>
    <div class="scan-frame-overlay" id="scanFrameOverlay"></div>
  `;
  document.getElementById("scanControlsLive").style.display = "flex";
  document.getElementById("scanConfirmRow").style.display = "none";

  try{
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      throw new Error("no_media_devices");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width:{ideal:1920}, height:{ideal:1080} },
      audio: false
    });
    state.cameraStream = stream;
    const video = document.getElementById("scanVideo");
    video.srcObject = stream;
  }catch(err){
    console.warn("Camera unavailable, showing fallback", err);
    showCameraFallback();
  }
}

function showCameraFallback(){
  document.getElementById("scanViewport").innerHTML = `
    <div class="scan-fallback">
      ${ICONS.image.replace("currentColor","var(--ink-faint)")}
      <h3>Camera isn't available here</h3>
      <p>This browser/device is blocking camera access, or no camera was found. You can still add the document by uploading a photo or file instead.</p>
    </div>
  `;
  document.getElementById("scanControlsLive").style.display = "none";
  document.getElementById("scanConfirmRow").style.display = "flex";
  document.getElementById("scanConfirmRow").innerHTML = `
    <button class="btn-ghost" onclick="closeScanScreen()">Cancel</button>
    <button class="btn-primary" onclick="triggerUploadInsteadOfScan()">Upload instead</button>
  `;
}

function triggerUploadInsteadOfScan(){
  closeScanScreen();
  document.getElementById("fileUploadInput").click();
}
window.triggerUploadInsteadOfScan = triggerUploadInsteadOfScan;

function captureFromCamera(){
  const video = document.getElementById("scanVideo");
  const canvas = document.getElementById("scanCanvas");
  if (!video || !video.videoWidth){
    showToast("Camera not ready yet, try again", "error");
    return;
  }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob((blob) => {
    if (!blob){ showToast("Capture failed, please try again", "error"); return; }
    state.capturedBlob = blob;
    const url = URL.createObjectURL(blob);
    document.getElementById("scanViewport").innerHTML = `<img src="${url}" class="scan-preview-img" alt="Captured document preview">`;
    document.getElementById("scanControlsLive").style.display = "none";
    document.getElementById("scanConfirmRow").style.display = "flex";
    document.getElementById("scanConfirmRow").innerHTML = `
      <button class="btn-ghost" onclick="retakePhoto()">Retake</button>
      <button class="btn-primary" onclick="useCapturedPhoto()">Use photo</button>
    `;
  }, "image/jpeg", 0.92);
}
window.captureFromCamera = captureFromCamera;

function retakePhoto(){
  state.capturedBlob = null;
  openScanScreen();
}
window.retakePhoto = retakePhoto;

function useCapturedPhoto(){
  if (!state.capturedBlob){ showToast("No photo captured", "error"); return; }
  state.pendingSaveBlob = state.capturedBlob;
  state.pendingSaveIsImage = true;
  closeScanScreen();
  openSaveSheet("Scanned Document " + new Date().toLocaleDateString());
}
window.useCapturedPhoto = useCapturedPhoto;

function stopCameraStream(){
  if (state.cameraStream){
    state.cameraStream.getTracks().forEach(t => t.stop());
    state.cameraStream = null;
  }
}

function closeScanScreen(){
  stopCameraStream();
  document.getElementById("scanScreen").classList.remove("active");
  showScreen("appScreen");
  document.getElementById("appScreen").classList.add("active");
}
window.closeScanScreen = closeScanScreen;

/* ---------------- SAVE DOCUMENT SHEET (name + category) ---------------- */
function openSaveSheet(suggestedName){
  document.getElementById("saveDocName").value = suggestedName || "";
  const sel = document.getElementById("saveCatSelect");
  state.pendingSaveCategory = state.currentCategory && CATEGORIES.find(c=>c.id===state.currentCategory) ? state.currentCategory : CATEGORIES[0].id;
  sel.innerHTML = CATEGORIES.map(c => `
    <button type="button" class="sheet-cat-pill ${c.id===state.pendingSaveCategory?'selected':''}" data-cat="${c.id}" onclick="selectSaveCategory('${c.id}')">${escapeHtml(c.name)}</button>
  `).join("");
  document.getElementById("saveSheetOverlay").classList.add("show");
  document.getElementById("saveSheet").classList.add("show");
}

function selectSaveCategory(catId){
  state.pendingSaveCategory = catId;
  document.querySelectorAll("#saveCatSelect .sheet-cat-pill").forEach(p => {
    p.classList.toggle("selected", p.dataset.cat === catId);
  });
}
window.selectSaveCategory = selectSaveCategory;

function closeSaveSheet(){
  document.getElementById("saveSheetOverlay").classList.remove("show");
  document.getElementById("saveSheet").classList.remove("show");
  state.pendingSaveBlob = null;
}
window.closeSaveSheet = closeSaveSheet;

async function confirmSaveDocument(){
  const name = document.getElementById("saveDocName").value.trim();
  if (!name){ showToast("Please name your document", "error"); return; }
  if (!state.pendingSaveBlob){ showToast("No file to save", "error"); return; }

  const id = uid();
  try{
    await dbPutFile(id, state.pendingSaveBlob);
  }catch(err){
    console.error("Failed to save file to IndexedDB", err);
    showToast("Could not save the file. Storage may be full.", "error");
    return;
  }

  const doc = {
    id,
    name,
    category: state.pendingSaveCategory,
    isImage: state.pendingSaveIsImage,
    size: state.pendingSaveBlob.size || 0,
    secured: false,
    createdAt: Date.now(),
  };
  state.documents.unshift(doc);
  persistDocuments();

  closeSaveSheet();
  showToast("Document saved", "success");
  goToView(state.currentView === "category" ? "category" : "home", state.currentCategory);
}
window.confirmSaveDocument = confirmSaveDocument;

/* ---------------- VIEWER MODAL ---------------- */
async function openViewer(docId){
  const doc = state.documents.find(d => d.id === docId);
  if (!doc){ showToast("Document not found", "error"); return; }
  state.currentViewerDocId = docId;

  document.getElementById("viewerName").textContent = doc.name;
  const cat = getCategoryById(doc.category);
  document.getElementById("viewerMeta").textContent = `${cat.name} · ${new Date(doc.createdAt).toLocaleDateString()} · ${fileSizeLabel(doc.size)}`;

  const secureLabel = document.getElementById("viewerSecureLabel");
  secureLabel.textContent = doc.secured ? "Unsecure" : "Secure";

  const body = document.getElementById("viewerBody");
  body.innerHTML = `<div class="doc-noimg">${ICONS.doc.replace("currentColor","var(--ink-faint)")}<span>Loading preview...</span></div>`;

  document.getElementById("viewerOverlay").classList.add("show");

  if (doc.isImage){
    const url = await getDocObjectUrl(docId);
    if (url){
      body.innerHTML = `<img src="${url}" alt="${escapeHtml(doc.name)}">`;
    } else {
      body.innerHTML = `<div class="doc-noimg">${ICONS.image.replace("currentColor","var(--ink-faint)")}<span>No preview available</span></div>`;
    }
  } else {
    body.innerHTML = `<div class="doc-noimg">${ICONS.doc.replace("currentColor","var(--ink-faint)")}<span>Preview not available for this file type</span></div>`;
  }
}
window.openViewer = openViewer;

function closeViewer(){
  document.getElementById("viewerOverlay").classList.remove("show");
  state.currentViewerDocId = null;
}
window.closeViewer = closeViewer;

async function downloadCurrentDoc(){
  const doc = state.documents.find(d => d.id === state.currentViewerDocId);
  if (!doc) return;
  try{
    const blob = await dbGetFile(doc.id);
    if (!blob){ showToast("File data not found", "error"); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ext = doc.isImage ? "jpg" : "pdf";
    a.href = url;
    a.download = doc.name.replace(/[^\w\-. ]/g,"_") + "." + ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
    showToast("Download started", "success");
  }catch(err){
    console.error(err);
    showToast("Download failed", "error");
  }
}
window.downloadCurrentDoc = downloadCurrentDoc;

function toggleSecureCurrentDoc(){
  const doc = state.documents.find(d => d.id === state.currentViewerDocId);
  if (!doc) return;
  doc.secured = !doc.secured;
  persistDocuments();
  document.getElementById("viewerSecureLabel").textContent = doc.secured ? "Unsecure" : "Secure";
  showToast(doc.secured ? "Document marked as secured" : "Document unsecured", "success");
  renderCurrentView();
}
window.toggleSecureCurrentDoc = toggleSecureCurrentDoc;

function deleteCurrentDoc(){
  state.deleteTargetDocId = state.currentViewerDocId;
  document.getElementById("confirmOverlay").classList.add("show");
}
window.deleteCurrentDoc = deleteCurrentDoc;

function closeConfirm(){
  document.getElementById("confirmOverlay").classList.remove("show");
  state.deleteTargetDocId = null;
}
window.closeConfirm = closeConfirm;

async function confirmDeleteDoc(){
  const id = state.deleteTargetDocId;
  if (!id) return;
  try{ await dbDeleteFile(id); }catch(e){ console.warn("dbDeleteFile failed", e); }
  if (blobUrlCache.has(id)){
    URL.revokeObjectURL(blobUrlCache.get(id));
    blobUrlCache.delete(id);
  }
  state.documents = state.documents.filter(d => d.id !== id);
  persistDocuments();
  closeConfirm();
  closeViewer();
  showToast("Document deleted", "success");
  renderCurrentView();
}
window.confirmDeleteDoc = confirmDeleteDoc;

/* ---------------- SHARE ---------------- */
function openShareSheetForCurrent(){
  const doc = state.documents.find(d => d.id === state.currentViewerDocId);
  if (!doc) return;
  state.shareTargetDocId = doc.id;
  document.getElementById("viewerOverlay").classList.remove("show");
  document.getElementById("shareDocLabel").textContent = `Share "${doc.name}"`;
  const fakeLink = location.origin + location.pathname + "#doc=" + doc.id;
  document.getElementById("shareLinkInput").value = fakeLink;
  document.getElementById("shareSheetOverlay").classList.add("show");
  document.getElementById("shareSheet").classList.add("show");
}
window.openShareSheetForCurrent = openShareSheetForCurrent;

function closeShareSheet(reopenViewer){
  document.getElementById("shareSheetOverlay").classList.remove("show");
  document.getElementById("shareSheet").classList.remove("show");
  if (reopenViewer !== false && state.currentViewerDocId){
    document.getElementById("viewerOverlay").classList.add("show");
  }
}
window.closeShareSheet = closeShareSheet;

async function shareVia(channel){
  const doc = state.documents.find(d => d.id === state.shareTargetDocId);
  if (!doc) return;
  const link = document.getElementById("shareLinkInput").value;
  const text = `Sharing "${doc.name}" from my LifeVault: ${link}`;

  try{
    if (channel === "whatsapp"){
      window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank");
    } else if (channel === "email"){
      window.location.href = "mailto:?subject=" + encodeURIComponent("Document: " + doc.name) + "&body=" + encodeURIComponent(text);
    } else if (channel === "copy"){
      await copyShareLink();
      return;
    } else if (channel === "more"){
      if (navigator.share){
        try{
          const blob = await dbGetFile(doc.id);
          if (blob && navigator.canShare && navigator.canShare({ files:[new File([blob],doc.name,{type:blob.type})] })){
            await navigator.share({ files:[new File([blob],doc.name,{type:blob.type})], title: doc.name, text: "Shared from LifeVault" });
          } else {
            await navigator.share({ title: doc.name, text, url: link });
          }
        }catch(err){
          if (err.name !== "AbortError") showToast("Share was cancelled", "info");
          return;
        }
      } else {
        await copyShareLink();
        return;
      }
    }
    showToast("Share opened", "success");
    closeShareSheet();
  }catch(err){
    console.error(err);
    showToast("Couldn't open share — link copied instead", "info");
    copyShareLink();
  }
}
window.shareVia = shareVia;

async function copyShareLink(){
  const input = document.getElementById("shareLinkInput");
  try{
    await navigator.clipboard.writeText(input.value);
    showToast("Link copied to clipboard", "success");
  }catch(e){
    input.select();
    document.execCommand("copy");
    showToast("Link copied to clipboard", "success");
  }
  closeShareSheet();
}
window.copyShareLink = copyShareLink;

/* ---------------- APP INIT ---------------- */
function initApp(){
  // Splash sequence
  setTimeout(() => {
    resumeSession();
  }, 1500);

  // sheet swipe-to-close via overlay tap is already handled by onclick on overlay divs
}

function resumeSession(){
  const sessionUserId = localStorage.getItem(LS_SESSION);
  if (!sessionUserId){
    resetAuthForm();
    showScreen("authScreen");
    return;
  }
  const users = getUsers();
  const user = users.find(u => u.id === sessionUserId);
  if (!user){
    logoutCompletely();
    return;
  }
  state.currentUser = user;
  loadDocumentsForCurrentUser();

  if (!user.pinSet){
    goToPinSetup(true);
    return;
  }
  const lockState = localStorage.getItem(LS_LOCK_STATE);
  if (lockState === "unlocked"){
    enterApp();
  } else {
    goToPinLock();
  }
}

document.addEventListener("DOMContentLoaded", initApp);

/* expose for init */
window.__lifevault_internal = { showScreen, showToast, enterApp };

})();