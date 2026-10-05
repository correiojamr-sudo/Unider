import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { supabase } from './lib/supabase';
import Login from './pages/Login';
import Lobby from './pages/Lobby';
import Chat from './pages/Chat';
import { useTimeSync } from './hooks/useTimeSync';
import { AUTH_STORAGE_CHANNEL, observeAuthSession } from './lib/authSession';

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
  const { signOutError, dismissSignOutError, isSigningOut } = useAuthStore();
  const [startupError, setStartupError] = useState(false);
  const [startupAttempt, setStartupAttempt] = useState(0);

  useEffect(() => {
    return observeAuthSession({
      subscribe: callback => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange(callback);
        let active = true;
        let read = 0;
        const changes = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(AUTH_STORAGE_CHANNEL) : null;
        if (changes) changes.onmessage = () => {
          const operation = ++read;
          const revision = useAuthStore.getState().sessionRevision;
          supabase.auth.getSession().then(({ data, error }) => {
            if (active && operation === read && revision === useAuthStore.getState().sessionRevision && !error) {
              callback(data.session ? 'SIGNED_IN' : 'SIGNED_OUT', data.session);
            }
          }).catch(() => { /* A failed reread cannot discard the current session. */ });
        };
        return () => { active = false; subscription.unsubscribe(); changes?.close(); };
      },
      getSession: () => supabase.auth.getSession(),
      revision: () => useAuthStore.getState().sessionRevision,
      apply: session => { useAuthStore.getState().applyAuthEvent(session); setStartupError(false); },
      failed: () => { useAuthStore.getState().finishStartup(); setStartupError(true); },
    });
  }, [startupAttempt]);

  return (
    <BrowserRouter>
      <div className="min-h-screen w-full bg-slate-900 text-slate-100 flex justify-center">
        <div className="w-full max-w-md bg-slate-900 relative shadow-2xl overflow-hidden flex flex-col">
           {startupError && <div role="alert" className="p-3 text-sm text-red-200">
             A sessão inicial não foi confirmada. Verifica a ligação.
             <button onClick={() => { setStartupError(false); setStartupAttempt(value => value + 1); }} className="block underline">Tentar novamente</button>
           </div>}
           {signOutError && <div role="alert" className="p-3 text-sm text-red-200">
             {signOutError}
             <button onClick={dismissSignOutError} className="block underline">Fechar aviso</button>
           </div>}
           {isSigningOut && <p role="status" className="p-3 text-sm">A confirmar saída...</p>}
           <AppRoutes />
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
