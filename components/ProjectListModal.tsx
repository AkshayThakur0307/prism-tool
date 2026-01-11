
import React, { useState, useEffect } from 'react';
import { ShareProjectModal } from './ShareProjectModal';
import { Project } from '../types';
import { projectService } from '../services/projectService';
import { useAuth } from '../src/contexts/AuthContext';
import { useRBAC } from '../src/hooks/useRBAC';

interface ProjectListModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectProject: (project: Project) => void;
    onProjectUpdated?: (project: Project) => void;
    activeProjectId: string | null;
}

const ProjectListModal: React.FC<ProjectListModalProps> = ({ isOpen, onClose, onSelectProject, onProjectUpdated, activeProjectId }) => {
    const { user } = useAuth();
    const { role, canCreateProject, canDeleteProject, canShareProject } = useRBAC();
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');

    useEffect(() => {
        if (isOpen && user) {
            loadProjects();
        }
    }, [isOpen, user]);

    const loadProjects = async () => {
        if (!user) return;
        setIsLoading(true);
        try {
            const list = await projectService.getUserProjects(user.uid);
            setProjects(list);
        } catch (e) {
            console.error("Failed to load projects", e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!user) return;
        setIsCreating(true);
        try {
            const metadata = newProjectName ? { projectMetadata: { companyName: newProjectName } } : undefined;
            const newProject = await projectService.createProject(user.uid, user.displayName || user.email || 'Anonymous', metadata as any);
            setProjects([newProject, ...projects]);
            onSelectProject(newProject);
            setNewProjectName('');
        } catch (e) {
            console.error("Failed to create project", e);
        } finally {
            setIsCreating(false);
        }
    };

    const handleDelete = async (projectId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("Are you sure you want to delete this project? This cannot be undone.")) return;

        try {
            await projectService.deleteProject(projectId);
            setProjects(projects.filter(p => p.id !== projectId));
        } catch (e) {
            console.error("Failed to delete project", e);
        }
    };

    const startEditing = (project: Project, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingProjectId(project.id);
        setEditingName(project.name || project.projectMetadata.companyName || '');
    };

    const saveRename = async () => {
        if (!editingProjectId || !editingName.trim()) {
            setEditingProjectId(null);
            return;
        }

        try {
            await projectService.renameProject(editingProjectId, editingName);

            const updatedProject = projects.find(p => p.id === editingProjectId);
            if (updatedProject) {
                const newVersion = {
                    ...updatedProject,
                    name: editingName,
                    projectMetadata: { ...updatedProject.projectMetadata, companyName: editingName },
                    updatedAt: Date.now()
                };

                setProjects(projects.map(p => p.id === editingProjectId ? newVersion : p));
                if (onProjectUpdated) onProjectUpdated(newVersion);
            }
        } catch (e) {
            console.error("Failed to rename project", e);
        } finally {
            setEditingProjectId(null);
        }
    };

    const [projectToShare, setProjectToShare] = useState<Project | null>(null);

    // Filter projects
    const ownedProjects = projects.filter(p => p.userId === user?.uid);
    const sharedProjects = projects.filter(p => p.userId !== user?.uid);

    // ... (Keep lifecycle loops)

    const handleShareClick = (project: Project, e: React.MouseEvent) => {
        e.stopPropagation();
        setProjectToShare(project);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <i className="fas fa-folder-open text-indigo-400"></i>
                            Project Workspace
                            <span className={`text-[10px] uppercase font-black px-2 py-0.5 rounded-full border tracking-widest ml-2
                                ${role === 'pro' ? 'bg-amber-500/10 border-amber-500/50 text-amber-400' :
                                    role === 'standard' ? 'bg-blue-500/10 border-blue-500/50 text-blue-400' :
                                        'bg-slate-700/50 border-slate-600 text-slate-400'}
                            `}>
                                {role} Plan
                            </span>
                        </h2>
                        <p className="text-sm text-slate-400 mt-1">Manage owned and shared projects</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <i className="fas fa-times text-xl"></i>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8">

                    {/* MY PROJECTS SECTION */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">My Projects</h3>
                        </div>

                        {/* Create New Block */}
                        {canCreateProject && (
                            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 flex items-center gap-4">
                                <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                                    <i className="fas fa-plus"></i>
                                </div>
                                <input
                                    type="text"
                                    placeholder="Enter project name (e.g. Acme Corp Discovery)..."
                                    className="flex-1 bg-transparent border-none outline-none text-white placeholder-slate-500"
                                    value={newProjectName}
                                    onChange={(e) => setNewProjectName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                                />
                                <button
                                    onClick={handleCreate}
                                    disabled={isCreating}
                                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                                >
                                    {isCreating ? 'Creating...' : 'Create New'}
                                </button>
                            </div>
                        )}

                        {/* Owned List */}
                        {isLoading ? (
                            <div className="text-center py-4 text-slate-500">
                                <i className="fas fa-circle-notch fa-spin mr-2"></i> Loading...
                            </div>
                        ) : ownedProjects.length === 0 ? (
                            <div className="text-center py-8 text-slate-500 border-2 border-dashed border-slate-800 rounded-xl">
                                <p>No owned projects found.</p>
                            </div>
                        ) : (
                            <div className="grid gap-3">
                                {ownedProjects.map(project => (
                                    <div
                                        key={project.id}
                                        onClick={() => onSelectProject(project)}
                                        className={`group p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between
                                    ${activeProjectId === project.id
                                                ? 'bg-slate-800 border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.1)]'
                                                : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600 hover:bg-slate-800/60'}
                                `}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0
                                        ${activeProjectId === project.id ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-400 group-hover:bg-slate-600 group-hover:text-white'}
                                    `}>
                                                <i className="fas fa-cube"></i>
                                            </div>
                                            <div>
                                                {editingProjectId === project.id ? (
                                                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                                        <input
                                                            type="text"
                                                            value={editingName}
                                                            onChange={(e) => setEditingName(e.target.value)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') saveRename();
                                                                if (e.key === 'Escape') setEditingProjectId(null);
                                                            }}
                                                            onBlur={saveRename}
                                                            autoFocus
                                                            className="bg-slate-950 border border-indigo-500/50 rounded px-2 py-1 text-sm text-white outline-none w-full min-w-[200px]"
                                                        />
                                                    </div>
                                                ) : (
                                                    <h3 className={`font-medium ${activeProjectId === project.id ? 'text-white' : 'text-slate-200'}`}>
                                                        {project.name || 'Untitled Project'}
                                                    </h3>
                                                )}
                                                <p className="text-xs text-slate-500">
                                                    Last updated: {new Date(project.updatedAt).toLocaleDateString()}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={(e) => {
                                                    if (!canShareProject) return;
                                                    handleShareClick(project, e);
                                                }}
                                                className={`p-2 rounded-lg transition-colors
                                                    ${canShareProject
                                                        ? 'text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10'
                                                        : 'text-slate-600 bg-slate-800/30 cursor-not-allowed opacity-50'}
                                                `}
                                                title={canShareProject ? "Share Project" : "Upgrade to Pro to share"}
                                            >
                                                {!canShareProject && <i className="fas fa-lock text-[8px] text-amber-500 mr-1"></i>}
                                                <i className="fas fa-share-alt"></i>
                                            </button>
                                            <button
                                                onClick={(e) => startEditing(project, e)}
                                                className="p-2 text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-colors"
                                                title="Rename Project"
                                            >
                                                <i className="fas fa-pen"></i>
                                            </button>
                                            {canDeleteProject && (
                                                <button
                                                    onClick={(e) => handleDelete(project.id, e)}
                                                    className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                                                    title="Delete Project"
                                                >
                                                    <i className="fas fa-trash-alt"></i>
                                                </button>
                                            )}
                                            <div className="text-indigo-400">
                                                <i className="fas fa-chevron-right"></i>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* SHARED WITH ME SECTION */}
                    {sharedProjects.length > 0 && (
                        <div className="space-y-4 pt-4 border-t border-slate-800/50">
                            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                <i className="fas fa-users mb-0.5"></i> Shared with Me
                            </h3>
                            <div className="grid gap-3">
                                {sharedProjects.map(project => (
                                    <div
                                        key={project.id}
                                        onClick={() => onSelectProject(project)}
                                        className={`group p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between
                                    ${activeProjectId === project.id
                                                ? 'bg-slate-800 border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.1)]'
                                                : 'bg-slate-800/20 border-slate-700/30 hover:border-slate-600 hover:bg-slate-800/40'}
                                `}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center shrink-0 border border-slate-700">
                                                <i className="fas fa-share text-slate-500"></i>
                                            </div>
                                            <div>
                                                <h3 className={`font-medium ${activeProjectId === project.id ? 'text-white' : 'text-slate-300'}`}>
                                                    {project.name || 'Untitled Project'}
                                                </h3>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400 border border-slate-700">View Only</span>
                                                    <span className="text-[10px] text-slate-500">
                                                        Owner: <span className="text-slate-400 font-bold">{project.userName || 'Unknown'}</span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-slate-600 group-hover:text-indigo-400 transition-colors">
                                            <i className="fas fa-chevron-right"></i>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

            </div>

            {/* Share Modal */}
            {projectToShare && (
                <ShareProjectModal
                    projectId={projectToShare.id}
                    projectName={projectToShare.name || projectToShare.projectMetadata.companyName}
                    onClose={() => setProjectToShare(null)}
                />
            )}
        </div>
    );
};

export default ProjectListModal;
