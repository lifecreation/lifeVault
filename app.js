/* ============================================================
   LifeVault — Application Logic (FIREBASE VERSION)
   Auth:      Firebase Authentication (Email/Password now, Phone later)
   Metadata:  Firestore  -> users/{uid}  and  users/{uid}/documents/{docId}
   Files:     Firebase Storage -> users/{uid}/files/{docId}

   ------------------------------------------------------------
   REQUIRED IN YOUR HTML (before this script tag), in this order:

   <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js"></script>
   <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js"></script>
   <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js"></script>
   <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-storage-compat.js"></script>
   <script src="lifevault-firebase.js"></script>

   Then paste your Firebase project config below (Project settings ->
   General -> Your apps -> SDK setup and configuration).
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyByif5d0C7IjMzZzfk2sNAtqm48_wbSG4c",
  authDomain: "doklh26.firebaseapp.com",
  projectId: "doklh26",
  storageBucket: "doklh26.firebasestorage.app",
  messagingSenderId: "649444595165",
  appId: "1:649444595165:web:b0f322c5f6441aaf82d234",
  measurementId: "G-N5QK72SDLS",
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

(function(){
"use strict";

/* ---------------- CONSTANTS ---------------- */
const LS_LOCK_STATE = "lv_lock_state";   // device-level: locked/unlocked (kept local on purpose)
const LS_PIN_CACHE_PREFIX = "lv_pin_cache_"; // local cache of pin hash for instant unlock without a Firestore read

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
  currentUser: null,          // { uid, name, email, phone, pinSet }
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
  currentViewerDocId: null,
  shareTargetDocId: null,
  deleteTargetDocId: null,
  searchQuery: "",
};

let docsUnsubscribe = null; // live Firestore listener cleanup

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

/* simple hash — used ONLY for the local PIN cache convenience check.
   Firestore security rules are the real gate for data access. */
function simpleHash(str){
  let h = 0;
  for (let i=0;i<str.length;i++){ h = (Math.imul(31,h) + str.charCodeAt(i)) | 0; }
  return "h"+h.toString(36)+"_"+str.length;
}

function friendlyAuthError(err){
  const map = {
    "auth/email-already-in-use": "An account already exists with this email. Try logging in.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/user-not-found": "No account found with this email. Please sign up.",
    "auth/wrong-password": "Incorrect password. Please try again.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/too-many-requests": "Too many attempts. Please wait a bit and try again.",
    "auth/network-request-failed": "Network error. Check your connection and try again.",
  };
  return map[err.code] || (err.message || "Something went wrong. Please try again.");
}

/* ---------------- AUTH UI STATE ---------------- */
let authMode = "login"; // login | signup
// Phone auth is coming later — email is the only active method for now.
let authMethod = "email";

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

/* Phone method disabled for now — kept as a stub so the button doesn't crash
   if it's still in your HTML. Wire this up when phone auth is added. */
function switchAuthMethod(method){
  if (method === "phone"){
    showAuthError("Phone login is coming soon — please use email for now.");
    return;
  }
  authMethod = "email";
  applyAuthMethodVisibility();
  hideAuthError();
}
window.switchAuthMethod = switchAuthMethod;

/* Forces the email field to show and the phone field to hide, regardless
   of whatever the HTML's default state was (old HTML defaulted to phone). */
function applyAuthMethodVisibility(){
  const phoneField = document.getElementById("phoneField");
  const emailField = document.getElementById("emailField");
  const methodPhoneBtn = document.getElementById("methodPhoneBtn");
  const methodEmailBtn = document.getElementById("methodEmailBtn");
  if (phoneField) phoneField.style.display = "none";
  if (emailField) emailField.style.display = "block";
  if (methodPhoneBtn) methodPhoneBtn.classList.remove("active");
  if (methodEmailBtn) methodEmailBtn.classList.add("active");
}

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

async function handleAuthSubmit(e){
  e.preventDefault();
  hideAuthError();

  const password = document.getElementById("passwordInput").value;
  const email = document.getElementById("emailInput").value.trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    showAuthError("Please enter a valid email address");
    return;
  }
  if (!password || password.length < 6){
    showAuthError("Password must be at least 6 characters");
    return;
  }

  const submitBtn = document.getElementById("authSubmitBtn");
  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = "Please wait...";

  try{
    if (authMode === "signup"){
      const name = document.getElementById("nameInput").value.trim();
      if (!name){ showAuthError("Please enter your name"); return; }

      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: name });
      await db.collection("users").doc(cred.user.uid).set({
        name,
        email,
        phone: "",
        pinSet: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      showToast("Account created", "success");
      // onAuthStateChanged will route to PIN setup
    } else {
      await auth.signInWithEmailAndPassword(email, password);
      // onAuthStateChanged will route onward
    }
  }catch(err){
    console.error(err);
    showAuthError(friendlyAuthError(err));
  }finally{
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
}
window.handleAuthSubmit = handleAuthSubmit;

function logoutCompletely(){
  localStorage.removeItem(LS_LOCK_STATE);
  detachDocsListener();
  auth.signOut().catch(err => console.error("Sign out failed", err));
  state.currentUser = null;
  state.documents = [];
}
window.logoutCompletely = logoutCompletely;

function resetAuthForm(){
  document.getElementById("authForm").reset();
  hideAuthError();
  switchAuthTab("login");
}

/* ---------------- FORGOT PASSWORD (real email link now — no OTP needed) ---------------- */
function goToForgotPassword(){
  document.getElementById("forgotPhoneInput").value = document.getElementById("emailInput").value || "";
  document.getElementById("forgotError").classList.remove("show");
  showScreen("forgotScreen");
}
window.goToForgotPassword = goToForgotPassword;

function backToLogin(){ showScreen("authScreen"); }
window.backToLogin = backToLogin;
function backToForgot(){ showScreen("forgotScreen"); }
window.backToForgot = backToForgot;

/* NOTE: this function is kept with its original name (sendResetOtp) so your
   existing HTML button keeps working, but it no longer sends an OTP — it
   sends a real Firebase password-reset email instead. */
async function sendResetOtp(){
  const email = document.getElementById("forgotPhoneInput").value.trim();
  const errBox = document.getElementById("forgotError");
  const errText = document.getElementById("forgotErrorText");
  errBox.classList.remove("show");

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    errText.textContent = "Please enter a valid email address";
    errBox.classList.add("show");
    return;
  }

  try{
    await auth.sendPasswordResetEmail(email);
    showToast("Reset link sent — check your email", "success");
    resetAuthForm();
    showScreen("authScreen");
  }catch(err){
    console.error(err);
    errText.textContent = friendlyAuthError(err);
    errBox.classList.add("show");
  }
}
window.sendResetOtp = sendResetOtp;

/* The OTP-entry and new-password screens are no longer part of the flow —
   Firebase's reset link takes the user to their email, where they set a new
   password directly. You can remove otpScreen / newPasswordScreen from your
   HTML, or leave them unused. */
function resendOtp(){ sendResetOtp(); }
window.resendOtp = resendOtp;
function verifyOtp(){ /* unused in Firebase flow */ }
window.verifyOtp = verifyOtp;
function submitNewPassword(){ /* unused in Firebase flow */ }
window.submitNewPassword = submitNewPassword;

/* ---------------- PIN SETUP & LOCK ----------------
   PIN is a device-unlock convenience layer on top of real Firebase Auth.
   The hash lives in Firestore (users/{uid}.pinHash) so it's consistent
   across devices, and is cached locally for instant re-checks. */
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

async function processPinSetupComplete(){
  if (state.pinSetupFirstEntry === null){
    state.pinSetupFirstEntry = state.pinSetupBuffer;
    state.pinSetupBuffer = "";
    renderPinDots("pinSetupDots", 0);
    document.getElementById("pinSetupTitle").textContent = "Confirm your PIN";
    document.getElementById("pinSetupSub").textContent = "Enter the same 6-digit PIN again";
  } else {
    if (state.pinSetupBuffer === state.pinSetupFirstEntry){
      const hash = simpleHash(state.pinSetupBuffer);
      try{
        await db.collection("users").doc(state.currentUser.uid).set(
          { pinSet: true, pinHash: hash },
          { merge: true }
        );
        state.currentUser.pinSet = true;
        localStorage.setItem(LS_PIN_CACHE_PREFIX + state.currentUser.uid, hash);
        localStorage.setItem(LS_LOCK_STATE, "unlocked");
        showToast("PIN set successfully", "success");
        enterApp();
      }catch(err){
        console.error(err);
        showToast("Couldn't save PIN — check your connection", "error");
      }
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

async function processPinLockComplete(){
  const enteredHash = simpleHash(state.pinLockBuffer);
  let storedHash = localStorage.getItem(LS_PIN_CACHE_PREFIX + state.currentUser.uid);

  if (!storedHash){
    // no local cache (e.g. new device) — fetch once from Firestore
    try{
      const snap = await db.collection("users").doc(state.currentUser.uid).get();
      storedHash = snap.exists ? snap.data().pinHash : null;
      if (storedHash) localStorage.setItem(LS_PIN_CACHE_PREFIX + state.currentUser.uid, storedHash);
    }catch(err){
      console.error(err);
      document.getElementById("pinLockError").textContent = "Couldn't verify PIN — check your connection.";
      return;
    }
  }

  if (enteredHash === storedHash){
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

/* ---------------- DOCUMENT DATA (Firestore, live-synced) ---------------- */
function docsCollectionRef(){
  return db.collection("users").doc(state.currentUser.uid).collection("documents");
}

function attachDocsListener(){
  detachDocsListener();
  docsUnsubscribe = docsCollectionRef().orderBy("createdAt", "desc").onSnapshot(
    (snap) => {
      state.documents = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name,
          category: data.category,
          isImage: data.isImage,
          size: data.size || 0,
          secured: !!data.secured,
          storagePath: data.storagePath,
          createdAt: data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now(),
        };
      });
      renderCurrentView();
    },
    (err) => {
      console.error("Documents listener failed", err);
      showToast("Couldn't sync documents — check your connection", "error");
    }
  );
}

function detachDocsListener(){
  if (docsUnsubscribe){ docsUnsubscribe(); docsUnsubscribe = null; }
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
  if (!main) return;
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
        <span>${escapeHtml(u.email || u.phone || "")}</span>
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

/* lazy-load thumbnails from Firebase Storage without blocking render */
const thumbUrlCache = new Map();
async function hydrateThumbnails(){
  const nodes = document.querySelectorAll("[data-thumb-for]");
  for (const node of nodes){
    const id = node.getAttribute("data-thumb-for");
    const doc = state.documents.find(d=>d.id===id);
    if (!doc || !doc.isImage) continue;
    const url = await getDocDownloadUrl(doc);
    if (url){
      node.innerHTML = `<img src="${url}" alt="${escapeHtml(doc.name)}">` + (doc.secured ? `<div class="doc-thumb-badge">SECURED</div>` : "");
    }
  }
  computeStorageUsed();
}

async function getDocDownloadUrl(doc){
  if (thumbUrlCache.has(doc.id)) return thumbUrlCache.get(doc.id);
  try{
    const url = await storage.ref(doc.storagePath).getDownloadURL();
    thumbUrlCache.set(doc.id, url);
    return url;
  }catch(e){
    console.error("getDocDownloadUrl failed", e);
    return null;
  }
}

async function computeStorageUsed(){
  const label = document.getElementById("storageUsedLabel");
  if (!label) return;
  const totalBytes = state.documents.reduce((sum,d)=>sum+(d.size||0),0);
  label.textContent = fileSizeLabel(totalBytes) + " used";
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
  const storagePath = `users/${state.currentUser.uid}/files/${id}`;
  const saveBtn = document.querySelector("#saveSheet .btn-primary");
  if (saveBtn){ saveBtn.disabled = true; saveBtn.textContent = "Uploading..."; }

  try{
    await storage.ref(storagePath).put(state.pendingSaveBlob);

    await docsCollectionRef().doc(id).set({
      name,
      category: state.pendingSaveCategory,
      isImage: state.pendingSaveIsImage,
      size: state.pendingSaveBlob.size || 0,
      secured: false,
      storagePath,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    closeSaveSheet();
    showToast("Document saved", "success");
    goToView(state.currentView === "category" ? "category" : "home", state.currentCategory);
  }catch(err){
    console.error("Failed to save document", err);
    showToast("Could not save the file. Check your connection and try again.", "error");
  }finally{
    if (saveBtn){ saveBtn.disabled = false; saveBtn.textContent = "Save"; }
  }
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
    const url = await getDocDownloadUrl(doc);
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
    const url = await getDocDownloadUrl(doc);
    if (!url){ showToast("File data not found", "error"); return; }
    const ext = doc.isImage ? "jpg" : "pdf";
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.name.replace(/[^\w\-. ]/g,"_") + "." + ext;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast("Download started", "success");
  }catch(err){
    console.error(err);
    showToast("Download failed", "error");
  }
}
window.downloadCurrentDoc = downloadCurrentDoc;

async function toggleSecureCurrentDoc(){
  const doc = state.documents.find(d => d.id === state.currentViewerDocId);
  if (!doc) return;
  const newVal = !doc.secured;
  try{
    await docsCollectionRef().doc(doc.id).update({ secured: newVal });
    document.getElementById("viewerSecureLabel").textContent = newVal ? "Unsecure" : "Secure";
    showToast(newVal ? "Document marked as secured" : "Document unsecured", "success");
  }catch(err){
    console.error(err);
    showToast("Couldn't update — check your connection", "error");
  }
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
  const doc = state.documents.find(d => d.id === id);

  try{
    if (doc && doc.storagePath){
      await storage.ref(doc.storagePath).delete().catch(e => console.warn("Storage delete failed", e));
    }
    await docsCollectionRef().doc(id).delete();
    thumbUrlCache.delete(id);
    closeConfirm();
    closeViewer();
    showToast("Document deleted", "success");
  }catch(err){
    console.error(err);
    showToast("Couldn't delete — check your connection", "error");
  }
}
window.confirmDeleteDoc = confirmDeleteDoc;

/* ---------------- SHARE ---------------- */
async function openShareSheetForCurrent(){
  const doc = state.documents.find(d => d.id === state.currentViewerDocId);
  if (!doc) return;
  state.shareTargetDocId = doc.id;
  document.getElementById("viewerOverlay").classList.remove("show");
  document.getElementById("shareDocLabel").textContent = `Share "${doc.name}"`;
  const url = await getDocDownloadUrl(doc);
  document.getElementById("shareLinkInput").value = url || "";
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
          await navigator.share({ title: doc.name, text, url: link });
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

/* ---------------- APP INIT / AUTH STATE ---------------- */
function initApp(){
  // Force email field visible from the very first paint (old HTML defaulted to phone).
  applyAuthMethodVisibility();
  // Splash sequence
  setTimeout(() => {
    // resumeSession happens via onAuthStateChanged below
  }, 1500);
}

auth.onAuthStateChanged(async (user) => {
  if (!user){
    detachDocsListener();
    state.currentUser = null;
    state.documents = [];
    resetAuthForm();
    showScreen("authScreen");
    return;
  }

  try{
    const snap = await db.collection("users").doc(user.uid).get();
    const profile = snap.exists ? snap.data() : {};
    state.currentUser = {
      uid: user.uid,
      name: profile.name || user.displayName || "",
      email: profile.email || user.email || "",
      phone: profile.phone || "",
      pinSet: !!profile.pinSet,
    };

    attachDocsListener();

    if (!state.currentUser.pinSet){
      goToPinSetup(true);
      return;
    }
    const lockState = localStorage.getItem(LS_LOCK_STATE);
    if (lockState === "unlocked"){
      enterApp();
    } else {
      goToPinLock();
    }
  }catch(err){
    console.error("Failed to load user profile", err);
    showToast("Couldn't load your account — check your connection", "error");
  }
});

document.addEventListener("DOMContentLoaded", initApp);

/* expose for init */
window.__lifevault_internal = { showScreen, showToast, enterApp };

})();
