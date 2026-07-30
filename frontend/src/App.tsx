import { useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { useAuthStore } from "./stores/authStore";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { FileManager } from "./pages/FileManager";
import { SharePage } from "./pages/FileManager";
import { AdminPanel } from "./pages/AdminPanel";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isChecking = useAuthStore((s) => s.isChecking);

  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="w-8 h-8 border-2 border-[var(--brand-blue)]/30 border-t-[var(--brand-blue)] rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated)
    return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AuthChecker({ children }: { children: React.ReactNode }) {
  const autoLogin = useAuthStore((s) => s.autoLogin);

  useEffect(() => {
    autoLogin();
  }, [autoLogin]);

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthChecker>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/s/:token" element={<SharePage />} />
          <Route path="/admin" element={<AdminPanel />} />
          <Route
            path="/app/*"
            element={
              <ProtectedRoute>
                <FileManager />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthChecker>
    </BrowserRouter>
  );
}
