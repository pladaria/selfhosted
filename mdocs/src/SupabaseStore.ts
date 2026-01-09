import {createClient, SupabaseClient} from '@supabase/supabase-js';
import {FileNode, FileSystemStore} from './types';

interface SupabaseFileNode {
    id: string;
    name: string;
    type: 'file' | 'directory';
    content?: string;
    parent_id?: string;
    user_id: string;
    created_at?: string;
    updated_at?: string;
}

// Singleton para el cliente de Supabase
let supabaseClientInstance: SupabaseClient | null = null;
let currentUrl: string | null = null;
let currentKey: string | null = null;

function getSupabaseClient(url: string, key: string): SupabaseClient {
    // Solo crear nueva instancia si cambian las credenciales
    if (supabaseClientInstance && currentUrl === url && currentKey === key) {
        return supabaseClientInstance;
    }

    supabaseClientInstance = createClient(url, key, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
    currentUrl = url;
    currentKey = key;

    return supabaseClientInstance;
}

export class SupabaseStore implements FileSystemStore {
    private client: SupabaseClient;
    private userId: string;

    constructor(supabaseUrl: string, supabaseKey: string, userId: string) {
        this.client = getSupabaseClient(supabaseUrl, supabaseKey);
        this.userId = userId;
    }

    private mapFromSupabase(node: SupabaseFileNode): FileNode {
        return {
            id: node.id,
            name: node.name,
            type: node.type,
            content: node.content,
            parentId: node.parent_id,
        };
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
        const {data, error} = await this.client
            .from('files')
            .select('*')
            .eq('user_id', this.userId)
            .order('name');

        if (error) {
            console.error('Error fetching tree:', error);
            throw error;
        }

        const nodes = (data as SupabaseFileNode[]).map(this.mapFromSupabase);
        return this.buildTree(nodes);
    }

    async getFile(id: string): Promise<FileNode | null> {
        const {data, error} = await this.client
            .from('files')
            .select('*')
            .eq('id', id)
            .eq('user_id', this.userId)
            .single();

        if (error) {
            console.error('Error fetching file:', error);
            return null;
        }

        return this.mapFromSupabase(data as SupabaseFileNode);
    }

    async createFile(parentId: string | null, name: string, type: 'file' | 'directory'): Promise<FileNode> {
        const newNode = {
            id: crypto.randomUUID(),
            name,
            type,
            content: type === 'file' ? '' : undefined,
            parent_id: parentId,
            user_id: this.userId,
        };

        const {data, error} = await this.client.from('files').insert(newNode).select().single();

        if (error) {
            console.error('Error creating file:', error);
            throw error;
        }

        return this.mapFromSupabase(data as SupabaseFileNode);
    }

    async updateFile(id: string, updates: Partial<FileNode>): Promise<void> {
        const supabaseUpdates: Partial<SupabaseFileNode> = {};

        if (updates.name !== undefined) supabaseUpdates.name = updates.name;
        if (updates.content !== undefined) supabaseUpdates.content = updates.content;
        if (updates.parentId !== undefined) supabaseUpdates.parent_id = updates.parentId;

        const {error} = await this.client
            .from('files')
            .update(supabaseUpdates)
            .eq('id', id)
            .eq('user_id', this.userId);

        if (error) {
            console.error('Error updating file:', error);
            throw error;
        }
    }

    async deleteFile(id: string): Promise<void> {
        // Get all descendant IDs
        const {data, error: fetchError} = await this.client
            .from('files')
            .select('id, parent_id')
            .eq('user_id', this.userId);

        if (fetchError) {
            console.error('Error fetching files for deletion:', fetchError);
            throw fetchError;
        }

        const allNodes = data as {id: string; parent_id?: string}[];
        const toDelete = new Set<string>();
        const addToDelete = (nodeId: string) => {
            toDelete.add(nodeId);
            allNodes.filter((n) => n.parent_id === nodeId).forEach((child) => addToDelete(child.id));
        };
        addToDelete(id);

        const {error: deleteError} = await this.client
            .from('files')
            .delete()
            .in('id', Array.from(toDelete))
            .eq('user_id', this.userId);

        if (deleteError) {
            console.error('Error deleting file:', deleteError);
            throw deleteError;
        }
    }

    async moveFile(id: string, newParentId: string | null): Promise<void> {
        const {error} = await this.client
            .from('files')
            .update({parent_id: newParentId})
            .eq('id', id)
            .eq('user_id', this.userId);

        if (error) {
            console.error('Error moving file:', error);
            throw error;
        }
    }
}
