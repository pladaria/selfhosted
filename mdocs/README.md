# MDocs

A web application for managing and editing text documents with special support for Markdown.

## Features

- 📁 **File Manager**: Sidebar with complete directory tree
    - Create, rename, and delete files and folders
    - Context menu (right-click) with options
    - Drag and drop to reorganize files

- ✍️ **Code Editor**: Powerful editor with syntax highlighting
    - Support for multiple languages (JavaScript, TypeScript, Python, JSON, YAML, etc.)
    - Based on Monaco Editor (same as VS Code)
    - Auto-completion and syntax highlighting

- 📝 **Markdown Editor**: Special experience for .md files
    - Real-time preview
    - Side panel with rendered preview
    - Toggle to show/hide preview

- 🎨 **Theme System**:
    - Light and dark modes
    - System theme detection
    - Persistent theme preference

- ✨ **Code Formatting**:
    - Format button for code files (JS, TS, JSON, etc.)
    - Prettier integration for Markdown formatting
    - Automatic language detection

- 💾 **Storage**:
    - Currently uses browser localStorage
    - Architecture ready to migrate to backend (disk, S3, database, etc.)
    - Abstraction layer via `FileSystemStore` interface

## Technologies

- **React 18** with TypeScript
- **Vite** as bundler and dev server
- **Monaco Editor** for code editing
- **react-markdown** for Markdown rendering
- **Prettier** for code and markdown formatting
- **lucide-react** for icons
- **localStorage** for data persistence

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Production Build

```bash
npm run build
```

Optimized files will be generated in the `dist/` directory.

## Docker

Build and run with Docker:

```bash
# Build the image
npm run docker:build

# Publish to DockerHub
npm run docker:publish

# Run the container
docker run -p 8080:80 pladaria/mdocs:latest
```

The app will be available at http://localhost:8080

## Architecture

### File Structure

```
src/
├── types.ts              # TypeScript type definitions
├── store.ts              # Storage abstraction layer
├── FileTree.tsx          # File tree component
├── CodeEditor.tsx        # Code editor with Monaco
├── MarkdownEditor.tsx    # Special editor for Markdown
├── ThemeContext.tsx      # Theme management context
├── ThemeSelector.tsx     # Theme selector button
├── App.tsx               # Main component
├── App.css               # Global styles
└── main.tsx              # Entry point
```

### Backend Migration

To change the backend, you only need to create a new class that implements the `FileSystemStore` interface:

```typescript
export interface FileSystemStore {
    getTree(): Promise<FileNode[]>;
    getFile(id: string): Promise<FileNode | null>;
    createFile(parentId: string | null, name: string, type: 'file' | 'directory'): Promise<FileNode>;
    updateFile(id: string, updates: Partial<FileNode>): Promise<void>;
    deleteFile(id: string): Promise<void>;
    moveFile(id: string, newParentId: string | null): Promise<void>;
}
```

Examples of future implementations:

- `ApiStore` - REST API connection
- `FileSystemStore` - disk read/write (Node.js)
- `S3Store` - AWS S3 storage
- `DatabaseStore` - SQL or NoSQL storage

## License

MIT
