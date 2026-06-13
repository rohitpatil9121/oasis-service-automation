import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Login() {
  const { loginPassword, requestOtp, loginOtp, user } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState("password"); // password | otp
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) { nav("/"); return null; }

  async function run(fn) {
    setBusy(true); setErr("");
    try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const doPassword = () => run(async () => { await loginPassword(phone, password); nav("/"); });
  const doRequestOtp = () => run(async () => { await requestOtp(phone); setOtpSent(true); });
  const doVerifyOtp = () => run(async () => { await loginOtp(phone, code); nav("/"); });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand to-brand-dark p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-7 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-2 h-10 w-10 rounded-full bg-brand" />
          <h1 className="text-xl font-bold">Oasis Globe</h1>
          <p className="text-sm text-slate-400">Service Manager Login</p>
        </div>

        <div className="mb-4 flex rounded-lg bg-slate-100 p-1 text-sm">
          {["password", "otp"].map((m) => (
            <button key={m} onClick={() => { setMode(m); setErr(""); setOtpSent(false); }}
              className={`flex-1 rounded-md py-1.5 font-medium capitalize ${mode === m ? "bg-white shadow text-brand" : "text-slate-500"}`}>
              {m === "otp" ? "OTP" : "Password"}
            </button>
          ))}
        </div>

        {err && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}

        <label className="block text-sm font-medium text-slate-600">Phone</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)}
          placeholder="+9190000..." className="mb-3 mt-1 w-full rounded border border-slate-300 px-3 py-2" />

        {mode === "password" ? (
          <>
            <label className="block text-sm font-medium text-slate-600">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="mb-4 mt-1 w-full rounded border border-slate-300 px-3 py-2"
              onKeyDown={(e) => e.key === "Enter" && doPassword()} />
            <button onClick={doPassword} disabled={busy}
              className="w-full rounded bg-brand py-2.5 font-medium text-white hover:bg-brand-dark disabled:opacity-50">
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </>
        ) : (
          <>
            {!otpSent ? (
              <button onClick={doRequestOtp} disabled={busy}
                className="w-full rounded bg-brand py-2.5 font-medium text-white hover:bg-brand-dark disabled:opacity-50">
                {busy ? "Sending…" : "Send OTP via WhatsApp"}
              </button>
            ) : (
              <>
                <label className="block text-sm font-medium text-slate-600">6-digit code</label>
                <input value={code} onChange={(e) => setCode(e.target.value)}
                  className="mb-4 mt-1 w-full rounded border border-slate-300 px-3 py-2 tracking-widest"
                  onKeyDown={(e) => e.key === "Enter" && doVerifyOtp()} />
                <button onClick={doVerifyOtp} disabled={busy}
                  className="w-full rounded bg-brand py-2.5 font-medium text-white hover:bg-brand-dark disabled:opacity-50">
                  {busy ? "Verifying…" : "Verify & sign in"}
                </button>
                <button onClick={doRequestOtp} disabled={busy}
                  className="mt-2 w-full text-sm text-slate-400 hover:text-slate-600">Resend code</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
