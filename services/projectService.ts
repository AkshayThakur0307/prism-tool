import { db, functions } from './firebaseConfig';
import { collection, doc, setDoc, getDocs, deleteDoc, query, where, orderBy, getDoc, FieldPath } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Project, AppState, DiscoveryStage } from '../types';
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
    shareProject: async (projectId: string, email: string, role: string = 'viewer'): Promise<{ success: boolean; message?: string }> => {
        try {
            const shareFn = httpsCallable(functions, 'shareProject');
            const result = await shareFn({ projectId, email, role });
            return result.data as { success: boolean; message?: string };
        } catch (error) {
            console.error("Error sharing project:", error);
            throw error;
        }
    },

    // Get all projects for a user (Owned + Shared)
    getUserProjects: async (userId: string): Promise<Project[]> => {
        try {
            // 1. Fetch Owned Projects
            const ownedQuery = query(
                collection(db, PROJECTS_COLLECTION),
                where("userId", "==", userId)
            );
            const ownedSnapshot = await getDocs(ownedQuery);

            // 2. Fetch Shared Projects
            // Note: FieldPath query requires manual sorting as index might differ
            const sharedQuery = query(
                collection(db, PROJECTS_COLLECTION),
                where(new FieldPath('sharedWith', userId), '!=', null)
            );
            const sharedSnapshot = await getDocs(sharedQuery);

            const projectsMap = new Map<string, Project>();

            ownedSnapshot.forEach((doc) => {
                projectsMap.set(doc.id, doc.data() as Project);
            });

            sharedSnapshot.forEach((doc) => {
                // Shared projects might overlap if user shares with themselves (blocked in backend but safe to dedupe)
                if (!projectsMap.has(doc.id)) {
                    projectsMap.set(doc.id, doc.data() as Project);
                }
            });

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

    // Delete a project
    deleteProject: async (projectId: string): Promise<void> => {
        await deleteDoc(doc(db, PROJECTS_COLLECTION, projectId));
    }
};
