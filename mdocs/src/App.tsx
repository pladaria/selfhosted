import {useState, useEffect, useRef} from 'react';
import {FileTree} from './FileTree';
import {CodeEditor, CodeEditorRef} from './CodeEditor';
import {MarkdownEditor} from './MarkdownEditor';
import {Settings} from './Settings';
import {FileNode} from './types';
import {LocalStorageStore} from './store';
import {Eye, EyeOff, Sparkles, Settings as SettingsIcon, Plus, FolderPlus} from 'lucide-react';
import './App.css';

const store = new LocalStorageStore();

function App() {
    const [tree, setTree] = useState<FileNode[]>([]);
    const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
    const [showPreview, setShowPreview] = useState(true);
    const [showSettings, setShowSettings] = useState(false);
    const codeEditorRef = useRef<CodeEditorRef>(null);

    const handleFormat = () => {
        codeEditorRef.current?.format();
    };

    const loadTree = async () => {
        const data = await store.getTree();
        setTree(data);
    };

    useEffect(() => {
        loadTree();
    }, []);

    const handleSelectFile = async (file: FileNode) => {
        if (file.type === 'file') {
            const fullFile = await store.getFile(file.id);
            if (fullFile) {
                setSelectedFile(fullFile);
            }
        }
    };

    const handleCreateFile = async (parentId: string | null, type: 'file' | 'directory') => {
        const name = prompt(`Nombre del ${type === 'file' ? 'archivo' : 'directorio'}:`);
        if (name) {
            await store.createFile(parentId, name, type);
            await loadTree();
        }
    };

    const handleRename = async (id: string, newName: string) => {
        await store.updateFile(id, {name: newName});
        await loadTree();
        if (selectedFile?.id === id) {
            setSelectedFile({...selectedFile, name: newName});
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm('¿Estás seguro de eliminar este elemento?')) {
            await store.deleteFile(id);
            await loadTree();
            if (selectedFile?.id === id) {
                setSelectedFile(null);
            }
        }
    };

    const handleMove = async (id: string, newParentId: string | null) => {
        await store.moveFile(id, newParentId);
        await loadTree();
    };

    const handleContentChange = async (content: string) => {
        if (selectedFile) {
            await store.updateFile(selectedFile.id, {content});
            setSelectedFile({...selectedFile, content});
        }
    };

    return (
        <div className="app">
            <div className="sidebar">
                <div className="app-header">
                    <h1>MDocs</h1>
                    <div className="app-header-actions">
                        <button onClick={() => setShowSettings(true)} title="Preferencias">
                            <SettingsIcon size={16} />
                        </button>
                        <button onClick={() => handleCreateFile(null, 'file')} title="Nuevo archivo">
                            <Plus size={16} />
                        </button>
                        <button onClick={() => handleCreateFile(null, 'directory')} title="Nueva carpeta">
                            <FolderPlus size={16} />
                        </button>
                    </div>
                </div>
                <FileTree
                    nodes={tree}
                    selectedFileId={selectedFile?.id || null}
                    onSelectFile={handleSelectFile}
                    onRename={handleRename}
                    onDelete={handleDelete}
                    onMove={handleMove}
                />
            </div>
            <div className="main-content">
                {selectedFile ? (
                    <>
                        <div className="editor-header">
                            <h2>{selectedFile.name}</h2>
                            <div className="editor-actions">
                                <button
                                    className="format-button"
                                    onClick={handleFormat}
                                    title="Formatear código (Shift+Alt+F)"
                                >
                                    <Sparkles size={18} />
                                </button>
                                {selectedFile.name.endsWith('.md') && (
                                    <button
                                        className="toggle-preview"
                                        onClick={() => setShowPreview(!showPreview)}
                                        title={showPreview ? 'Ocultar vista previa' : 'Mostrar vista previa'}
                                    >
                                        {showPreview ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                )}
                            </div>
                        </div>
                        {selectedFile.name.endsWith('.md') ? (
                            <MarkdownEditor
                                ref={codeEditorRef}
                                file={selectedFile}
                                onChange={handleContentChange}
                                showPreview={showPreview}
                            />
                        ) : (
                            <CodeEditor
                                ref={codeEditorRef}
                                file={selectedFile}
                                onChange={handleContentChange}
                            />
                        )}
                    </>
                ) : (
                    <div className="empty-state">
                        <h2>Welcome to MDocs</h2>
                        <p>Select a file from the left panel or create a new one.</p>
                    </div>
                )}
            </div>
            <Settings isOpen={showSettings} onClose={() => setShowSettings(false)} />
        </div>
    );
}

export default App;
