# MDocs

A web-based document management and editing application with enhanced Markdown support.

## Project Structure

```
mdocs/
├── frontend/          # React + Vite frontend application
├── server/           # Express API server
└── package.json      # Root package for running both
```

## Quick Start

```bash
# Install dependencies for both frontend and server
npm run install:all

# Run both frontend and server concurrently
npm run dev
```

The frontend will be available at `http://localhost:5173`

The API server will run at `http://localhost:3001`

## Individual Commands

```bash
# Run only frontend
npm run dev:frontend

# Run only server
npm run dev:server

# Build frontend for production
npm run build
```

## Features

### File Management

- Hierarchical directory tree in sidebar
- Create, rename, and delete files and folders
- Context menu with file operations
- Drag and drop to reorganize files

### Code Editor

- Syntax highlighting for multiple languages (JavaScript, TypeScript, Python, JSON, YAML, etc.)
- Monaco Editor integration (same engine as VS Code)
- Auto-completion and IntelliSense
- Code formatting support

### Markdown Editor

- Real-time preview panel
- Side-by-side editing and preview
- Toggle preview visibility
- Prettier integration for formatting

### Theme System

- Light and dark modes
- System theme detection
- Persistent theme preference

### Storage Options

- **Local**: Browser localStorage (single device)
- **Cloud**: API server with filesystem persistence (multi-device)
- Easy switching between backends in settings

## Technologies

### Frontend

- React 18 with TypeScript
- Vite as bundler and dev server
- Monaco Editor for code editing
- react-markdown for Markdown rendering
- Prettier for code and markdown formatting
- lucide-react for icons

### Backend

- Express REST API
- Node.js filesystem operations
- CORS enabled for development

## Documentation

- [API Backend Documentation](./API_BACKEND.md)
- [Contributing Guidelines](./CONTRIBUTING.md)

## License

MIT
