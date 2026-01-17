import { useAuth } from '../contexts/AuthContext';
import { usePermissions, FeatureKey } from '../contexts/PermissionContext';

export const useRBAC = () => {
    const { userProfile, loading } = useAuth();
    const { permissions, isLoading: isPermissionsLoading } = usePermissions();

    // Default to 'standard' if logged in but role missing, 'viewer' if not logged in
    const role = userProfile?.role || (userProfile ? 'standard' : 'viewer');

    // Helper to check permission safely
    const hasAccess = (feature: FeatureKey) => {
        return permissions[feature]?.includes(role) || false;
    };

    return {
        role,
        isLoading: loading || isPermissionsLoading,

        // Feature Permissions
        canCreateProject: hasAccess('canCreateProject'),
        canEditProject: hasAccess('canEditProject'),
        canDeleteProject: hasAccess('canDeleteProject'),

        // AI Features
        canUseBasicAI: hasAccess('canUseBasicAI'),
        canUseAdvancedAI: hasAccess('canUseAdvancedAI'), // Thinking Mode, Research Grounding
        canCustomizeInstructions: hasAccess('canCustomizeInstructions'),
        canUseEnterpriseRAG: hasAccess('canUseEnterpriseRAG'),

        // Export / Integrations
        canExportData: hasAccess('canExportData'),
        canSyncJira: hasAccess('canSyncJira'),
        canUseEstimationStudio: hasAccess('canUseEstimationStudio'),
        canManageStageIterations: hasAccess('canManageStageIterations'), // Reset / Restore Versions

        // Refinement
        canUseRefinementStudio: hasAccess('canUseRefinementStudio'),

        // Admin (Hardcoded protection)
        isAdmin: role === 'admin',
        canManageUsers: role === 'admin',

        // Share Permission
        canShareProject: hasAccess('canShareProject'),
    };
};
