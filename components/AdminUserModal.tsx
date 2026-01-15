
import React, { useEffect, useState } from 'react';
import { collection, getDocs, doc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { db } from '../services/firebaseConfig';
import { UserProfile, UserRole } from '../types';
import { useRBAC } from '../src/hooks/useRBAC';
import { usePermissions, FEATURE_DEFINITIONS, FeatureKey } from '../src/contexts/PermissionContext';

import { useAuth } from '../src/contexts/AuthContext';
import ConfirmationModal from './common/ConfirmationModal';
import Toast, { ToastType } from './common/Toast';

interface AdminUserModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const ROLES: UserRole[] = ['viewer', 'standard', 'pro', 'admin'];
const ITEMS_PER_PAGE = 5;

const AdminUserModal: React.FC<AdminUserModalProps> = ({ isOpen, onClose }) => {
    const { isAdmin } = useRBAC();
    const { user: currentUser } = useAuth();
    const { permissions, updatePermission } = usePermissions();

    const [activeTab, setActiveTab] = useState<'users' | 'roles'>('users');

    // Users Tab State
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);

    // Delete Modal State
    const [userToDelete, setUserToDelete] = useState<{ uid: string, email: string } | null>(null);
    const [deleteProjects, setDeleteProjects] = useState(false);

    // Toast State
    const [toast, setToast] = useState<{ message: string, type: ToastType } | null>(null);

    // Role Change Modal State
    const [roleChangeTarget, setRoleChangeTarget] = useState<{ uid: string, newRole: UserRole } | null>(null);

    useEffect(() => {
        if (isOpen && isAdmin && activeTab === 'users') {
            loadUsers();
        }
    }, [isOpen, isAdmin, activeTab]);

    // Reset pagination when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, roleFilter]);

    const loadUsers = async () => {
        setIsLoading(true);
        try {
            const querySnapshot = await getDocs(collection(db, 'users'));
            const userList: UserProfile[] = [];
            querySnapshot.forEach((doc) => {
                userList.push(doc.data() as UserProfile);
            });
            setUsers(userList.sort((a, b) => b.createdAt - a.createdAt));
        } catch (error) {
            console.error("Error loading users:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const openDeleteModal = (userId: string, userEmail: string) => {
        setUserToDelete({ uid: userId, email: userEmail });
        setDeleteProjects(false); // Default to false
    };

    const confirmDeleteUser = async () => {
        if (!userToDelete) return;

        setUpdatingUserId(userToDelete.uid);
        try {
            // 1. Conditionally Delete User's Projects
            if (deleteProjects) {
                const projectsQuery = query(collection(db, 'projects'), where('userId', '==', userToDelete.uid));
                const projectsSnapshot = await getDocs(projectsQuery);

                const deletePromises = projectsSnapshot.docs.map(doc => deleteDoc(doc.ref));
                await Promise.all(deletePromises);
            }

            // 2. Delete User Profile
            await deleteDoc(doc(db, 'users', userToDelete.uid));

            // Update local state
            setUsers(users.filter(u => u.uid !== userToDelete.uid));
            setToast({ message: `User "${userToDelete.email}" successfully deleted.`, type: 'success' });
        } catch (error) {
            console.error("Error deleting user data:", error);
            setToast({ message: "Failed to delete user data.", type: 'error' });
        } finally {
            setUpdatingUserId(null);
            setUserToDelete(null);
        }
    };

    const handleRoleChangeRequest = (userId: string, newRole: UserRole) => {
        setRoleChangeTarget({ uid: userId, newRole });
    };

    const confirmRoleChange = async () => {
        if (!roleChangeTarget) return;
        const { uid, newRole } = roleChangeTarget;

        setUpdatingUserId(uid);
        try {
            const userRef = doc(db, 'users', uid);
            await updateDoc(userRef, { role: newRole });

            // Update local state
            setUsers(users.map(u => u.uid === uid ? { ...u, role: newRole } : u));
            setToast({ message: `User role updated to ${newRole}`, type: 'success' });
        } catch (error) {
            console.error("Error updating user role:", error);
            setToast({ message: "Failed to update user role.", type: 'error' });
        } finally {
            setUpdatingUserId(null);
            setRoleChangeTarget(null);
        }
    };

    const handlePermissionToggle = async (feature: FeatureKey, role: UserRole) => {
        const currentRoles = permissions[feature] || [];
        const isEnabled = currentRoles.includes(role);

        // Prevent disabling Admin access for safety (optional but good practice)
        if (role === 'admin' && isEnabled) {
            setToast({ message: "Admin access cannot be disabled.", type: 'error' });
            return;
        }

        let newRoles: UserRole[];
        if (isEnabled) {
            newRoles = currentRoles.filter(r => r !== role);
        } else {
            newRoles = [...currentRoles, role];
        }

        try {
            await updatePermission(feature, newRoles);
        } catch (e) {
            setToast({ message: "Failed to update permission.", type: 'error' });
        }
    };

    // Filter Logic
    const filteredUsers = users.filter(user => {
        const matchesSearch = (user.displayName?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
            user.email.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesRole = roleFilter === 'all' || user.role === roleFilter;
        return matchesSearch && matchesRole;
    }).sort((a, b) => {
        if (a.uid === currentUser?.uid) return -1;
        if (b.uid === currentUser?.uid) return 1;
        return b.createdAt - a.createdAt;
    });

    // Pagination Logic
    const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const currentUsers = filteredUsers.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    const handlePrevPage = () => {
        if (currentPage > 1) setCurrentPage(prev => prev - 1);
    };

    const handleNextPage = () => {
        if (currentPage < totalPages) setCurrentPage(prev => prev + 1);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-slate-900 border border-slate-700 w-full max-w-5xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="p-6 border-b border-slate-800 bg-slate-950/50">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                <i className="fas fa-users-cog text-rose-500"></i>
                                User Management
                                <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/50 text-rose-400 tracking-widest ml-2">
                                    Admin Console
                                </span>
                            </h2>
                            <p className="text-sm text-slate-400 mt-1">Manage platform access and role definitions</p>
                        </div>
                        <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                            <i className="fas fa-times text-xl"></i>
                        </button>
                    </div>

                    {/* TABS */}
                    <div className="flex gap-1 bg-slate-900/50 p-1 rounded-lg border border-slate-800 w-fit">
                        <button
                            onClick={() => setActiveTab('users')}
                            className={`px-4 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${activeTab === 'users'
                                ? 'bg-slate-800 text-white shadow-sm'
                                : 'text-slate-500 hover:text-slate-300'
                                }`}
                        >
                            <i className="fas fa-users"></i> Users
                        </button>
                        <button
                            onClick={() => setActiveTab('roles')}
                            className={`px-4 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${activeTab === 'roles'
                                ? 'bg-slate-800 text-white shadow-sm'
                                : 'text-slate-500 hover:text-slate-300'
                                }`}
                        >
                            <i className="fas fa-key"></i> Role Definitions
                        </button>
                    </div>
                </div>

                {/* Fixed Filters (Users Tab) - OUTSIDE Scroll Container */}
                {activeTab === 'users' && (
                    <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/50 flex gap-4">
                        <div className="relative flex-1">
                            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs"></i>
                            <input
                                type="text"
                                placeholder="Search users by name or email..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:border-indigo-500 outline-none placeholder:text-slate-600"
                            />
                        </div>
                        <div className="relative w-48">
                            <i className="fas fa-filter absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs"></i>
                            <select
                                value={roleFilter}
                                onChange={(e) => setRoleFilter(e.target.value as 'all' | UserRole)}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:border-indigo-500 outline-none appearance-none cursor-pointer"
                            >
                                <option value="all">All Roles</option>
                                <option value="viewer">Viewer</option>
                                <option value="standard">Standard</option>
                                <option value="pro">Pro</option>
                                <option value="admin">Admin</option>
                            </select>
                            <i className="fas fa-chevron-down absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 text-[10px] pointer-events-none"></i>
                        </div>
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 overflow-y-auto bg-slate-900">
                    {activeTab === 'users' ? (
                        /* USERS TAB CONTENT */
                        <div className="px-6 pb-6">
                            {isLoading ? (
                                <div className="text-center py-10 text-slate-500">
                                    <i className="fas fa-circle-notch fa-spin mr-2"></i> Loading users...
                                </div>
                            ) : (
                                <div className="flex flex-col h-full">
                                    <div className="flex-1">
                                        <div className="space-y-4">
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="border-b border-slate-800 text-xs font-black text-slate-500 uppercase tracking-widest sticky top-0 z-10 shadow-sm">
                                                        <th className="p-4 bg-slate-900">User</th>
                                                        <th className="p-4 bg-slate-900">Email</th>
                                                        <th className="p-4 bg-slate-900">Role</th>
                                                        <th className="p-4 bg-slate-900">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="text-sm">
                                                    {filteredUsers.length === 0 ? (
                                                        <tr>
                                                            <td colSpan={4} className="p-8 text-center text-slate-500 italic">
                                                                No users found matching your criteria.
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        currentUsers.map(user => {
                                                            const isCurrentUser = user.uid === currentUser?.uid;
                                                            return (
                                                                <tr key={user.uid} className={`border-b border-slate-800/50 transition-colors ${isCurrentUser ? 'bg-indigo-500/10 border-indigo-500/30' : 'hover:bg-slate-800/30'}`}>
                                                                    <td className="p-4 text-white font-medium">
                                                                        <div className="flex items-center gap-3">
                                                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isCurrentUser ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' : 'bg-slate-800 text-slate-400'}`}>
                                                                                {user.displayName ? user.displayName.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase()}
                                                                            </div>
                                                                            <div>
                                                                                {user.displayName || 'No Name'}
                                                                                {isCurrentUser && (
                                                                                    <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide bg-indigo-500 text-white">You</span>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                    <td className="p-4 text-slate-400 font-mono text-xs">
                                                                        {user.email}
                                                                    </td>
                                                                    <td className="p-4">
                                                                        <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider
                                                                    ${user.role === 'admin' ? 'bg-rose-500/10 text-rose-400' :
                                                                                user.role === 'pro' ? 'bg-amber-500/10 text-amber-400' :
                                                                                    'bg-blue-500/10 text-blue-400'}
                                                                `}>
                                                                            {user.role}
                                                                        </span>
                                                                    </td>
                                                                    <td className="p-4">
                                                                        {updatingUserId === user.uid ? (
                                                                            <span className="text-slate-500 text-xs"><i className="fas fa-spinner fa-spin"></i></span>
                                                                        ) : (
                                                                            isCurrentUser ? (
                                                                                <span className="text-[10px] text-slate-500 italic flex items-center gap-1.5 opacity-50 cursor-not-allowed">
                                                                                    <i className="fas fa-lock"></i> Locked
                                                                                </span>
                                                                            ) : (
                                                                                <div className="flex items-center gap-2">
                                                                                    <select
                                                                                        value={user.role}
                                                                                        onChange={(e) => handleRoleChangeRequest(user.uid, e.target.value as UserRole)}
                                                                                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 outline-none focus:border-indigo-500"
                                                                                    >
                                                                                        <option value="viewer">Viewer</option>
                                                                                        <option value="standard">Standard</option>
                                                                                        <option value="pro">Pro</option>
                                                                                        <option value="admin">Admin</option>
                                                                                    </select>
                                                                                    <button
                                                                                        onClick={() => openDeleteModal(user.uid, user.email)}
                                                                                        className="w-6 h-6 rounded bg-slate-800 hover:bg-rose-900/50 hover:text-rose-400 text-slate-500 transition-colors flex items-center justify-center group/del"
                                                                                        title="Delete User"
                                                                                    >
                                                                                        <i className="fas fa-trash-alt text-[10px] group-hover/del:scale-110 transition-transform"></i>
                                                                                    </button>
                                                                                </div>
                                                                            )
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    {/* Pagination Controls */}
                                    {filteredUsers.length > ITEMS_PER_PAGE && (
                                        <div className="flex items-center justify-between pt-4 mt-4 border-t border-slate-800 text-xs text-slate-400">
                                            <div>
                                                Showing {startIndex + 1} to {Math.min(startIndex + ITEMS_PER_PAGE, filteredUsers.length)} of {filteredUsers.length} users
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={handlePrevPage}
                                                    disabled={currentPage === 1}
                                                    className="px-3 py-1.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                                >
                                                    <i className="fas fa-chevron-left mr-1"></i> Prev
                                                </button>
                                                <div className="flex items-center px-3 bg-slate-900 rounded border border-slate-800">
                                                    Page <span className="mx-1 font-bold text-white">{currentPage}</span> of {totalPages}
                                                </div>
                                                <button
                                                    onClick={handleNextPage}
                                                    disabled={currentPage === totalPages}
                                                    className="px-3 py-1.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                                >
                                                    Next <i className="fas fa-chevron-right ml-1"></i>
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        /* ROLE DEFINITIONS TAB (MATRIX) */
                        <div className="px-8 pb-8">
                            <div className="bg-slate-950 rounded-xl border border-slate-800">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-900 text-xs font-black uppercase tracking-widest text-slate-400 border-b border-slate-800 sticky top-0 z-10 shadow-sm">
                                            <th className="p-4 w-1/3 bg-slate-900">Feature Capability</th>
                                            {ROLES.map(role => (
                                                <th key={role} className="p-4 text-center border-l border-slate-800/50 bg-slate-900">
                                                    <span className={`px-2 py-1 rounded
                                                        ${role === 'admin' ? 'text-rose-400 bg-rose-500/10' :
                                                            role === 'pro' ? 'text-amber-400 bg-amber-500/10' :
                                                                role === 'standard' ? 'text-indigo-400 bg-indigo-500/10' :
                                                                    'text-slate-400 bg-slate-800'}
                                                    `}>
                                                        {role}
                                                    </span>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/50">
                                        {(Object.keys(FEATURE_DEFINITIONS) as FeatureKey[]).map((featureKey) => {
                                            const def = FEATURE_DEFINITIONS[featureKey];
                                            const accessList = permissions[featureKey] || [];

                                            return (
                                                <tr key={featureKey} className="hover:bg-slate-900/40 transition-colors">
                                                    <td className="p-4">
                                                        <p className="text-sm font-bold text-slate-200">{def.label}</p>
                                                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">{featureKey}</p>
                                                    </td>
                                                    {ROLES.map(role => {
                                                        const isEnabled = accessList.includes(role);
                                                        const isDisabled = role === 'admin'; // Admin always enabled by lock policy (visual logic)

                                                        return (
                                                            <td key={role} className="p-4 text-center border-l border-slate-800/50">
                                                                <label className={`relative inline-flex items-center justify-center w-5 h-5 cursor-pointer ${role === 'admin' ? 'cursor-not-allowed opacity-50' : ''}`}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isEnabled}
                                                                        disabled={role === 'admin'}
                                                                        onChange={() => handlePermissionToggle(featureKey, role)}
                                                                        className="peer sr-only"
                                                                    />
                                                                    <div className={`w-5 h-5 rounded border transition-all flex items-center justify-center
                                                                        ${isEnabled
                                                                            ? 'bg-indigo-500 border-indigo-500 text-white'
                                                                            : 'bg-slate-900 border-slate-600 hover:border-slate-500'}
                                                                    `}>
                                                                        {isEnabled && <i className="fas fa-check text-[10px]"></i>}
                                                                    </div>
                                                                </label>
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <div className="mt-4 flex items-start gap-3 p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
                                <i className="fas fa-info-circle text-blue-400 mt-0.5"></i>
                                <div>
                                    <p className="text-sm font-bold text-blue-300">Role Capability Matrix</p>
                                    <p className="text-xs text-slate-400 mt-1">
                                        Adjusting these toggles will instantly update access permissions for all users with that role.
                                        Admin permissions are locked to prevent system lockout.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* DELETE CONFIRMATION MODAL */}
            {userToDelete && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setUserToDelete(null)}>
                    <div className="bg-slate-900 border border-red-500/30 w-full max-w-md rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="p-6">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
                                <i className="fas fa-exclamation-triangle text-amber-500"></i>
                                Delete User?
                            </h3>
                            <p className="text-sm text-slate-400 mb-6">
                                You are about to delete <span className="text-white font-mono bg-slate-800 px-1.5 py-0.5 rounded">{userToDelete.email}</span>.
                                This will remove their listener permissions and profile.
                            </p>

                            <label className="flex items-start gap-3 p-4 bg-red-500/5 border border-red-500/20 rounded-lg cursor-pointer hover:bg-red-500/10 transition-colors mb-6 group">
                                <div className="relative flex items-center mt-0.5">
                                    <input
                                        type="checkbox"
                                        checked={deleteProjects}
                                        onChange={(e) => setDeleteProjects(e.target.checked)}
                                        className="peer sr-only"
                                    />
                                    <div className="w-4 h-4 rounded border-2 border-slate-600 peer-checked:bg-red-500 peer-checked:border-red-500 transition-all"></div>
                                    <i className="fas fa-check text-[10px] text-white absolute left-0.5 top-0.5 opacity-0 peer-checked:opacity-100 transition-opacity"></i>
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-bold text-slate-200 group-hover:text-white transition-colors">Also delete all projects?</p>
                                    <p className="text-xs text-slate-500 mt-1">Permanently remove all project data owned by this user. This cannot be undone.</p>
                                </div>
                            </label>

                            <div className="flex gap-3 justify-end">
                                <button
                                    onClick={() => setUserToDelete(null)}
                                    className="px-4 py-2 rounded-lg text-sm font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmDeleteUser}
                                    disabled={!userToDelete}
                                    className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-sm font-bold text-white shadow-lg shadow-red-600/20 transition-all flex items-center gap-2"
                                >
                                    <i className="fas fa-trash-alt"></i> Delete User
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* ROLE CHANGE CONFIRMATION */}
            <ConfirmationModal
                isOpen={!!roleChangeTarget}
                onClose={() => setRoleChangeTarget(null)}
                onConfirm={confirmRoleChange}
                title="Change User Role"
                message={`Are you sure you want to change this user's role to ${roleChangeTarget?.newRole}?`}
                confirmLabel="Change Role"
                isLoading={!!updatingUserId}
            />

            {/* TOAST NOTIFICATION */}
            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}
        </div>
    );
};

export default AdminUserModal;
