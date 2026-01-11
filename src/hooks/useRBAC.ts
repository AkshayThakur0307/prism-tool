
import { useAuth } from '../contexts/AuthContext';

export const useRBAC = () => {
    const { userProfile, loading } = useAuth();

    const role = userProfile?.role || 'viewer'; // Default to safe 'viewer' if not loaded

    return {
        role,
        isLoading: loading,

        // Feature Permissions
        canCreateProject: role === 'standard' || role === 'pro',
        canEditProject: role === 'standard' || role === 'pro',
        canDeleteProject: role === 'standard' || role === 'pro',

        // AI Features
        canUseBasicAI: role === 'standard' || role === 'pro',
        canUseAdvancedAI: role === 'pro', // Thinking Mode, Research Grounding

        // Export / Integrations
        canExportData: role === 'pro',
        canSyncJira: role === 'pro',

        // Refinement
        canUseRefinementStudio: role === 'pro',
    };
};
