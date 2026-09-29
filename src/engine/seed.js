/**
 * Arbol base determinista: la "Base de Operaciones" en la que arrancan todas
 * las misiones.
 *
 * Regla dura del proyecto: aqui no hay `Math.random` ni `Date.now`. Si el estado
 * inicial cambiase entre ejecuciones, `expected_output` dejaria de ser
 * verificable y el validador no podria fiarse de nada.
 */

import { VFS, FILE, DIR, LINK, formatOctal } from './fs.js';

/** Reloj congelado: 2026-02-01 12:00:00 UTC. `date` y `ls -l` usan este valor. */
export const SHELL_NOW = Date.UTC(2026, 1, 1, 12, 0, 0) / 1000;

export const AGENT_UID = 1000;
export const AGENT_GID = 1000;
export const AGENT_HOME = '/home/agente';
export const AGENT_SHELL = '/bin/bash';
export const HOSTNAME = 'linuxlearn';

const T = (str) => str;

/**
 * Descripcion declarativa del arbol. Cada entrada:
 *   [ruta, tipo, modo, propietario(0=root,1000=agente), contenido]
 */
export const BASE_TREE = [
    ['/', DIR, 0o755, 0],

    ['/bin', DIR, 0o755, 0],
    ['/etc', DIR, 0o755, 0],
    ['/etc/hostname', FILE, 0o644, 0, T(`${HOSTNAME}\n`)],
    ['/etc/hosts', FILE, 0o644, 0, T('127.0.0.1\tlocalhost\n127.0.0.1\tlinuxlearn\n::1\tlocalhost ip6-localhost\n')],
    ['/etc/passwd', FILE, 0o644, 0, T(
        'root:x:0:0:root:/root:/bin/bash\n' +
        'agente:x:1000:1000:Agente de Operacion:/home/agente:/bin/bash\n'
    )],
    ['/etc/group', FILE, 0o644, 0, T('root:x:0:\nagente:x:1000:\n')],
    ['/etc/motd', FILE, 0o644, 0, T('Bienvenido a la Base de Operaciones LinuxLearn\nAcceso restringido. Toda accion queda registrada.\n')],
    ['/etc/shadow', FILE, 0o640, 0, T('root:*:19000:0:99999:7:::\nagente:$6$hash$19000:0:99999:7:::\n')],

    ['/var', DIR, 0o755, 0],
    ['/var/log', DIR, 0o755, 0],
    ['/var/log/app.log', FILE, 0o640, 0, T(
        '2026-01-31 08:00:01 INFO  arranque del servicio\n' +
        '2026-01-31 08:00:04 INFO  carga de configuracion\n' +
        '2026-01-31 08:14:22 WARN  disco al 85 por ciento\n' +
        '2026-01-31 08:15:00 ERROR conexion rechazada\n' +
        '2026-02-01 08:00:01 INFO  arranque del servicio\n' +
        '2026-02-01 08:00:05 INFO  carga de configuracion\n' +
        '2026-02-01 08:03:12 WARN  disco al 85 por ciento\n' +
        '2026-02-01 08:05:44 ERROR conexion rechazada\n' +
        '2026-02-01 09:10:00 INFO  tarea programada terminada\n'
    )],
    ['/var/log/acceso.log', FILE, 0o640, 0, T(
        '2026-02-01 07:58:11 agente login correcto\n' +
        '2026-02-01 07:58:14 agente terminal 1 abierta\n' +
        '2026-02-01 12:00:00 agente logout\n'
    )],

    ['/tmp', DIR, 0o1777, 0],

    ['/home', DIR, 0o755, 0],
    [AGENT_HOME, DIR, 0o755, AGENT_UID],
    [AGENT_HOME + '/.bashrc', FILE, 0o644, AGENT_UID, T(
        '# Configuracion del agente\n' +
        'export PS1="\\u@\\h:\\w\\$ "\n' +
        'alias ll="ls -l"\n' +
        'alias registro="grep -i error /var/log/app.log"\n'
    )],

    [AGENT_HOME + '/proyecto', DIR, 0o755, AGENT_UID],
    [AGENT_HOME + '/proyecto/leeme.txt', FILE, 0o644, AGENT_UID, T(
        'PROYECTO ATLAS\n' +
        '=============\n' +
        'Pasos del dia:\n' +
        '1. cd ~/proyecto\n' +
        '2. ls -l\n' +
        '3. grep -r "TODO" .\n' +
        '4. cat datos/empleados.csv\n'
    )],
    [AGENT_HOME + '/proyecto/notas.txt', FILE, 0o644, AGENT_UID, T(
        'TODO: revisar el informe de febrero\n' +
        'TODO: actualizar el presupuesto\n' +
        'hecho: migrar el servidor de ficheros\n' +
        'TODO: purgar los registros antiguos\n'
    )],
    [AGENT_HOME + '/proyecto/datos', DIR, 0o755, AGENT_UID],
    [AGENT_HOME + '/proyecto/datos/empleados.csv', FILE, 0o644, AGENT_UID, T(
        'nombre,departamento,salario,alta\n' +
        'Ana,Ventas,3200,2021-03-15\n' +
        'Luis,Ingenieria,4500,2020-07-01\n' +
        'Marta,Ingenieria,3900,2022-01-10\n' +
        'Diego,Ventas,2800,2019-11-20\n' +
        'Sofia,Marketing,3100,2023-05-02\n'
    )],
    [AGENT_HOME + '/proyecto/datos/ventas.txt', FILE, 0o644, AGENT_UID, T(
        '2026-01-05 120\n' +
        '2026-01-07 340\n' +
        '2026-01-12 90\n' +
        '2026-01-19 250\n' +
        '2026-02-01 410\n' +
        '2026-02-03 175\n' +
        '2026-02-11 620\n' +
        '2026-02-15 88\n' +
        '2026-02-20 305\n' +
        '2026-02-28 150\n'
    )],
    [AGENT_HOME + '/proyecto/datos/inventario.txt', FILE, 0o644, AGENT_UID, T(
        'A001 silla de oficina\n' +
        'A002 mesa de reuniones\n' +
        'B001 lampara de escritorio\n' +
        'B002 estante metalico\n' +
        'C001 caja de archivo\n'
    )],
    [AGENT_HOME + '/proyecto/datos/precios.txt', FILE, 0o644, AGENT_UID, T(
        'A001 49.90\n' +
        'A002 89.50\n' +
        'B001 19.00\n' +
        'B002 149.00\n' +
        'C001 5.25\n'
    )],
    [AGENT_HOME + '/proyecto/datos/actividades.txt', FILE, 0o644, AGENT_UID, T(
        'deployed\nmonitored\nbacked-up\nrotated\n'
    )],
    [AGENT_HOME + '/proyecto/datos/pendientes.txt', FILE, 0o644, AGENT_UID, T(
        'backed-up\ndeployed\npatched\nrotated\nscaled\n'
    )],
    [AGENT_HOME + '/proyecto/datos/accesos.txt', FILE, 0o644, AGENT_UID, T(
        'root\n' +
        'agente\n' +
        'invitado\n' +
        'root\n' +
        'agente\n' +
        'agente\n'
    )],
    [AGENT_HOME + '/proyecto/datos/privado.txt', FILE, 0o600, AGENT_UID, T('clave de la caja fuerte: 4815\n')],
    [AGENT_HOME + '/proyecto/datos/bloqueado.txt', FILE, 0o000, AGENT_UID, T('esto no se puede leer sin permisos\n')],
    [AGENT_HOME + '/proyecto/scripts', DIR, 0o755, AGENT_UID],
    [AGENT_HOME + '/proyecto/scripts/inventario.sh', FILE, 0o755, AGENT_UID, T(
        '#!/bin/bash\n' +
        '# Cuenta los Articulos del inventario\n' +
        'archivo="/home/agente/proyecto/datos/inventario.txt"\n' +
        'total=$(wc -l < $archivo)\n' +
        'echo "Articulos: $total"\n'
    )],
    [AGENT_HOME + '/proyecto/scripts/limpieza.sh', FILE, 0o755, AGENT_UID, T(
        '#!/bin/bash\n' +
        '# Borra los temporales de la carpeta de pruebas\n' +
        'destino="$HOME/tmp"\n' +
        'rm -rf $destino/*\n' +
        'echo "Limpieza terminada"\n'
    )],

    [AGENT_HOME + '/proyecto/scripts/despliegue.sh', FILE, 0o755, AGENT_UID, T(
        '#!/bin/bash\n' +
        '# Publica la ultima compilacion en el servidor de pruebas.\n' +
        '# GUION ROTO: la mision 30 pide encontrar el fallo.\n' +
        'set -e\n' +
        'origen="/home/agente/proyecto/datos"\n' +
        'destino="/var/www/html/releases"\n' +
        'mkdir $destino\n' +
        'cp $origen/*.csv $destino/\n' +
        'echo "despliegue completado en $destino"\n'
    )],

    [AGENT_HOME + '/informes', DIR, 0o755, AGENT_UID],
    [AGENT_HOME + '/informes/informe-enero.txt', FILE, 0o644, AGENT_UID, T(
        'Informe mensual - enero 2026\n' +
        'Ventas: 12300\n' +
        'Clientes: 87\n' +
        'Incidencias: 3\n' +
        'Estado: cerrado\n'
    )],
    [AGENT_HOME + '/informes/informe-febrero.txt', FILE, 0o644, AGENT_UID, T(
        'Informe mensual - febrero 2026\n' +
        'Ventas: 15800\n' +
        'Clientes: 102\n' +
        'Incidencias: 1\n' +
        'Estado: cerrado\n'
    )],
    [AGENT_HOME + '/informes/resumen.txt', FILE, 0o644, AGENT_UID, T(
        'INFORME DE RESUMEN OPERATIVO\n' +
        'Periodo: febrero 2026\n' +
        'Responsable: agente\n' +
        'Estado: FINAL\n' +
        'Notas: revision completada sin incidencias\n'
    )],

    [AGENT_HOME + '/equipo', DIR, 0o775, AGENT_UID],
    [AGENT_HOME + '/equipo/compartido.txt', FILE, 0o664, AGENT_UID, T('nota compartida del equipo\n')],
    [AGENT_HOME + '/equipo/lectura.txt', FILE, 0o640, AGENT_UID, T('solo lectura para el grupo\n')],

    [AGENT_HOME + '/respaldos', DIR, 0o700, AGENT_UID]
];

/** Enlace simbolico del arbol base: atajo al directorio de datos. */
export const BASE_LINKS = [
    [AGENT_HOME + '/datos', LINK, 0o777, AGENT_UID, AGENT_HOME + '/proyecto/datos'],
    [AGENT_HOME + '/logs', LINK, 0o777, AGENT_UID, '/var/log']
];

/**
 * Construye un VFS nuevo con el arbol base materializado y devuelve el contexto
 * del agente. Toda mision arranca desde aqui.
 *
 * Se monta como root y despues se aplica el propietario de cada entrada, que es
 * justo como se construye una imagen real: si no, `mkdir -p` fallaria al no
 * poder escribir en un directorio 755 ajeno.
 */
export function buildSeed(options = {}) {
    const now = options.now == null ? SHELL_NOW : options.now;
    const vfs = new VFS({ now });
    const ctx = {
        uid: AGENT_UID,
        gid: AGENT_GID,
        groups: [AGENT_GID],
        user: 'agente',
        home: AGENT_HOME,
        shell: AGENT_SHELL,
        host: HOSTNAME,
        now
    };
    const rootCtx = { uid: 0, gid: 0 };

    const ownerOf = new Map();
    for (const [path, , mode, owner] of BASE_TREE) ownerOf.set(path, [mode, owner]);
    for (const [path, , mode, owner] of BASE_LINKS) ownerOf.set(path, [mode, owner]);

    for (const [path, type, mode, , content] of BASE_TREE) {
        if (type === DIR) {
            if (path === '/') continue;
            vfs.mkdirp(path, mode, rootCtx);
        }
    }
    for (const [path, type, mode, , content] of BASE_TREE) {
        if (type !== FILE) continue;
        vfs.writeFile(path, content == null ? '' : content, mode, rootCtx);
    }
    for (const [path, type, mode, , target] of BASE_LINKS) {
        const parent = vfs.node(parentPathOf(path));
        parent.setChild(baseName(path), vfs.newLink(baseName(path), target, mode));
    }

    for (const [path, [mode, owner]] of ownerOf) {
        const node = vfs.rawNode(path);
        if (!node) continue;
        node.mode = mode & 0o7777;
        node.uid = owner;
        node.gid = owner;
    }

    // Marcas de tiempo escalonadas: `ls -l` y `find -mtime` dan resultados
    // reproducibles y razonables.
    let tick = 0;
    for (const [path] of BASE_TREE) {
        if (path === '/') continue;
        const node = vfs.rawNode(path);
        if (node) node.mtime = now - (7200 - tick * 60);
        tick++;
    }
    for (const [path] of BASE_LINKS) {
        const node = vfs.rawNode(path);
        if (node) node.mtime = now - 600;
    }

    if (options.extra) options.extra(vfs, ctx);
    return { vfs, ctx };
}

function parentPathOf(p) {
    const i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.slice(0, i);
}

function baseName(p) {
    const i = p.lastIndexOf('/');
    return i < 0 ? p : p.slice(i + 1);
}

export { formatOctal };
