
import React, { createContext, useContext, useEffect, useState } from 'react';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebaseConfig';
import { UserRole } from '../../types';

export const FEATURE_DEFINITIONS = {
    canCreateProject: { label: 'Create Projects', default: ['standard', 'pro', 'admin'] },
    canEditProject: { label: 'Edit Project Content', default: ['standard', 'pro', 'admin'] },
    canDeleteProject: { label: 'Delete Projects', default: ['standard', 'pro', 'admin'] }, // Usually owner only, but role allows it
    canUseBasicAI: { label: 'Basic AI Generation', default: ['standard', 'pro', 'admin'] },
    canUseAdvancedAI: { label: 'Advanced AI (Thinking/Search)', default: ['pro', 'admin'] },
    canExportData: { label: 'Export Data (PDF/CSV)', default: ['pro', 'admin'] },
    canSyncJira: { label: 'Jira Integration', default: ['pro', 'admin'] },
    canUseEstimationStudio: { label: 'Estimation Studio', default: ['pro', 'admin'] },
    canManageStageIterations: { label: 'Manage Versions/Reset', default: ['pro', 'admin'] },
    canUseRefinementStudio: { label: 'Refinement Studio', default: ['pro', 'admin'] },
    canShareProject: { label: 'Share Projects', default: ['pro', 'admin'] },
    canCustomizeInstructions: { label: 'Customize System Instructions', default: ['pro', 'admin'] },
    canUseEnterpriseRAG: { label: 'Enterprise RAG (Pinecone)', default: ['pro', 'admin'] },
    canUseFigma: { label: 'Figma Integration', default: ['pro', 'admin'] },
};

export type FeatureKey = keyof typeof FEATURE_DEFINITIONS;

interface PermissionContextType {
    permissions: Record<FeatureKey, UserRole[]>;
    isLoading: boolean;
    updatePermission: (feature: FeatureKey, roles: UserRole[]) => Promise<void>;
}

const PermissionContext = createContext<PermissionContextType | undefined>(undefined);

export const PermissionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Initialize with defaults
    const [permissions, setPermissions] = useState<Record<FeatureKey, UserRole[]>>(() => {
        const defaults: any = {};
        Object.entries(FEATURE_DEFINITIONS).forEach(([key, def]) => {
            defaults[key] = def.default;
        });
        return defaults;
    });
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const docRef = doc(db, 'systemConfig', 'permissions');

        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setPermissions(prev => ({ ...prev, ...data }));
            } else {
                // Determine if we should create it? 
                // Mostly fine to just run with defaults and save them on first edit.
                // Or auto-create now.
            }
            setIsLoading(false);
        }, (err) => {
            console.error("Failed to load permissions", err);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const updatePermission = async (feature: FeatureKey, roles: UserRole[]) => {
        const docRef = doc(db, 'systemConfig', 'permissions');
        // Merge with existing
        await setDoc(docRef, {
            [feature]: roles
        }, { merge: true });
        // Local state update happens via snapshot listener
    };

    return (
        <PermissionContext.Provider value={{ permissions, isLoading, updatePermission }}>
            {children}
        </PermissionContext.Provider>
    );
};

export const usePermissions = () => {
    const context = useContext(PermissionContext);
    if (!context) {
        throw new Error('usePermissions must be used within a PermissionProvider');
    }
    return context;
};
