import { auth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from "../firebase-init.js";
import { $, applyTheme, busy } from "../shared.js";

applyTheme();
onAuthStateChanged(auth, (u) => { if (u) location.replace("profiles.html"); });

const MESSAGES = {
  "auth/invalid-credential": "Email or password is incorrect.",
  "auth/user-not-found": "No account found with this email.",
  "auth/wrong-password": "Incorrect password.",
  "auth/email-already-in-use": "That email already has an account. Try signing in.",
  "auth/invalid-email": "That email address does not look right.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
  "auth/network-request-failed": "Network problem. Check your connection.",
  "auth/missing-password": "Enter your password.",
};
function say(text, kind = "bad") {
  const m = $("message");
  m.textContent = text; m.className = `notice ${kind}`;
}
const creds = () => ({ email: $("email").value.trim(), password: $("password").value });
const fail = (e) => say(MESSAGES[e.code] || "Something went wrong. Please try again.");

$("showPw").onchange = (e) => { $("password").type = e.target.checked ? "text" : "password"; };

$("authForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const { email, password } = creds();
  if (!email || !password) return say("Enter your email and password.");
  busy($("loginBtn"), () => signInWithEmailAndPassword(auth, email, password).catch(fail));
});

$("signupBtn").onclick = () => {
  const { email, password } = creds();
  if (!email || !password) return say("Enter an email and a password to create your account.");
  busy($("signupBtn"), () => createUserWithEmailAndPassword(auth, email, password).catch(fail));
};

$("forgotBtn").onclick = () => {
  const { email } = creds();
  if (!email) return say("Enter your email above, then press “Forgot password?”.", "warn");
  busy($("forgotBtn"), () => sendPasswordResetEmail(auth, email)
    .then(() => say("If an account exists for that email, a reset link is on its way.", "good"))
    .catch(fail));
};
