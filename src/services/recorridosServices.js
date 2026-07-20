import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";

function normalizarPropiedadesPermitidas(usuario) {
  if (!usuario) return [];

  if (
    Array.isArray(usuario.propiedadesPermitidas) &&
    usuario.propiedadesPermitidas.length > 0
  ) {
    return usuario.propiedadesPermitidas.filter(Boolean);
  }

  if (usuario.propiedadId && usuario.propiedadId !== "todas") {
    return [usuario.propiedadId];
  }

  return [];
}

function ordenarRecorridosPorNombre(recorridos) {
  return [...recorridos].sort((a, b) =>
    String(a.nombre || "").localeCompare(String(b.nombre || ""), "es")
  );
}

function mapearRecorridos(snapshot) {
  return snapshot.docs.map((documento) => ({
    id: documento.id,
    ...documento.data(),
  }));
}

export async function obtenerRecorridosDisponiblesParaUsuario(usuario) {
  if (!usuario) return [];

  const plantillasRef = collection(db, "plantillasRecorridos");

  const propiedadesPermitidas = normalizarPropiedadesPermitidas(usuario);

  const puedeVerTodas =
    usuario.rol === "administrador" || propiedadesPermitidas.includes("*");

  if (puedeVerTodas) {
    const consultaTodas = query(plantillasRef, where("activo", "==", true));

    const snapshot = await getDocs(consultaTodas);

    return ordenarRecorridosPorNombre(mapearRecorridos(snapshot));
  }

  if (!propiedadesPermitidas.length) {
    return [];
  }

  const resultados = [];

  for (const propiedadId of propiedadesPermitidas) {
    const consultaPorPropiedad = query(
      plantillasRef,
      where("activo", "==", true),
      where("propiedadId", "==", propiedadId)
    );

    const snapshot = await getDocs(consultaPorPropiedad);

    resultados.push(...mapearRecorridos(snapshot));
  }

  const recorridosUnicos = new Map();

  resultados.forEach((recorrido) => {
    recorridosUnicos.set(recorrido.id, recorrido);
  });

  return ordenarRecorridosPorNombre([...recorridosUnicos.values()]);
}