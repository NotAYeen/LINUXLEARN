import { describe, it, expect } from 'vitest';
import { NIVELES, MODOS, DIFICULTADES, COMANDOS, misionPorId } from '../src/levels.js';

describe('Misiones LinuxLearn', () => {
    it('hay 32 misiones con ids unicos y consecutivos', () => {
        expect(NIVELES).toHaveLength(32);
        const ids = NIVELES.map((n) => n.id);
        expect(new Set(ids).size).toBe(32);
        NIVELES.forEach((n, i) => expect(n.id).toBe(i + 1));
    });

    it('todas llevan titulo, modo, dificultad, brief, objetivos y pistas', () => {
        for (const n of NIVELES) {
            expect(n.titulo, `mision ${n.id}`).toBeTruthy();
            expect(MODOS).toContain(n.modo);
            expect(DIFICULTADES).toContain(n.dificultad);
            expect(n.brief.length, `mision ${n.id}: brief demasiado corto`).toBeGreaterThanOrEqual(40);
            expect(n.objetivos.length).toBeGreaterThan(0);
            expect(n.pistas.length).toBeGreaterThan(0);
            expect(Array.isArray(n.comandos)).toBe(true);
        }
    });

    it('cada mision tiene solucion de referencia y contrato', () => {
        for (const n of NIVELES) {
            expect(n.soluciones.length, `mision ${n.id}`).toBeGreaterThan(0);
            for (const s of n.soluciones) expect(s.trim().length).toBeGreaterThan(0);
            const tieneContrato = typeof n.salidaEsperada === 'string'
                || (Array.isArray(n.comprobaciones) && n.comprobaciones.length > 0);
            expect(tieneContrato, `mision ${n.id}: sin salidaEsperada ni comprobaciones`).toBe(true);
        }
    });

    it('las comprobaciones usan claves conocidas', () => {
        const claves = new Set(['exit_code', 'stderr_contains', 'output_contains', 'fs']);
        const campos = new Set(['path', 'exists', 'absent', 'content', 'lines', 'mode', 'target']);
        for (const n of NIVELES) {
            for (const c of n.comprobaciones ?? []) {
                const ks = Object.keys(c);
                expect(ks.length).toBeGreaterThan(0);
                for (const k of ks) expect(claves, `mision ${n.id}: ${k}`).toContain(k);
                if (c.fs) for (const k of Object.keys(c.fs)) {
                    expect(campos, `mision ${n.id}: fs.${k}`).toContain(k);
                }
            }
        }
    });

    it('las modalidades especiales traen sus campos', () => {
        const dep = NIVELES.filter((n) => n.modo === 'Depuracion');
        expect(dep.length).toBeGreaterThanOrEqual(2);
        for (const n of dep) {
            expect(n.fallo?.comando, `mision ${n.id}`).toBeTruthy();
            expect(n.fallo?.comando).not.toBe(n.soluciones[0]);
            expect(n.fallo?.salida).toBeTruthy();
        }

        const aud = NIVELES.filter((n) => n.modo === 'Auditoria');
        expect(aud.length).toBeGreaterThanOrEqual(2);
        for (const n of aud) {
            expect(n.auditoria?.tokens.length, `mision ${n.id}`).toBeGreaterThanOrEqual(3);
            expect(n.auditoria.indice_error).toBeGreaterThanOrEqual(0);
            expect(n.auditoria.indice_error).toBeLessThan(n.auditoria.tokens.length);
        }

        const ens = NIVELES.filter((n) => n.modo === 'Ensamblaje');
        expect(ens.length).toBeGreaterThanOrEqual(1);
        for (const n of ens) {
            expect(n.bloques.length, `mision ${n.id}`).toBe(7);
            expect(n.bloques.join(' | ')).toBe(n.soluciones[0]);
        }
    });

    it('el reparto de modalidades y dificultades es el previsto', () => {
        const porModo = {};
        for (const n of NIVELES) porModo[n.modo] = (porModo[n.modo] || 0) + 1;
        expect(porModo.Terminal).toBeGreaterThanOrEqual(24);
        expect(porModo.Depuracion).toBeGreaterThanOrEqual(2);
        expect(porModo.Auditoria).toBeGreaterThanOrEqual(2);
        expect(porModo.Ensamblaje).toBeGreaterThanOrEqual(1);

        const porDif = {};
        for (const n of NIVELES) porDif[n.dificultad] = (porDif[n.dificultad] || 0) + 1;
        for (const d of DIFICULTADES) expect(porDif[d]).toBeGreaterThan(0);
    });

    it('los comandos anunciados estan en la lista COMANDOS', () => {
        expect(COMANDOS.length).toBeGreaterThan(0);
        expect(new Set(COMANDOS).size).toBe(COMANDOS.length);
        expect(COMANDOS).toContain('grep');
        expect(COMANDOS).toContain('awk');
    });

    it('misionPorId recupera la mision', () => {
        expect(misionPorId(1).titulo).toBeTruthy();
        expect(misionPorId(32).modo).toBe('Ensamblaje');
        expect(misionPorId(99)).toBeNull();
    });
});
