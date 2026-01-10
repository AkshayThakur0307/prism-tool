import React from 'react';
import { useAuth } from '../src/contexts/AuthContext';

const LoginScreen: React.FC = () => {
    const { signInWithGoogle } = useAuth();
    const [error, setError] = React.useState('');

    const handleLogin = async () => {
        try {
            await signInWithGoogle();
        } catch (err: any) {
            setError('Failed to sign in. Please try again. ' + err.message);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 font-['Inter'] relative overflow-hidden">
            {/* Background Ambience */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-[20%] -left-[20%] w-[70%] h-[70%] bg-indigo-500/10 rounded-full blur-[120px] animate-pulse-slow"></div>
                <div className="absolute top-[40%] -right-[20%] w-[60%] h-[60%] bg-blue-500/10 rounded-full blur-[120px] animate-pulse-slow delay-1000"></div>
            </div>

            <div className="relative z-10 w-full max-w-md bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl shadow-indigo-500/10">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-500/30">
                        <i className="fas fa-rocket text-white text-2xl"></i>
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-2">Discovery Accelerator</h1>
                    <p className="text-slate-400 text-sm">Enterprise Product Strategy Platform</p>
                </div>

                <button
                    onClick={handleLogin}
                    className="w-full bg-white text-slate-900 font-semibold py-3.5 px-4 rounded-xl flex items-center justify-center gap-3 hover:bg-slate-100 transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl"
                >
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
                    <span>Sign in with Google</span>
                </button>

                {error && (
                    <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs text-center">
                        {error}
                    </div>
                )}

                <div className="mt-8 pt-8 border-t border-slate-800/50 text-center">
                    <p className="text-[10px] text-slate-600 uppercase tracking-widest font-bold">
                        Powered by Gemini & Groq Intelligence
                    </p>
                </div>
            </div>
        </div>
    );
};

export default LoginScreen;
