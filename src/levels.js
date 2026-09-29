/**
 * Las 32 misiones de LinuxLearn.
 *
 * Cada mision declara un CONTRATO, no una cadena literal que el alumno tenga
 * que clonar a mano:
 *
 *   - `salidaEsperada`  la salida del comando, normalizada (sin espacios al
 *                       final de linea ni saltos sobrantes).
 *   - `comprobaciones`  estado del sistema: `exit_code`, `stderr_contains` y
 *                       ficheros (`exists`, `absent`, `content`, `lines`,
 *                       `mode`, `target`).
 *
 * La evaluacion vive en `src/check.js` y la usan igual la interfaz y los
 * tests, para que "en verde" signifique lo mismo en los dos sitios.
 *
 * Modalidades:
 *
 *   Terminal     el alumno escribe comandos hasta cumplir el contrato.
 *   Depuracion   el panel muestra el intento fallido (`fallo`) y hay que
 *                escribir el comando corregido.
 *   Auditoria    el panel muestra un comando partido en `auditoria.tokens`
 *                con un token erroneo: hay que senalar `indice_error`.
 *   Ensamblaje   hay que ordenar `bloques` hasta reconstruir `soluciones[0]`.
 *
 * IMPORTANTE (estado del 2026-09-28): `comandos` esta vacio a proposito. El
 * registro de comandos (`src/engine/coreutils/index.js`) aun no esta lleno y
 * `scripts/validate-levels.mjs` daria error por comando desconocido. Rellenar
 * esa lista cuando esten los comandos, y anadir
 * `tests/levels.test.js -> ejecuta cada solucion con el motor`.
 * Ver `PROGRESO.md` apartado 4.
 */

export const MODOS = ['Terminal', 'Depuracion', 'Auditoria', 'Ensamblaje'];

export const DIFICULTADES = ['Basico', 'Intermedio', 'Avanzado', 'Experto'];

/** Comandos que usan las misiones: se rellena al completar el registro. */
export const COMANDOS = [
    'awk', 'cat', 'chmod', 'cp', 'cut', 'echo', 'find', 'grep', 'head', 'if',
    'ln', 'ls', 'mkdir', 'mv', 'printf', 'pwd', 'readlink', 'rm', 'sed',
    'sort', 'tr', 'uniq', 'wc'
];

export const NIVELES = [
    // ---------------------------------------------------------------- 1-10
    {
        id: 1,
        titulo: 'Posicionate',
        modo: 'Terminal',
        dificultad: 'Basico',
        brief: 'Toda mision empieza por saber donde estas. Pide el directorio de trabajo actual y comprueba que la base de operaciones te recibe en tu carpeta personal.',
        objetivos: ['Ejecutar pwd', 'Comprobar que empieza por /home/agente'],
        pistas: ['El comando lleva tres letras.', 'pwd = print working directory.'],
        comandos: [],
        soluciones: ['pwd'],
        salidaEsperada: '/home/agente\n'
    },
    {
        id: 2,
        titulo: 'Inventario de la base',
        modo: 'Terminal',
        dificultad: 'Basico',
        brief: 'Lista el contenido de tu carpeta personal sin entrar en ella. Deben salir los cinco recursos de la base, incluidos los dos atajos simbolicos.',
        objetivos: ['Ejecutar ls en el directorio actual', 'Ver equipo, informes, proyecto y respaldos'],
        pistas: ['ls no necesita argumentos si ya estas en casa.', 'Los enlaces simbolicos se listan como si fueran ficheros.'],
        comandos: [],
        soluciones: ['ls'],
        salidaEsperada: 'datos\nequipo\ninformes\nlogs\nproyecto\nrespaldos\n'
    },
    {
        id: 3,
        titulo: 'Leer un fichero',
        modo: 'Terminal',
        dificultad: 'Basico',
        brief: 'El fichero de notas de la carpeta proyecto contiene las tareas pendientes del dia. Muestro su contenido entero en la terminal usando el camino completo con el atajo de casa.',
        objetivos: ['Usar ~ para el directorio personal', 'Leer proyecto/notas.txt con cat'],
        pistas: ['~ se expande a tu directorio personal.', 'cat imprime el fichero entero.'],
        comandos: [],
        soluciones: ['cat ~/proyecto/notas.txt'],
        salidaEsperada: 'TODO: revisar el informe de febrero\nTODO: actualizar el presupuesto\nhecho: migrar el servidor de ficheros\nTODO: purgar los registros antiguos\n'
    },
    {
        id: 4,
        titulo: 'Moverte por el arbol',
        modo: 'Terminal',
        dificultad: 'Basico',
        brief: 'Cambia al directorio de registros y confirma el salto imprimiendo la nueva ruta en la misma linea de ordenes.',
        objetivos: ['Ejecutar cd /var/log', 'Confirmar con pwd en la misma linea'],
        pistas: ['Los dos comandos pueden ir unidos con &&.', 'cd no imprime nada: quien habla es pwd.'],
        comandos: [],
        soluciones: ['cd /var/log && pwd'],
        salidaEsperada: '/var/log\n'
    },
    {
        id: 5,
        titulo: 'Crea la estructura del respaldo',
        modo: 'Terminal',
        dificultad: 'Basico',
        brief: 'Prepara dentro de tus respaldos la carpeta anual y la mensual de febrero de 2026 con una sola orden, sin que falle si algun nivel intermedio ya existe.',
        objetivos: ['Crear respaldos/2026/02 de una vez', 'Que la orden termine con codigo 0'],
        pistas: ['-p crea todos los padres que hagan falta.', 'La ruta parte de ~/respaldos.'],
        comandos: [],
        soluciones: ['mkdir -p ~/respaldos/2026/02'],
        comprobaciones: [
            { exit_code: 0 },
            { fs: { path: '/home/agente/respaldos/2026/02', exists: true } }
        ]
    },
    {
        id: 6,
        titulo: 'Redirecciona una salida',
        modo: 'Terminal',
        dificultad: 'Basico',
        brief: 'Escribe la frase "informe listo" en un fichero nuevo llamado estado.txt dentro de informes. La terminal no debe mostrar nada: todo va al fichero.',
        objetivos: ['Usar > para redirigir', 'Crear informes/estado.txt con ese contenido'],
        pistas: ['> trunca el fichero si ya existiera.', 'Comilla la frase para que sea un solo argumento.'],
        comandos: [],
        soluciones: ['echo "informe listo" > ~/informes/estado.txt'],
        comprobaciones: [
            { fs: { path: '/home/agente/informes/estado.txt', exists: true, content: 'informe listo\n' } }
        ]
    },
    {
        id: 7,
        titulo: 'Duplica las notas',
        modo: 'Terminal',
        dificultad: 'Basico',
        brief: 'Haz una copia de proyecto/notas.txt dentro de la carpeta informes con el nombre notas.txt. El original debe quedar intacto.',
        objetivos: ['Copiar con cp', 'Verificar que el original sigue ahi'],
        pistas: ['cp origen destino.', 'Si el destino es un directorio, conserva el nombre.'],
        comandos: [],
        soluciones: ['cp ~/proyecto/notas.txt ~/informes/notas.txt'],
        comprobaciones: [
            { exit_code: 0 },
            { fs: { path: '/home/agente/informes/notas.txt', exists: true, lines: 4 } },
            { fs: { path: '/home/agente/proyecto/notas.txt', exists: true } }
        ]
    },
    {
        id: 8,
        titulo: 'Renombra los precios',
        modo: 'Terminal',
        dificultad: 'Basico',
        brief: 'La tabla de precios pasa a llamarse costos.txt. Muevela dentro de la misma carpeta de datos y comprueba que el nombre viejo ya no existe.',
        objetivos: ['Mover con mv', 'Que desapareca precios.txt'],
        pistas: ['mv hace de rename cuando el destino esta en el mismo directorio.', 'prueba con ls proyecto/datos si dudas.'],
        comandos: [],
        soluciones: ['mv ~/proyecto/datos/precios.txt ~/proyecto/datos/costos.txt'],
        comprobaciones: [
            { exit_code: 0 },
            { fs: { path: '/home/agente/proyecto/datos/costos.txt', exists: true } },
            { fs: { path: '/home/agente/proyecto/datos/precios.txt', absent: true } }
        ]
    },
    {
        id: 9,
        titulo: 'Elimina el fichero bloqueado',
        modo: 'Terminal',
        dificultad: 'Basico',
        brief: 'Borra el fichero bloqueado.txt de la carpeta de datos. Esta sin permisos de lectura, pero basta con tener escritura en el directorio que lo contiene.',
        objetivos: ['Borrar con rm', 'Que el fichero deje de existir'],
        pistas: ['rm no mira el modo del fichero, mira el del directorio.', 'No hace falta -f.'],
        comandos: [],
        soluciones: ['rm ~/proyecto/datos/bloqueado.txt'],
        comprobaciones: [
            { exit_code: 0 },
            { fs: { path: '/home/agente/proyecto/datos/bloqueado.txt', absent: true } }
        ]
    },
    {
        id: 10,
        titulo: 'Las tres primeras lineas',
        modo: 'Terminal',
        dificultad: 'Basico',
        brief: 'Muestra unicamente las tres primeras lineas del registro de la aplicacion. El resto del log no debe aparecer en pantalla.',
        objetivos: ['Limitar la salida con head', 'Que salgan exactamente tres lineas'],
        pistas: ['head -n 3 fichero.', 'El fichero es /var/log/app.log.'],
        comandos: [],
        soluciones: ['head -n 3 /var/log/app.log'],
        salidaEsperada: '2026-01-31 08:00:01 INFO  arranque del servicio\n2026-01-31 08:00:04 INFO  carga de configuracion\n2026-01-31 08:14:22 WARN  disco al 85 por ciento\n'
    },

    // --------------------------------------------------------------- 11-20
    {
        id: 11,
        titulo: 'Cuenta las lineas',
        modo: 'Terminal',
        dificultad: 'Intermedio',
        brief: 'Cuenta cuantas lineas tiene el fichero de notas y muestra la cifra junto a la ruta completa del fichero, tal como hace la utilidad real.',
        objetivos: ['Usar wc -l', 'Que la salida incluya el fichero'],
        pistas: ['wc -l fichero', 'Si solo quisieras el numero, redirige la entrada con <.'],
        comandos: [],
        soluciones: ['wc -l ~/proyecto/notas.txt'],
        salidaEsperada: '4 /home/agente/proyecto/notas.txt\n'
    },
    {
        id: 12,
        titulo: 'Filtra las tareas TODO',
        modo: 'Terminal',
        dificultad: 'Intermedio',
        brief: 'Extrae del fichero de notas unicamente las lineas que contienen la palabra TODO, respetando el orden en que aparecen.',
        objetivos: ['Buscar texto con grep', 'Que salgan las tres lineas de tarea'],
        pistas: ['grep PATRON FICHERO', 'grep distingue mayusculas: TODO esta en mayusculas.'],
        comandos: [],
        soluciones: ['grep TODO ~/proyecto/notas.txt'],
        salidaEsperada: 'TODO: revisar el informe de febrero\nTODO: actualizar el presupuesto\nTODO: purgar los registros antiguos\n'
    },
    {
        id: 13,
        titulo: 'Cuenta los registros de nivel INFO',
        modo: 'Terminal',
        dificultad: 'Intermedio',
        brief: 'Cuenta cuantas lineas del log de la aplicacion son de nivel INFO. Debe salir un unico numero, sin el texto de las lineas.',
        objetivos: ['Contar coincidencias con grep -c', 'Que salga solo el numero'],
        pistas: ['-c cambia la impresion por el recuento.', 'El fichero es /var/log/app.log.'],
        comandos: [],
        soluciones: ['grep -c INFO /var/log/app.log'],
        salidaEsperada: '5\n'
    },
    {
        id: 14,
        titulo: 'Ordena el registro de empleados',
        modo: 'Terminal',
        dificultad: 'Intermedio',
        brief: 'Muestra el CSV de empleados ordenado por orden alfabetico de la primera columna, con la cabecera incluida en el listado.',
        objetivos: ['Ordenar con sort', 'Respetar el orden por bytes de GNU'],
        pistas: ['sort sin opciones ya ordena de forma ascendente.', 'Las mayusculas van antes que las minusculas.'],
        comandos: [],
        soluciones: ['sort ~/proyecto/datos/empleados.csv'],
        salidaEsperada: 'Ana,Ventas,3200,2021-03-15\nDiego,Ventas,2800,2019-11-20\nLuis,Ingenieria,4500,2020-07-01\nMarta,Ingenieria,3900,2022-01-10\nSofia,Marketing,3100,2023-05-02\nnombre,departamento,salario,alta\n'
    },
    {
        id: 15,
        titulo: 'Primera tuberia',
        modo: 'Terminal',
        dificultad: 'Intermedio',
        brief: 'Une dos utilidades con una tuberia para que la salida del alimentador entre por la entrada del contador y obtengas el numero de lineas del inventario.',
        objetivos: ['Conectar cat con wc mediante |', 'Que salga un unico numero'],
        pistas: ['La tuberia | pasa la salida izquierda como entrada derecha.', 'cat fichero | wc -l'],
        comandos: [],
        soluciones: ['cat ~/proyecto/datos/inventario.txt | wc -l'],
        salidaEsperada: '5\n'
    },
    {
        id: 16,
        titulo: 'Repeticiones del registro de accesos',
        modo: 'Terminal',
        dificultad: 'Intermedio',
        brief: 'Ordena el fichero de accesos y muestra cuanto se ha repetido cada usuario con el recuento al lado. Hay tres entradas para agente, dos para root y una para invitado.',
        objetivos: ['Encadenar sort y uniq -c', 'Que el recuento salga con el formato de uniq'],
        pistas: ['uniq solo elimina duplicados adyacentes: ordena antes.', 'uniq -c imprime el contador a la izquierda.'],
        comandos: [],
        soluciones: ['sort ~/proyecto/datos/accesos.txt | uniq -c'],
        salidaEsperada: '      3 agente\n      1 invitado\n      2 root\n'
    },
    {
        id: 17,
        titulo: 'Extrae una columna CSV',
        modo: 'Terminal',
        dificultad: 'Intermedio',
        brief: 'Saca del registro de empleados unicamente la primera columna, la de los nombres, con la cabecera incluida.',
        objetivos: ['Separar campos con cut -d -f', 'Que salgan seis lineas'],
        pistas: ['cut -d, -f1 fichero', 'El separador va con comas pegadas: -d,.'],
        comandos: [],
        soluciones: ['cut -d, -f1 ~/proyecto/datos/empleados.csv'],
        salidaEsperada: 'nombre\nAna\nLuis\nMarta\nDiego\nSofia\n'
    },
    {
        id: 18,
        titulo: 'Convierte a mayusculas',
        modo: 'Terminal',
        dificultad: 'Intermedio',
        brief: 'Pasa el listado de actividades a mayusculas usando tr con las clases de caracteres, redirigiendo el fichero por la entrada estandar.',
        objetivos: ['Usar tr con [:lower:] y [:upper:]', 'Redirigir la entrada con <'],
        pistas: ["tr '[:lower:]' '[:upper:]' < fichero", 'El fichero es proyecto/datos/actividades.txt.'],
        comandos: [],
        soluciones: ["tr '[:lower:]' '[:upper:]' < ~/proyecto/datos/actividades.txt"],
        salidaEsperada: 'DEPLOYED\nMONITORED\nBACKED-UP\nROTATED\n'
    },
    {
        id: 19,
        titulo: 'Imprime solo los errores',
        modo: 'Terminal',
        dificultad: 'Intermedio',
        brief: 'Con sed, imprime sin mas las lineas del log que contengan ERROR, sin tocar el fichero. Deben salir exactamente las dos incidencias.',
        objetivos: ['Usar sed con direccion /ERROR/ y accion p', 'Trabajar con -n para silenciar la impresion automatica'],
        pistas: ['-n silencia el volcado por defecto.', "La direccion y la accion juntas: /ERROR/p"],
        comandos: [],
        soluciones: ["sed -n '/ERROR/p' /var/log/app.log"],
        salidaEsperada: '2026-01-31 08:15:00 ERROR conexion rechazada\n2026-02-01 08:05:44 ERROR conexion rechazada\n'
    },
    {
        id: 20,
        titulo: 'Procesa campos con awk',
        modo: 'Terminal',
        dificultad: 'Intermedio',
        brief: 'Usa awk con el separador de CSV para imprimir solo la columna del nombre de cada empleado, cabecera incluida.',
        objetivos: ['Definir -F, en awk', 'Acceder al campo con $1'],
        pistas: ["awk -F, '{print $1}' fichero", 'El $ va entre comillas simples para que no lo toque el shell.'],
        comandos: [],
        soluciones: ["awk -F, '{print $1}' ~/proyecto/datos/empleados.csv"],
        salidaEsperada: 'nombre\nAna\nLuis\nMarta\nDiego\nSofia\n'
    },

    // --------------------------------------------------------------- 21-25
    {
        id: 21,
        titulo: 'Busca los scripts',
        modo: 'Terminal',
        dificultad: 'Avanzado',
        brief: 'Recorre la carpeta de scripts del proyecto y lista las rutas completas de los tres ficheros con extension .sh, en orden alfabetico.',
        objetivos: ['Usar find con -name y comodines', 'Que las rutas sean absolutas'],
        pistas: ['find RUTA -name "*.sh"', 'El comodin va entre comillas para que no lo expanda el shell.'],
        comandos: [],
        soluciones: ['find ~/proyecto/scripts -name "*.sh"'],
        salidaEsperada: '/home/agente/proyecto/scripts/despliegue.sh\n/home/agente/proyecto/scripts/inventario.sh\n/home/agente/proyecto/scripts/limpieza.sh\n'
    },
    {
        id: 22,
        titulo: 'Depuracion: el contador que no cuenta',
        modo: 'Depuracion',
        dificultad: 'Avanzado',
        brief: 'El operador anterior queria contar los ERROR del registro principal y obtuvo 0. Revisa el comando fallido del panel, encuentra el error y escribe la version correcta.',
        objetivos: ['Detectar que el fichero del comando es el equivocado', 'Contar los ERROR de app.log'],
        pistas: ['El recuento es 0 porque el otro log no tiene errores.', 'Cambia el fichero por /var/log/app.log.'],
        comandos: [],
        soluciones: ['grep -c ERROR /var/log/app.log'],
        salidaEsperada: '2\n',
        fallo: {
            comando: 'grep -c ERROR /var/log/acceso.log',
            salida: '0\n'
        }
    },
    {
        id: 23,
        titulo: 'Crea un atajo simbolico',
        modo: 'Terminal',
        dificultad: 'Avanzado',
        brief: 'Crea en tu directorio personal un enlace simbolico llamado enlace-datos que apunte a la carpeta de datos del proyecto, y muestra su destino con readlink.',
        objetivos: ['Crear el enlace con ln -s', 'Leer el destino con readlink'],
        pistas: ['ln -s destino enlace', 'Encadena la lectura con && para verlo en la misma linea.'],
        comandos: [],
        soluciones: ['ln -s ~/proyecto/datos ~/enlace-datos && readlink ~/enlace-datos'],
        salidaEsperada: '/home/agente/proyecto/datos\n',
        comprobaciones: [
            { fs: { path: '/home/agente/enlace-datos', exists: true, target: '/home/agente/proyecto/datos' } }
        ]
    },
    {
        id: 24,
        titulo: 'Captura los errores',
        modo: 'Terminal',
        dificultad: 'Avanzado',
        brief: 'Redirige la salida de error de ls hacia /tmp/fallos.txt intentando listar un fichero que no existe. En pantalla no debe salir nada y el fichero debe guardar el mensaje de GNU.',
        objetivos: ['Usar 2> para redirigir stderr', 'Que el codigo de salida sea 2'],
        pistas: ['El descriptor 2 es la salida de error.', 'El camino es /etc/noexiste.'],
        comandos: [],
        soluciones: ['ls /etc/noexiste 2> /tmp/fallos.txt'],
        comprobaciones: [
            { exit_code: 2 },
            { fs: { path: '/tmp/fallos.txt', content: "ls: cannot access '/etc/noexiste': No such file or directory\n" } }
        ]
    },
    {
        id: 25,
        titulo: 'Sustitucion de comandos',
        modo: 'Terminal',
        dificultad: 'Avanzado',
        brief: 'Cuenta los TODO del fichero de notas guardando el resultado en una variable y muestra la frase "Quedan 3 tareas TODO" usando la sustitucion $(...).',
        objetivos: ['Guardar el recuento en una variable', 'Insertarla con $(...) dentro de un echo'],
        pistas: ['n=$(grep -c TODO ~/proyecto/notas.txt)', 'Despues: echo "Quedan $n tareas TODO".'],
        comandos: [],
        soluciones: ['n=$(grep -c TODO ~/proyecto/notas.txt); echo "Quedan $n tareas TODO"'],
        salidaEsperada: 'Quedan 3 tareas TODO\n'
    },

    // --------------------------------------------------------------- 26-32
    {
        id: 26,
        titulo: 'Auditoria: la columna que no es',
        modo: 'Auditoria',
        dificultad: 'Avanzado',
        brief: 'Alguien pidio nombre y salario del CSV y el comando devolvio nombre y departamento. Senala el token responsable del fallo en el comando mostrado en el panel.',
        objetivos: ['Leer la salida real y la esperada', 'Senalar el campo de -f'],
        pistas: ['-f selecciona los campos que se imprimen.', 'El segundo campo es departamento, el tercero salario.'],
        comandos: [],
        soluciones: ['cut -d, -f1,3 ~/proyecto/datos/empleados.csv'],
        salidaEsperada: 'nombre,salario\nAna,3200\nLuis,4500\nMarta,3900\nDiego,2800\nSofia,3100\n',
        auditoria: {
            tokens: ['cut', '-d,', '-f1,2', '~/proyecto/datos/empleados.csv'],
            indice_error: 2
        }
    },
    {
        id: 27,
        titulo: 'Comprueba y decide',
        modo: 'Terminal',
        dificultad: 'Avanzado',
        brief: 'Usa la construccion if con el test de fichero para comprobar que /etc/hostname existe y muestra "hostname listo" si es asi.',
        objetivos: ['Escribir un if completo con fi', 'Usar [ -f ] sobre /etc/hostname'],
        pistas: ['if [ -f RUTA ]; then ... fi', 'El test devuelve 0 si el fichero existe.'],
        comandos: [],
        soluciones: ['if [ -f /etc/hostname ]; then echo "hostname listo"; fi'],
        salidaEsperada: 'hostname listo\n'
    },
    {
        id: 28,
        titulo: 'Suma con un bucle',
        modo: 'Terminal',
        dificultad: 'Avanzado',
        brief: 'Recorre con un bucle for los numeros del 1 al 5 acumulandolos en una variable y muestra el total en pantalla. La suma correcta es 15.',
        objetivos: ['Escribir un for con do y done', 'Usar aritmetica $(( )) para acumular'],
        pistas: ['for n in 1 2 3 4 5; do ... done', 'total=$((total + n))'],
        comandos: [],
        soluciones: ['total=0; for n in 1 2 3 4 5; do total=$((total + n)); done; echo "total $total"'],
        salidaEsperada: 'total 15\n'
    },
    {
        id: 29,
        titulo: 'Define una funcion',
        modo: 'Terminal',
        dificultad: 'Experto',
        brief: 'Escribe una funcion llamada saludar que reciba un nombre como primer argumento y lo salude, y llamala con el usuario agente para ver el resultado.',
        objetivos: ['Definir una funcion con nombre() { ... }', 'Pasar argumentos posicionales con $1'],
        pistas: ['saludar() { echo "Hola, $1"; }', 'Las comas no hacen falta: el argumento va separado.'],
        comandos: [],
        soluciones: ['saludar() { echo "Hola, $1"; }; saludar agente'],
        salidaEsperada: 'Hola, agente\n'
    },
    {
        id: 30,
        titulo: 'Depuracion: el guion de despliegue roto',
        modo: 'Depuracion',
        dificultad: 'Experto',
        brief: 'El guion despliegue.sh de la carpeta scripts falla al publicar porque intenta crear una ruta cuyo padre no existe. Reproduce el despliegue corregido en una sola linea: crea la carpeta destino, copia los CSV y anuncia el resultado.',
        objetivos: ['Detectar el mkdir sin -p', 'Copiar solo los CSV con comodin', 'Imprimir el aviso final'],
        pistas: ['La ruta /var/www/html/releases no existe.', 'mkdir -p crea toda la cadena.', 'cp ~/proyecto/datos/*.csv DESTINO/'],
        comandos: [],
        soluciones: ['mkdir -p /var/www/html/releases && cp ~/proyecto/datos/*.csv /var/www/html/releases/ && echo "despliegue completado en /var/www/html/releases"'],
        salidaEsperada: 'despliegue completado en /var/www/html/releases\n',
        comprobaciones: [
            { exit_code: 0 },
            { fs: { path: '/var/www/html/releases/empleados.csv', exists: true } }
        ],
        fallo: {
            comando: 'set -e\norigen="/home/agente/proyecto/datos"\ndestino="/var/www/html/releases"\nmkdir $destino\ncp $origen/*.csv $destino/\necho "despliegue completado en $destino"',
            salida: "mkdir: cannot create directory '/var/www/html/releases': No such file or directory\n"
        }
    },
    {
        id: 31,
        titulo: 'Auditoria: el campo que no pedian',
        modo: 'Auditoria',
        dificultad: 'Experto',
        brief: 'El informe debia mostrar la columna de salarios del CSV y en su lugar salen las fechas de alta. Senala que token del comando awk esta mal escrito.',
        objetivos: ['Comparar salida real y salida esperada', 'Identificar el campo $4'],
        pistas: ['Los campos del CSV son nombre, departamento, salario y alta.', 'El salario es el tercer campo.'],
        comandos: [],
        soluciones: ["awk -F, '{print $3}' ~/proyecto/datos/empleados.csv"],
        salidaEsperada: 'salario\n3200\n4500\n3900\n2800\n3100\n',
        auditoria: {
            tokens: ['awk', '-F,', '{print $4}', '~/proyecto/datos/empleados.csv'],
            indice_error: 2
        }
    },
    {
        id: 32,
        titulo: 'Tuberia de siete etapas',
        modo: 'Ensamblaje',
        dificultad: 'Experto',
        brief: 'Ordena las siete etapas del pipeline hasta reconstruir la orden que ignora los arranques del servicio y dice que nivel de log domina en el registro. La respuesta es INFO con tres apariciones.',
        objetivos: ['Ordenar las etapas del pipeline', 'Que la salida sea el recuento dominante'],
        pistas: ['Primero se filtra, despues se extrae el nivel.', 'sort antes de uniq -c: uniq solo ve adyacentes.', 'sort -rn deja el mayor arriba.'],
        comandos: [],
        soluciones: ["cat /var/log/app.log | grep -v arranque | awk '{print $3}' | sort | uniq -c | sort -rn | head -n 1"],
        salidaEsperada: '      3 INFO\n',
        bloques: [
            "cat /var/log/app.log",
            "grep -v arranque",
            "awk '{print $3}'",
            'sort',
            'uniq -c',
            'sort -rn',
            'head -n 1'
        ]
    }
];

/** Busca una mision por su id. */
export function misionPorId(id) {
    return NIVELES.find((n) => n.id === id) ?? null;
}
