import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../services/firebaseConfig';
import { UserProfile, UserRole } from '../../types';

interface AuthContextType {
    user: User | null;
    userProfile: UserProfile | null;
    loading: boolean;
    signInWithGoogle: () => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        console.log("[AuthContext] Initializing listener...");
        let profileUnsubscribe: (() => void) | null = null;

        const authUnsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            console.log("[AuthContext] Auth State Changed:", currentUser ? `User ${currentUser.uid}` : "No User");
            setUser(currentUser);

            // Cleanup previous profile listener if user changes
            if (profileUnsubscribe) {
                profileUnsubscribe();
                profileUnsubscribe = null;
            }

            if (currentUser) {
                const userRef = doc(db, 'users', currentUser.uid);

                // Real-time listener: Switch from getDoc to onSnapshot
                profileUnsubscribe = onSnapshot(userRef, async (docSnap) => {
                    if (docSnap.exists()) {
                        const data = docSnap.data() as UserProfile;
                        // Ensure role exists, default to standard (handles legacy users)
                        if (!data.role) data.role = 'standard';
                        console.log("Updated User Profile:", data);
                        setUserProfile(data);
                    } else {
                        // Create profile if missing
                        console.log("Creating new user profile...");
                        const newProfile: UserProfile = {
                            uid: currentUser.uid,
                            email: currentUser.email || '',
                            displayName: currentUser.displayName || '',
                            role: 'standard',
                            createdAt: Date.now()
                        };
                        try {
                            // Use merge: true to avoid overwriting if it exists created by another process
                            await setDoc(userRef, newProfile, { merge: true });
                            console.log("Created/Merged new user profile");
                        } catch (e) {
                            console.error("Error creating profile:", e);
                        }
                    }
                    setLoading(false);
                }, (err) => {
                    console.error("Profile Listener Error:", err);
                    setLoading(false);
                });

            } else {
                setUserProfile(null);
                setLoading(false);
            }
        });

        return () => {
            authUnsubscribe();
            if (profileUnsubscribe) profileUnsubscribe();
        };
    }, []);

    const signInWithGoogle = async () => {
        const provider = new GoogleAuthProvider();

        // ENTERPRISE: Restrict to Org Domain if configured
        const orgDomain = import.meta.env.VITE_ORG_DOMAIN;
        if (orgDomain) {
            provider.setCustomParameters({ hd: orgDomain });
        }

        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Login Failed", error);
            throw error;
        }
    };

    const logout = async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Logout Failed", error);
        }
    };

    return (
        <AuthContext.Provider value={{ user, userProfile, loading, signInWithGoogle, logout }}>
            {children}
        </AuthContext.Provider>
    );
};
