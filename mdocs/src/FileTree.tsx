import React, {useState, useRef, useEffect} from 'react';
import {FileNode} from './types';
import {File, Folder, FolderOpen, Plus, Trash2, Edit2, FolderPlus} from 'lucide-react';
import {ThemeSelector} from './ThemeSelector';

interface FileTreeProps {
    nodes: FileNode[];
    selectedFileId: string | null;
    onSelectFile: (file: FileNode) => void;
    onCreateFile: (parentId: string | null, type: 'file' | 'directory') => void;
    onRename: (id: string, newName: string) => void;
    onDelete: (id: string) => void;
    onMove: (id: string, newParentId: string | null) => void;
}

export const FileTree: React.FC<FileTreeProps> = ({
    nodes,
    selectedFileId,
    onSelectFile,
    onCreateFile,
    onRename,
    onDelete,
    onMove,
}) => {
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        node: FileNode | null;
    } | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [draggedId, setDraggedId] = useState<string | null>(null);

    const contextMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
                setContextMenu(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleExpand = (id: string) => {
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const handleContextMenu = (e: React.MouseEvent, node: FileNode | null) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({x: e.clientX, y: e.clientY, node});
    };

    const handleRename = (node: FileNode) => {
        setRenamingId(node.id);
        setRenameValue(node.name);
        setContextMenu(null);
    };

    const confirmRename = () => {
        if (renamingId && renameValue.trim()) {
            onRename(renamingId, renameValue.trim());
        }
        setRenamingId(null);
        setRenameValue('');
    };

    const handleDragStart = (e: React.DragEvent, node: FileNode) => {
        e.stopPropagation();
        setDraggedId(node.id);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', node.id);
    };

    const handleDragOver = (e: React.DragEvent, node?: FileNode) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';

        // Highlight folders when dragging over them
        if (node?.type === 'directory') {
            e.currentTarget.classList.add('drag-over');
        }
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.currentTarget.classList.remove('drag-over');
    };

    const handleDrop = (e: React.DragEvent, targetNode: FileNode | null) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove('drag-over');

        if (!draggedId || draggedId === targetNode?.id) {
            setDraggedId(null);
            return;
        }

        // Determine the new parent
        let newParentId: string | null = null;
        if (targetNode) {
            if (targetNode.type === 'directory') {
                // Drop directly on a folder
                newParentId = targetNode.id;
            } else {
                // Drop on a file -> move to the same level
                newParentId = targetNode.parentId || null;
            }
        }

        onMove(draggedId, newParentId);
        setDraggedId(null);
    };

    const renderNode = (node: FileNode, depth: number = 0): React.ReactNode => {
        const isExpanded = expandedIds.has(node.id);
        const isSelected = node.id === selectedFileId;
        const isRenaming = node.id === renamingId;

        return (
            <div key={node.id}>
                <div
                    className={`file-tree-item ${isSelected ? 'selected' : ''} ${
                        draggedId === node.id ? 'dragging' : ''
                    }`}
                    style={{paddingLeft: `${depth * 16 + 8}px`}}
                    onClick={() => {
                        if (node.type === 'directory') {
                            toggleExpand(node.id);
                        } else {
                            onSelectFile(node);
                        }
                    }}
                    onContextMenu={(e) => handleContextMenu(e, node)}
                    draggable
                    onDragStart={(e) => handleDragStart(e, node)}
                    onDragOver={(e) => handleDragOver(e, node)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, node)}
                >
                    {node.type === 'directory' ? (
                        isExpanded ? (
                            <FolderOpen size={16} />
                        ) : (
                            <Folder size={16} />
                        )
                    ) : (
                        <File size={16} />
                    )}
                    {isRenaming ? (
                        <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={confirmRename}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') confirmRename();
                                if (e.key === 'Escape') setRenamingId(null);
                            }}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <span>{node.name}</span>
                    )}
                </div>
                {node.type === 'directory' && isExpanded && node.children && (
                    <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
                )}
            </div>
        );
    };

    return (
        <div className="file-tree">
            <div className="file-tree-header">
                <h3>MDocs</h3>
                <div className="file-tree-actions">
                    <ThemeSelector />
                    <button onClick={() => onCreateFile(null, 'file')} title="Nuevo archivo">
                        <Plus size={16} />
                    </button>
                    <button onClick={() => onCreateFile(null, 'directory')} title="Nueva carpeta">
                        <FolderPlus size={16} />
                    </button>
                </div>
            </div>
            <div
                className="file-tree-content"
                onContextMenu={(e) => handleContextMenu(e, null)}
                onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => handleDrop(e, null)}
            >
                {nodes.map((node) => renderNode(node))}
            </div>

            {contextMenu && (
                <div
                    ref={contextMenuRef}
                    className="context-menu"
                    style={{left: contextMenu.x, top: contextMenu.y}}
                >
                    {contextMenu.node && (
                        <>
                            <button onClick={() => handleRename(contextMenu.node!)}>
                                <Edit2 size={14} /> Renombrar
                            </button>
                            <button
                                onClick={() => {
                                    onDelete(contextMenu.node!.id);
                                    setContextMenu(null);
                                }}
                            >
                                <Trash2 size={14} /> Eliminar
                            </button>
                            <hr />
                        </>
                    )}
                    <button
                        onClick={() => {
                            onCreateFile(
                                contextMenu.node?.type === 'directory' ? contextMenu.node.id : null,
                                'file'
                            );
                            setContextMenu(null);
                        }}
                    >
                        <Plus size={14} /> Nuevo archivo
                    </button>
                    <button
                        onClick={() => {
                            onCreateFile(
                                contextMenu.node?.type === 'directory' ? contextMenu.node.id : null,
                                'directory'
                            );
                            setContextMenu(null);
                        }}
                    >
                        <FolderPlus size={14} /> Nueva carpeta
                    </button>
                </div>
            )}
        </div>
    );
};
