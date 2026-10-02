import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../../services/firebase";
import { compressImage } from "../../../utils/image";
import {
  actualizarEjecucionLocal,
  cerrarRecorridosVencidosLocal,
  finalizarEjecucionLocal,
  guardarEvidenciaLocal,
  guardarIncidenciaLocal,
  iniciarEjecucionLocal,
  limpiarCierreSesionRecorrido,
  listarEvidencias,
  listarEjecucionesActivasLocal,
  listarEjecucionesPausadasLocal,
  listarEjecucionesPendientesSync,
  listarIncidenciasPendientesSync,
  marcarEjecucionSincronizada,
  marcarRecorridosPorCierreSesion,
  marcarEvidenciasSincronizadas,
} from "../../../services/offlineDb";
import { subirRecorridoConFotos } from "../../../services/reportSyncService";
import { sincronizarIncidenciasPendientes } from "../../../services/incidentSyncService";
import {
  getCurrentLocation,
  obtenerUbicacionNativa,
} from "../../../services/locationService";
import { getDeviceInfo, isNativeApp } from "../../../services/deviceService";
import {
  groupRoutesByProperty,
  mapSnapshotRoutes,
  normalizePoints,
} from "../utils/guardiaHelpers";

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function hayConexionInternet() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

function ejecutarConTimeout(promesa, milisegundos = 120000) {
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

function crearIdTemporal(prefijo = "id") {
  return `${prefijo}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizarPermisosGuardia(profile) {
  if (!profile) return [];

  if (
    Array.isArray(profile.propiedadesPermitidas) &&
    profile.propiedadesPermitidas.length > 0
  ) {
    return profile.propiedadesPermitidas.filter(Boolean);
  }

  if (
    Array.isArray(profile.propiedadesAsignadas) &&
    profile.propiedadesAsignadas.length > 0
  ) {
    return profile.propiedadesAsignadas.filter(Boolean);
  }

  if (profile.propiedadId === "todas") {
    return ["*"];
  }

  if (profile.propiedadId && profile.propiedadId !== "todas") {
    return [profile.propiedadId];
  }

  return [];
}

async function obtenerMapaPropiedades() {
  try {
    const snapshot = await getDocs(collection(db, "propiedades"));
    const map = new Map();

    snapshot.docs.forEach((documento) => {
      const data = documento.data() || {};
      const nombre =
        data.nombre ||
        data.nombrePropiedad ||
        data.hotel ||
        data.codigo ||
        documento.id;

      map.set(documento.id, nombre);

      if (data.codigo) {
        map.set(data.codigo, nombre);
      }
    });

    return map;
  } catch (error) {
    console.warn("No fue posible cargar nombres de propiedades:", error);
    return new Map();
  }
}

function aplicarNombrePropiedad(recorrido, propiedadesMap) {
  if (!recorrido) return recorrido;

  const propiedadId = recorrido.propiedadId || "";
  const nombreDesdeMapa = propiedadId ? propiedadesMap.get(propiedadId) : "";

  const propiedadNombreActual =
    recorrido.propiedadNombre && recorrido.propiedadNombre !== propiedadId
      ? recorrido.propiedadNombre
      : "";

  const nombrePropiedad =
    propiedadNombreActual ||
    nombreDesdeMapa ||
    recorrido.propiedad ||
    recorrido.hotel ||
    recorrido.nombrePropiedad ||
    propiedadId ||
    "Propiedad";

  return {
    ...recorrido,
    propiedadNombre: nombrePropiedad,
  };
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

function esArchivoValido(value) {
  return value instanceof File || value instanceof Blob;
}

async function convertirFotoAFile(input) {
  if (!input) {
    throw new Error("No se recibió fotografía.");
  }

  if (input instanceof File) {
    return input;
  }

  if (input instanceof Blob) {
    return new File([input], `evidencia_${Date.now()}.jpg`, {
      type: input.type || "image/jpeg",
      lastModified: Date.now(),
    });
  }

  if (typeof input === "string") {
    const response = await fetch(input);
    const blob = await response.blob();

    return new File([blob], `evidencia_${Date.now()}.jpg`, {
      type: blob.type || "image/jpeg",
      lastModified: Date.now(),
    });
  }

  if (input?.webPath) {
    const response = await fetch(input.webPath);
    const blob = await response.blob();

    return new File([blob], `evidencia_${Date.now()}.jpg`, {
      type: blob.type || "image/jpeg",
      lastModified: Date.now(),
    });
  }

  if (input?.base64String) {
    const contentType = input.format === "png" ? "image/png" : "image/jpeg";
    const byteCharacters = atob(input.base64String);
    const byteNumbers = Array.from(byteCharacters, (character) =>
      character.charCodeAt(0)
    );
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: contentType });

    return new File([blob], `evidencia_${Date.now()}.jpg`, {
      type: contentType,
      lastModified: Date.now(),
    });
  }

  throw new Error("La fotografía no tiene un formato válido.");
}

function getIncidentTipoNombre(tipo) {
  const tipos = {
    proveedor: "Proveedor",
    hechos_relevantes: "Informe de hechos relevantes",
  };

  return tipos[tipo] || "Incidencia";
}

function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatLocalTime(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${hours}:${minutes}`;
}

export function useGuardiaDashboard({ profile }) {
  const profileId = profile?.id || profile?.uid || "";
  const profileName =
    profile?.nombre || profile?.displayName || profile?.email || "Guardia";

  const previewRef = useRef("");
  const restoredExecutionForRef = useRef("");
  const processingExpiredRoutesRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [routes, setRoutes] = useState([]);
  const [message, setMessage] = useState("");

  const [deviceInfo, setDeviceInfo] = useState(null);
  const [registeredDevice, setRegisteredDevice] = useState(null);

  const [activeExecution, setActiveExecution] = useState(null);
  const [activeRoute, setActiveRoute] = useState(null);
  const [evidenceMap, setEvidenceMap] = useState({});
  const [showingExecution, setShowingExecution] = useState(false);

  const [capturePoint, setCapturePoint] = useState(null);
  const [evidenceComment, setEvidenceComment] = useState("");
  const [evidencePhoto, setEvidencePhoto] = useState(null);
  const [evidencePreview, setEvidencePreview] = useState("");
  const [savingEvidence, setSavingEvidence] = useState(false);

  const [confirmFinishOpen, setConfirmFinishOpen] = useState(false);
  const [savingFinish, setSavingFinish] = useState(false);

  const [pendingExecutions, setPendingExecutions] = useState([]);
  const [syncingExecutionId, setSyncingExecutionId] = useState("");
  const [isOnline, setIsOnline] = useState(hayConexionInternet());
  const [syncProgress, setSyncProgress] = useState(null);

  const [incidentOpen, setIncidentOpen] = useState(false);
  const [incidentTipo, setIncidentTipo] = useState("proveedor");
  const [incidentDescripcion, setIncidentDescripcion] = useState("");
  const [savingIncident, setSavingIncident] = useState(false);

  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseMotivo, setPauseMotivo] = useState("proveedor");
  const [pauseComentario, setPauseComentario] = useState("");
  const [savingPause, setSavingPause] = useState(false);

  const [pendingIncidents, setPendingIncidents] = useState([]);
  const [syncingIncidents, setSyncingIncidents] = useState(false);

  const [pausedExecutions, setPausedExecutions] = useState([]);

  const [incidentContext, setIncidentContext] = useState(null);

  const earlyClosePreviewRef = useRef("");

  const [earlyCloseOpen, setEarlyCloseOpen] = useState(false);
  const [earlyCloseMotivo, setEarlyCloseMotivo] = useState("proveedor");
  const [earlyCloseComentario, setEarlyCloseComentario] = useState("");
  const [earlyClosePhoto, setEarlyClosePhoto] = useState(null);
  const [earlyClosePreview, setEarlyClosePreview] = useState("");
  const [savingEarlyClose, setSavingEarlyClose] = useState(false);

  const operationalProperties = useMemo(() => {
    return normalizarPermisosGuardia(profile);
  }, [profile]);

  const operationalPropertiesKey = useMemo(() => {
    return safeArray(operationalProperties).join("|");
  }, [operationalProperties]);

  const hasPropertyAccess = useMemo(() => {
    const permisos = safeArray(operationalProperties);
    return permisos.includes("*") || permisos.length > 0;
  }, [operationalProperties]);

  const groupedRoutes = useMemo(() => {
    return groupRoutesByProperty(safeArray(routes));
  }, [routes]);

  const activePoints = useMemo(() => {
    return safeArray(normalizePoints(activeRoute?.puntos || []));
  }, [activeRoute]);

  const completed = useMemo(() => {
    const points = safeArray(activePoints);
    const evidences = evidenceMap || {};

    return points.filter((point) => evidences[point.id]).length;
  }, [activePoints, evidenceMap]);

  const totalPoints = safeArray(activePoints).length;
  const missing = Math.max(totalPoints - completed, 0);

  function clearPreviewUrl() {
    if (previewRef.current && previewRef.current.startsWith("blob:")) {
      URL.revokeObjectURL(previewRef.current);
    }

    previewRef.current = "";
  }

  const loadDevice = useCallback(async () => {
    if (!profileId) {
      setLoading(false);
      setMessage("No se encontró información del usuario.");
      return;
    }

    try {
      const currentDevice = await getDeviceInfo();

      setDeviceInfo(currentDevice);

      setRegisteredDevice({
        id: "dispositivo-alpha",
        deviceId: currentDevice?.deviceId || "dispositivo-alpha",
        identificador: currentDevice?.identificador || "dispositivo-alpha",
        codigoDispositivo:
          currentDevice?.codigoDispositivo || "dispositivo-alpha",
        nombre:
          currentDevice?.nombre ||
          currentDevice?.model ||
          "Dispositivo del guardia",
        activo: true,
        usuarioId: profileId,
        propiedadesPermitidas: safeArray(operationalProperties),
        registroLocal: true,
      });
    } catch (error) {
      console.warn("No se pudo leer el dispositivo:", error);

      setDeviceInfo({
        deviceId: "dispositivo-alpha",
        nombre: "Dispositivo del guardia",
        model: "No disponible",
        platform: "android",
      });

      setRegisteredDevice({
        id: "dispositivo-alpha",
        deviceId: "dispositivo-alpha",
        identificador: "dispositivo-alpha",
        codigoDispositivo: "dispositivo-alpha",
        nombre: "Dispositivo del guardia",
        activo: true,
        usuarioId: profileId,
        propiedadesPermitidas: safeArray(operationalProperties),
        registroLocal: true,
      });
    }

    if (!hasPropertyAccess) {
      setMessage(
        "Tu usuario no tiene propiedades asignadas. Solicita al administrador que te asigne una propiedad."
      );
    } else {
      setMessage("");
    }

    setLoading(false);
  }, [profileId, operationalProperties, hasPropertyAccess]);

  const loadRoutes = useCallback(async () => {
    if (!profileId) {
      setRoutes([]);
      setLoading(false);
      return;
    }

    if (!hasPropertyAccess) {
      setRoutes([]);
      setLoading(false);
      setMessage(
        "Tu usuario no tiene propiedades asignadas. Solicita al administrador que te asigne una propiedad."
      );
      return;
    }

    setLoading(true);

    try {
      const permisos = safeArray(operationalProperties).filter(Boolean);
      const recorridosRef = collection(db, "plantillasRecorridos");
      const propiedadesMap = await obtenerMapaPropiedades();

      let snapshots = [];

      if (permisos.includes("*")) {
        const recorridosQuery = query(
          recorridosRef,
          where("activo", "==", true)
        );

        const snapshot = await getDocs(recorridosQuery);
        snapshots = [snapshot];
      } else {
        const consultas = permisos.map((propiedadId) => {
          const recorridosQuery = query(
            recorridosRef,
            where("activo", "==", true),
            where("propiedadId", "==", propiedadId)
          );

          return getDocs(recorridosQuery);
        });

        snapshots = await Promise.all(consultas);
      }

      const recorridos = snapshots.flatMap((snapshot) =>
        safeArray(mapSnapshotRoutes(snapshot))
      );

      const recorridosConPropiedad = recorridos.map((recorrido) =>
        aplicarNombrePropiedad(recorrido, propiedadesMap)
      );

      const recorridosUnicos = Array.from(
        new Map(recorridosConPropiedad.map((item) => [item.id, item])).values()
      );

      const recorridosOrdenados = recorridosUnicos.sort((a, b) =>
        String(a.nombre || "").localeCompare(String(b.nombre || ""), "es")
      );

      setRoutes(recorridosOrdenados);
      setMessage("");
    } catch (error) {
      console.error("Error cargando recorridos:", error);

      setRoutes([]);

      setMessage(
        `No fue posible cargar los recorridos. ${
          error?.code === "permission-denied"
            ? "Revisa permisos de Firestore o propiedad asignada."
            : error?.message || ""
        }`
      );
    } finally {
      setLoading(false);
    }
  }, [profileId, hasPropertyAccess, operationalProperties]);

  const loadPendingSync = useCallback(async () => {
    if (!profileId) return;

    try {
      const pendientes = safeArray(await listarEjecucionesPendientesSync(profileId));
      setPendingExecutions(pendientes);
    } catch (error) {
      console.error("Error cargando pendientes:", error);
      setPendingExecutions([]);
    }
  }, [profileId]);

  const loadPendingIncidents = useCallback(async () => {
    if (!profileId) return;

    try {
      const pendientes = await listarIncidenciasPendientesSync(profileId);
      setPendingIncidents(safeArray(pendientes));
    } catch (error) {
      console.error("Error cargando incidencias pendientes:", error);
      setPendingIncidents([]);
    }
  }, [profileId]);

  const refreshEvidence = useCallback(async (executionId) => {
    if (!executionId) return;

    const evidencias = safeArray(await listarEvidencias(executionId));
    const nextMap = {};

    evidencias.forEach((evidencia) => {
      if (evidencia?.puntoId) {
        nextMap[evidencia.puntoId] = evidencia;
      }
    });

    setEvidenceMap(nextMap);
  }, []);

  const loadPausedExecutions = useCallback(async () => {
  if (!profileId) return;

  try {
    const pausados = await listarEjecucionesPausadasLocal(profileId);
    setPausedExecutions(safeArray(pausados));
  } catch (error) {
    console.error("Error cargando recorridos pausados:", error);
    setPausedExecutions([]);
  }
}, [profileId]);

  const processExpiredRoutes = useCallback(() => {
    if (!profileId) return Promise.resolve([]);
    if (processingExpiredRoutesRef.current) {
      return processingExpiredRoutesRef.current;
    }

    const task = (async () => {
      try {
        await cerrarRecorridosVencidosLocal();

        const pendientes = safeArray(
          await listarEjecucionesPendientesSync(profileId)
        );
        const cierresAutomaticos = pendientes.filter(
          (ejecucion) =>
            ejecucion?.cierreAutomatico === true &&
            ejecucion?.motivoCierreAutomatico === "guardia_no_termino"
        );

        if (hayConexionInternet()) {
          for (const ejecucion of cierresAutomaticos) {
            try {
              const evidencias = safeArray(await listarEvidencias(ejecucion.id));
              await ejecutarConTimeout(
                subirRecorridoConFotos({ ejecucion, evidencias }),
                120000
              );
              await marcarEjecucionSincronizada(ejecucion.id);
              await marcarEvidenciasSincronizadas(ejecucion.id);
            } catch (error) {
              console.warn(
                "El cierre automático quedó pendiente por sincronizar:",
                error
              );
            }
          }
        }

        await loadPendingSync();
        await loadPausedExecutions();
        return cierresAutomaticos;
      } catch (error) {
        console.error("Error revisando recorridos vencidos:", error);
        return [];
      }
    })();

    processingExpiredRoutesRef.current = task;
    task.finally(() => {
      if (processingExpiredRoutesRef.current === task) {
        processingExpiredRoutesRef.current = null;
      }
    });

    return task;
  }, [profileId, loadPendingSync, loadPausedExecutions]);

  const restoreActiveExecution = useCallback(async () => {
    if (!profileId) return null;

    try {
      const vencidos = await processExpiredRoutes();
      const activas = await listarEjecucionesActivasLocal(profileId);
      let execution = safeArray(activas)[0];

      if (!execution?.id) {
        if (vencidos.length) {
          setMessage(
            "Un recorrido anterior venció y se cerró como Guardia no terminó. Solo se conservaron los puntos capturados."
          );
        }
        return null;
      }

      if (execution.sesionCerradaEn) {
        execution = (await limpiarCierreSesionRecorrido(execution.id)) || execution;
      }

      const rutaOriginal = safeArray(routes).find(
        (route) =>
          route.id === execution.plantillaId ||
          route.id === execution.recorridoId
      );

      const puntos = safeArray(
        normalizePoints(rutaOriginal?.puntos || execution.puntos || [])
      );

      setActiveRoute({
        ...(rutaOriginal || {}),
        id:
          execution.plantillaId ||
          execution.recorridoId ||
          execution.id,
        nombre:
          execution.plantillaNombre ||
          execution.recorridoNombre ||
          rutaOriginal?.nombre ||
          "Recorrido",
        propiedadId: execution.propiedadId || rutaOriginal?.propiedadId || "",
        propiedadNombre:
          execution.propiedadNombre ||
          rutaOriginal?.propiedadNombre ||
          "Propiedad",
        puntos,
      });

      setActiveExecution(execution);
      setShowingExecution(true);
      await refreshEvidence(execution.id);
      setMessage("Recorrido recuperado del dispositivo. Puedes continuar donde lo dejaste.");

      return execution;
    } catch (error) {
      console.error("Error recuperando recorrido activo:", error);
      return null;
    }
  }, [profileId, routes, refreshEvidence, processExpiredRoutes]);

  const startRoute = useCallback(
    async (route) => {
      if (!route?.id) {
        setMessage("No se encontró el recorrido seleccionado.");
        return;
      }

      if (!profileId) {
        setMessage("No se encontró información del usuario.");
        return;
      }

      const recorridosActivosLocales = await listarEjecucionesActivasLocal(profileId);
      const recorridoActivoLocal = safeArray(recorridosActivosLocales)[0];

      if (recorridoActivoLocal?.id) {
        const restaurado = await restoreActiveExecution();
        if (restaurado) {
          setMessage(
            "Ya existe un recorrido activo guardado en este dispositivo. Continúalo antes de iniciar otro."
          );
          return;
        }
      }

      const tieneRecorridoPausado = safeArray(pausedExecutions).some(
        (ejecucion) => ejecucion?.estado === "pausado"
      );

      if (tieneRecorridoPausado) {
        setMessage(
          "Tienes un recorrido pausado. Debes continuarlo antes de iniciar otro."
        );
        return;
      }

      try {
        setMessage("Iniciando recorrido...");

        const puntos = safeArray(normalizePoints(route?.puntos || []));

        if (!puntos.length) {
          setMessage("Este recorrido no tiene puntos configurados.");
          return;
        }

        const propiedadNombre =
          route.propiedadNombre ||
          route.propiedad ||
          route.nombrePropiedad ||
          route.propiedadId ||
          "Propiedad";

        const dispositivoId =
          registeredDevice?.id ||
          registeredDevice?.deviceId ||
          deviceInfo?.deviceId ||
          "dispositivo-alpha";

        const dispositivoNombre =
          registeredDevice?.nombre ||
          deviceInfo?.model ||
          deviceInfo?.nombre ||
          "Dispositivo";

        const executionData = {
          id: crearIdTemporal("ejecucion"),
          plantillaId: route.id,
          plantillaNombre: route.nombre || route.plantillaNombre || "",
          recorridoId: route.id,
          recorridoNombre: route.nombre || route.plantillaNombre || "",
          propiedadId: route.propiedadId || "",
          propiedadNombre,
          guardiaId: profileId,
          guardiaNombre: profileName,
          dispositivoId,
          dispositivoNombre,
          puntosTotales: puntos.length,
          puntosCompletados: 0,
          puntosPendientes: puntos.length,
          estado: "en_proceso",
          pausas: [],
          puntos,
          pendienteSync: true,
          sincronizado: false,
          iniciadaEn: new Date().toISOString(),
          creadoEn: new Date().toISOString(),
          actualizadoEn: new Date().toISOString(),
        };

        const execution = await iniciarEjecucionLocal(executionData);
        const executionFinal = execution || executionData;

        setActiveRoute({
          ...route,
          propiedadNombre,
          puntos,
        });

        setActiveExecution(executionFinal);
        setEvidenceMap({});
        setShowingExecution(true);
        setMessage("Recorrido iniciado.");
      } catch (error) {
        console.error("Error iniciando recorrido:", error);

        setMessage(
          `No fue posible iniciar el recorrido. ${
            error?.message || "Revisa la base local offline."
          }`
        );
      }
    },
    [
      profileId,
      profileName,
      registeredDevice,
      deviceInfo,
      pausedExecutions,
      restoreActiveExecution,
    ]
  );

  const backToRouteList = useCallback(
    (customMessage = "") => {
      setActiveExecution(null);
      setActiveRoute(null);
      setEvidenceMap({});
      setShowingExecution(false);
      setConfirmFinishOpen(false);
      setSavingFinish(false);
      setMessage(customMessage || "");
      loadPendingSync();
      loadPendingIncidents();
    },
    [loadPendingSync, loadPendingIncidents]
  );

  const clearEvidencePhoto = useCallback(() => {
    clearPreviewUrl();
    setEvidencePhoto(null);
    setEvidencePreview("");
  }, []);

  const openCapture = useCallback(
    (point) => {
      if (activeExecution?.estado === "pausado") {
        setMessage("Reanuda el recorrido antes de capturar evidencias.");
        return;
      }

      clearEvidencePhoto();
      setCapturePoint(point);
      setEvidenceComment("");
      setMessage("");
    },
    [clearEvidencePhoto, activeExecution]
  );

  const closeCapture = useCallback(() => {
    if (savingEvidence) return;

    clearEvidencePhoto();
    setCapturePoint(null);
    setEvidenceComment("");
  }, [savingEvidence, clearEvidencePhoto]);

  const setPhotoForEvidence = useCallback(async (input) => {
    try {
      const file = await convertirFotoAFile(input);

      clearPreviewUrl();

      if (!esArchivoValido(file)) {
        setEvidencePhoto(null);
        setEvidencePreview("");
        return;
      }

      const previewUrl = URL.createObjectURL(file);

      previewRef.current = previewUrl;
      setEvidencePreview(previewUrl);
      setEvidencePhoto(file);
    } catch (error) {
      console.error("Error preparando fotografía:", error);
      clearPreviewUrl();
      setEvidencePhoto(null);
      setEvidencePreview("");
      setMessage(error?.message || "No fue posible preparar la fotografía.");
    }
  }, []);

  const takeNativePhotoForEvidence = useCallback(
    async (photo) => {
      if (!photo) return;
      await setPhotoForEvidence(photo);
    },
    [setPhotoForEvidence]
  );

  const selectWebPhotoForEvidence = useCallback(
    async (event) => {
      const file = event?.target?.files?.[0];

      if (!file) return;

      await setPhotoForEvidence(file);
      event.target.value = "";
    },
    [setPhotoForEvidence]
  );

  const captureEvidence = useCallback(
    async (point, photoFile, comment) => {
      if (!activeExecution || !activeRoute) {
        throw new Error("No hay recorrido activo.");
      }

      if (activeExecution.estado === "pausado") {
        throw new Error("Reanuda el recorrido antes de capturar evidencias.");
      }

      const [optimizedPhoto, location] = await Promise.all([
        compressImage(photoFile),
        obtenerUbicacionConLimite(),
      ]);

      const evidencia = {
        id: crearIdTemporal("evidencia"),
        ejecucionId: activeExecution.id,
        plantillaId: activeRoute.id,
        plantillaNombre: activeRoute.nombre || "",
        recorridoId: activeRoute.id,
        recorridoNombre: activeRoute.nombre || "",
        propiedadId: activeRoute.propiedadId || "",
        propiedadNombre: activeRoute.propiedadNombre || "",
        guardiaId: profileId,
        guardiaNombre: profileName,
        dispositivoId:
          registeredDevice?.id ||
          registeredDevice?.deviceId ||
          deviceInfo?.deviceId ||
          "dispositivo-alpha",
        dispositivoNombre:
          registeredDevice?.nombre || deviceInfo?.model || "Dispositivo",
        puntoId: point.id,
        puntoNombre: point.nombre,
        puntoOrden: point.orden || 0,
        comentario: comment,
        foto: optimizedPhoto,
        fotoSincronizada: false,
        fotoUrl: "",
        fotoStoragePath: "",
        fotoThumbUrl: "",
        fotoThumbStoragePath: "",
        ubicacionDisponible: location.ubicacionDisponible === true,
        latitud: location.latitud,
        longitud: location.longitud,
        precisionGps: location.precisionGps,
        errorGps: location.errorGps || "",
        capturadaEn: new Date().toISOString(),
        creadaEn: new Date().toISOString(),
        pendienteSync: true,
        sincronizado: false,
      };

      await guardarEvidenciaLocal(evidencia);
      await refreshEvidence(activeExecution.id);

      setMessage(`Evidencia guardada para ${point.nombre}.`);
    },
    [
      activeExecution,
      activeRoute,
      profileId,
      profileName,
      registeredDevice,
      deviceInfo,
      refreshEvidence,
    ]
  );

  const saveEvidenceFromModal = useCallback(async () => {
    if (!capturePoint) {
      setMessage("Selecciona un punto.");
      return;
    }

    if (!evidencePhoto) {
      setMessage("La fotografía es obligatoria.");
      return;
    }

    if (!evidenceComment.trim()) {
      setMessage("El comentario es obligatorio.");
      return;
    }

    setSavingEvidence(true);
    setMessage("Guardando evidencia...");

    try {
      await captureEvidence(capturePoint, evidencePhoto, evidenceComment.trim());
      closeCapture();
    } catch (error) {
      console.error("Error guardando evidencia:", error);
      setMessage(error?.message || "No fue posible guardar la evidencia.");
    } finally {
      setSavingEvidence(false);
    }
  }, [
    capturePoint,
    evidencePhoto,
    evidenceComment,
    captureEvidence,
    closeCapture,
  ]);

const openIncidentModal = useCallback((context = {}) => {
  setIncidentTipo(context.tipo || "proveedor");
  setIncidentDescripcion("");
  setIncidentContext(context || null);
  setIncidentOpen(true);
  setMessage("");
}, []);

const closeIncidentModal = useCallback(() => {
  if (savingIncident) return;

  setIncidentOpen(false);
  setIncidentTipo("proveedor");
  setIncidentDescripcion("");
  setIncidentContext(null);
}, [savingIncident]);

 const saveIncident = useCallback(
  async (payload = {}) => {
    const tipoFinal = payload.tipo || incidentTipo;

    if (!tipoFinal) {
      setMessage("Selecciona el tipo de incidencia.");
      return;
    }

    const propiedadId =
      activeRoute?.propiedadId ||
      activeExecution?.propiedadId ||
      payload.propiedadId ||
      incidentContext?.propiedadId ||
      safeArray(operationalProperties).find((item) => item !== "*") ||
      "";

    const propiedadNombre =
      activeRoute?.propiedadNombre ||
      activeExecution?.propiedadNombre ||
      payload.propiedadNombre ||
      incidentContext?.propiedadNombre ||
      "";

    if (!propiedadId) {
      setMessage("No se encontró la propiedad para la incidencia.");
      return;
    }

    setSavingIncident(true);
    setMessage("Guardando incidencia...");

    try {
      const ahora = new Date();

      const [location, fotosPreparadas] = await Promise.all([
        obtenerUbicacionConLimite(),
        Promise.all(
          safeArray(payload.fotos).map(async (foto, index) => {
            const file = await convertirFotoAFile(foto);
            const optimizedPhoto = await compressImage(file);

            return {
              id: crearIdTemporal(`foto_inc_${index + 1}`),
              orden: index + 1,
              nombreArchivo: file.name || `foto_${index + 1}.jpg`,
              foto: optimizedPhoto,
              fotoSincronizada: false,
              fotoUrl: "",
              fotoStoragePath: "",
              fotoThumbUrl: "",
              fotoThumbStoragePath: "",
            };
          })
        ),
      ]);

      const campos = payload.campos || {};
      const firmas = payload.firmas || {};

      const incidencia = {
        id: crearIdTemporal("incidencia"),

        tipo: tipoFinal,
        tipoNombre: payload.tipoNombre || getIncidentTipoNombre(tipoFinal),

        propiedadId,
        propiedadNombre,

        guardiaId: profileId,
        guardiaNombre: profileName,

        dispositivoId:
          registeredDevice?.id ||
          registeredDevice?.deviceId ||
          deviceInfo?.deviceId ||
          "dispositivo-alpha",
        dispositivoNombre:
          registeredDevice?.nombre || deviceInfo?.model || "Dispositivo",

        fecha: payload.fecha || formatLocalDate(ahora),
        hora: payload.hora || formatLocalTime(ahora),

        campos,
        firmas,
        fotos: fotosPreparadas,
        cantidadFotos: fotosPreparadas.length,

        descripcion:
          payload.descripcion ||
          campos.descripcionHechos ||
          campos.motivo ||
          "",

        estado: "abierta",
        prioridad: tipoFinal === "hechos_relevantes" ? "alta" : "media",

        ubicacionDisponible: location.ubicacionDisponible === true,
        latitud: location.latitud,
        longitud: location.longitud,
        precisionGps: location.precisionGps,
        errorGps: location.errorGps || "",

        creadaEn: ahora.toISOString(),
        actualizadoEn: ahora.toISOString(),
        pendienteSync: true,
        sincronizado: false,
      };

      await guardarIncidenciaLocal(incidencia);
      await loadPendingIncidents();

      setMessage(
        `${incidencia.tipoNombre} guardado. Quedó pendiente por sincronizar.`
      );

      closeIncidentModal();
    } catch (error) {
      console.error("Error guardando incidencia:", error);
      setMessage(error?.message || "No fue posible guardar la incidencia.");
    } finally {
      setSavingIncident(false);
    }
  },
  [
    activeExecution,
    activeRoute,
    incidentTipo,
    incidentContext,
    profileId,
    profileName,
    registeredDevice,
    deviceInfo,
    operationalProperties,
    closeIncidentModal,
    loadPendingIncidents,
  ]
);

  const openPauseModal = useCallback(() => {
    setPauseMotivo("proveedor");
    setPauseComentario("");
    setPauseOpen(true);
    setMessage("");
  }, []);

  const closePauseModal = useCallback(() => {
    if (savingPause) return;

    setPauseOpen(false);
    setPauseMotivo("proveedor");
    setPauseComentario("");
  }, [savingPause]);

const pauseRoute = useCallback(async () => {
  if (!activeExecution) {
    setMessage("No hay recorrido activo para pausar.");
    return;
  }

  if (!pauseComentario.trim()) {
    setMessage("Agrega un comentario para pausar el recorrido.");
    return;
  }

  setSavingPause(true);
  setMessage("Pausando recorrido...");

  try {
    const pausa = {
      motivo: pauseMotivo,
      comentario: pauseComentario.trim(),
      pausadoEn: new Date().toISOString(),
    };

    const pausasActuales = Array.isArray(activeExecution.pausas)
      ? activeExecution.pausas
      : [];

    await actualizarEjecucionLocal(activeExecution.id, {
      estado: "pausado",
      pausadoEn: pausa.pausadoEn,
      motivoPausa: pauseMotivo,
      comentarioPausa: pauseComentario.trim(),
      pausas: [...pausasActuales, pausa],
      pendienteSync: true,
      sincronizado: false,
    });

    setPauseOpen(false);
    setPauseMotivo("proveedor");
    setPauseComentario("");

    setActiveExecution(null);
    setActiveRoute(null);
    setEvidenceMap({});
    setShowingExecution(false);
    setConfirmFinishOpen(false);

    await loadPausedExecutions();
    await loadPendingSync();

    setMessage("Recorrido pausado. Puedes continuarlo desde el menú principal.");
  } catch (error) {
    console.error("Error pausando recorrido:", error);
    setMessage(error?.message || "No fue posible pausar el recorrido.");
  } finally {
    setSavingPause(false);
  }
}, [
  activeExecution,
  pauseMotivo,
  pauseComentario,
  loadPausedExecutions,
  loadPendingSync,
]);

const continuePausedExecution = useCallback(
  async (execution) => {
    if (!execution?.id) {
      setMessage("No se encontró el recorrido pausado.");
      return;
    }

    setMessage("Reanudando recorrido...");

    try {
      const pausasActuales = Array.isArray(execution.pausas)
        ? [...execution.pausas]
        : [];

      if (pausasActuales.length) {
        const ultima = pausasActuales[pausasActuales.length - 1];

        if (!ultima.reanudadoEn) {
          pausasActuales[pausasActuales.length - 1] = {
            ...ultima,
            reanudadoEn: new Date().toISOString(),
          };
        }
      }

      const ejecucionActualizada = await actualizarEjecucionLocal(execution.id, {
        estado: "en_proceso",
        sesionCerradaEn: null,
        vencimientoSesionEn: null,
        recuperadoTrasCierreSesionEn: new Date().toISOString(),
        reanudadoEn: new Date().toISOString(),
        pausas: pausasActuales,
        pendienteSync: true,
        sincronizado: false,
      });

      const rutaOriginal = safeArray(routes).find(
        (route) =>
          route.id === ejecucionActualizada.plantillaId ||
          route.id === ejecucionActualizada.recorridoId
      );

      const puntos = safeArray(
        normalizePoints(rutaOriginal?.puntos || ejecucionActualizada.puntos || [])
      );

      setActiveRoute({
        ...(rutaOriginal || {}),
        id:
          ejecucionActualizada.plantillaId ||
          ejecucionActualizada.recorridoId ||
          execution.id,
        nombre:
          ejecucionActualizada.plantillaNombre ||
          ejecucionActualizada.recorridoNombre ||
          "Recorrido",
        propiedadId: ejecucionActualizada.propiedadId || "",
        propiedadNombre: ejecucionActualizada.propiedadNombre || "Propiedad",
        puntos,
      });

      setActiveExecution(ejecucionActualizada);
      setShowingExecution(true);

      await refreshEvidence(ejecucionActualizada.id);
      await loadPausedExecutions();

      setMessage("Recorrido reanudado.");
    } catch (error) {
      console.error("Error continuando recorrido:", error);
      setMessage(error?.message || "No fue posible continuar el recorrido.");
    }
  },
  [routes, refreshEvidence, loadPausedExecutions]
);

  const resumeRoute = useCallback(async () => {
    if (!activeExecution) return;

    setMessage("Reanudando recorrido...");

    try {
      const pausasActuales = Array.isArray(activeExecution.pausas)
        ? [...activeExecution.pausas]
        : [];

      if (pausasActuales.length) {
        const ultima = pausasActuales[pausasActuales.length - 1];

        if (!ultima.reanudadoEn) {
          pausasActuales[pausasActuales.length - 1] = {
            ...ultima,
            reanudadoEn: new Date().toISOString(),
          };
        }
      }

      const ejecucionActualizada = await actualizarEjecucionLocal(
        activeExecution.id,
        {
          estado: "en_proceso",
          reanudadoEn: new Date().toISOString(),
          pausas: pausasActuales,
          pendienteSync: true,
          sincronizado: false,
        }
      );

      setActiveExecution(ejecucionActualizada);
      setMessage("Recorrido reanudado.");
    } catch (error) {
      console.error("Error reanudando recorrido:", error);
      setMessage(error?.message || "No fue posible reanudar el recorrido.");
    }
  }, [activeExecution]);

  function getEarlyCloseMotivoNombre(motivo) {
  const motivos = {
    comida: "Salida a comer",
    proveedor: "Llegó proveedor",
    fin_turno: "Terminó turno",
    emergencia: "Emergencia",
    operacion: "Apoyo a operación",
    supervisor: "Indicación de supervisor",
    otro: "Otro",
  };

  return motivos[motivo] || "Otro";
}

function clearEarlyClosePreviewUrl() {
  if (
    earlyClosePreviewRef.current &&
    earlyClosePreviewRef.current.startsWith("blob:")
  ) {
    URL.revokeObjectURL(earlyClosePreviewRef.current);
  }

  earlyClosePreviewRef.current = "";
}

const openEarlyCloseModal = useCallback(() => {
  if (!activeExecution) {
    setMessage("No hay recorrido activo para cerrar.");
    return;
  }

  setEarlyCloseMotivo("proveedor");
  setEarlyCloseComentario("");
  setEarlyClosePhoto(null);
  setEarlyClosePreview("");
  setEarlyCloseOpen(true);
  setMessage("");
}, [activeExecution]);

const closeEarlyCloseModal = useCallback(() => {
  if (savingEarlyClose) return;

  clearEarlyClosePreviewUrl();
  setEarlyCloseOpen(false);
  setEarlyCloseMotivo("proveedor");
  setEarlyCloseComentario("");
  setEarlyClosePhoto(null);
  setEarlyClosePreview("");
}, [savingEarlyClose]);

const clearEarlyClosePhoto = useCallback(() => {
  clearEarlyClosePreviewUrl();
  setEarlyClosePhoto(null);
  setEarlyClosePreview("");
}, []);

const setPhotoForEarlyClose = useCallback(async (input) => {
  try {
    const file = await convertirFotoAFile(input);

    clearEarlyClosePreviewUrl();

    if (!esArchivoValido(file)) {
      setEarlyClosePhoto(null);
      setEarlyClosePreview("");
      return;
    }

    const previewUrl = URL.createObjectURL(file);

    earlyClosePreviewRef.current = previewUrl;
    setEarlyClosePreview(previewUrl);
    setEarlyClosePhoto(file);
  } catch (error) {
    console.error("Error preparando foto de cierre:", error);
    clearEarlyClosePreviewUrl();
    setEarlyClosePhoto(null);
    setEarlyClosePreview("");
    setMessage(error?.message || "No fue posible preparar la fotografía.");
  }
}, []);

const selectEarlyClosePhoto = useCallback(
  async (event) => {
    const file = event?.target?.files?.[0];

    if (!file) return;

    await setPhotoForEarlyClose(file);
    event.target.value = "";
  },
  [setPhotoForEarlyClose]
);

const finishRouteEarly = useCallback(async () => {
  if (!activeExecution || !activeRoute) {
    setMessage("No hay recorrido activo para cerrar.");
    return;
  }

  if (!earlyCloseComentario.trim()) {
    setMessage("Agrega un comentario para terminar antes.");
    return;
  }

  if (!earlyClosePhoto) {
    setMessage("La fotografía es obligatoria para terminar antes.");
    return;
  }

  setSavingEarlyClose(true);
  setMessage("Cerrando recorrido anticipadamente...");

  try {
    const [optimizedPhoto, location] = await Promise.all([
      compressImage(earlyClosePhoto),
      obtenerUbicacionConLimite(),
    ]);

    const motivoNombre = getEarlyCloseMotivoNombre(earlyCloseMotivo);

    const evidenciaCierre = {
      id: crearIdTemporal("cierre"),
      ejecucionId: activeExecution.id,
      plantillaId: activeRoute.id,
      plantillaNombre: activeRoute.nombre || "",
      recorridoId: activeRoute.id,
      recorridoNombre: activeRoute.nombre || "",
      propiedadId: activeRoute.propiedadId || "",
      propiedadNombre: activeRoute.propiedadNombre || "",
      guardiaId: profileId,
      guardiaNombre: profileName,
      dispositivoId:
        registeredDevice?.id ||
        registeredDevice?.deviceId ||
        deviceInfo?.deviceId ||
        "dispositivo-alpha",
      dispositivoNombre:
        registeredDevice?.nombre || deviceInfo?.model || "Dispositivo",

      puntoId: "__cierre_anticipado__",
      puntoNombre: "Cierre anticipado",
      puntoOrden: 9999,

      tipoEvidencia: "cierre_anticipado",
      esCierreAnticipado: true,
      motivoCierreAnticipado: earlyCloseMotivo,
      motivoCierreAnticipadoNombre: motivoNombre,

      comentario: `Motivo: ${motivoNombre}. ${earlyCloseComentario.trim()}`,
      foto: optimizedPhoto,
      fotoSincronizada: false,
      fotoUrl: "",
      fotoStoragePath: "",
      fotoThumbUrl: "",
      fotoThumbStoragePath: "",

      ubicacionDisponible: location.ubicacionDisponible === true,
      latitud: location.latitud,
      longitud: location.longitud,
      precisionGps: location.precisionGps,
      errorGps: location.errorGps || "",

      capturadaEn: new Date().toISOString(),
      creadaEn: new Date().toISOString(),
      pendienteSync: true,
      sincronizado: false,
    };

    await guardarEvidenciaLocal(evidenciaCierre);

    const closedExecution = await finalizarEjecucionLocal(activeExecution.id, {
      puntosCompletados: completed,
      puntosPendientes: missing,
      estado: "cerrado_incompleto",
      cierreAnticipado: true,
      motivoCierreAnticipado: earlyCloseMotivo,
      motivoCierreAnticipadoNombre: motivoNombre,
      comentarioCierreAnticipado: earlyCloseComentario.trim(),
      evidenciaCierreId: evidenciaCierre.id,
      pendienteSync: true,
      sincronizado: false,
      finalizadaEn: new Date().toISOString(),
    });

    setActiveExecution(closedExecution);

    const evidenciasFinales = safeArray(
      await listarEvidencias(closedExecution.id)
    );

    clearEarlyClosePreviewUrl();
    setEarlyCloseOpen(false);
    setEarlyCloseMotivo("proveedor");
    setEarlyCloseComentario("");
    setEarlyClosePhoto(null);
    setEarlyClosePreview("");

    if (!hayConexionInternet()) {
      backToRouteList(
        "Recorrido cerrado anticipadamente localmente. No hay internet, quedó pendiente por sincronizar."
      );
      return;
    }

    setSyncProgress({
      actual: 0,
      total: evidenciasFinales.length,
      mensaje: "Subiendo cierre anticipado...",
    });

    const resultado = await ejecutarConTimeout(
      subirRecorridoConFotos({
        ejecucion: closedExecution,
        evidencias: evidenciasFinales,
        onProgress: setSyncProgress,
      }),
      120000
    );

    await marcarEjecucionSincronizada(closedExecution.id);
    await marcarEvidenciasSincronizadas(closedExecution.id);

    backToRouteList(
      `Recorrido cerrado anticipadamente y subido correctamente. Fotos: ${resultado.totalFotos}/${resultado.totalEvidencias}.`
    );
  } catch (error) {
    console.error("Error cerrando anticipadamente:", error);

    backToRouteList(
      `Recorrido cerrado anticipadamente localmente, pero quedó pendiente por sincronizar. ${
        error?.message || ""
      }`
    );
  } finally {
    setSavingEarlyClose(false);
    setSyncProgress(null);
  }
}, [
  activeExecution,
  activeRoute,
  earlyCloseComentario,
  earlyCloseMotivo,
  earlyClosePhoto,
  completed,
  missing,
  profileId,
  profileName,
  registeredDevice,
  deviceInfo,
  backToRouteList,
]);

  const finishRoute = useCallback(async () => {
    if (!activeExecution) return;

    if (activeExecution.estado === "pausado") {
      setMessage("Reanuda el recorrido antes de finalizarlo.");
      setConfirmFinishOpen(false);
      return;
    }

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
      const finishedExecution = await finalizarEjecucionLocal(
        activeExecution.id,
        {
          puntosCompletados: completed,
          puntosPendientes: missing,
          dispositivoId:
            registeredDevice?.id ||
            registeredDevice?.deviceId ||
            deviceInfo?.deviceId ||
            "dispositivo-alpha",
          dispositivoNombre:
            registeredDevice?.nombre || deviceInfo?.model || "Dispositivo",
          estado: "finalizado",
          pendienteSync: true,
          sincronizado: false,
          finalizadaEn: new Date().toISOString(),
        }
      );

      setActiveExecution(finishedExecution);

      const evidenciasFinales = safeArray(
        await listarEvidencias(finishedExecution.id)
      );

      if (!hayConexionInternet()) {
        backToRouteList(
          "Recorrido finalizado localmente. No hay internet, quedó pendiente por sincronizar."
        );
        return;
      }

      setSyncProgress({
        actual: 0,
        total: evidenciasFinales.length,
        mensaje: "Preparando sincronización...",
      });

      setMessage("Recorrido finalizado. Subiendo fotos y reporte...");

      const resultado = await ejecutarConTimeout(
        subirRecorridoConFotos({
          ejecucion: finishedExecution,
          evidencias: evidenciasFinales,
          onProgress: setSyncProgress,
        }),
        120000
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
      setSyncProgress(null);
    }
  }, [
    activeExecution,
    missing,
    completed,
    registeredDevice,
    deviceInfo,
    backToRouteList,
  ]);

  const syncPendingExecution = useCallback(
    async (ejecucion) => {
      if (!ejecucion?.id) return;

      if (!hayConexionInternet()) {
        setMessage("No hay conexión a internet para sincronizar.");
        return;
      }

      setSyncingExecutionId(ejecucion.id);
      setMessage("Preparando sincronización...");

      try {
        const evidencias = safeArray(await listarEvidencias(ejecucion.id));

        setSyncProgress({
          actual: 0,
          total: evidencias.length,
          mensaje: "Preparando sincronización...",
        });

        const resultado = await ejecutarConTimeout(
          subirRecorridoConFotos({
            ejecucion,
            evidencias,
            onProgress: setSyncProgress,
          }),
          120000
        );

        await marcarEjecucionSincronizada(ejecucion.id);
        await marcarEvidenciasSincronizadas(ejecucion.id);

        await loadPendingSync();

        setMessage(
          `Pendiente sincronizado correctamente. Fotos: ${resultado.totalFotos}/${resultado.totalEvidencias}.`
        );
      } catch (error) {
        console.error("Error sincronizando pendiente:", error);
        setMessage(
          `No fue posible sincronizar el recorrido. ${
            error?.message || "Intenta de nuevo."
          }`
        );
      } finally {
        setSyncingExecutionId("");
        setSyncProgress(null);
      }
    },
    [loadPendingSync]
  );

  const prepareLogout = useCallback(async () => {
    if (!profileId) return;

    try {
      await marcarRecorridosPorCierreSesion(profileId);
    } catch (error) {
      console.error("No fue posible preparar el recorrido antes de cerrar sesión:", error);
      setMessage(
        "No fue posible guardar el estado del recorrido antes de cerrar sesión. Intenta nuevamente."
      );
      throw error;
    }
  }, [profileId]);

  const syncPendingIncidents = useCallback(async () => {
    if (!isOnline) {
      setMessage("No hay internet para subir incidencias.");
      return;
    }

    setSyncingIncidents(true);
    setSyncProgress({
      actual: 0,
      total: pendingIncidents.length,
      mensaje: "Preparando incidencias...",
    });

    try {
      const resultado = await sincronizarIncidenciasPendientes({
        guardiaId: profileId,
        onProgress: setSyncProgress,
      });

      await loadPendingIncidents();

      setMessage(
        `Incidencias sincronizadas correctamente: ${resultado.sincronizadas}.`
      );
    } catch (error) {
      console.error("Error sincronizando incidencias:", error);
      setMessage(
        `No fue posible sincronizar incidencias. ${error?.message || ""}`
      );
    } finally {
      setSyncingIncidents(false);
      setSyncProgress(null);
    }
  }, [isOnline, pendingIncidents.length, profileId, loadPendingIncidents]);

  useEffect(() => {
    loadDevice();
  }, [loadDevice]);

  useEffect(() => {
    if (!profileId) return;
    loadRoutes();
  }, [profileId, operationalPropertiesKey, loadRoutes]);

  useEffect(() => {
    if (!profileId) return;
    if (restoredExecutionForRef.current === profileId) return;

    restoredExecutionForRef.current = profileId;
    restoreActiveExecution();
  }, [profileId, restoreActiveExecution]);

  useEffect(() => {
    if (!profileId) {
      restoredExecutionForRef.current = "";
    }
  }, [profileId]);

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
    if (!profileId) return undefined;

    const timer = window.setInterval(() => {
      processExpiredRoutes();
    }, 60000);

    return () => window.clearInterval(timer);
  }, [profileId, processExpiredRoutes]);

  useEffect(() => {
    if (!profileId || !isOnline) return;
    processExpiredRoutes();
  }, [profileId, isOnline, processExpiredRoutes]);

  useEffect(() => {
    if (!profileId) return;
    loadPendingSync();
  }, [profileId, loadPendingSync]);

  useEffect(() => {
    if (!profileId) return;
    loadPendingIncidents();
  }, [profileId, loadPendingIncidents]);

 useEffect(() => {
  return () => {
    clearPreviewUrl();
    clearEarlyClosePreviewUrl();
  };
}, []);

  useEffect(() => {
  if (!profileId) return;

  loadPausedExecutions();
}, [profileId, loadPausedExecutions]);

  return {
   
  loading,
  message,
  profileName,
  isOnline,

  hasPropertyAccess,
  registeredDevice,
  deviceInfo,

  groupedRoutes,
  loadRoutes,
  startRoute,
  restoreActiveExecution,
  prepareLogout,
  pausedExecutions,
loadPausedExecutions,
continuePausedExecution,

  showingExecution,
  activeRoute,
  activeExecution,
  activePoints,
  evidenceMap,
  completed,
  missing,
  totalPoints,

  pendingExecutions,
  syncingExecutionId,
  loadPendingSync,
  syncPendingExecution,

  pendingIncidents,
  syncingIncidents,
  loadPendingIncidents,
  syncPendingIncidents,

  capturePoint,
  evidenceComment,
  evidencePhoto,
  evidencePreview,
  savingEvidence,
  setEvidenceComment,
  openCapture,
  closeCapture,
  takeNativePhotoForEvidence,
  selectWebPhotoForEvidence,
  clearEvidencePhoto,
  saveEvidenceFromModal,

  incidentOpen,
  incidentTipo,
  incidentDescripcion,
  incidentContext,
  savingIncident,
  setIncidentTipo,
  setIncidentDescripcion,
  openIncidentModal,
  closeIncidentModal,
  saveIncident,

  earlyCloseOpen,
  earlyCloseMotivo,
  earlyCloseComentario,
  earlyClosePhoto,
  earlyClosePreview,
  savingEarlyClose,
  setEarlyCloseMotivo,
  setEarlyCloseComentario,
  openEarlyCloseModal,
  closeEarlyCloseModal,
  selectEarlyClosePhoto,
  clearEarlyClosePhoto,
  finishRouteEarly,

  pauseOpen,
  pauseMotivo,
  pauseComentario,
  savingPause,
  setPauseMotivo,
  setPauseComentario,
  openPauseModal,
  closePauseModal,
  pauseRoute,
  resumeRoute,

  confirmFinishOpen,
  savingFinish,
  setConfirmFinishOpen,
  finishRoute,

  syncProgress,
  };
}