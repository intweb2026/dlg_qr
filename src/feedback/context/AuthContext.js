import { createContext, useCallback, useContext, useEffect, useState } from "react";
import api, { TOKEN_KEY, UNAUTHORIZED_EVENT } from "../api";

const AuthContext = createContext(null);

function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    /* storage blocked */
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let token = null;
    try {
      token = localStorage.getItem(TOKEN_KEY);
    } catch (e) {
      /* storage blocked */
    }
    if (!token) {
      setChecking(false);
      return;
    }
    api
      .get("/auth/me/")
      .then((res) => setUser(res.data))
      .catch(clearToken)
      .finally(() => setChecking(false));
  }, []);

  // Any admin request answered with 401 (token deleted or expired) signs the admin out.
  useEffect(() => {
    const onUnauthorized = () => {
      clearToken();
      setUser(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await api.post("/auth/login/", { username, password });
    localStorage.setItem(TOKEN_KEY, res.data.token);
    setUser({ username: res.data.username, full_name: res.data.full_name });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout/");
    } catch (e) {
      /* token may already be invalid */
    }
    clearToken();
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, checking, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
