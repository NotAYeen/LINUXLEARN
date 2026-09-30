import { describe, it, expect } from 'vitest';
import { crearSesion } from '../src/engine/shell.js';
import { evaluar } from '../src/engine/arith.js';

/** Ejecuta un guion en una sesion nueva y devuelve `{ stdout, code }`. */
function correr(guion) {
    const sesion = crearSesion();
    const r = sesion.ejecutar(guion);
    return { ...r, sesion };
}

describe('shell: ordenes simples y tuberias', () => {
    it('devuelve la salida esperada', () => {
        expect(correr('echo hola').stdout).toBe('hola\n');
        expect(correr('echo -n sin').stdout).toBe('sin');
        expect(correr('pwd').stdout).toBe('/home/agente\n');
        expect(correr('cat proyecto/notas.txt').stdout).toContain('TODO: revisar');
        expect(correr('cat proyecto/notas.txt | wc -l').stdout).toBe('4\n');
    });

    it('respeta el orden de las tuberias', () => {
        expect(correr('cat /var/log/app.log | awk \'{print $3}\' | sort | uniq -c | sort -rn | head -n 1').stdout)
            .toBe('      5 INFO\n');
        expect(correr('cat proyecto/datos/empleados.csv | cut -d, -f1 | head -n 2').stdout)
            .toBe('nombre\nAna\n');
    });

    it('devuelve codigos de salida como bash', () => {
        expect(correr('true').code).toBe(0);
        expect(correr('false').code).toBe(1);
        expect(correr('grep -q ERROR /var/log/app.log').code).toBe(0);
        expect(correr('grep -q ZZZZ /var/log/app.log').code).toBe(1);
        expect(correr('ordeninventada').code).toBe(127);
        expect(correr('cat /noexiste').code).toBe(1);
    });

    it('invierte cada linea con rev', () => {
        expect(correr('echo primera | rev').stdout).toBe('aremirp\n');
        expect(correr('rev proyecto/notas.txt | head -n 1').stdout)
            .toBe('orerbef ed emrofni le rasiver :ODOT\n');
    });

    it('tee escribe en el fichero y tambien por la salida', () => {
        // El caso de diff-bash de `tee` es una carrera (tee f | cat f), asi que
        // aqui se comprueba por separado que tee escribe de verdad.
        const sesion = crearSesion();
        expect(sesion.ejecutar('echo secreto | tee /tmp/tee-check.txt').stdout).toBe('secreto\n');
        expect(sesion.ejecutar('cat /tmp/tee-check.txt').stdout).toBe('secreto\n');
    });

    it('los operadores && y || cortocircuitan', () => {
        expect(correr('true && echo si').stdout).toBe('si\n');
        expect(correr('false && echo si').stdout).toBe('');
        expect(correr('false || echo no').stdout).toBe('no\n');
        expect(correr('true || echo no').stdout).toBe('');
        expect(correr('false; echo siempre').stdout).toBe('siempre\n');
    });
});

describe('shell: variables, sustituciones y aritmetica', () => {
    it('guarda el estado entre llamadas', () => {
        const sesion = crearSesion();
        sesion.ejecutar('x=5');
        expect(sesion.ejecutar('echo $x').stdout).toBe('5\n');
        sesion.ejecutar('x=$((x*2))');
        expect(sesion.ejecutar('echo $x').stdout).toBe('10\n');
    });

    it('sustituye salidas de comandos', () => {
        expect(correr('n=$(grep -c TODO proyecto/notas.txt); echo "Quedan $n tareas"').stdout)
            .toBe('Quedan 3 tareas\n');
        expect(correr('echo $(basename /a/b.txt)').stdout).toBe('b.txt\n');
        expect(correr('d=$(dirname /a/b/c.txt); echo $d').stdout).toBe('/a/b\n');
    });

    it('hace aritmetica de bash', () => {
        expect(correr('echo $((2+3)) $((10/3)) $((2**10)) $((7%3))').stdout).toBe('5 3 1024 1\n');
        expect(correr('n=7; echo $((n*3))').stdout).toBe('21\n');
        expect(correr('echo $((1<2)) $((3>4))').stdout).toBe('1 0\n');
        expect(correr('echo $((1/0))').code).toBe(1);
    });

    it('el evaluador coincide con bash en operadores', () => {
        const v = { n: '7' };
        const g = (k) => v[k];
        expect(evaluar('2+3', g)).toBe(5);
        expect(evaluar('n*3', g)).toBe(21);
        expect(evaluar('7|8', g)).toBe(15);
        expect(evaluar('~5', g)).toBe(-6);
        expect(evaluar('1&&0', g)).toBe(0);
        expect(evaluar('1||0', g)).toBe(1);
        expect(evaluar('0||3', g)).toBe(1);
        expect(evaluar('0&&3', g)).toBe(0);
        expect(evaluar('0x10', g)).toBe(16);
        expect(evaluar('1+2,3*4', g)).toBe(12);
        expect(evaluar('-5/2', g)).toBe(-2);
    });
});

describe('shell: control de flujo', () => {
    it('ejecuta if/else', () => {
        expect(correr('if [ -f /etc/passwd ]; then echo existe; else echo falta; fi').stdout).toBe('existe\n');
        expect(correr('if [ -f /nada ]; then echo existe; else echo falta; fi').stdout).toBe('falta\n');
        expect(correr('if [ 3 -gt 2 ]; then echo mayor; fi').stdout).toBe('mayor\n');
    });

    it('itera con for y while', () => {
        expect(correr('for i in 1 2 3; do echo -n "$i "; done; echo').stdout).toBe('1 2 3 \n');
        expect(correr('i=0; while [ $i -lt 3 ]; do i=$((i+1)); done; echo $i').stdout).toBe('3\n');
        expect(correr('i=0; until [ $i -ge 2 ]; do i=$((i+1)); done; echo $i').stdout).toBe('2\n');
        expect(correr('n=0; for f in proyecto/datos/*.txt; do n=$((n+1)); done; echo $n').stdout).toBe('8\n');
    });

    it('selecciona con case', () => {
        expect(correr('a=3; case $a in 1|2) echo bajo;; 3|4) echo medio;; esac').stdout).toBe('medio\n');
        expect(correr('x=hola; case $x in h*) echo empieza;; *) echo otro;; esac').stdout).toBe('empieza\n');
    });

    it('define y llama funciones con local', () => {
        expect(correr('salir() { echo "adios $1"; }; salir mundo').stdout).toBe('adios mundo\n');
        expect(correr('f() { local x=5; echo $((x*2)); }; f; echo "[$x]"').stdout).toBe('10\n[]\n');
    });

    it('lee con read en un bucle', () => {
        expect(correr('while read -r l; do echo "[$l]"; done < proyecto/notas.txt | head -n 1').stdout)
            .toBe('[TODO: revisar el informe de febrero]\n');
    });
});

describe('shell: redirecciones', () => {
    it('escribe y anade a ficheros', () => {
        const r = correr('echo uno > /tmp/a.txt; echo dos >> /tmp/a.txt; cat /tmp/a.txt');
        expect(r.stdout).toBe('uno\ndos\n');
    });

    it('admite here-docs', () => {
        expect(correr('cat <<FIN\nhola\nmundo\nFIN').stdout).toBe('hola\nmundo\n');
        expect(correr('cat <<-FIN\n\tsangrado\n\tFIN').stdout).toBe('sangrado\n');
    });

    it('redirige la salida de error', () => {
        const r = correr('ls /noexiste 2>/dev/null; echo fin');
        expect(r.stdout).toBe('fin\n');
        expect(r.stderr).toBe('');
    });
});

describe('shell: casos de las misiones', () => {
    it('resuelve las 32 soluciones sin errores internos', () => {
        const guiones = [
            'pwd',
            'ls',
            'cat ~/proyecto/notas.txt',
            'cd /var/log && pwd',
            'grep -c ERROR /var/log/app.log',
            'head -n 3 /var/log/app.log',
            'wc -l ~/proyecto/notas.txt',
            'grep TODO ~/proyecto/notas.txt',
            'sort ~/proyecto/datos/empleados.csv',
            'cat ~/proyecto/datos/inventario.txt | wc -l',
            'sort ~/proyecto/datos/accesos.txt | uniq -c',
            'cut -d, -f1 ~/proyecto/datos/empleados.csv',
            "awk -F, '{print $1}' ~/proyecto/datos/empleados.csv",
            'find ~/proyecto/scripts -name "*.sh"',
            "sed -n '/ERROR/p' /var/log/app.log",
            "tr '[:lower:]' '[:upper:]' < ~/proyecto/datos/actividades.txt",
            'cut -d, -f1,3 ~/proyecto/datos/empleados.csv',
            "awk -F, '{print $3}' ~/proyecto/datos/empleados.csv"
        ];
        for (const guion of guiones) {
            const r = correr(guion);
            expect(r.stderr, guion).not.toMatch(/is not defined|not a function|Maximum call stack/);
        }
    });
});

describe('shell: protecciones', () => {
    it('corta los bucles infinitos con un presupuesto', () => {
        const r = correr('while true; do echo x; done');
        expect(r.code).toBe(1);
        expect(r.stderr).toMatch(/bucle infinito/);
    });

    it('set -e detiene el guion', () => {
        const r = correr('set -e; false; echo nunca');
        expect(r.stdout).not.toMatch(/nunca/);
    });

    it('el estado no se filtra entre sesiones', () => {
        const a = crearSesion();
        a.ejecutar('secreto=42');
        const b = crearSesion();
        expect(b.ejecutar('echo [$secreto]').stdout).toBe('[]\n');
    });
});
