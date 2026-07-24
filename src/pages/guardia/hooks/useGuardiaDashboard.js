import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../../services/firebase";
import { compressImage } from "../../../utils/image";
import {
  finalizarEjecucionLocal,
  guardarEvidenciaLocal,
  iniciarEjecucionLocal,
  listarEvidencias,
  listarEjecucionesPendientesSync,
  marcarEjecucionSincronizada,
  marcarEvidenciasSincronizadas,
} from "../../../services/offlineDb";
import { subirRecorridoConFotos } from "../../../services/reportSyncService";
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
      map.set(documento.id, data.nombre || data.codigo || documento.id);
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

export function useGuardiaDashboard({ profile }) {
  const profileId = profile?.id || profile?.uid || "";
  const profileName = profile?.nombre || profile?.email || "Guardia";
  const previewRef = useRef("");

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
        String(a.nombre || "").localeCompare(String(b.nombre || ""))
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
      const pendientes = safeArray(await listarEjecucionesPendientesSync());

      const pendientesDelGuardia = pendientes.filter(
        (ejecucion) => ejecucion?.guardiaId === profileId
      );

      setPendingExecutions(pendientesDelGuardia);
    } catch (error) {
      console.error("Error cargando pendientes:", error);
      setPendingExecutions([]);
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

  const startRoute = useCallback(
    async (route) => {
      if (!route?.id) return;

      try {
        setMessage("");

        const puntos = safeArray(normalizePoints(route?.puntos || []));
        const propiedadNombre =
          route.propiedadNombre || route.propiedad || route.propiedadId || "";

        const execution = await iniciarEjecucionLocal({
          id: crearIdTemporal("ejecucion"),
          plantillaId: route.id,
          plantillaNombre: route.nombre || "",
          recorridoId: route.id,
          recorridoNombre: route.nombre || "",
          propiedadId: route.propiedadId || "",
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
          puntosTotales: puntos.length,
          puntosCompletados: 0,
          puntosPendientes: puntos.length,
          estado: "en_proceso",
          pendienteSync: true,
          sincronizado: false,
          iniciadaEn: new Date().toISOString(),
        });

        setActiveRoute({
          ...route,
          propiedadNombre,
          puntos,
        });

        setActiveExecution(execution);
        setEvidenceMap({});
        setShowingExecution(true);
        setMessage("Recorrido iniciado.");
      } catch (error) {
        console.error("Error iniciando recorrido:", error);
        setMessage("No fue posible iniciar el recorrido.");
      }
    },
    [profileId, profileName, registeredDevice, deviceInfo]
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
    },
    [loadPendingSync]
  );

  const clearEvidencePhoto = useCallback(() => {
    clearPreviewUrl();
    setEvidencePhoto(null);
    setEvidencePreview("");
  }, []);

  const openCapture = useCallback(
    (point) => {
      clearEvidencePhoto();
      setCapturePoint(point);
      setEvidenceComment("");
      setMessage("");
    },
    [clearEvidencePhoto]
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

  const finishRoute = useCallback(async () => {
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

  useEffect(() => {
    loadDevice();
  }, [loadDevice]);

  useEffect(() => {
    if (!profileId) return;
    loadRoutes();
  }, [profileId, operationalPropertiesKey, loadRoutes]);

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
    if (!profileId) return;
    loadPendingSync();
  }, [profileId, loadPendingSync]);

  useEffect(() => {
    return () => {
      clearPreviewUrl();
    };
  }, []);

  return {
    loading,
    routes,
    message,
    setMessage,

    profileId,
    profileName,

    deviceInfo,
    registeredDevice,

    operationalProperties,
    hasPropertyAccess,

    groupedRoutes,
    activeExecution,
    activeRoute,
    activePoints,
    completed,
    missing,
    totalPoints,
    showingExecution,
    evidenceMap,

    capturePoint,
    evidenceComment,
    evidencePhoto,
    evidencePreview,
    savingEvidence,
    setEvidenceComment,

    confirmFinishOpen,
    setConfirmFinishOpen,
    savingFinish,

    pendingExecutions,
    syncingExecutionId,
    isOnline,
    syncProgress,

    loadRoutes,
    loadPendingSync,
    startRoute,
    backToRouteList,

    openCapture,
    closeCapture,
    clearEvidencePhoto,
    takeNativePhotoForEvidence,
    selectWebPhotoForEvidence,
    saveEvidenceFromModal,

    finishRoute,
    syncPendingExecution,
  };
}