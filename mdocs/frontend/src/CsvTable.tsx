interface CsvTableProps {
    csv: string;
}

export const CsvTable = ({csv}: CsvTableProps) => {
    const parseCSV = (text: string): string[][] => {
        const lines = text.trim().split('\n');
        return lines.map((line) => {
            // Simple CSV parser (handles basic cases)
            const cells: string[] = [];
            let current = '';
            let inQuotes = false;

            for (let i = 0; i < line.length; i++) {
                const char = line[i];

                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    cells.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            cells.push(current.trim());
            return cells;
        });
    };

    try {
        const rows = parseCSV(csv);
        if (rows.length === 0) return null;

        const headers = rows[0];
        const data = rows.slice(1);

        return (
            <table className="csv-table">
                <thead>
                    <tr>
                        {headers.map((header, i) => (
                            <th key={i}>{header}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {data.map((row, i) => (
                        <tr key={i}>
                            {row.map((cell, j) => (
                                <td key={j}>{cell}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    } catch (error) {
        console.error('CSV parsing error:', error);
        return <pre style={{color: 'red'}}>Error parsing CSV</pre>;
    }
};
