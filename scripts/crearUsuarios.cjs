const fs = require("fs");
const path = require("path");

const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const serviceAccount = require("./serviceAccountKey.json");

initializeApp({
  credential: cert(serviceAccount),
});

const auth = getAuth();
const db = getFirestore();

const AUTH_DOMAIN = "seguridadgmr.local";
const INPUT_FILE = path.join(__dirname, "usuarios.csv");
const OUTPUT_FILE = path.join(__dirname, "usuarios_creados.csv");

function limpiarTexto(valor = "") {
  return String(valor || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Ñ/g, "N")
    .replace(/ñ/g, "n");
}

function limpiarUsuario(valor = "") {
  return limpiarTexto(valor)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function generarUsuario(nombre, apellido) {
  const nombreLimpio = limpiarUsuario(nombre);
  const apellidoLimpio = limpiarUsuario(apellido);

  const inicial = nombreLimpio.charAt(0) || "U";
  const apellidoBase = apellidoLimpio || "USUARIO";

  return `${inicial}${apellidoBase}`;
}

function generarClave4() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

function parsePropiedades(valor, propiedadId) {
  const texto = String(valor || "").trim();

  if (!texto && propiedadId) return [propiedadId];
  if (!texto) return [];

  return texto
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function leerCsvSimple(filePath) {
  const content = fs.readFileSync(filePath, "utf8").trim();

  if (!content) return [];

  const lines = content.split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(",").map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = line.split(",").map((value) => value.trim());
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    return row;
  });
}

async function existeEmail(email) {
  try {
    await auth.getUserByEmail(email);
    return true;
  } catch (error) {
    if (error?.code === "auth/user-not-found") return false;
    throw error;
  }
}

async function obtenerUsuarioDisponible(usuarioBase) {
  let intento = limpiarUsuario(usuarioBase);
  let contador = 2;

  while (await existeEmail(`${intento.toLowerCase()}@${AUTH_DOMAIN}`)) {
    intento = `${limpiarUsuario(usuarioBase)}${contador}`;
    contador += 1;
  }

  return intento;
}

async function crearUsuario(row) {
  const nombre = String(row.nombre || "").trim();
  const apellido = String(row.apellido || "").trim();
  const claveEmpleado = String(row.claveEmpleado || row.clave || "").trim();

  const nombreCompleto = `${nombre} ${apellido}`.trim();

  if (!nombre || !apellido) {
    throw new Error("Falta nombre o apellido.");
  }

  const rol = String(row.rol || "guardia").trim().toLowerCase();
  const propiedadId = String(row.propiedadId || "").trim() || "todas";

  const propiedadesPermitidas = parsePropiedades(
    row.propiedadesPermitidas,
    propiedadId
  );

  const usuarioBase = row.usuario
    ? limpiarUsuario(row.usuario)
    : generarUsuario(nombre, apellido);

  const usuario = await obtenerUsuarioDisponible(usuarioBase);

  const clave4 = generarClave4();
  const passwordFirebase = `GMR${clave4}`;
  const email = `${usuario.toLowerCase()}@${AUTH_DOMAIN}`;

  const userRecord = await auth.createUser({
    email,
    password: passwordFirebase,
    displayName: nombreCompleto,
    disabled: false,
  });

  await auth.setCustomUserClaims(userRecord.uid, {
    rol,
  });

  await db.collection("usuarios").doc(userRecord.uid).set(
    {
      nombre: nombreCompleto,
      correo: email,
      usuario,
      username: usuario,
      claveEmpleado,
      rol,
      activo: true,
      propiedadId,
      propiedadesPermitidas,
      creadoEn: FieldValue.serverTimestamp(),
      actualizadoEn: FieldValue.serverTimestamp(),
      creadoPorScript: true,
    },
    { merge: true }
  );

  return {
    uid: userRecord.uid,
    claveEmpleado,
    nombre: nombreCompleto,
    usuario,
    clave4,
    passwordFirebase,
    email,
    rol,
    propiedadId,
    propiedadesPermitidas: propiedadesPermitidas.join("|"),
  };
}

async function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`No existe el archivo: ${INPUT_FILE}`);
    process.exit(1);
  }

  const rows = leerCsvSimple(INPUT_FILE);

  if (!rows.length) {
    console.error("El CSV no tiene usuarios.");
    process.exit(1);
  }

  const resultados = [];
  const errores = [];

  for (const row of rows) {
    try {
      const resultado = await crearUsuario(row);
      resultados.push(resultado);

      console.log(
        `OK: ${resultado.nombre} | Usuario: ${resultado.usuario} | Clave: ${resultado.clave4}`
      );
    } catch (error) {
      const nombre = `${row.nombre || ""} ${row.apellido || ""}`.trim();

      errores.push({
        nombre,
        error: error?.message || String(error),
      });

      console.error(`ERROR: ${nombre} | ${error?.message || error}`);
    }
  }

  const headers = [
    "claveEmpleado",
    "nombre",
    "usuario",
    "clave4",
    "passwordFirebase",
    "email",
    "uid",
    "rol",
    "propiedadId",
    "propiedadesPermitidas",
  ];

  const output = [
    headers.join(","),
    ...resultados.map((item) =>
      headers
        .map((header) => String(item[header] ?? "").replace(/,/g, " "))
        .join(",")
    ),
  ].join("\n");

  fs.writeFileSync(OUTPUT_FILE, output, "utf8");

  console.log("");
  console.log(`Usuarios creados: ${resultados.length}`);
  console.log(`Errores: ${errores.length}`);
  console.log(`Archivo generado: ${OUTPUT_FILE}`);

  if (errores.length) {
    console.log("");
    console.log("Errores:");
    errores.forEach((item) => {
      console.log(`- ${item.nombre}: ${item.error}`);
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error general:", error);
    process.exit(1);
  });