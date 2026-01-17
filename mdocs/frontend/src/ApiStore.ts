import {FileNode, FileSystemStore} from './types';

const API_BASE_URL = 'http://localhost:3001/api';

export class ApiStore implements FileSystemStore {
    private async request(endpoint: string, options?: RequestInit): Promise<any> {
        const url = `${API_BASE_URL}${endpoint}`;
        console.log('API request to:', url);

        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options?.headers,
                },
            });

            console.log('API response status:', response.status);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('API response data:', data);
            return data;
        } catch (error) {
            console.error('API request error:', error);
            console.error('Error details:', {
                url,
                message: error instanceof Error ? error.message : 'Unknown error',
                name: error instanceof Error ? error.name : 'Unknown',
            });
            throw error;
        }
    }

    private buildTree(nodes: FileNode[]): FileNode[] {
        const nodeMap = new Map<string, FileNode>();
        const rootNodes: FileNode[] = [];

        nodes.forEach((node) => {
            nodeMap.set(node.id, {...node, children: []});
        });

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
        const data = await this.request('/files');
        return this.buildTree(data);
    }

    async getFile(id: string): Promise<FileNode | null> {
        try {
            return await this.request(`/files/${id}`);
        } catch (error) {
            console.error('Error fetching file:', error);
            return null;
        }
    }

    async createFile(parentId: string | null, name: string, type: 'file' | 'directory'): Promise<FileNode> {
        return await this.request('/files', {
            method: 'POST',
            body: JSON.stringify({parentId, name, type}),
        });
    }

    async updateFile(id: string, updates: Partial<FileNode>): Promise<void> {
        const body: any = {};
        if (updates.name !== undefined) body.name = updates.name;
        if (updates.content !== undefined) body.content = updates.content;
        if (updates.parentId !== undefined) body.parentId = updates.parentId;

        await this.request(`/files/${id}`, {
            method: 'PUT',
            body: JSON.stringify(body),
        });
    }

    async deleteFile(id: string): Promise<void> {
        await this.request(`/files/${id}`, {
            method: 'DELETE',
        });
    }

    async moveFile(id: string, newParentId: string | null): Promise<void> {
        await this.request(`/files/${id}`, {
            method: 'PUT',
            body: JSON.stringify({parentId: newParentId}),
        });
    }
}
