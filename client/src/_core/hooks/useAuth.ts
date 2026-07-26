import { useEffect, useState } from "react";

const localUser = {
  id: 1,
  name: "Local Tester",
  email: "local@example.com",
  role: "user" as const,
};

export function useAuth() {
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    const handler = () => setRequested(true);
    window.addEventListener("ess:auth-requested", handler);
    return () => window.removeEventListener("ess:auth-requested", handler);
  }, []);

  return {
    user: localUser,
    isAuthenticated: true,
    loading: false,
    loginRequested: requested,
  };
}
