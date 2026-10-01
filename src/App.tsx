import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { supabase } from './lib/supabase';
import Login from './pages/Login';
import Lobby from './pages/Lobby';
import Chat from './pages/Chat';
import { useTimeSync } from './hooks/useTimeSync';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, isLoading } = useAuthStore();
  const location = useLocation();

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center bg-slate-900 text-white">Carregando...</div>;
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

const AuthRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, isLoading } = useAuthStore();

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center bg-slate-900 text-white">Carregando...</div>;
  }

  if (session) {
    return <Navigate to="/lobby" replace />;
  }

  return <>{children}</>;
};

const AppRoutes = () => {
  useTimeSync();

  return (
    <Routes>
      <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />
      <Route path="/lobby" element={<ProtectedRoute><Lobby /></ProtectedRoute>} />
      <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/lobby" replace />} />
    </Routes>
  );
};

function App() {
  const { setSession } = useAuthStore();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: any) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, [setSession]);

  return (
    <BrowserRouter>
      <div className="min-h-screen w-full bg-slate-900 text-slate-100 flex justify-center">
        <div className="w-full max-w-md bg-slate-900 relative shadow-2xl overflow-hidden flex flex-col">
           <AppRoutes />
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
