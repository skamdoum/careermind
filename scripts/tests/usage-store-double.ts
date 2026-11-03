/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase RPC boundary double for pre-existing route regression suites. Actual guard SQL is tested separately. */
import { randomUUID } from "node:crypto";
export function usageStoreDouble(getClient: () => any) {
    const operations = new Map<string, any>();
    return { usageRPC: async (name: string, args: any) => {
            if (name === 'ai_usage_claim') {
                const op = { id: randomUUID(), owner: randomUUID(), steps: {} };
                operations.set(op.id, op);
                return { operation: op };
            }
            const op = operations.get(args.p_id);
            if (!op)
                throw Error('Unknown fixture operation');
            if (name === 'ai_usage_step') {
                if (args.p_action === 'begin')
                    return true;
                op.steps[args.p_key] = args.p_value;
                return args.p_value;
            }
            if (name === 'ai_usage_end')
                return null;
            if (name !== 'ai_usage_persist')
                throw Error('Unexpected usage RPC');
            const data = args.p_data, client = getClient();
            const insert = async (table: string, row: any) => { const r = await client.from(table).insert(row).select().single(); if (r.error)
                throw Error('fixture persistence failure'); return r.data; };
            switch (args.p_kind) {
                case 'analysis': {
                    const a = await insert('analyses', data.analysis);
                    const p = await insert('plans', data.plan);
                    for (const [key, table] of [['signals', 'signal_assessments'], ['gaps', 'gaps'], ['tasks', 'plan_tasks']])
                        if (data[key].length)
                            await insert(table, data[key]);
                    return { analysisId: a.id, planId: p.id, result: data.result };
                }
                case 'investigation': return insert('gap_investigations', data);
                case 'user_turn':
                case 'assistant_turn': return insert('gap_investigation_turns', data);
                case 'evidence': return insert('gap_investigation_evidence', data);
                case 'investigation_update': {
                    const r = await client.from('gap_investigations').update(data).eq('id', data.id);
                    if (r.error)
                        throw Error('fixture update failure');
                    return true;
                }
                default: throw Error('Unexpected persistence fixture');
            }
        } };
}
