import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
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
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            console.log("[AuthContext] Auth State Changed:", currentUser ? `User ${currentUser.uid}` : "No User");
            setUser(currentUser);

            if (currentUser) {
                // Fetch User Profile
                const userRef = doc(db, 'users', currentUser.uid);
                try {
                    const userSnap = await getDoc(userRef);
                    if (userSnap.exists()) {
                        console.log("Loaded User Profile:", userSnap.data());
                        setUserProfile(userSnap.data() as UserProfile);
                    } else {
                        // Create new profile for first-time login
                        console.log("Creating new user profile...");
                        const newProfile: UserProfile = {
                            uid: currentUser.uid,
                            email: currentUser.email || '',
                            displayName: currentUser.displayName || '',
                            role: 'standard', // Default role for new users
                            createdAt: Date.now()
                        };
                        await setDoc(userRef, newProfile);
                        setUserProfile(newProfile);
                    }
                } catch (e) {
                    console.error("Error fetching user profile:", e);
                    // Fallback to minimal profile if DB fails
                    setUserProfile({
                        uid: currentUser.uid,
                        email: currentUser.email || '',
                        role: 'standard',
                        createdAt: Date.now()
                    });
                }
            } else {
                setUserProfile(null);
            }

            setLoading(false);
        });
        return unsubscribe;
    }, []);

    const signInWithGoogle = async () => {
        const provider = new GoogleAuthProvider();
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
