import {
  listarIncidenciasPendientesSync,
  marcarIncidenciaSincronizada,
} from "./offlineDb";
import { subirIncidenciaFirestore } from "./incidenciasService";

export async function sincronizarIncidenciasPendientes({
  guardiaId = "",
  onProgress,
} = {}) {
  const incidencias = await listarIncidenciasPendientesSync(guardiaId);

  let sincronizadas = 0;

  for (const incidencia of incidencias) {
    onProgress?.({
      actual: sincronizadas,
      total: incidencias.length,
      mensaje: `Subiendo incidencia ${sincronizadas + 1} de ${
        incidencias.length
      }...`,
    });

    await subirIncidenciaFirestore(incidencia, {
      onProgress: (progress) => {
        onProgress?.({
          actual: sincronizadas,
          total: incidencias.length,
          mensaje:
            progress?.mensaje ||
            `Subiendo incidencia ${sincronizadas + 1} de ${
              incidencias.length
            }...`,
        });
      },
    });

    await marcarIncidenciaSincronizada(incidencia.id);

    sincronizadas += 1;

    onProgress?.({
      actual: sincronizadas,
      total: incidencias.length,
      mensaje: `Incidencia ${sincronizadas} de ${incidencias.length} sincronizada.`,
    });
  }

  onProgress?.({
    actual: sincronizadas,
    total: incidencias.length,
    mensaje: "Incidencias sincronizadas.",
  });

  return {
    total: incidencias.length,
    sincronizadas,
  };
}