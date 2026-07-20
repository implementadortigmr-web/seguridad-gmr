export default function CatalogTable({ columns, rows }) {
  if (!rows.length) {
    return <div className="empty-state">Aún no hay registros en este catálogo.</div>;
  }

  return (
    <div className="catalog-table">
      <div
        className="catalog-table-head"
        style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}
      >
        {columns.map((column) => (
          <span key={column}>{column}</span>
        ))}
      </div>

      {rows.map((row, rowIndex) => (
        <div
          className="catalog-table-row"
          style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}
          key={rowIndex}
        >
          {row.map((cell, cellIndex) => (
            <span key={cellIndex}>{cell}</span>
          ))}
        </div>
      ))}
    </div>
  );
}
