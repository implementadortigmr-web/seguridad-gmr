import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import AppHeader from "../components/AppHeader";
import { recorridoDemo } from "../data/mockData";
import { limpiarEvidenciasLocal, listarEvidencias } from "../services/offlineDb";
import { formatDate } from "../utils/formatters";

export default function SupervisorDashboard() {
  const [evidences, setEvidences] = useState([]);

  async function loadData() {
    const records = await listarEvidencias(recorridoDemo.id);
    setEvidences(records);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function resetLocalTest() {
    const confirmed = window.confirm("¿Deseas borrar las evidencias locales de prueba?");
    if (!confirmed) return;

    await limpiarEvidenciasLocal();
    localStorage.removeItem("recorrido-demo-iniciado");
    await loadData();
  }

  const registeredPoints = new Map(evidences.map((evidence) => [evidence.puntoId, evidence]));
  const missing = recorridoDemo.puntos.length - evidences.length;

  return (
    <div className="app-page">
      <AppHeader />

      <main className="dashboard-container">
        <div className="dashboard-top">
          <div>
            <p className="eyebrow">Panel de supervisión</p>
            <h1>Control de recorridos</h1>
          </div>

          <button className="secondary-button" onClick={loadData}>
            <RefreshCw size={17} />
            Actualizar
          </button>
        </div>

        <div className="local-warning">
          En esta prueba las evidencias se consultan desde este mismo equipo. Cuando conectemos Firebase Storage,
          el supervisor podrá ver la información enviada desde los celulares de los guardias.
        </div>

        <section className="stats-grid">
          <div className="stat-card">
            <span>Puntos requeridos</span>
            <strong>{recorridoDemo.puntos.length}</strong>
          </div>
          <div className="stat-card success">
            <span>Fotos registradas</span>
            <strong>{evidences.length}</strong>
          </div>
          <div className="stat-card warning">
            <span>Puntos faltantes</span>
            <strong>{missing}</strong>
          </div>
          <div className="stat-card pending">
            <span>Pendientes de sync</span>
            <strong>{evidences.length}</strong>
          </div>
        </section>

        <section className="review-card">
          <div className="review-header">
            <div>
              <h2>{recorridoDemo.nombre}</h2>
              <p>{recorridoDemo.propiedad}</p>
            </div>
            <span className={`route-status ${missing === 0 ? "done" : ""}`}>
              {missing === 0 ? "Completo" : "En proceso"}
            </span>
          </div>

          <div className="review-table">
            <div className="table-head">
              <span>Punto</span>
              <span>Fotografía</span>
              <span>Ubicación</span>
              <span>Estado</span>
            </div>

            {recorridoDemo.puntos.map((point) => {
              const evidence = registeredPoints.get(point.id);

              return (
                <div className="table-row" key={point.id}>
                  <span>
                    {point.orden}. {point.nombre}
                  </span>
                  <span>{evidence ? formatDate(evidence.capturadaEn) : "Sin fotografía"}</span>
                  <span>{evidence?.ubicacionDisponible ? `±${Math.round(evidence.precisionGps)} m` : "—"}</span>
                  <span>
                    {evidence ? (
                      <small className="pill pending">Pendiente de sincronizar</small>
                    ) : (
                      <small className="pill missing">Pendiente</small>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <div className="admin-actions">
          <button className="danger-button" onClick={resetLocalTest}>
            Borrar prueba local
          </button>
        </div>
      </main>
    </div>
  );
}
