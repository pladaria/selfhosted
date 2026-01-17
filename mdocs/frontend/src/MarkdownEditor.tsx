import {forwardRef} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter';
import {vscDarkPlus, vs} from 'react-syntax-highlighter/dist/esm/styles/prism';
import {FileNode} from './types';
import {CodeEditor, CodeEditorRef} from './CodeEditor';
import {useTheme} from './ThemeContext';
import {MermaidDiagram} from './MermaidDiagram';
import {CsvTable} from './CsvTable';
import {ResizablePanel} from './ResizablePanel';

interface MarkdownEditorProps {
    file: FileNode;
    onChange: (content: string) => void;
    showPreview: boolean;
}

export const MarkdownEditor = forwardRef<CodeEditorRef, MarkdownEditorProps>(
    ({file, onChange, showPreview}, ref) => {
        const {resolvedTheme} = useTheme();

        return (
            <div className="markdown-editor">
                {showPreview ? (
                    <ResizablePanel
                        storageKey="mdocs-markdown-preview-width"
                        defaultLeftWidth={50}
                        minLeftWidth={30}
                        maxLeftWidth={70}
                        leftPanel={
                            <div className="markdown-editor-pane">
                                <CodeEditor ref={ref} file={file} onChange={onChange} />
                            </div>
                        }
                        rightPanel={
                            <div className="markdown-preview-pane">
                                <div className="markdown-preview">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            input(props) {
                                                const {type, checked, disabled, ...rest} = props;
                                                if (type === 'checkbox') {
                                                    return (
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            readOnly
                                                            {...rest}
                                                        />
                                                    );
                                                }
                                                return <input {...props} />;
                                            },
                                            code(props) {
                                                const {children, className, node, ...rest} = props;
                                                const match = /language-(\w+)/.exec(className || '');

                                                if (match && match[1] === 'mermaid') {
                                                    return <MermaidDiagram chart={String(children)} />;
                                                }

                                                if (match && match[1] === 'csv') {
                                                    return <CsvTable csv={String(children)} />;
                                                }

                                                return match ? (
                                                    <SyntaxHighlighter
                                                        PreTag="div"
                                                        language={match[1]}
                                                        style={resolvedTheme === 'light' ? vs : vscDarkPlus}
                                                    >
                                                        {String(children).replace(/\n$/, '')}
                                                    </SyntaxHighlighter>
                                                ) : (
                                                    <code {...rest} className={className}>
                                                        {children}
                                                    </code>
                                                );
                                            },
                                        }}
                                    >
                                        {file.content || ''}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        }
                    />
                ) : (
                    <div className="markdown-editor-pane">
                        <CodeEditor ref={ref} file={file} onChange={onChange} />
                    </div>
                )}
            </div>
        );
    }
);
