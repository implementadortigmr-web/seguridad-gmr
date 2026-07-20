import { useEffect, useMemo, useState } from "react";
import {
  collection,
  documentId,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import AppHeader from "../components/AppHeader";
import ConnectionBadge from "../components/ConnectionBadge";
import MessageBox from "../components/MessageBox";
import { useAuth } from "../context/AuthContext";
import { db } from "../services/firebase";
import {
  crearEjecucionLocal,
  finalizarEjecucionLocal,
  guardarEvidenciaLocal,
  listarEvidencias,
  marcarEjecucionSincronizada,
  marcarEvidenciasSincronizadas,
  obtenerEjecucionActiva,
  listarEjecucionesPendientesSync,
} from "../services/offlineDb";
import {
  obtenerDeviceId,
  obtenerDispositivoRegistrado,
  obtenerPropiedadesOperativas,
} from "../services/deviceService";
import {
  isNativeApp,
  obtenerUbicacionNativa,
  tomarFotoNativa,
} from "../services/nativeCaptureService";
import { subirRecorridoConFotos } from "../services/reportSyncService";
import { compressImage } from "../utils/image";
import { getCurrentLocation } from "../utils/location";

import ActiveRouteCard from "./guardia/components/ActiveRouteCard";
import EvidenceCaptureModal from "./guardia/components/EvidenceCaptureModal";
import FinishConfirmModal from "./guardia/components/FinishConfirmModal";
import PointsList from "./guardia/components/PointsList";
import RouteList from "./guardia/components/RouteList";
import PendingSyncList from "./guardia/components/PendingSyncList";
import UnauthorizedDeviceCard from "./guardia/components/UnauthorizedDeviceCard";
import {
  chunkArray,
  groupRoutesByProperty,
  mapSnapshotRoutes,
  normalizePoints,
  sortByName,
} from "./guardia/utils/guardiaHelpers";

async function getPropertyNamesMap(allowedProperties) {
  const propertiesRef = collection(db, "propiedades");
  const propertyMap = new Map();

  if (allowedProperties.includes("*")) {
    const snapshot = await getDocs(propertiesRef);

    snapshot.docs.forEach((document) => {
      propertyMap.set(document.id, document.data().nombre || document.id);
    });

    return propertyMap;
  }

  const chunks = chunkArray(allowedProperties, 10);

  for (const chunk of chunks) {
    const propertiesQuery = query(
      propertiesRef,
      where(documentId(), "in", chunk)
    );

    const snapshot = await getDocs(propertiesQuery);

    snapshot.docs.forEach((document) => {
      propertyMap.set(document.id, document.data().nombre || document.id);
    });
  }

  return propertyMap;
}

async function getRoutesForOperationalProperties(operationalProperties) {
  const plantillasRef = collection(db, "plantillasRecorridos");

  let routes = [];

  if (operationalProperties.includes("*")) {
    const allRoutesQuery = query(plantillasRef, where("activo", "==", true));
    const snapshot = await getDocs(allRoutesQuery);
    routes = mapSnapshotRoutes(snapshot);
  } else {
    for (const propertyId of operationalProperties) {
      const routeQuery = query(
        plantillasRef,
        where("activo", "==", true),
        where("propiedadId", "==", propertyId)
      );

      const snapshot = await getDocs(routeQuery);
      routes.push(...mapSnapshotRoutes(snapshot));
    }
  }

  const uniqueRoutes = new Map();

  routes.forEach((route) => {
    uniqueRoutes.set(route.id, route);
  });

  const propertyNamesMap = await getPropertyNamesMap(operationalProperties);

  const routesWithPropertyName = [...uniqueRoutes.values()].map((route) => ({
    ...route,
    propiedadNombre:
      propertyNamesMap.get(route.propiedadId) || route.propiedadId,
  }));

  return sortByName(routesWithPropertyName);
}

function hayConexionInternet() {
  return navigator.onLine !== false;
}

function ejecutarConTimeout(promesa, milisegundos = 35000) {
  return Promise.race([
    promesa,
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "La sincronización tardó demasiado. El recorrido quedó pendiente por sincronizar."
            )
          ),
        milisegundos
      )
    ),
  ]);
}

export default function GuardiaDashboard() {
  const { profile } = useAuth();

  const [deviceId, setDeviceId] = useState("");
  const [registeredDevice, setRegisteredDevice] = useState(null);
  const [deviceStatus, setDeviceStatus] = useState("loading");
  const [operationalProperties, setOperationalProperties] = useState([]);
  const [pendingExecutions, setPendingExecutions] = useState([]);
  const [syncingExecutionId, setSyncingExecutionId] = useState("");
  const [isOnline, setIsOnline] = useState(navigator.onLine !== false);

  const [routes, setRoutes] = useState([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [activeExecution, setActiveExecution] = useState(null);
  const [evidences, setEvidences] = useState([]);

  const [processingPointId, setProcessingPointId] = useState(null);
  const [message, setMessage] = useState("");
  const [loadingRoutes, setLoadingRoutes] = useState(true);

  const [capturePoint, setCapturePoint] = useState(null);
  const [evidenceComment, setEvidenceComment] = useState("");
  const [evidencePhoto, setEvidencePhoto] = useState(null);
  const [evidencePreview, setEvidencePreview] = useState("");
  const [savingEvidence, setSavingEvidence] = useState(false);

  const [confirmFinishOpen, setConfirmFinishOpen] = useState(false);
  const [savingFinish, setSavingFinish] = useState(false);

  const propertyGroups = useMemo(() => groupRoutesByProperty(routes), [routes]);

  const selectedProperty = useMemo(() => {
    return (
      propertyGroups.find((property) => property.id === selectedPropertyId) ||
      null
    );
  }, [propertyGroups, selectedPropertyId]);

  const routesForSelectedProperty = selectedProperty?.recorridos || [];

  const selectedRoute = useMemo(() => {
    return routes.find((item) => item.id === selectedRouteId) || null;
  }, [routes, selectedRouteId]);

  const points = useMemo(
    () => normalizePoints(selectedRoute?.puntos),
    [selectedRoute]
  );

  const evidenceByPoint = useMemo(() => {
    return new Map(evidences.map((record) => [record.puntoId, record]));
  }, [evidences]);

  const completed = evidences.length;
  const total = points.length;
  const missing = Math.max(total - completed, 0);

  const routeInProgress = activeExecution?.estado === "en_proceso";
  const routeFinished = activeExecution?.estado === "finalizado";
  const showingExecution = Boolean(activeExecution && selectedRoute);
  const deviceAuthorized = deviceStatus === "authorized";

  async function loadDevice() {
    setDeviceStatus("loading");
    setMessage("");

    try {
      const id = await obtenerDeviceId();
      setDeviceId(id);

      const device = await obtenerDispositivoRegistrado(id);
      setRegisteredDevice(device);

      if (!device) {
        setDeviceStatus("not_registered");
        setOperationalProperties([]);
        return;
      }

      const operational = obtenerPropiedadesOperativas(profile, device);

      if (!operational.autorizado) {
        if (operational.motivo === "dispositivo_inactivo") {
          setDeviceStatus("inactive");
        } else if (operational.motivo === "dispositivo_sin_propiedades") {
          setDeviceStatus("no_properties");
        } else {
          setDeviceStatus("no_match");
        }

        setOperationalProperties([]);
        return;
      }

      setOperationalProperties(operational.propiedades);
      setDeviceStatus("authorized");
    } catch (error) {
      console.error("Error validando dispositivo:", error);
      setDeviceStatus("not_registered");
      setOperationalProperties([]);
      setMessage(`No fue posible validar el dispositivo: ${error.message}`);
    }
  }

  async function restoreActiveExecution(data) {
    if (!profile?.id || !data.length) return;

    for (const route of data) {
      const execution = await obtenerEjecucionActiva(route.id, profile.id);

      if (execution) {
        setSelectedPropertyId(route.propiedadId);
        setSelectedRouteId(route.id);
        setActiveExecution(execution);

        const records = await listarEvidencias(execution.id);
        setEvidences(records);

        setMessage("Se recuperó un recorrido en proceso.");
        return;
      }
    }
  }

  async function loadRoutes() {
    if (!deviceAuthorized || !operationalProperties.length) {
      setRoutes([]);
      setLoadingRoutes(false);
      return;
    }

    setLoadingRoutes(true);
    setMessage("");

    try {
      const data = await getRoutesForOperationalProperties(
        operationalProperties
      );

      setRoutes(data);

      const grouped = groupRoutesByProperty(data);

      if (grouped.length > 0) {
        const firstProperty = grouped[0];
        setSelectedPropertyId((current) => current || firstProperty.id);
      }

      if (!data.length) {
        setMessage(
          "No hay recorridos activos para las propiedades autorizadas en este celular."
        );
      }

      await restoreActiveExecution(data);
    } catch (error) {
      console.error("Error leyendo recorridos:", error);

      setMessage(
        `No fue posible cargar los recorridos. Código: ${
          error?.code || "sin-codigo"
        }. ${error?.message || ""}`
      );
    } finally {
      setLoadingRoutes(false);
    }
  }

  async function loadEvidences(executionId) {
    if (!executionId) {
      setEvidences([]);
      return;
    }

    const records = await listarEvidencias(executionId);
    setEvidences(records);
  }

  (() => {
    if (!profile?.id) return;

    loadDevice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

useEffect(() => {
  if (!profile?.id) return;

  loadDevice();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [profile?.id]);

useEffect(() => {
  if (!deviceAuthorized) return;

  loadRoutes();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [deviceAuthorized, JSON.stringify(operationalProperties)]);

useEffect(() => {
  function updateOnlineStatus() {
    setIsOnline(hayConexionInternet());
  }

  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);

  updateOnlineStatus();

  return () => {
    window.removeEventListener("online", updateOnlineStatus);
    window.removeEventListener("offline", updateOnlineStatus);
  };
}, []);

useEffect(() => {
  if (!profile?.id) return;

  loadPendingSync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [profile?.id]);

  function handlePropertyChange(propertyId) {
    const property = propertyGroups.find((item) => item.id === propertyId);

    setSelectedPropertyId(propertyId);
    setSelectedRouteId("");
    setActiveExecution(null);
    setEvidences([]);

    setMessage(
      property
        ? `Propiedad seleccionada: ${property.nombre}. Elige un recorrido.`
        : ""
    );
  }

  async function startRoute(route) {
    if (!route || !profile) return;

    const execution = await crearEjecucionLocal({
      plantilla: route,
      guardia: profile,
    });

    setSelectedRouteId(route.id);
    setActiveExecution(execution);
    setEvidences([]);
    setMessage(`Recorrido iniciado: ${route.nombre}.`);
  }

  function backToRouteList(customMessage = "Selecciona otro recorrido para continuar.") {
    setSelectedRouteId("");
    setActiveExecution(null);
    setEvidences([]);
    setConfirmFinishOpen(false);
    setMessage(customMessage);
    loadPendingSync();
  }

  function clearEvidencePhoto() {
  if (evidencePreview) {
    URL.revokeObjectURL(evidencePreview);
  }

  setEvidencePhoto(null);
  setEvidencePreview("");
}

function createPhotoPreview(file) {
  if (!file) return "";

  try {
    return URL.createObjectURL(file);
  } catch (error) {
    console.warn("No fue posible crear vista previa:", error);
    return "";
  }
}

function openCapture(point) {
  setCapturePoint(point);
  setEvidenceComment("");
  setEvidencePhoto(null);
  setEvidencePreview("");
  setMessage("");
}

function closeCapture() {
  clearEvidencePhoto();
  setCapturePoint(null);
  setEvidenceComment("");
  setSavingEvidence(false);
}

function setPhotoForEvidence(file) {
  if (!file) return;

  clearEvidencePhoto();

  setEvidencePhoto(file);
  setEvidencePreview(createPhotoPreview(file));
  setMessage("Foto cargada correctamente. Agrega el comentario para guardar.");
}

function validateEvidenceForm() {
  if (!evidencePhoto) {
    setMessage("La fotografía es obligatoria para guardar la evidencia.");
    return false;
  }

  if (!evidenceComment.trim()) {
    setMessage("El comentario es obligatorio para guardar la evidencia.");
    return false;
  }

  return true;
}

    async function obtenerUbicacionConLimite() {
      const ubicacionDefault = {
        ubicacionDisponible: false,
        latitud: null,
        longitud: null,
        precisionGps: null,
        errorGps: "Ubicación no disponible o tardó demasiado.",
      };

      try {
        const promesaUbicacion = isNativeApp()
          ? obtenerUbicacionNativa()
          : getCurrentLocation();

        const promesaTimeout = new Promise((resolve) => {
          setTimeout(() => resolve(ubicacionDefault), 5000);
        });

        return await Promise.race([promesaUbicacion, promesaTimeout]);
      } catch (error) {
        return {
          ...ubicacionDefault,
          errorGps: error?.message || "Error obteniendo ubicación.",
        };
      }
    }

 async function captureEvidence(point, file, comentario = "") {
    if (!file || !selectedRoute || !activeExecution) return;

    setProcessingPointId(point.id);
    setSavingEvidence(true);
    setMessage("Obteniendo ubicación y guardando evidencia local...");

    try {
        const [optimizedPhoto, location] = await Promise.all([
        compressImage(file),
        obtenerUbicacionConLimite(),
      ]);

      await guardarEvidenciaLocal({
        ejecucionId: activeExecution.id,
        recorridoId: selectedRoute.id,
        plantillaId: selectedRoute.id,
        plantillaNombre: selectedRoute.nombre,
        puntoId: point.id,
        puntoNombre: point.nombre,
        puntoOrden: point.orden,
        comentario,
        guardiaId: profile.id,
        guardiaNombre: profile.nombre,
        propiedadId: selectedRoute.propiedadId,
        propiedad: selectedRoute.propiedadNombre || selectedRoute.propiedadId,
        dispositivoId: deviceId,
        dispositivoNombre: registeredDevice?.nombre || "",
        estado: "pendiente_sync",
        capturadaEn: new Date().toISOString(),
        foto: optimizedPhoto,
        fotoNombre: file.name,
        pesoOriginal: file.size,
        pesoOptimizado: optimizedPhoto.size,
        ...location,
      });

      await loadEvidences(activeExecution.id);

      setMessage(
        "Evidencia guardada localmente. Quedará pendiente de sincronización."
      );

      closeCapture();
    } catch (error) {
      console.error("Error guardando evidencia:", error);
      setMessage(`No fue posible guardar la evidencia: ${error.message}`);
    } finally {
      setProcessingPointId(null);
      setSavingEvidence(false);
    }
  }


async function takeNativePhotoForEvidence() {
  try {
    const file = await tomarFotoNativa();
    setPhotoForEvidence(file);
  } catch (error) {
    console.error("Error tomando foto nativa:", error);

    if (
      String(error?.message || "")
        .toLowerCase()
        .includes("cancel")
    ) {
      setMessage("Captura cancelada.");
      return;
    }

    setMessage(`No fue posible abrir la cámara: ${error.message}`);
  }
}

function selectWebPhotoForEvidence(file) {
  setPhotoForEvidence(file);
}

async function saveEvidenceFromModal() {
  if (!capturePoint || !validateEvidenceForm()) return;

  await captureEvidence(
    capturePoint,
    evidencePhoto,
    evidenceComment.trim()
  );
}

 
  function hayConexionInternet() {
  return navigator.onLine !== false;
}

function ejecutarConTimeout(promesa, milisegundos = 35000) {
  return Promise.race([
    promesa,
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "La sincronización tardó demasiado. El recorrido quedó pendiente por sincronizar."
            )
          ),
        milisegundos
      )
    ),
  ]);
}

async function loadPendingSync() {
  try {
    const pendientes = await listarEjecucionesPendientesSync();

    const pendientesDelGuardia = pendientes.filter(
      (ejecucion) => ejecucion.guardiaId === profile?.id
    );

    setPendingExecutions(pendientesDelGuardia);
  } catch (error) {
    console.error("Error cargando pendientes:", error);
  }
}

async function syncPendingExecution(ejecucion) {
  if (!hayConexionInternet()) {
    setMessage("No hay internet. Intenta sincronizar cuando vuelva la conexión.");
    return;
  }

  setSyncingExecutionId(ejecucion.id);
  setMessage("Subiendo recorrido pendiente...");

  try {
    const evidenciasPendientes = await listarEvidencias(ejecucion.id);

    const resultado = await ejecutarConTimeout(
      subirRecorridoConFotos({
        ejecucion,
        evidencias: evidenciasPendientes,
      })
    );

    await marcarEjecucionSincronizada(ejecucion.id);
    await marcarEvidenciasSincronizadas(ejecucion.id);

    await loadPendingSync();

    setMessage(
      `Recorrido pendiente subido correctamente. Fotos sincronizadas: ${resultado.totalFotos}/${resultado.totalEvidencias}.`
    );
  } catch (error) {
    console.error("Error sincronizando pendiente:", error);

    setMessage(
      `No fue posible sincronizar el recorrido. Sigue pendiente. ${
        error?.message || ""
      }`
    );
  } finally {
    setSyncingExecutionId("");
  }
}

async function finishRoute() {
  if (!activeExecution) return;

  if (missing > 0) {
    setMessage(
      `Aún faltan ${missing} punto(s) sin fotografía. El recorrido no puede marcarse como completo.`
    );
    setConfirmFinishOpen(false);
    return;
  }

  setSavingFinish(true);
  setMessage("Finalizando recorrido...");

  try {
    const finishedExecution = await finalizarEjecucionLocal(activeExecution.id, {
      puntosCompletados: completed,
      puntosPendientes: missing,
      dispositivoId: deviceId,
      dispositivoNombre: registeredDevice?.nombre || "",
      pendienteSync: true,
    });

    setActiveExecution(finishedExecution);

    const evidenciasFinales = await listarEvidencias(finishedExecution.id);

    if (!hayConexionInternet()) {
      backToRouteList(
        "Recorrido finalizado localmente. No hay internet, quedó pendiente por sincronizar."
      );
      return;
    }

    setMessage("Recorrido finalizado. Subiendo fotos y reporte...");

    const resultado = await ejecutarConTimeout(
      subirRecorridoConFotos({
        ejecucion: finishedExecution,
        evidencias: evidenciasFinales,
      })
    );

    await marcarEjecucionSincronizada(finishedExecution.id);
    await marcarEvidenciasSincronizadas(finishedExecution.id);

    backToRouteList(
      `Recorrido subido correctamente. Fotos sincronizadas: ${resultado.totalFotos}/${resultado.totalEvidencias}.`
    );
  } catch (error) {
    console.error("Error subiendo recorrido:", error);

    backToRouteList(
      `Recorrido finalizado localmente, pero quedó pendiente por sincronizar. ${
        error?.message || ""
      }`
    );
  } finally {
    setSavingFinish(false);
    setConfirmFinishOpen(false);
  }
}

  return (
    <div className="app-page">
      <AppHeader />

      <main className="dashboard-container">
        <div className="dashboard-top">
          <div>
            <p className="eyebrow">App del guardia</p>
            <h1>Hola, {profile?.nombre}</h1>
          </div>

          <ConnectionBadge />
        </div>

        <MessageBox>{message}</MessageBox>

        {!deviceAuthorized && (
          <UnauthorizedDeviceCard
            deviceStatus={deviceStatus}
            deviceId={deviceId}
            onRetry={loadDevice}
          />
        )}

        {deviceAuthorized && !showingExecution && (
            <PendingSyncList
              pendientes={pendingExecutions}
              isOnline={isOnline}
              syncingId={syncingExecutionId}
              onRefresh={loadPendingSync}
              onSync={syncPendingExecution}
            />
          )}

        {deviceAuthorized && !showingExecution && (
          <RouteList
            selectedProperty={selectedProperty}
            propertyGroups={propertyGroups}
            selectedPropertyId={selectedPropertyId}
            routesForSelectedProperty={routesForSelectedProperty}
            registeredDevice={registeredDevice}
            loadingRoutes={loadingRoutes}
            onRefresh={loadRoutes}
            onPropertyChange={handlePropertyChange}
            onStartRoute={startRoute}
          />
        )}

        {deviceAuthorized && showingExecution && selectedRoute && (
          <ActiveRouteCard
            selectedRoute={selectedRoute}
            registeredDevice={registeredDevice}
            activeExecution={activeExecution}
            completed={completed}
            total={total}
            routeFinished={routeFinished}
            onBackToList={() => backToRouteList()}
          />
        )}

        {deviceAuthorized && showingExecution && selectedRoute && (
          <PointsList
            points={points}
            evidenceByPoint={evidenceByPoint}
            missing={missing}
            routeInProgress={routeInProgress}
            routeFinished={routeFinished}
            processingPointId={processingPointId}
            onOpenCapture={openCapture}
            onRequestFinish={() => setConfirmFinishOpen(true)}
            onBackToList={() => backToRouteList()}
          />
        )}

       <EvidenceCaptureModal
        point={capturePoint}
        comment={evidenceComment}
        photoPreview={evidencePreview}
        hasPhoto={Boolean(evidencePhoto)}
        saving={savingEvidence}
        onChangeComment={setEvidenceComment}
        onClose={closeCapture}
        onNativePhoto={takeNativePhotoForEvidence}
        onWebPhoto={selectWebPhotoForEvidence}
        onClearPhoto={clearEvidencePhoto}
        onSave={saveEvidenceFromModal}
      />

        <FinishConfirmModal
          open={confirmFinishOpen}
          completed={completed}
          missing={missing}
          saving={savingFinish}
          onCancel={() => setConfirmFinishOpen(false)}
          onConfirm={finishRoute}
        />
      </main>
    </div>
  );
}