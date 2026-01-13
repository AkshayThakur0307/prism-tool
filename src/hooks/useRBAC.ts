
import { useAuth } from '../contexts/AuthContext';

export const useRBAC = () => {
    const { userProfile, loading } = useAuth();

    const role = userProfile?.role || 'viewer'; // Default to safe 'viewer' if not loaded
    console.log("[RBAC] Current Role:", role, "| User:", userProfile?.email);

    return {
        role,
        isLoading: loading,

        // Feature Permissions
        canCreateProject: role === 'standard' || role === 'pro' || role === 'admin',
        canEditProject: role === 'standard' || role === 'pro' || role === 'admin',
        canDeleteProject: role === 'standard' || role === 'pro' || role === 'admin',

        // AI Features
        canUseBasicAI: role === 'standard' || role === 'pro' || role === 'admin',
        canUseAdvancedAI: role === 'pro' || role === 'admin', // Thinking Mode, Research Grounding

        // Export / Integrations
        canExportData: role === 'pro' || role === 'admin',
        canSyncJira: role === 'pro' || role === 'admin',
        canUseEstimationStudio: role === 'pro' || role === 'admin',

        // Refinement
        canUseRefinementStudio: role === 'pro' || role === 'admin',

        // Admin
        isAdmin: role === 'admin',
        canManageUsers: role === 'admin',

        // Share Permission
        canShareProject: role === 'pro' || role === 'admin',
    };
};
