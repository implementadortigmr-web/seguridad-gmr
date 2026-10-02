import CatalogTable from '../../components/CatalogTable';

const ROLES = [
  ['Administrador', 'Acceso total a configuración y reportes.'],
  ['Supervisor de seguridad', 'Consulta recorridos e incidencias según propiedades asignadas.'],
  ['Recursos Humanos', 'Administra Eventuales/Practicantes y consulta Asistencia, sin recorridos ni incidencias.'],
  ['Nóminas', 'Consulta únicamente Asistencia México. No administra personal ni seguridad.'],
  ['Seguridad', 'Opera rondines, incidencias y asistencia cuando su perfil lo autoriza.'],
  ['Seguridad México', 'Cuenta operativa restringida a Asistencia en México.'],
];

export default function RolesPanel() {
  return (
    <section>
      <h2>Roles</h2>
      <p className="muted admin-intro">
        Los roles aplican una base de permisos. En Permisos puedes personalizar cada usuario sin cambiar su rol.
      </p>
      <CatalogTable columns={['Rol', 'Descripción']} rows={ROLES} />
    </section>
  );
}
