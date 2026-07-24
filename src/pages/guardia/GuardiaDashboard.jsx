import { Camera, LogOut, RefreshCcw, ShieldCheck } from "lucide-react";
import { formatDate } from "../../utils/formatters";
import RouteList from "./components/RouteList";
import ActiveRouteCard from "./components/ActiveRouteCard";
import PointsList from "./components/PointsList";
import EvidenceCaptureModal from "./components/EvidenceCaptureModal";
import FinishConfirmModal from "./components/FinishConfirmModal";
import PendingSyncList from "./components/PendingSyncList";
import { useGuardiaDashboard } from "./hooks/useGuardiaDashboard";
import "./guardia.css";

export default function GuardiaDashboard({ profile, logout }) {
  const guardia = useGuardiaDashboard({ profile });

  const safeLogout =
    typeof logout === "function"
      ? logout
      : () => {
          window.location.hash = "#/";
          window.location.reload();
        };

  function handleRefresh() {
    guardia.loadRoutes();
    guardia.loadPendingSync();
  }

  if (guardia.loading) {
    return (
      <section className="guardia-page">
        <div className="guardia-topbar">
          <div>
            <span className="guardia-kicker">Seguridad GMR</span>
            <h1>Panel de guardia</h1>
          </div>

          <button type="button" className="secondary-button" onClick={safeLogout}>
            <LogOut size={16} />
            Salir
          </button>
        </div>

        <div className="guardia-loading-card">
          <div className="pdf-loading-spinner" />
          <p>Cargando información...</p>
        </div>
      </section>
    );
  }

  if (!guardia.hasPropertyAccess) {
    return (
      <section className="guardia-page">
        <div className="guardia-topbar">
          <div>
            <span className="guardia-kicker">Seguridad GMR</span>
            <h1>Panel de guardia</h1>
          </div>

          <button type="button" className="secondary-button" onClick={safeLogout}>
            <LogOut size={16} />
            Salir
          </button>
        </div>

        <div className="guardia-message">
          {guardia.message ||
            "Tu usuario no tiene propiedades asignadas. Contacta al administrador."}
        </div>
      </section>
    );
  }

  return (
    <section className="guardia-page">
      <div className="guardia-topbar">
        <div>
          <span className="guardia-kicker">Seguridad GMR</span>
          <h1>Panel de guardia</h1>
          <p>
            {guardia.profileName} · {guardia.isOnline ? "En línea" : "Sin conexión"}
          </p>
        </div>

        <div className="guardia-topbar-actions">
          <button type="button" className="secondary-button" onClick={handleRefresh}>
            <RefreshCcw size={16} />
            Actualizar
          </button>

          <button type="button" className="secondary-button" onClick={safeLogout}>
            <LogOut size={16} />
            Salir
          </button>
        </div>
      </div>

      {guardia.message && <div className="guardia-message">{guardia.message}</div>}

      <div className="guardia-status-card">
        <div>
          <ShieldCheck size={20} />
          <span>Acceso validado</span>
        </div>

        <strong>
          {guardia.registeredDevice?.nombre ||
            guardia.deviceInfo?.model ||
            "Dispositivo del guardia"}
        </strong>
      </div>

      {!guardia.showingExecution && (
        <PendingSyncList
          pendientes={guardia.pendingExecutions}
          isOnline={guardia.isOnline}
          syncingId={guardia.syncingExecutionId}
          onRefresh={guardia.loadPendingSync}
          onSync={guardia.syncPendingExecution}
        />
      )}

      {!guardia.showingExecution && (
        <RouteList
          groupedRoutes={guardia.groupedRoutes}
          onStartRoute={guardia.startRoute}
        />
      )}

      {guardia.showingExecution && guardia.activeRoute && guardia.activeExecution && (
        <>
          <ActiveRouteCard
            route={guardia.activeRoute}
            execution={guardia.activeExecution}
            completed={guardia.completed}
            missing={guardia.missing}
            total={guardia.totalPoints}
            formatDate={formatDate}
          />

          <PointsList
            points={guardia.activePoints}
            evidenceMap={guardia.evidenceMap}
            completed={guardia.completed}
            missing={guardia.missing}
            savingFinish={guardia.savingFinish}
            onCapture={guardia.openCapture}
           onBack={() =>
              guardia.backToRouteList(
                "Recorrido cerrado en pantalla. Si ya se finalizó quedará pendiente."
              )
            }
            onOpenFinish={() => guardia.setConfirmFinishOpen(true)}
          />
        </>
      )}

      <EvidenceCaptureModal
        point={guardia.capturePoint}
        comment={guardia.evidenceComment}
        photoPreview={guardia.evidencePreview}
        hasPhoto={Boolean(guardia.evidencePhoto)}
        saving={guardia.savingEvidence}
        onChangeComment={guardia.setEvidenceComment}
        onClose={guardia.closeCapture}
        onNativePhoto={guardia.takeNativePhotoForEvidence}
        onClearPhoto={guardia.clearEvidencePhoto}
        onSave={guardia.saveEvidenceFromModal}
      />

      <FinishConfirmModal
        open={guardia.confirmFinishOpen}
        saving={guardia.savingFinish}
        completed={guardia.completed}
        missing={guardia.missing}
        total={guardia.totalPoints}
        onClose={() => guardia.setConfirmFinishOpen(false)}
        onConfirm={guardia.finishRoute}
      />

      {guardia.syncProgress && (
        <div className="sync-progress-overlay">
          <div className="sync-progress-modal">
            <div className="pdf-loading-spinner" />

            <h3>Sincronizando recorrido</h3>

            <p>{guardia.syncProgress.mensaje}</p>

            <div className="sync-progress-bar">
              <div
                style={{
                  width: `${
                    guardia.syncProgress.total > 0
                      ? Math.max(
                          5,
                          Math.round(
                            (guardia.syncProgress.actual /
                              guardia.syncProgress.total) *
                              100
                          )
                        )
                      : 5
                  }%`,
                }}
              />
            </div>

            <span>
              {guardia.syncProgress.actual} de {guardia.syncProgress.total} evidencias
            </span>
          </div>
        </div>
      )}

      {guardia.savingEvidence && (
        <div className="sync-progress-overlay">
          <div className="sync-progress-modal">
            <div className="pdf-loading-spinner" />

            <h3>Guardando evidencia</h3>

            <p>Procesando fotografía, comentario y ubicación GPS.</p>

            <span>
              <Camera size={14} /> No cierres esta pantalla.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}