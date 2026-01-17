import {useEffect, useRef} from 'react';
import mermaid from 'mermaid';
import {useTheme} from './ThemeContext';

interface MermaidDiagramProps {
    chart: string;
}

export const MermaidDiagram = ({chart}: MermaidDiagramProps) => {
    const ref = useRef<HTMLDivElement>(null);
    const {resolvedTheme} = useTheme();

    useEffect(() => {
        mermaid.initialize({
            startOnLoad: false,
            theme: resolvedTheme === 'dark' ? 'dark' : 'default',
            securityLevel: 'loose',
        });
    }, [resolvedTheme]);

    useEffect(() => {
        if (ref.current && chart) {
            const renderChart = async () => {
                try {
                    const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
                    const {svg} = await mermaid.render(id, chart);
                    if (ref.current) {
                        ref.current.innerHTML = svg;
                    }
                } catch (error) {
                    console.error('Mermaid rendering error:', error);
                    if (ref.current) {
                        ref.current.innerHTML = `<pre style="color: red;">Error rendering diagram: ${error}</pre>`;
                    }
                }
            };
            renderChart();
        }
    }, [chart]);

    return <div ref={ref} className="mermaid-diagram" />;
};
