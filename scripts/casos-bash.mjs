/**
 * Casos de comparacion diferencial. Cada entrada se ejecuta tal cual en bash
 * real y en el emulador: si algo difiere, el guion se considera incompatible.
 *
 *   nombre   identificador legible, aparece en el informe
 *   guion    el texto que ejecuta el alumno
 *   archivos contenido previo del arbol, relativo a la sesion
 *   cwd      directorio de trabajo inicial
 *   ignorar  campos que no se comparan (`code` para codigos de Coreutils)
 *
 * No se comparan las salidas con fechas, duenos o permisos reales (`ls -l`,
 * `stat`, `date`, `env`), porque en el emulador son deterministas y en bash no.
 */

const DATOS = 'nombre,departamento,salario,alta\nAna,Ventas,3200,2021-03-15\nLuis,Ingenieria,4500,2020-07-01\nMarta,Ingenieria,3900,2022-01-10\nDiego,Ventas,2800,2019-11-20\nSofia,Marketing,3100,2023-05-02\n';
const NUMEROS = '10\n9\n2\n45\n3\n7\n';
const LETRAS = 'b\na\nb\nc\na\nb\n';
const NOTAS = 'primera linea\nsegunda linea\ntercera\n';
const LOG = [
    '2026-01-31 08:00:01 INFO  arranque',
    '2026-01-31 08:00:04 INFO  carga',
    '2026-01-31 08:14:22 WARN  disco lleno',
    '2026-01-31 08:15:00 ERROR conexion rechazada',
    '2026-02-01 08:00:01 INFO  arranque',
    '2026-02-01 08:05:44 ERROR conexion rechazada',
    ''
].join('\n');

const ARBOL = {
    'prueba/empleados.csv': DATOS,
    'prueba/numeros.txt': NUMEROS,
    'prueba/letras.txt': LETRAS,
    'notas.txt': NOTAS,
    'var/log/app.log': LOG
};

export const CASOS = [
    // --- texto ---
    { nombre: 'echo simple', guion: 'echo hola mundo' },
    { nombre: 'echo -n', guion: 'printf "[%s]" a b c' },
    { nombre: 'printf formato', guion: 'printf "%5.2f|%-6s|%03d\\n" 3.14159 hola 7' },
    { nombre: 'wc por defecto', guion: 'cat prueba/empleados.csv | wc -l', archivos: ARBOL },
    { nombre: 'wc campos', guion: 'cat prueba/empleados.csv | wc -l -w -c', archivos: ARBOL },
    { nombre: 'cut por campo', guion: 'cut -d, -f2 prueba/empleados.csv', archivos: ARBOL },
    { nombre: 'cut varios campos', guion: 'cut -d, -f1,3 prueba/empleados.csv', archivos: ARBOL },
    { nombre: 'cut rango', guion: 'cut -d, -f2- prueba/empleados.csv', archivos: ARBOL },
    { nombre: 'cut caracteres', guion: 'cut -c1-4 prueba/empleados.csv', archivos: ARBOL },
    { nombre: 'head -n', guion: 'head -n 2 notas.txt', archivos: ARBOL },
    { nombre: 'tail -n', guion: 'tail -n 2 notas.txt', archivos: ARBOL },
    { nombre: 'tail +n', guion: 'tail -n +2 notas.txt', archivos: ARBOL },
    { nombre: 'head y tail con tuberia', guion: 'cat prueba/empleados.csv | head -n 2 | tail -n 1', archivos: ARBOL },
    { nombre: 'sort numerico', guion: 'sort -n prueba/numeros.txt', archivos: ARBOL },
    { nombre: 'sort numerico inverso', guion: 'sort -rn prueba/numeros.txt', archivos: ARBOL },
    { nombre: 'sort unico', guion: 'sort -u prueba/letras.txt', archivos: ARBOL },
    { nombre: 'sort por clave', guion: 'sort -t, -k3 -n prueba/empleados.csv', archivos: ARBOL },
    { nombre: 'uniq -c', guion: 'cat prueba/letras.txt | uniq -c', archivos: ARBOL },
    { nombre: 'sort uniq -c', guion: 'sort prueba/letras.txt | uniq -c', archivos: ARBOL },
    { nombre: 'uniq -d', guion: 'sort prueba/letras.txt | uniq -d', archivos: ARBOL },
    { nombre: 'uniq -u', guion: 'sort prueba/letras.txt | uniq -u', archivos: ARBOL },
    { nombre: 'tr mayusculas', guion: 'tr a-z A-Z < prueba/letras.txt', archivos: ARBOL },
    { nombre: 'tr clases', guion: "tr '[:lower:]' '[:upper:]' < prueba/letras.txt", archivos: ARBOL },
    { nombre: 'tr borra', guion: "tr -d 'a' < prueba/letras.txt", archivos: ARBOL },
    { nombre: 'tr squeeze', guion: "tr -s ' ' < notas.txt", archivos: ARBOL },
    // `rev` no viene en Git Bash de Windows; se compara en Ubuntu (su engine.test.js
    // lo cubre igualmente con un caso fijo).
    { nombre: 'seq simple', guion: 'seq 3' },
    { nombre: 'seq rango', guion: 'seq 2 4' },
    { nombre: 'seq paso', guion: 'seq 1 2 9' },
    { nombre: 'seq separador', guion: 'seq -s, 1 3' },
    { nombre: 'seq ancho', guion: 'seq -w 8 10' },
    // `tee f | cat f` es una carrera (cat puede abrir antes de que tee cree el
    // fichero), asi que aqui se espera a que tee termine.
    { nombre: 'tee', guion: 'echo secreto | tee copiado.txt > /dev/null; cat copiado.txt', archivos: ARBOL },

    // --- regex ---
    { nombre: 'grep basico', guion: 'grep ERROR var/log/app.log', archivos: ARBOL },
    { nombre: 'grep cuenta', guion: 'grep -c ERROR var/log/app.log', archivos: ARBOL },
    { nombre: 'grep sin coincidencia', guion: 'grep -c ZZZZ var/log/app.log', archivos: ARBOL, ignorar: ['code'] },
    { nombre: 'grep -i', guion: 'grep -i error var/log/app.log', archivos: ARBOL },
    { nombre: 'grep -v', guion: 'grep -v INFO var/log/app.log', archivos: ARBOL },
    { nombre: 'grep -o', guion: 'grep -o INFO var/log/app.log', archivos: ARBOL },
    { nombre: 'grep varios ficheros', guion: 'grep -c INFO var/log/app.log notas.txt', archivos: ARBOL },
    { nombre: 'sed sustitucion', guion: "sed 's/linea/LINEA/' notas.txt", archivos: ARBOL },
    { nombre: 'sed global', guion: "sed 's/a/A/g' prueba/letras.txt", archivos: ARBOL },
    { nombre: 'sed imprime linea', guion: "sed -n '2p' notas.txt", archivos: ARBOL },
    { nombre: 'sed por patron', guion: "sed -n '/segunda/p' notas.txt", archivos: ARBOL },
    { nombre: 'sed borra', guion: "sed '/primera/d' notas.txt", archivos: ARBOL },
    { nombre: 'sed con grupo', guion: "sed 's/\\([a-z]*\\) linea/X/' notas.txt", archivos: ARBOL },
    { nombre: 'awk campo', guion: "awk -F, '{print $1}' prueba/empleados.csv", archivos: ARBOL },
    { nombre: 'awk condicion', guion: "awk -F, '$3 > 3000 {print $1}' prueba/empleados.csv", archivos: ARBOL },
    { nombre: 'awk numerica', guion: "awk -F, '{suma += $3} END {print suma}' prueba/empleados.csv", archivos: ARBOL },
    { nombre: 'awk cuenta lineas', guion: "awk 'END {print NR}' notas.txt", archivos: ARBOL },
    { nombre: 'awk separador de campos', guion: "awk '{print NF}' notas.txt", archivos: ARBOL },
    { nombre: 'awk printf', guion: "awk -F, '{printf \"%s=%s\\n\", $1, $2}' prueba/empleados.csv", archivos: ARBOL },
    { nombre: 'find por nombre', guion: 'find prueba -name "*.txt" -type f', archivos: ARBOL },
    { nombre: 'find por tipo', guion: 'find prueba -type d', archivos: ARBOL },

    // --- shell ---
    { nombre: 'variables', guion: 'x=5; echo $x' },
    { nombre: 'variables concatenadas', guion: 'a=uno; b=dos; echo $a$b' },
    { nombre: 'entorno exportado', guion: 'export VAR=5; echo $VAR' },
    { nombre: 'aritmetica', guion: 'echo $((2+3)) $((10/3)) $((2**8)) $((7%3))' },
    { nombre: 'aritmetica con variable', guion: 'n=7; echo $((n*3))' },
    { nombre: 'comparacion en if', guion: 'if [ 3 -gt 2 ]; then echo mayor; else echo menor; fi' },
    { nombre: 'test -f', guion: 'if [ -f notas.txt ]; then echo existe; fi', archivos: ARBOL },
    { nombre: 'test -d', guion: 'if [ -d prueba ]; then echo dir; fi', archivos: ARBOL },
    { nombre: 'for con glob', guion: 'for f in prueba/*.txt; do echo $f; done', archivos: ARBOL },
    { nombre: 'for con palabras', guion: 'for i in 1 2 3; do echo -n "$i"; done; echo' },
    { nombre: 'while con read', guion: 'while read -r l; do echo "<$l>"; done < notas.txt', archivos: ARBOL },
    { nombre: 'until', guion: 'i=0; until [ $i -ge 3 ]; do i=$((i+1)); done; echo $i' },
    { nombre: 'case', guion: 'a=hola; case $a in h*) echo h;; *) echo otro;; esac' },
    { nombre: 'funcion', guion: 'saludo() { echo "hola $1"; }; saludo mundo' },
    { nombre: 'funcion con return', guion: 'doble() { echo $(( $1 * 2 )); return 0; }; doble 21' },
    { nombre: 'subshell', guion: 'x=1; (x=2); echo $x' },
    { nombre: 'sustitucion de orden', guion: 'echo $(echo anidado | tr a-z A-Z)' },
    { nombre: 'redireccion de escritura', guion: 'echo fuera > salida.txt; cat salida.txt', archivos: ARBOL },
    { nombre: 'redireccion de anadido', guion: 'echo a > s.txt; echo b >> s.txt; cat s.txt', archivos: ARBOL },
    { nombre: 'here-doc', guion: 'cat <<FIN\nlinea1\nlinea2\nFIN' },
    { nombre: 'tuberia con codigo', guion: 'grep -q ERROR var/log/app.log && echo hay error', archivos: ARBOL },
    { nombre: 'pipeline de siete etapas', guion: 'cat var/log/app.log | grep -v arranque | awk \'{print $3}\' | sort | uniq -c | sort -rn | head -n 1', archivos: ARBOL },
    { nombre: 'cd y pwd', guion: 'cd prueba && ls && cd .. && ls prueba' },
    { nombre: 'mkdir y ls', guion: 'mkdir -p uno/dos/tres && ls uno/dos', ignorar: ['code'] },

    // --- errores: el texto importa, el codigo tambien ---
    { nombre: 'comando inexistente', guion: 'ordeninventada' },
    { nombre: 'fichero inexistente', guion: 'cat noexiste.txt' },
    { nombre: 'grep sin permiso', guion: 'cat prueba/permisos.txt', archivos: { ...ARBOL, 'prueba/permisos.txt': 'x' }, ignorar: ['code'] }
];
