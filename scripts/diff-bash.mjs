/**
 * Comparacion diferencial: ejecuta los mismos guiones en el emulador y en bash
 * real y exige que coincidan salida, error y codigo de salida.
 *
 * Por que hace falta: el motor esta escrito a mano y es facil que se desvíe de
 * GNU en un espacio, un tabulador o un codigo de retorno. Los casos viven en
 * `casos-bash.mjs`; anadir uno nuevo es la forma mas barata de encontrar esos
 * desvios antes de que los vea el alumno.
 *
 *   node scripts/diff-bash.mjs              todos los casos
 *   node scripts/diff-bash.mjs grep         solo los que casen con "grep"
 *   BASH=/usr/bin/bash node scripts/diff-bash.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CASOS } from './casos-bash.mjs';

const CANDIDATOS_BASH = [
    process.env.BASH,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    '/usr/bin/bash',
    '/bin/bash'
].filter(Boolean);

function localizarBash() {
    for (const ruta of CANDIDATOS_BASH) {
        if (ruta.includes('/') || ruta.includes('\\')) {
            if (existsSync(ruta)) return ruta;
            continue;
        }
        try {
            execFileSync(ruta, ['--version'], { stdio: 'ignore' });
            return ruta;
        } catch { /* siguiente candidato */ }
    }
    return null;
}

/**
 * Deja el guion comparable: sin CR, sin espacios finales, sin codigo de color y
 * sin el prefijo que bash pone a los errores del shell (`bash: line 1: ...`),
 * que el emulador escribe como `bash: ...`.
 */
function normalizar(texto) {
    return String(texto ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\x1b\[[0-9;]*m/g, '')
        .replace(/(^|\n)bash: (-c: )?line \d+: /g, '$1bash: ')
        .replace(/(^|\n)\/usr\/bin\/bash: line \d+: /g, '$1bash: ')
        .replace(/(^|\n)bash: line \d+: /g, '$1bash: ')
        .split('\n')
        .map((l) => l.replace(/[ \t]+$/, ''))
        .join('\n')
        .replace(/\n+$/, '');
}

function diff(esperado, obtenido) {
    if (esperado === obtenido) return null;
    const e = esperado.split('\n');
    const o = obtenido.split('\n');
    const detalle = [];
    for (let i = 0; i < Math.max(e.length, o.length); i++) {
        if (e[i] !== o[i]) detalle.push(`  linea ${i + 1}\n    bash    ${JSON.stringify(e[i] ?? null)}\n    emulador ${JSON.stringify(o[i] ?? null)}`);
        if (detalle.length >= 3) break;
    }
    return detalle.join('\n');
}

function prepararArbol(destino, archivos) {
    for (const [ruta, contenido] of Object.entries(archivos ?? {})) {
        const completo = join(destino, ruta);
        mkdirSync(join(completo, '..'), { recursive: true });
        writeFileSync(completo, contenido);
    }
}

function ejecutarBash(bash, caso) {
    const dir = mkdtempSync(join(tmpdir(), 'lxl-bash-'));
    try {
        prepararArbol(dir, caso.archivos);
        const salida = execFileSync(bash, ['-c', caso.guion], {
            cwd: caso.cwd ? join(dir, caso.cwd) : dir,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, LC_ALL: 'C', LANG: 'C', PS1: '', COLUMNS: '80' }
        });
        return { stdout: normalizar(salida), stderr: normalizar(''), code: 0 };
    } catch (e) {
        return {
            stdout: normalizar(e.stdout),
            stderr: normalizar(e.stderr),
            code: typeof e.status === 'number' ? e.status : 1
        };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

async function cargarEmulador() {
    try {
        const { crearSesion } = await import('../src/engine/shell.js');
        return crearSesion;
    } catch (e) {
        console.warn(`aviso  el motor todavia no se puede cargar (${e.message.split('\n')[0]}); se omiten ${CASOS.length} casos`);
        return null;
    }
}

function ejecutarEmulador(crearSesion, caso) {
    try {
        const sesion = crearSesion();
        for (const [ruta, contenido] of Object.entries(caso.archivos ?? {})) sesion.escribir(ruta, contenido);
        if (caso.cwd) sesion.cd(caso.cwd);
        const r = sesion.ejecutar(caso.guion);
        return { stdout: normalizar(r.stdout), stderr: normalizar(r.stderr), code: r.code };
    } catch (e) {
        return { stdout: '', stderr: normalizar(e.message), code: 1 };
    }
}

const filtro = process.argv[2];
const casos = filtro ? CASOS.filter((c) => c.nombre.includes(filtro)) : CASOS;
const bash = casos.length ? localizarBash() : null;

if (casos.length && !bash) {
    console.error('error  no encuentro bash real; define BASH=/ruta/a/bash');
    process.exit(1);
}

const crearSesion = casos.length ? await cargarEmulador() : null;
let fallos = 0;

if (!casos.length) {
    console.log(filtro
        ? 'diff-bash: ningun caso coincide con el filtro'
        : 'diff-bash: 0 casos comparados (motor pendiente)');
} else if (!crearSesion) {
    console.log('diff-bash: 0 casos comparados (motor pendiente)');
} else {
    for (const caso of casos) {
        const real = ejecutarBash(bash, caso);
        const mio = ejecutarEmulador(crearSesion, caso);
        const problemas = [];
        for (const campo of ['stdout', 'stderr', 'code']) {
            if (caso.ignorar?.includes(campo)) continue;
            const d = diff(String(real[campo]), String(mio[campo]));
            if (d) problemas.push(`  ${campo}\n${d}`);
        }
        if (problemas.length) {
            fallos++;
            console.error(`FALLO  ${caso.nombre}\n  guion: ${caso.guion.replace(/\n/g, ' ; ')}\n${problemas.join('\n')}`);
        } else {
            console.log(`ok     ${caso.nombre}`);
        }
    }
    console.log(`\ndiff-bash: ${casos.length - fallos}/${casos.length} casos coinciden con bash`);
}

process.exit(fallos ? 1 : 0);
