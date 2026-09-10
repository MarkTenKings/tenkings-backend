import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { WORKSPACE_GRANTS, WORKSPACE_FUNCTIONS, workspaceGrantSQL, assertWorkspacePrivileges } from '../src/workspace-privileges.mjs';

function catalog(kind = 'SOURCE') {
    const grants = WORKSPACE_GRANTS[kind], columns = [];
    for (const [schema, relative] of [['atlas_staff', '../../../frontend/atlas-app/prisma/schema.prisma'], ['public', '../../database/prisma/schema.prisma']]) {
        const text = readFileSync(new URL(relative, import.meta.url), 'utf8');
        const models = new Map([...text.matchAll(/^model\s+(\w+)\s*\{(.*?)^\}/gms)].map(match => [match[1], match[2]]));
        for (const [name, body] of models) for (const line of body.split('\n')) {
            const field = /^\s+(\w+)\s+(\w+)/.exec(line);
            if (!field || models.has(field[2])) continue;
            const column = field[1], grant = grants[schema]?.[name];
            columns.push({ schema, name, column, sel: grant?.SELECT?.includes(column) === true,
                ins: grant?.INSERT?.includes(column) === true, upd: grant?.UPDATE?.includes(column) === true,
                refs: false, extra: false, grants: false });
        }
    }
    const state = { unsafe: false, columns, schemas: ['atlas_staff', 'public'].map(name => ({ name, creates: false, uses: true, grants: false })),
        sequences: [], functions: WORKSPACE_FUNCTIONS[kind].map(name => ({ schema: 'atlas_staff', name, definer: true, grants: false })) };
    const tx = { async $queryRaw(strings) {
        const query = strings.join('?');
        if (query.includes('FROM pg_roles r WHERE r.rolname=current_user')) return [{ unsafe: state.unsafe }];
        if (query.includes('FROM pg_namespace n WHERE')) return state.schemas;
        if (query.includes('JOIN pg_attribute a')) return state.columns;
        if (query.includes('WITH sequences AS MATERIALIZED')) return state.sequences;
        if (query.includes('FROM pg_proc p')) return state.functions;
        throw Error(`Unexpected privilege query: ${query}`);
    } };
    return { state, tx, column: (table, name) => columns.find(row => row.name === table && row.column === name) };
}

test('private role grants reject SQL injection and cannot combine source authority with coordinator mutations', () => {
    for (const role of ['root; GRANT ALL', '"owner"', 'ROOT', '', 'a'.repeat(64)])
        assert.throws(() => workspaceGrantSQL(role), /WORKSPACE_DATABASE_ROLE_INVALID/);
    assert.throws(() => workspaceGrantSQL('safe_role', 'ALL'), /WORKSPACE_DATABASE_ROLE_INVALID/);
    const source = workspaceGrantSQL('source_role'), coordinator = workspaceGrantSQL('coordinator_role', 'COORDINATOR');
    assert(!/GRANT ALL|GRANT DELETE|GRANT TRUNCATE|GRANT CREATE|WITH GRANT OPTION/.test(source + coordinator));
    assert.match(source, /GRANT SELECT \("id","source","sourceSessionId","certificateSequence","createdAt"\) ON public\."HumanGradeLabel"/);
    assert(!/UPDATE[^\n]*"(actualMicroUsd|costEvidenceHash|publicReportSlug|nfcDone)"/.test(source));
    assert.equal(WORKSPACE_GRANTS.SOURCE.atlas_staff.StaffWorkspaceCard.UPDATE, undefined);
    assert.equal(WORKSPACE_GRANTS.SOURCE.atlas_staff.StaffOperatorRun.INSERT, undefined);
    assert.equal(WORKSPACE_GRANTS.COORDINATOR.public, undefined);
    assert(Object.isFrozen(WORKSPACE_GRANTS.SOURCE.public.HumanGradeLabel.SELECT));
});

test('the exact source and coordinator effective catalogs pass with required current memory catch-up rights', async () => {
    for (const kind of ['SOURCE', 'COORDINATOR']) await assertWorkspacePrivileges(catalog(kind).tx, kind);
});

test('extra effective writes, certificate reads, invoice settlement and missing memory rights fail closed', async () => {
    for (const [table, column, permission, value] of [
        ['StaffControl', 'enabled', 'upd', true], ['StaffIdentity', 'role', 'upd', true], ['StaffSession', 'revokedAt', 'upd', true],
        ['StaffGradingExecution', 'actualMicroUsd', 'upd', true], ['StaffWorkspaceSourceOperation', 'costEvidenceHash', 'upd', true],
        ['AiGraderV2Session', 'publicReportSlug', 'upd', true], ['AiGraderV2CardTypeMap', 'currentRevisionId', 'upd', true],
        ['HumanGradeLabel', 'certificateNumber', 'sel', true], ['HumanGradeLabel', 'sourceSessionId', 'upd', true],
        ['StaffWorkspaceCard', 'revision', 'upd', true], ['AiGraderV2LearningBank', 'state', 'upd', false],
    ]) {
        const f = catalog(); f.column(table, column)[permission] = value;
        await assert.rejects(() => assertWorkspacePrivileges(f.tx), /WORKSPACE_DATABASE_ROLE_INVALID/, `${table}.${column}`);
    }
});

test('ownership, ambient schemas, missing columns, grant options, sequences and extra definers are rejected', async () => {
    const mutations = [f => { f.state.unsafe = true; }, f => { f.state.schemas[0].creates = true; },
        f => { f.state.schemas.push({ name: 'unrelated', uses: true, creates: false, grants: false }); },
        f => { f.column('StaffWorkspaceCard', 'canonical').grants = true; },
        f => { f.column('StaffWorkspaceCard', 'canonical').extra = true; },
        f => { f.state.columns = f.state.columns.filter(row => row.name !== 'StaffWorkspaceCard' || row.column !== 'canonical'); },
        f => { f.state.sequences.push({ oid: 100 }); }, f => { f.state.functions.pop(); },
        f => { f.state.functions[0].grants = true; }, f => { f.state.functions[0].definer = false; },
        f => { f.state.functions.push({ schema: 'public', name: 'unreviewed_authority()', definer: true, grants: false }); }];
    for (const mutate of mutations) { const f = catalog(); mutate(f);
        await assert.rejects(() => assertWorkspacePrivileges(f.tx), /WORKSPACE_DATABASE_ROLE_INVALID/); }
});
