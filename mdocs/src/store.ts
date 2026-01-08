import {FileNode, FileSystemStore} from './types';

const STORAGE_KEY = 'mdocs-filesystem';

export class LocalStorageStore implements FileSystemStore {
    private loadData(): FileNode[] {
        const data = localStorage.getItem(STORAGE_KEY);
        if (!data) {
            // Initial example structure
            const initialData: FileNode[] = [
                {
                    id: '1',
                    name: 'Welcome.md',
                    type: 'file',
                    content: '# Welcome to MDocs\n\nThis is your first document.',
                    parentId: undefined,
                },
            ];
            this.saveData(initialData);
            return initialData;
        }
        return JSON.parse(data);
    }

    private saveData(data: FileNode[]): void {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    private buildTree(nodes: FileNode[]): FileNode[] {
        const nodeMap = new Map<string, FileNode>();
        const rootNodes: FileNode[] = [];

        // Create node map
        nodes.forEach((node) => {
            nodeMap.set(node.id, {...node, children: []});
        });

        // Build tree
        nodes.forEach((node) => {
            const treeNode = nodeMap.get(node.id)!;
            if (node.parentId && nodeMap.has(node.parentId)) {
                const parent = nodeMap.get(node.parentId)!;
                if (!parent.children) parent.children = [];
                parent.children.push(treeNode);
            } else {
                rootNodes.push(treeNode);
            }
        });

        return rootNodes;
    }

    async getTree(): Promise<FileNode[]> {
        const data = this.loadData();
        return this.buildTree(data);
    }

    async getFile(id: string): Promise<FileNode | null> {
        const data = this.loadData();
        return data.find((node) => node.id === id) || null;
    }

    async createFile(parentId: string | null, name: string, type: 'file' | 'directory'): Promise<FileNode> {
        const data = this.loadData();
        const newNode: FileNode = {
            id: Date.now().toString(),
            name,
            type,
            content: type === 'file' ? '' : undefined,
            parentId: parentId || undefined,
        };
        data.push(newNode);
        this.saveData(data);
        return newNode;
    }

    async updateFile(id: string, updates: Partial<FileNode>): Promise<void> {
        const data = this.loadData();
        const index = data.findIndex((node) => node.id === id);
        if (index !== -1) {
            data[index] = {...data[index], ...updates};
            this.saveData(data);
        }
    }

    async deleteFile(id: string): Promise<void> {
        const data = this.loadData();

        // Find all IDs to delete (including children)
        const toDelete = new Set<string>();
        const addToDelete = (nodeId: string) => {
            toDelete.add(nodeId);
            data.filter((n) => n.parentId === nodeId).forEach((child) => addToDelete(child.id));
        };
        addToDelete(id);

        // Filter
        const filtered = data.filter((node) => !toDelete.has(node.id));
        this.saveData(filtered);
    }

    async moveFile(id: string, newParentId: string | null): Promise<void> {
        const data = this.loadData();
        const index = data.findIndex((node) => node.id === id);
        if (index !== -1) {
            data[index].parentId = newParentId || undefined;
            this.saveData(data);
        }
    }
}
