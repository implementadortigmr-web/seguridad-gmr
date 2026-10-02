import { puedeRegistrarAsistencia } from "../../../shared/asistenciaDomain";
import { PERMISOS, tienePermiso } from "../../../shared/perfilesAcceso";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Camera,
  ClipboardList,
  LogOut,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import MessageBox from "../../components/MessageBox";
import { formatDate } from "../../utils/formatters";
import RouteList from "./components/RouteList";
import ActiveRouteCard from "./components/ActiveRouteCard";
import PointsList from "./components/PointsList";
import EvidenceCaptureModal from "./components/EvidenceCaptureModal";
import FinishConfirmModal from "./components/FinishConfirmModal";
import PendingSyncList from "./components/PendingSyncList";
import IncidentModal from "./components/IncidentModal";
import PauseRouteModal from "./components/PauseRouteModal";
import IncidentTypeList from "./components/IncidentTypeList";
import EarlyCloseRouteModal from "./components/EarlyCloseRouteModal";
import { useGuardiaDashboard } from "./hooks/useGuardiaDashboard";
import "./guardia.css";

const AsistenciaModulo = lazy(() => import("../../modules/asistencia/AsistenciaModulo"));

export default function GuardiaDashboard() {
  const { profile, logout } = useAuth();
  const guardia = useGuardiaDashboard({ profile });

  const canAttendance = puedeRegistrarAsistencia(profile);
  const canRoutes = tienePermiso(profile, PERMISOS.OPERAR_RECORRIDOS);
  const canIncidents = tienePermiso(profile, PERMISOS.OPERAR_INCIDENCIAS);
  const firstSection = useMemo(() => (canRoutes ? "recorridos" : canIncidents ? "incidencias" : canAttendance ? "asistencia" : ""), [canRoutes, canIncidents, canAttendance]);
  const [activeSection, setActiveSection] = useState(firstSection);

  useEffect(() => {
    const allowed = (activeSection === "recorridos" && canRoutes)
      || (activeSection === "incidencias" && canIncidents)
      || (activeSection === "asistencia" && canAttendance);
    if (!allowed) setActiveSection(firstSection);
  }, [activeSection, canRoutes, canIncidents, canAttendance, firstSection]);

  const safeLogout = async () => {
    try {
      await guardia.prepareLogout?.();

      if (typeof logout === "function") {
        await logout();
        return;
      }

      window.location.hash = "#/";
      window.location.reload();
    } catch (error) {
      console.error("No fue posible cerrar sesión de forma segura:", error);
    }
  };

  function handleRefresh() {
    guardia.loadRoutes?.();
    guardia.loadPendingSync?.();
    guardia.loadPausedExecutions?.();
    guardia.loadPendingIncidents?.();
  }

  if (guardia.loading) {
    return (
      <section className="guardia-page">
        <div className="guardia-topbar">
          <div>
            <span className="guardia-kicker">Seguridad GMR</span>
            <h1>Panel de guardia</h1>
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={safeLogout}
          >
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

          <button
            type="button"
            className="secondary-button"
            onClick={safeLogout}
          >
            <LogOut size={16} />
            Salir
          </button>
        </div>

        <MessageBox type="warning">
          {guardia.message ||
            "Tu usuario no tiene propiedades asignadas. Contacta al administrador."}
        </MessageBox>
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
            {guardia.profileName} ·{" "}
            {guardia.isOnline ? "En línea" : "Sin conexión"}
          </p>
        </div>

        <div className="guardia-topbar-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={handleRefresh}
          >
            <RefreshCcw size={16} />
            Actualizar
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={safeLogout}
          >
            <LogOut size={16} />
            Salir
          </button>
        </div>
      </div>

      {guardia.message && (
        <MessageBox>{guardia.message}</MessageBox>
      )}

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
        <div className="guardia-main-menu">
          {canAttendance && (
            <button type="button" className={`guardia-main-menu-button asistencia-menu-button ${activeSection === "asistencia" ? "active" : ""}`}
              onClick={() => setActiveSection("asistencia")}>
              <ClipboardList size={22} /><span>Asistencia</span>
            </button>
          )}
          {canRoutes && (
            <button
              type="button"
              className={`guardia-main-menu-button ${activeSection === "recorridos" ? "active" : ""}`}
              onClick={() => setActiveSection("recorridos")}
            >
              <ClipboardList size={22} />
              <span>Recorridos</span>
            </button>
          )}

          {canIncidents && (
            <button
              type="button"
              className={`guardia-main-menu-button ${activeSection === "incidencias" ? "active" : ""}`}
              onClick={() => setActiveSection("incidencias")}
            >
              <ShieldAlert size={22} />
              <span>Incidencias</span>
            </button>
          )}
        </div>
      )}

      {!guardia.showingExecution && activeSection === "asistencia" && canAttendance && (
        <Suspense fallback={<p>Cargando asistencia...</p>}><AsistenciaModulo /></Suspense>
      )}

      {!guardia.showingExecution && activeSection === "recorridos" && canRoutes && (
        <>
          <PendingSyncList
            pendientes={guardia.pendingExecutions}
            isOnline={guardia.isOnline}
            syncingId={guardia.syncingExecutionId}
            onRefresh={guardia.loadPendingSync}
            onSync={guardia.syncPendingExecution}
          />

          {guardia.pausedExecutions?.length > 0 && (
            <section className="paused-routes-card">
              <p className="eyebrow">Recorridos pendientes</p>
              <h2>Recorridos pausados</h2>

              <div className="paused-routes-list">
                {guardia.pausedExecutions.map((execution) => (
                  <article className="paused-route-item" key={execution.id}>
                    <div>
                      <strong>
                        {execution.recorridoNombre ||
                          execution.plantillaNombre ||
                          "Recorrido"}
                      </strong>

                      <span>{execution.propiedadNombre || "Propiedad"}</span>

                      <small>
                        Pausado por:{" "}
                        {execution.comentarioPausa || "Sin comentario"}
                      </small>
                    </div>

                    <button
                      type="button"
                      className="primary-button paused-route-button"
                      onClick={() =>
                        guardia.continuePausedExecution(execution)
                      }
                    >
                      Continuar recorrido
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )}

          {(!guardia.pausedExecutions ||
            guardia.pausedExecutions.length === 0) && (
            <RouteList
              groupedRoutes={guardia.groupedRoutes}
              onStartRoute={guardia.startRoute}
            />
          )}

          {guardia.pausedExecutions?.length > 0 && (
            <div className="guardia-locked-routes-card">
              <h3>Recorridos bloqueados temporalmente</h3>
              <p>
                Tienes un recorrido pausado. Para iniciar otro recorrido,
                primero debes continuar y finalizar el recorrido pendiente.
              </p>
            </div>
          )}
        </>
      )}

      {!guardia.showingExecution && activeSection === "incidencias" && canIncidents && (
        <>
          {guardia.pendingIncidents?.length > 0 && (
            <div className="incident-pending-card">
              <div>
                <strong>Incidencias pendientes</strong>
                <span>
                  Tienes {guardia.pendingIncidents.length} incidencia(s)
                  pendiente(s) por sincronizar.
                </span>
              </div>

              <button
                type="button"
                className="primary-button"
                onClick={guardia.syncPendingIncidents}
                disabled={!guardia.isOnline || guardia.syncingIncidents}
              >
                {guardia.syncingIncidents
                  ? "Subiendo..."
                  : "Subir incidencias"}
              </button>
            </div>
          )}

          <IncidentTypeList
            groupedRoutes={guardia.groupedRoutes}
            onOpenIncident={guardia.openIncidentModal}
          />
        </>
      )}

      {guardia.showingExecution &&
        guardia.activeRoute &&
        guardia.activeExecution && (
          <>
            <ActiveRouteCard
              route={guardia.activeRoute}
              execution={guardia.activeExecution}
              completed={guardia.completed}
              missing={guardia.missing}
              total={guardia.totalPoints}
              formatDate={formatDate}
            />

            {guardia.activeExecution?.estado !== "pausado" && (
              <>
                <div className="incident-action-card">
                  <div>
                    <strong>Pausa del recorrido</strong>
                    <span>
                      Pausa el recorrido cuando tengas una interrupción temporal.
                    </span>
                  </div>

                  <button
                    type="button"
                    className="secondary-button incident-main-button"
                    onClick={guardia.openPauseModal}
                  >
                    Pausar recorrido
                  </button>
                </div>

                <div className="early-close-action-card">
                  <div>
                    <strong>Terminar antes</strong>
                    <span>
                      Cierra el recorrido como incompleto cuando no puedas
                      terminar todos los puntos.
                    </span>
                  </div>

                  <button
                    type="button"
                    className="danger-button early-close-main-button"
                    onClick={guardia.openEarlyCloseModal}
                  >
                    Terminar antes
                  </button>
                </div>

                <PointsList
                  points={guardia.activePoints}
                  evidenceMap={guardia.evidenceMap}
                  completed={guardia.completed}
                  missing={guardia.missing}
                  savingFinish={guardia.savingFinish}
                  onCapture={guardia.openCapture}
                  onOpenFinish={() => guardia.setConfirmFinishOpen(true)}
                />
              </>
            )}

            {guardia.activeExecution?.estado === "pausado" && (
              <div className="guardia-paused-card">
                <h3>Recorrido en pausa</h3>
                <p>
                  La captura de evidencias y el cierre anticipado están
                  bloqueados hasta que el recorrido sea reanudado.
                </p>
              </div>
            )}
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

     <IncidentModal
        open={guardia.incidentOpen}
        tipo={guardia.incidentTipo}
        context={guardia.incidentContext}
        guardiaNombre={guardia.profileName}
        saving={guardia.savingIncident}
        onClose={guardia.closeIncidentModal}
        onSave={guardia.saveIncident}
      />

      <PauseRouteModal
        open={guardia.pauseOpen}
        motivo={guardia.pauseMotivo}
        comentario={guardia.pauseComentario}
        saving={guardia.savingPause}
        onChangeMotivo={guardia.setPauseMotivo}
        onChangeComentario={guardia.setPauseComentario}
        onClose={guardia.closePauseModal}
        onSave={guardia.pauseRoute}
      />

      <EarlyCloseRouteModal
        open={guardia.earlyCloseOpen}
        motivo={guardia.earlyCloseMotivo}
        comentario={guardia.earlyCloseComentario}
        photoPreview={guardia.earlyClosePreview}
        hasPhoto={Boolean(guardia.earlyClosePhoto)}
        saving={guardia.savingEarlyClose}
        completed={guardia.completed}
        missing={guardia.missing}
        total={guardia.totalPoints}
        onChangeMotivo={guardia.setEarlyCloseMotivo}
        onChangeComentario={guardia.setEarlyCloseComentario}
        onPhotoChange={guardia.selectEarlyClosePhoto}
        onClearPhoto={guardia.clearEarlyClosePhoto}
        onClose={guardia.closeEarlyCloseModal}
        onSave={guardia.finishRouteEarly}
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

            <h3>Sincronizando información</h3>

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
              {guardia.syncProgress.actual} de {guardia.syncProgress.total}
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