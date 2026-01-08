import {forwardRef} from 'react';
import ReactMarkdown from 'react-markdown';
import {FileNode} from './types';
import {CodeEditor, CodeEditorRef} from './CodeEditor';

interface MarkdownEditorProps {
    file: FileNode;
    onChange: (content: string) => void;
    showPreview: boolean;
}

export const MarkdownEditor = forwardRef<CodeEditorRef, MarkdownEditorProps>(
    ({file, onChange, showPreview}, ref) => {
        return (
            <div className="markdown-editor">
                <div className="markdown-editor-content">
                    <div className="markdown-editor-pane">
                        <CodeEditor ref={ref} file={file} onChange={onChange} />
                    </div>
                    {showPreview && (
                        <div className="markdown-preview-pane">
                            <div className="markdown-preview">
                                <ReactMarkdown>{file.content || ''}</ReactMarkdown>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }
);
