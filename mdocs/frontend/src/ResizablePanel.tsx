import {useState, useRef, useEffect, ReactNode} from 'react';

interface ResizablePanelProps {
    leftPanel: ReactNode;
    rightPanel: ReactNode;
    defaultLeftWidth?: number;
    minLeftWidth?: number;
    maxLeftWidth?: number;
    storageKey: string;
}

export const ResizablePanel = ({
    leftPanel,
    rightPanel,
    defaultLeftWidth = 50,
    minLeftWidth = 20,
    maxLeftWidth = 80,
    storageKey,
}: ResizablePanelProps) => {
    const [leftWidth, setLeftWidth] = useState(() => {
        const saved = localStorage.getItem(storageKey);
        return saved ? parseFloat(saved) : defaultLeftWidth;
    });

    const [isResizing, setIsResizing] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        localStorage.setItem(storageKey, leftWidth.toString());
    }, [leftWidth, storageKey]);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing || !containerRef.current) return;

            const container = containerRef.current;
            const containerRect = container.getBoundingClientRect();
            const offsetX = e.clientX - containerRect.left;
            const newLeftWidth = (offsetX / containerRect.width) * 100;

            const clampedWidth = Math.max(minLeftWidth, Math.min(maxLeftWidth, newLeftWidth));
            setLeftWidth(clampedWidth);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [isResizing, minLeftWidth, maxLeftWidth]);

    return (
        <div ref={containerRef} className="resizable-panel-container">
            <div className="resizable-panel-left" style={{width: `${leftWidth}%`}}>
                {leftPanel}
            </div>
            <div
                className={`resizable-divider ${isResizing ? 'resizing' : ''}`}
                onMouseDown={handleMouseDown}
                style={{cursor: isResizing ? 'ew-resize' : 'col-resize'}}
            />
            <div className="resizable-panel-right" style={{width: `${100 - leftWidth}%`}}>
                {rightPanel}
            </div>
        </div>
    );
};
