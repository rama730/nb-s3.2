'use client';

import { useState, useEffect } from 'react';
import { User } from '@/types/hub';
import { Loader2, Plus, X } from 'lucide-react';
import { useToast } from '@/components/ui-custom/Toast';
import { 
    createCollectionAction, 
    getUserCollectionsAction, 
    addProjectsToCollectionAction 
} from '@/app/actions/collection';

interface AddToCollectionModalProps {
    projectIds: string[];
    onClose: () => void;
    currentUser: User | null;
}

export default function AddToCollectionModal({
    projectIds,
    onClose,
    currentUser,
}: AddToCollectionModalProps) {
    const { showToast } = useToast();
    const [collections, setCollections] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    
    const [isCreating, setIsCreating] = useState(false);
    const [newCollectionName, setNewCollectionName] = useState('');

    useEffect(() => {
        async function loadCollections() {
            setLoading(true);
            const res = await getUserCollectionsAction();
            if (res.success && res.collections) {
                setCollections(res.collections);
            }
            setLoading(false);
        }
        loadCollections();
    }, []);

    const handleSelectCollection = async (collectionId: string) => {
        setSaving(true);
        const res = await addProjectsToCollectionAction(collectionId, projectIds);
        setSaving(false);
        
        if (res.success) {
            showToast(
                `Successfully added ${projectIds.length} project(s) to collection.`,
                'success'
            );
            onClose();
        } else {
            showToast(
                `Failed to add projects: ${res.error || 'Unknown error'}`,
                'error'
            );
        }
    };

    const handleCreateCollection = async () => {
        if (!newCollectionName.trim()) return;
        
        setSaving(true);
        const createRes = await createCollectionAction(newCollectionName.trim());
        if (!createRes.success || !createRes.collection) {
            setSaving(false);
            showToast(
                `Failed to create collection: ${createRes.error || 'Unknown error'}`,
                'error'
            );
            return;
        }

        const addRes = await addProjectsToCollectionAction(createRes.collection.id, projectIds);
        setSaving(false);
        
        if (addRes.success) {
            showToast(
                `Created collection and added ${projectIds.length} project(s).`,
                'success'
            );
            onClose();
        } else {
            showToast(
                `Failed to add projects to new collection: ${addRes.error || 'Unknown error'}`,
                'error'
            );
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
            <div className="relative flex flex-col bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md max-h-[80vh]">
                <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                        Add to Collection
                    </h2>
                    <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <div className="p-4 overflow-y-auto">
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                        Adding {projectIds.length} project(s) to a collection:
                    </p>

                    {loading ? (
                        <div className="flex justify-center p-4">
                            <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                        </div>
                    ) : (
                        <div className="space-y-2 mb-4">
                            {collections.length === 0 ? (
                                <p className="text-sm text-zinc-500 italic text-center py-2">No existing collections found.</p>
                            ) : (
                                collections.map(col => (
                                    <button
                                        key={col.id}
                                        onClick={() => handleSelectCollection(col.id)}
                                        disabled={saving}
                                        className="w-full text-left px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all font-medium text-sm flex justify-between items-center"
                                    >
                                        <span>{col.name}</span>
                                        <span className="text-xs text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                                            {col.projects?.length || 0} items
                                        </span>
                                    </button>
                                ))
                            )}
                        </div>
                    )}

                    {isCreating ? (
                        <div className="flex items-center gap-2 mt-4 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
                            <input
                                type="text"
                                placeholder="Collection name..."
                                value={newCollectionName}
                                onChange={(e) => setNewCollectionName(e.target.value)}
                                className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-md px-3 py-1.5 text-sm outline-none focus:border-blue-500"
                                autoFocus
                            />
                            <button
                                onClick={handleCreateCollection}
                                disabled={saving || !newCollectionName.trim()}
                                className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                            >
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                            </button>
                            <button
                                onClick={() => { setIsCreating(false); setNewCollectionName(''); }}
                                className="p-1.5 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setIsCreating(true)}
                            className="w-full flex items-center gap-2 justify-center px-4 py-3 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500 text-zinc-600 dark:text-zinc-400 text-sm font-medium transition-colors mt-2"
                        >
                            <Plus className="w-4 h-4" />
                            New Collection
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
