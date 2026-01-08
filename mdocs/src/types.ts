export interface FileNode {
    id: string;
    name: string;
    type: 'file' | 'directory';
    content?: string;
    children?: FileNode[];
    parentId?: string;
}

export interface FileSystemStore {
    getTree(): Promise<FileNode[]>;
    getFile(id: string): Promise<FileNode | null>;
    createFile(parentId: string | null, name: string, type: 'file' | 'directory'): Promise<FileNode>;
    updateFile(id: string, updates: Partial<FileNode>): Promise<void>;
    deleteFile(id: string): Promise<void>;
    moveFile(id: string, newParentId: string | null): Promise<void>;
}
