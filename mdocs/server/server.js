import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;
const BASE_PATH = '/tmp/mdocs/userpath';

app.use(cors());
app.use(express.json());

// Asegurar que el directorio base existe
async function ensureBaseDir() {
    try {
        await fs.mkdir(BASE_PATH, {recursive: true});
    } catch (error) {
        console.error('Error creating base directory:', error);
    }
}

// Convertir el árbol de archivos plano a estructura de directorios
function getFilePath(fileId, files) {
    const file = files.find((f) => f.id === fileId);
    if (!file) return null;

    const parts = [];
    let current = file;

    while (current) {
        parts.unshift(current.name);
        if (current.parentId) {
            current = files.find((f) => f.id === current.parentId);
        } else {
            current = null;
        }
    }

    return path.join(BASE_PATH, ...parts);
}

// GET /api/files - Obtener todos los archivos
app.get('/api/files', async (req, res) => {
    try {
        const indexPath = path.join(BASE_PATH, '.index.json');
        try {
            const data = await fs.readFile(indexPath, 'utf-8');
            res.json(JSON.parse(data));
        } catch (error) {
            // Si no existe el índice, devolver estructura vacía
            res.json([]);
        }
    } catch (error) {
        console.error('Error reading files:', error);
        res.status(500).json({error: 'Error reading files'});
    }
});

// GET /api/files/:id - Obtener un archivo específico
app.get('/api/files/:id', async (req, res) => {
    try {
        const indexPath = path.join(BASE_PATH, '.index.json');
        const data = await fs.readFile(indexPath, 'utf-8');
        const files = JSON.parse(data);
        const file = files.find((f) => f.id === req.params.id);

        if (!file) {
            return res.status(404).json({error: 'File not found'});
        }

        // Si es un archivo (no directorio), leer su contenido
        if (file.type === 'file') {
            const filePath = getFilePath(file.id, files);
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                file.content = content;
            } catch (error) {
                file.content = '';
            }
        }

        res.json(file);
    } catch (error) {
        console.error('Error reading file:', error);
        res.status(500).json({error: 'Error reading file'});
    }
});

// POST /api/files - Crear un nuevo archivo o directorio
app.post('/api/files', async (req, res) => {
    try {
        const {parentId, name, type} = req.body;
        const indexPath = path.join(BASE_PATH, '.index.json');

        let files = [];
        try {
            const data = await fs.readFile(indexPath, 'utf-8');
            files = JSON.parse(data);
        } catch (error) {
            // Índice no existe, crear vacío
        }

        const newFile = {
            id: Date.now().toString(),
            name,
            type,
            content: type === 'file' ? '' : undefined,
            parentId: parentId || undefined,
        };

        files.push(newFile);

        // Crear el archivo/directorio en el filesystem
        const filePath = getFilePath(newFile.id, files);
        if (type === 'directory') {
            await fs.mkdir(filePath, {recursive: true});
        } else {
            await fs.mkdir(path.dirname(filePath), {recursive: true});
            await fs.writeFile(filePath, '', 'utf-8');
        }

        // Guardar índice actualizado
        await fs.writeFile(indexPath, JSON.stringify(files, null, 2), 'utf-8');

        res.json(newFile);
    } catch (error) {
        console.error('Error creating file:', error);
        res.status(500).json({error: 'Error creating file'});
    }
});

// PUT /api/files/:id - Actualizar un archivo
app.put('/api/files/:id', async (req, res) => {
    try {
        const {name, content, parentId} = req.body;
        const indexPath = path.join(BASE_PATH, '.index.json');

        const data = await fs.readFile(indexPath, 'utf-8');
        const files = JSON.parse(data);
        const fileIndex = files.findIndex((f) => f.id === req.params.id);

        if (fileIndex === -1) {
            return res.status(404).json({error: 'File not found'});
        }

        const oldFilePath = getFilePath(files[fileIndex].id, files);

        // Actualizar el índice
        if (name !== undefined) files[fileIndex].name = name;
        if (parentId !== undefined) files[fileIndex].parentId = parentId || undefined;
        if (content !== undefined) files[fileIndex].content = content;

        const newFilePath = getFilePath(files[fileIndex].id, files);

        // Si cambió el path (nombre o parent), mover el archivo/directorio
        if (oldFilePath !== newFilePath) {
            try {
                // Crear directorio padre si no existe
                await fs.mkdir(path.dirname(newFilePath), {recursive: true});

                // Mover archivo o directorio (fs.rename mueve todo el contenido si es directorio)
                await fs.rename(oldFilePath, newFilePath);
            } catch (error) {
                console.error('Error moving file/directory:', error);
                // Si falla, intentar crear el archivo/directorio desde cero
                if (files[fileIndex].type === 'directory') {
                    await fs.mkdir(newFilePath, {recursive: true});
                } else if (files[fileIndex].type === 'file') {
                    await fs.writeFile(newFilePath, content || '', 'utf-8');
                }
            }
        }

        // Si es un archivo y cambió el contenido, actualizarlo
        if (files[fileIndex].type === 'file' && content !== undefined) {
            await fs.writeFile(newFilePath, content, 'utf-8');
        }

        await fs.writeFile(indexPath, JSON.stringify(files, null, 2), 'utf-8');

        res.json({success: true});
    } catch (error) {
        console.error('Error updating file:', error);
        res.status(500).json({error: 'Error updating file'});
    }
});

// DELETE /api/files/:id - Eliminar un archivo o directorio
app.delete('/api/files/:id', async (req, res) => {
    try {
        const indexPath = path.join(BASE_PATH, '.index.json');
        const data = await fs.readFile(indexPath, 'utf-8');
        let files = JSON.parse(data);

        const file = files.find((f) => f.id === req.params.id);
        if (!file) {
            return res.status(404).json({error: 'File not found'});
        }

        // Encontrar todos los IDs a eliminar (incluyendo hijos)
        const toDelete = new Set();
        const addToDelete = (nodeId) => {
            toDelete.add(nodeId);
            files.filter((f) => f.parentId === nodeId).forEach((child) => addToDelete(child.id));
        };
        addToDelete(req.params.id);

        // Eliminar del filesystem
        const filePath = getFilePath(file.id, files);
        try {
            const stats = await fs.stat(filePath);
            if (stats.isDirectory()) {
                await fs.rm(filePath, {recursive: true, force: true});
            } else {
                await fs.unlink(filePath);
            }
        } catch (error) {
            console.error('Error deleting from filesystem:', error);
        }

        // Actualizar índice
        files = files.filter((f) => !toDelete.has(f.id));
        await fs.writeFile(indexPath, JSON.stringify(files, null, 2), 'utf-8');

        res.json({success: true});
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({error: 'Error deleting file'});
    }
});

// Iniciar servidor
ensureBaseDir().then(() => {
    app.listen(PORT, () => {
        console.log(`MDocs API Server running on http://localhost:${PORT}`);
        console.log(`Base path: ${BASE_PATH}`);
    });
});
