import React from 'react';
import ReactDOM from 'react-dom/client';
import './src/index.css';
import App from './App';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { PermissionProvider } from './src/contexts/PermissionContext';
import LoginScreen from './components/LoginScreen';

const ProtectedApp = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return <App />;
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AuthProvider>
      <PermissionProvider>
        <ProtectedApp />
      </PermissionProvider>
    </AuthProvider>
  </React.StrictMode>
);
