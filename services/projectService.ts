import { db, functions } from './firebaseConfig';
import { collection, doc, setDoc, getDocs, deleteDoc, query, where, orderBy, getDoc, FieldPath } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Project, AppState, DiscoveryStage, SharedUser } from '../types';
import { STAGE_CONFIGS } from '../constants';

const PROJECTS_COLLECTION = 'projects';

// Helper to create a default empty project state
export const createDefaultProjectState = (): AppState => ({
    // ... (unchanged)
    currentStage: DiscoveryStage.DOMAIN,
    projectMetadata: {
        companyName: '',
        missionStatement: '',
        targetVertical: '',
        geography: '',
        tam: '',
        revenueModel: '',
        websiteUrls: '',
        keyCompetitors: '',
    },
    settings: {
        isThinkingEnabled: false,
        isSearchEnabled: false,
    },
    stages: {
        [DiscoveryStage.DOMAIN]: { input: '', output: '', files: [], urls: [], status: 'pending', questions: [], answers: {}, versions: [], coherenceScore: 0 },
        [DiscoveryStage.BOD]: { input: '', output: '', files: [], urls: [], status: 'pending', questions: [], answers: {}, versions: [], coherenceScore: 0 },
        [DiscoveryStage.KPI]: { input: '', output: '', files: [], urls: [], status: 'pending', questions: [], answers: {}, versions: [], coherenceScore: 0 },
        [DiscoveryStage.EPICS]: { input: '', output: '', files: [], urls: [], status: 'pending', questions: [], answers: {}, versions: [], coherenceScore: 0 },
    }
});

export const projectService = {
    // Create a new project
    createProject: async (userId: string, userName: string, initialData?: Partial<AppState>): Promise<Project> => {
        const projectId = doc(collection(db, PROJECTS_COLLECTION)).id;
        const now = Date.now();

        const baseState = createDefaultProjectState();

        // Merge initial data if provided
        const appState: AppState = {
            ...baseState,
            ...initialData,
            projectMetadata: {
                ...baseState.projectMetadata,
                ...initialData?.projectMetadata
            },
            stages: {
                ...baseState.stages,
                ...initialData?.stages
            }
        };

        const newProject: Project = {
            ...appState,
            id: projectId,
            userId,
            userName,
            name: appState.projectMetadata.companyName || 'Untitled Project',
            createdAt: now,
            updatedAt: now,
        };

        await setDoc(doc(db, PROJECTS_COLLECTION, projectId), newProject);
        return newProject;
    },

    // Save/Update an existing project
    saveProject: async (project: Project): Promise<void> => {
        try {
            const updatedProject = {
                ...project,
                updatedAt: Date.now(),
                name: project.projectMetadata.companyName || project.name || 'Untitled Project'
            };

            // Sanitize undefined values which Firestore hates
            const sanitizedProject = JSON.parse(JSON.stringify(updatedProject));

            await setDoc(doc(db, PROJECTS_COLLECTION, project.id), sanitizedProject, { merge: true });
        } catch (error) {
            console.error("Error saving project:", error);
            throw error;
        }
    },

    // Generic update for partial data
    updateProject: async (projectId: string, data: Partial<Project>): Promise<void> => {
        const docRef = doc(db, PROJECTS_COLLECTION, projectId);
        await setDoc(docRef, {
            ...data,
            updatedAt: Date.now()
        }, { merge: true });
    },

    // Rename a project
    renameProject: async (projectId: string, newName: string): Promise<void> => {
        const docRef = doc(db, PROJECTS_COLLECTION, projectId);
        await setDoc(docRef, {
            name: newName,
            projectMetadata: { companyName: newName },
            updatedAt: Date.now()
        }, { merge: true });
    },

    // Share a project
    shareProject: async (projectId: string, email: string, role: 'viewer' | 'editor' = 'viewer'): Promise<{ success: boolean; message?: string }> => {
        try {
            const projectRef = doc(db, PROJECTS_COLLECTION, projectId);
            const projectDoc = await getDoc(projectRef);

            if (!projectDoc.exists()) {
                throw new Error("Project not found");
            }

            const currentData = projectDoc.data() as Project;
            const now = Date.now();

            // Check if already shared
            if (currentData.sharedEmails?.includes(email)) {
                return { success: false, message: "User already has access." };
            }

            // Prepare updates
            // 1. Add to sharedWith array of objects (for UI display)
            const newSharedUser = {
                email,
                role,
                sharedAt: now,
                sharedBy: 'owner' // We can improve this if we pass current user context
            };

            const updatedSharedWith = [...(currentData.sharedWith || []), newSharedUser];

            // 2. Add to sharedEmails array (for Security Rules & Querying)
            const updatedSharedEmails = [...(currentData.sharedEmails || []), email];

            await setDoc(projectRef, {
                sharedWith: updatedSharedWith,
                sharedEmails: updatedSharedEmails,
                updatedAt: now
            }, { merge: true });

            return { success: true };
        } catch (error: any) {
            console.error("Error sharing project:", error);
            if (error.code === 'permission-denied') {
                return { success: false, message: "You don't have permission to share this project." };
            }
            return { success: false, message: error.message || "Failed to share project." };
        }
    },

    // Get all projects for a user (Owned + Shared)
    getUserProjects: async (userId: string, userEmail?: string | null): Promise<Project[]> => {
        try {
            // 1. Fetch Owned Projects
            const ownedQuery = query(
                collection(db, PROJECTS_COLLECTION),
                where("userId", "==", userId)
            );
            const ownedSnapshot = await getDocs(ownedQuery);

            const projectsMap = new Map<string, Project>();

            ownedSnapshot.forEach((doc) => {
                projectsMap.set(doc.id, doc.data() as Project);
            });

            // 2. Fetch Shared Projects (if email is provided)
            if (userEmail) {
                const sharedQuery = query(
                    collection(db, PROJECTS_COLLECTION),
                    where("sharedEmails", "array-contains", userEmail)
                );
                const sharedSnapshot = await getDocs(sharedQuery);

                sharedSnapshot.forEach((doc) => {
                    if (!projectsMap.has(doc.id)) {
                        projectsMap.set(doc.id, doc.data() as Project);
                    }
                });
            }

            // Convert to array and sort by updatedAt
            return Array.from(projectsMap.values()).sort((a, b) => b.updatedAt - a.updatedAt);
        } catch (error) {
            console.error("Error fetching projects:", error);
            if ((error as any).code === 'failed-precondition') {
                console.warn("Firestore index required. Fallback to client-side sort if needed.");
            }
            throw error;
        }
    },

    // Get a single project
    getProject: async (projectId: string): Promise<Project | null> => {
        const docRef = doc(db, PROJECTS_COLLECTION, projectId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return docSnap.data() as Project;
        }
        return null;
    },

    // Clone a project
    cloneProject: async (originalProjectId: string, userId: string): Promise<Project> => {
        try {
            // 1. Get Original Project
            const originalProject = await projectService.getProject(originalProjectId);
            if (!originalProject) {
                throw new Error("Project not found");
            }

            // 2. Prepare New Project Data
            const now = Date.now();
            const newProjectId = doc(collection(db, PROJECTS_COLLECTION)).id;
            const newName = `Copy of ${originalProject.name || originalProject.projectMetadata.companyName || 'Untitled Project'}`;

            const newProject: Project = {
                ...originalProject,
                id: newProjectId,
                userId: userId, // Assign to current user (even if cloning shared project)
                userName: originalProject.userName, // Ideally should be current user's name but we might not have it here easily. 
                // However, usually userId matches auth.currentUser.uid.
                // Let's rely on the caller or update it if we have context. 
                // Actually, we should probably let the UI pass the userName or fetch it.
                // For now, let's keep original userName or maybe empty? 
                // Better: We'll stick to just userId for ownership.
                name: newName,
                projectMetadata: {
                    ...originalProject.projectMetadata,
                    companyName: newName
                },
                createdAt: now,
                updatedAt: now,
                // Clear any sharing info if it exists (though usually kept in separate collection or field, 
                // but checking the type definition would be good. 
                // Based on getUserProjects, specific sharedWith field isn't in main type but implied query.
                // Depending on type definition, we might need to strip some fields.
                // But shallow copy of Project type is usually safe given the schema.
            };

            // IMPORTANT: If 'sharedWith' is a field on the document, we must clear it so we don't accidentally share the clone.
            // Looking at getUserProjects, it queries specific field path 'sharedWith'. 
            // If it's part of the explicit Project type, we should clear it.
            // If it's flexible, we delete it.
            const projectToSave: any = { ...newProject };
            delete projectToSave.sharedWith;

            await setDoc(doc(db, PROJECTS_COLLECTION, newProjectId), projectToSave);
            return newProject;
        } catch (error) {
            console.error("Error cloning project:", error);
            throw error;
        }
    },

    // Delete a project
    deleteProject: async (projectId: string): Promise<void> => {
        await deleteDoc(doc(db, PROJECTS_COLLECTION, projectId));
    },

    // Save a specific stage (Optimized update)
    saveProjectStage: async (projectId: string, stage: DiscoveryStage, stageData: any): Promise<void> => {
        const docRef = doc(db, PROJECTS_COLLECTION, projectId);
        await setDoc(docRef, {
            stages: {
                [stage]: stageData
            },
            updatedAt: Date.now()
        }, { merge: true });
    },

    // --- SHADOW COMPETITOR PERSISTENCE ---

    // Save a completed analysis
    // Save a completed or aborted analysis
    saveShadowAnalysis: async (
        projectId: string,
        analysis: any,
        competitors: string[],
        status: 'completed' | 'aborted' = 'completed',
        userContext: string = '',
        competitorData: any[] = []
    ): Promise<void> => {
        try {
            const analysesRef = collection(db, PROJECTS_COLLECTION, projectId, 'competitor_analyses');
            const newDoc = doc(analysesRef);

            await setDoc(newDoc, {
                id: newDoc.id,
                timestamp: Date.now(),
                competitors: competitors,
                status: status,
                userContext: userContext,
                savedInputs: competitorData, // Full competitor objects with geography
                region: analysis?.dna?.[0]?.financialFlexibility?.classification ? 'Global' : 'Unknown',
                result: analysis,
                summary: `Analysis of ${competitors.length} competitors (${competitors.join(', ')})`
            });
        } catch (error) {
            console.error("Error saving shadow analysis:", error);
            throw error;
        }
    },

    // Get analysis history
    getShadowAnalysisHistory: async (projectId: string): Promise<any[]> => {
        try {
            const analysesRef = collection(db, PROJECTS_COLLECTION, projectId, 'competitor_analyses');
            const q = query(analysesRef, orderBy('timestamp', 'desc'));
            const snapshot = await getDocs(q);

            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error("Error fetching shadow history:", error);
            return [];
        }
    },

    // Delete an analysis
    deleteShadowAnalysis: async (projectId: string, analysisId: string): Promise<void> => {
        try {
            await deleteDoc(doc(db, PROJECTS_COLLECTION, projectId, 'competitor_analyses', analysisId));
        } catch (error) {
            console.error("Error deleting shadow analysis:", error);
            throw error;
        }
    },

    // Bulk delete analyses
    deleteShadowAnalyses: async (projectId: string, analysisIds: string[]): Promise<void> => {
        try {
            const deletePromises = analysisIds.map(id =>
                deleteDoc(doc(db, PROJECTS_COLLECTION, projectId, 'competitor_analyses', id))
            );
            await Promise.all(deletePromises);
        } catch (error) {
            console.error("Error deleting shadow analyses:", error);
            throw error;
        }
    }
};
