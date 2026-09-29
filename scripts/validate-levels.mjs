/**
 * Comprueba que src/levels.js esta bien formado antes de publicar.
 *
 * No ejecuta el shell: valida la forma del contenido y que cada mision use
 * comandos que existen en el registro. Los errores se listan todos juntos
 * para no tener que corregirlos de uno en uno.
 */

import {NIVELES, MODOS, DIFICULTADES, COMANDOS } from '../src/levels.js';
import { comandosRegistrados } from '../src/engine/registry.js';

const errores = [];
const avisos = [];

const problema = (id, msg) => errores.push(`mision ${id}: ${msg}`);
const aviso = (id, msg) => avisos.push(`mision ${id}: ${msg}`);

const registrados = comandosRegistrados();

if (!Array.isArray(NIVELES) || NIVELES.length === 0) {
    console.error('levels.js no exporta ningun nivel');
    process.exit(1);
}

const vistos = new Set();

for (const nivel of NIVELES) {
    const id = nivel?.id ?? '(sin id)';
    if (typeof nivel?.id !== 'number') problema(id, 'falta id numerico');
    if (vistos.has(nivel?.id)) problema(id, 'id duplicado');
    vistos.add(nivel?.id);
    if (typeof nivel?.titulo !== 'string' || !nivel.titulo.trim()) problema(id, 'falta titulo');
    if (!MODOS.includes(nivel?.modo)) problema(id, `modo desconocido: ${nivel?.modo}`);
    if (!DIFICULTADES.includes(nivel?.dificultad)) problema(id, `dificultad desconocida: ${nivel?.dificultad}`);
    if (typeof nivel?.brief !== 'string' || nivel.brief.length < 40) problema(id, 'falta un brief util');
    if (!Array.isArray(nivel?.objetivos) || !nivel.objetivos.length) problema(id, 'sin objetivos');
    if (!Array.isArray(nivel?.pistas) || !nivel.pistas.length) aviso(id, 'sin pistas');
    if (!Array.isArray(nivel?.soluciones) || !nivel.soluciones.length) problema(id, 'sin soluciones de referencia');
    if (typeof nivel?.salidaEsperada !== 'string' && !Array.isArray(nivel?.comprobaciones)) {
        problema(id, 'necesita salidaEsperada o comprobaciones');
    }

    for (const cmd of nivel?.comandos ?? []) {
        if (!registrados.has(cmd)) problema(id, `comando desconocido: ${cmd}`);
        if (!COMANDOS.includes(cmd)) aviso(id, `comando fuera de la lista COMANDOS: ${cmd}`);
    }

    for (const sol of nivel?.soluciones ?? []) {
        if (typeof sol !== 'string' || !sol.trim()) problema(id, 'solucion vacia');
    }
}

for (const [i, nivel] of NIVELES.entries()) {
    if (nivel.id !== i + 1) problema(nivel.id, `deberia ser el id ${i + 1} para no dejar huecos`);
}

const porModo = {};
const porDificultad = {};
for (const n of NIVELES) {
    porModo[n.modo] = (porModo[n.modo] || 0) + 1;
    porDificultad[n.dificultad] = (porDificultad[n.dificultad] || 0) + 1;
}

if (NIVELES.length !== 32) errores.push(`se esperaban 32 misiones y hay ${NIVELES.length}`);

for (const m of avisos) console.warn(`aviso  ${m}`);
if (errores.length) {
    for (const e of errores) console.error(`error  ${e}`);
    console.error(`\nvalidate-levels: ${errores.length} error(es)`);
    process.exit(1);
}

console.log('validate-levels: 32 misiones correctas');
console.log('  modos      ', JSON.stringify(porModo));
console.log('  dificultad ', JSON.stringify(porDificultad));
console.log('  comandos   ', registrados.size, 'registrados');
