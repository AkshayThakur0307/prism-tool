
import React, { useEffect, useState } from 'react';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebaseConfig';
import { UserProfile, UserRole } from '../types';
import { useRBAC } from '../src/hooks/useRBAC';

import { useAuth } from '../src/contexts/AuthContext';

interface AdminUserModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const AdminUserModal: React.FC<AdminUserModalProps> = ({ isOpen, onClose }) => {
    const { isAdmin } = useRBAC();
    const { user: currentUser } = useAuth();
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

    const [searchTerm, setSearchTerm] = useState('');
    const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');

    useEffect(() => {
        if (isOpen && isAdmin) {
            loadUsers();
        }
    }, [isOpen, isAdmin]);

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
            alert("Failed to load users. Ensure you have Admin permissions.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleRoleChange = async (userId: string, newRole: UserRole) => {
        if (!confirm(`Are you sure you want to change this user's role to ${newRole}?`)) return;

        setUpdatingUserId(userId);
        try {
            const userRef = doc(db, 'users', userId);
            await updateDoc(userRef, { role: newRole });

            // Update local state
            setUsers(users.map(u => u.uid === userId ? { ...u, role: newRole } : u));
            alert(`User role updated to ${newRole}`);
        } catch (error) {
            console.error("Error updating user role:", error);
            alert("Failed to update user role.");
        } finally {
            setUpdatingUserId(null);
        }
    };

    const filteredUsers = users.filter(user => {
        const matchesSearch = (user.displayName?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
            user.email.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesRole = roleFilter === 'all' || user.role === roleFilter;
        return matchesSearch && matchesRole;
    }).sort((a, b) => {
        // Pin current user to top
        if (a.uid === currentUser?.uid) return -1;
        if (b.uid === currentUser?.uid) return 1;
        // Default sort by createdAt descending (already applied in loadUsers, but good to preserve)
        return b.createdAt - a.createdAt;
    });

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-slate-900 border border-slate-700 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <i className="fas fa-users-cog text-rose-500"></i>
                            User Management
                            <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/50 text-rose-400 tracking-widest ml-2">
                                Admin Console
                            </span>
                        </h2>
                        <p className="text-sm text-slate-400 mt-1">Manage platform access and user roles</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <i className="fas fa-times text-xl"></i>
                    </button>
                </div>

                {/* Filters & Search */}
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

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {isLoading ? (
                        <div className="text-center py-10 text-slate-500">
                            <i className="fas fa-circle-notch fa-spin mr-2"></i> Loading users...
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-800 text-xs font-black text-slate-500 uppercase tracking-widest">
                                        <th className="p-4">User</th>
                                        <th className="p-4">Email</th>
                                        <th className="p-4">Role</th>
                                        <th className="p-4">Actions</th>
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
                                        filteredUsers.map(user => {
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
                                                                <select
                                                                    value={user.role}
                                                                    onChange={(e) => handleRoleChange(user.uid, e.target.value as UserRole)}
                                                                    className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 outline-none focus:border-indigo-500"
                                                                >
                                                                    <option value="viewer">Viewer</option>
                                                                    <option value="standard">Standard</option>
                                                                    <option value="pro">Pro</option>
                                                                    <option value="admin">Admin</option>
                                                                </select>
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
                    )}
                </div>
            </div>
        </div>
    );
};

export default AdminUserModal;
