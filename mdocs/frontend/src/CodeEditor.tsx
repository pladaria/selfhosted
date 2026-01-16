import {useEffect, useRef, forwardRef, useImperativeHandle} from 'react';
import Editor from '@monaco-editor/react';
import * as prettier from 'prettier/standalone';
import * as prettierPluginMarkdown from 'prettier/plugins/markdown';
import {FileNode} from './types';
import {useTheme} from './ThemeContext';

interface CodeEditorProps {
    file: FileNode;
    onChange: (content: string) => void;
}

export interface CodeEditorRef {
    format: () => void;
}

const getLanguageFromFilename = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
        md: 'markdown',
        js: 'javascript',
        jsx: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        json: 'json',
        py: 'python',
        yaml: 'yaml',
        yml: 'yaml',
        html: 'html',
        css: 'css',
        xml: 'xml',
        sql: 'sql',
        sh: 'shell',
        bash: 'shell',
    };
    return languageMap[ext || ''] || 'plaintext';
};

export const CodeEditor = forwardRef<CodeEditorRef, CodeEditorProps>(({file, onChange}, ref) => {
    const language = getLanguageFromFilename(file.name);
    const changeTimeoutRef = useRef<number>();
    const editorRef = useRef<any>(null);
    const {resolvedTheme} = useTheme();

    const handleEditorDidMount = (editor: any) => {
        editorRef.current = editor;
    };

    useImperativeHandle(ref, () => ({
        format: async () => {
            if (!editorRef.current) return;

            const model = editorRef.current.getModel();
            if (!model) return;

            if (language === 'markdown') {
                // Format markdown with prettier
                try {
                    const currentValue = model.getValue();
                    const formatted = await prettier.format(currentValue, {
                        parser: 'markdown',
                        plugins: [prettierPluginMarkdown],
                        proseWrap: 'preserve',
                    });

                    if (formatted !== currentValue) {
                        model.setValue(formatted);
                    }
                } catch (error) {
                    console.error('Error formatting markdown:', error);
                }
            } else {
                // Use Monaco's formatter for other languages
                editorRef.current.getAction('editor.action.formatDocument')?.run();
            }
        },
    }));

    const handleChange = (value: string | undefined) => {
        if (value !== undefined) {
            // Debounce to avoid saving on every keystroke
            if (changeTimeoutRef.current) {
                clearTimeout(changeTimeoutRef.current);
            }
            changeTimeoutRef.current = setTimeout(() => {
                onChange(value);
            }, 500);
        }
    };

    useEffect(() => {
        return () => {
            if (changeTimeoutRef.current) {
                clearTimeout(changeTimeoutRef.current);
            }
        };
    }, []);

    return (
        <div className="code-editor">
            <Editor
                height="100%"
                language={language}
                value={file.content || ''}
                onChange={handleChange}
                onMount={handleEditorDidMount}
                theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs-light'}
                options={{
                    minimap: {enabled: false},
                    fontSize: 14,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                }}
            />
        </div>
    );
});
