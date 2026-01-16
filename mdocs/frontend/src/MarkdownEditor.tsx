import {forwardRef} from 'react';
import ReactMarkdown from 'react-markdown';
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter';
import {vscDarkPlus, vs} from 'react-syntax-highlighter/dist/esm/styles/prism';
import {FileNode} from './types';
import {CodeEditor, CodeEditorRef} from './CodeEditor';
import {useTheme} from './ThemeContext';
import {MermaidDiagram} from './MermaidDiagram';
import {CsvTable} from './CsvTable';

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
                <div className="markdown-editor-content">
                    <div className="markdown-editor-pane">
                        <CodeEditor ref={ref} file={file} onChange={onChange} />
                    </div>
                    {showPreview && (
                        <div className="markdown-preview-pane">
                            <div className="markdown-preview">
                                <ReactMarkdown
                                    components={{
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
                    )}
                </div>
            </div>
        );
    }
);
