import { createContext, useContext, useEffect, useState } from "react";
import { api, setToken } from "../api/client.js";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session from sessionStorage on load.
  useEffect(() => {
    const t = sessionStorage.getItem("og_token");
    const u = sessionStorage.getItem("og_user");
    if (t && u) {
      setToken(t);
      setUser(JSON.parse(u));
    }
    setLoading(false);
  }, []);

  function persist(token, u) {
    setToken(token);
    sessionStorage.setItem("og_token", token);
    sessionStorage.setItem("og_user", JSON.stringify(u));
    setUser(u);
  }

  async function loginPassword(phone, password) {
    const { token, user } = await api.login(phone, password);
    persist(token, user);
  }
  async function requestOtp(phone) { await api.requestOtp(phone); }
  async function loginOtp(phone, code) {
    const { token, user } = await api.verifyOtp(phone, code);
    persist(token, user);
  }
  function logout() {
    setToken(null);
    sessionStorage.clear();
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, loginPassword, requestOtp, loginOtp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
