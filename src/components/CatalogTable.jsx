export default function CatalogTable({ columns = [], rows = [] }) {
  const safeColumns = Array.isArray(columns) ? columns : [];
  const safeRows = Array.isArray(rows) ? rows : [];

  if (safeRows.length === 0) {
    return (
      <div className="empty-state">
        Aún no hay registros en este catálogo.
      </div>
    );
  }

  return (
    <div className="catalog-table">
      <div
        className="catalog-table-head"
        style={{
          gridTemplateColumns: `repeat(${Math.max(
            safeColumns.length,
            1
          )}, 1fr)`,
        }}
      >
        {safeColumns.map((column, index) => (
          <span key={`${column}-${index}`}>{column}</span>
        ))}
      </div>

      {safeRows.map((row, rowIndex) => {
        const safeRow = Array.isArray(row) ? row : [];

        return (
          <div
            className="catalog-table-row"
            style={{
              gridTemplateColumns: `repeat(${Math.max(
                safeColumns.length,
                1
              )}, 1fr)`,
            }}
            key={rowIndex}
          >
            {safeRow.map((cell, cellIndex) => (
              <span key={cellIndex}>{cell}</span>
            ))}
          </div>
        );
      })}
    </div>
  );
}