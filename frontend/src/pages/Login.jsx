import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { Button, Input, Field, PhoneInput, Alert, Icon, Logo } from "../components/ui.jsx";

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

  const run = (fn) => async (e) => {
    e?.preventDefault();
    setBusy(true); setErr("");
    try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const doPassword = run(async () => { await loginPassword(phone, password); nav("/"); });
  const doRequestOtp = run(async () => { await requestOtp(phone); setOtpSent(true); });
  const doVerifyOtp = run(async () => { await loginOtp(phone, code); nav("/"); });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand to-brand-dark p-4">
      <div className="w-full max-w-sm animate-in rounded-2xl bg-white p-7 shadow-pop">
        <div className="mb-6 text-center">
          <Logo className="mx-auto mb-3 h-14" badge="mx-auto h-12 w-12 rounded-xl text-sm" />
          <p className="text-sm text-slate-400">Service Manager Login</p>
        </div>

        <div className="mb-5 flex rounded-lg bg-slate-100 p-1 text-sm">
          {["password", "otp"].map((m) => (
            <button key={m} onClick={() => { setMode(m); setErr(""); setOtpSent(false); }}
              className={`flex-1 rounded-md py-1.5 font-medium transition ${mode === m ? "bg-white text-brand shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {m === "otp" ? "OTP" : "Password"}
            </button>
          ))}
        </div>

        {err && <div className="mb-3"><Alert>{err}</Alert></div>}

        {mode === "password" ? (
          <form onSubmit={doPassword} className="space-y-3">
            <Field label="Phone"><PhoneInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="90000 00000" autoFocus /></Field>
            <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /></Field>
            <Button type="submit" className="mt-1 w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          </form>
        ) : (
          <form onSubmit={otpSent ? doVerifyOtp : doRequestOtp} className="space-y-3">
            <Field label="Phone"><PhoneInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="90000 00000" autoFocus /></Field>
            {!otpSent ? (
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Sending…" : <><Icon name="phone" /> Send OTP via WhatsApp</>}
              </Button>
            ) : (
              <>
                <Field label="6-digit code"><Input value={code} onChange={(e) => setCode(e.target.value)} className="tracking-[0.3em]" placeholder="••••••" /></Field>
                <Button type="submit" className="w-full" disabled={busy}>{busy ? "Verifying…" : "Verify & sign in"}</Button>
                <button type="button" onClick={doRequestOtp} disabled={busy}
                  className="w-full text-center text-sm text-slate-400 hover:text-slate-600">Resend code</button>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
