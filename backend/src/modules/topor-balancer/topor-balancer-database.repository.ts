import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';

import type {
    ToporBalancerConfig,
    ToporBalancerAdminGroup,
    ToporBalancerAdminNode,
    ToporBalancerAdminRequest,
    ToporBalancerDbAssignment,
    ToporBalancerDbGroup,
    ToporBalancerDbNode,
    ToporBalancerGroupSquadScope,
    ToporBalancerGroupStrategy,
    ToporBalancerLocation,
    ToporBalancerNode,
    ToporBalancerNodeStatus,
    ToporRemnawaveTopologyHost,
    ToporRemnawaveTopologyInbound,
    ToporRemnawaveTopologyNode,
    ToporRemnawaveTopologySnapshot,
    ToporRemnawaveTopologySquad,
} from './types';

interface PgQueryResult<T> {
    rows: T[];
}

interface PgQueryable {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<PgQueryResult<T>>;
}

interface PgClient extends PgQueryable {
    release(): void;
}

interface PgPool extends PgQueryable {
    connect(): Promise<PgClient>;
    end(): Promise<void>;
}

interface PgPoolConstructor {
    new (options: { connectionString: string }): PgPool;
}

interface PgModule {
    Pool: PgPoolConstructor;
}

export interface ToporBalancerAssignmentSelectionInput {
    shortUuid: string;
    location: ToporBalancerLocation;
    candidateTechnicalHostNames: string[];
}

export interface ToporBalancerRequestLogInput {
    groupCandidateDiagnostics?: unknown[];
    shortUuid: string;
    userAgent?: string;
    responseFormat: string;
    inputLinksCount: number;
    matchedTechnicalLinks?: number;
    outputLinksCount: number;
    rewrittenLinksCount?: number;
    selectedNodes?: Record<string, string>;
    status?: string;
    errorMessage?: string;
    warnings?: string[];
}

export interface ToporBalancerAssignmentFilters {
    shortUuid?: string;
    publicHostCode?: string;
    planCode?: string;
    nodeId?: string;
}

export interface ToporBalancerGroupAssignmentFilters {
    publicHostCode: string;
    planCode: string;
}

export interface ToporBalancerRequestFilters {
    shortUuid?: string;
}

export interface ToporBalancerNodeUpdateInput {
    technicalHostName?: string;
    publicHostCode?: string;
    weight?: number;
    maxUsers?: number;
    status?: ToporBalancerNodeStatus;
    priority?: number;
    publicName?: string;
    locationCode?: string;
    planCode?: string;
}

export interface ToporBalancerNodeCreateInput {
    groupId?: string;
    technicalHostName: string;
    publicHostCode: string;
    publicName: string;
    locationCode?: string;
    planCode: string;
    weight: number;
    maxUsers: number;
    status: ToporBalancerNodeStatus;
    priority?: number;
}

export type ToporBalancerNodeDeleteResult = 'deleted' | 'has_assignments' | 'not_found';

export interface ToporBalancerGroupCreateInput {
    publicHostCode: string;
    publicName: string;
    locationCode?: string;
    planCode: string;
    strategy: ToporBalancerGroupStrategy;
    enabled: boolean;
    squadScope?: ToporBalancerGroupSquadScope;
    internalSquadUuid?: string;
}

export interface ToporBalancerGroupUpdateInput {
    publicHostCode?: string;
    publicName?: string;
    locationCode?: string;
    planCode?: string;
    strategy?: ToporBalancerGroupStrategy;
    enabled?: boolean;
    squadScope?: ToporBalancerGroupSquadScope;
    internalSquadUuid?: string;
}

export interface ToporBalancerGroupNodeCreateInput {
    technicalHostName: string;
    weight: number;
    maxUsers: number;
    status: ToporBalancerNodeStatus;
    priority?: number;
}

export type ToporBalancerGroupDeleteResult = 'deleted' | 'has_nodes' | 'not_found';

export interface ToporBalancerManualReassignInput {
    shortUuid: string;
    publicHostCode: string;
    planCode: string;
    technicalHostName: string;
}

export interface ToporBalancerAssignmentRepository {
    initializeSchema(): Promise<void>;
    upsertConfiguredNodes(config: ToporBalancerConfig): Promise<void>;
    getOrCreateAssignment(
        input: ToporBalancerAssignmentSelectionInput,
    ): Promise<ToporBalancerDbNode | null>;
    recordRequest(input: ToporBalancerRequestLogInput): Promise<void>;
    healthCheck(): Promise<boolean>;
    countNodes(): Promise<number>;
    countAssignments(): Promise<number>;
    countRequests(): Promise<number>;
    listGroupRecentDiagnostics(filters: ToporBalancerGroupAssignmentFilters): Promise<ToporBalancerAdminRequest[]>;
    listGroups(): Promise<ToporBalancerAdminGroup[]>;
    getGroup(id: string): Promise<ToporBalancerAdminGroup | null>;
    createGroup(input: ToporBalancerGroupCreateInput): Promise<ToporBalancerAdminGroup | null>;
    updateGroup(
        id: string,
        input: ToporBalancerGroupUpdateInput,
    ): Promise<ToporBalancerAdminGroup | null>;
    deleteGroup(id: string): Promise<ToporBalancerGroupDeleteResult>;
    listGroupNodes(groupId: string): Promise<ToporBalancerAdminNode[] | null>;
    createGroupNode(
        groupId: string,
        input: ToporBalancerGroupNodeCreateInput,
    ): Promise<ToporBalancerAdminNode | null>;
    updateGroupNode(
        groupId: string,
        nodeId: string,
        input: ToporBalancerNodeUpdateInput,
    ): Promise<ToporBalancerAdminNode | null>;
    deleteGroupNode(groupId: string, nodeId: string): Promise<ToporBalancerNodeDeleteResult>;
    listNodes(): Promise<ToporBalancerAdminNode[]>;
    createNode(input: ToporBalancerNodeCreateInput): Promise<ToporBalancerAdminNode | null>;
    updateNode(
        id: string,
        input: ToporBalancerNodeUpdateInput,
    ): Promise<ToporBalancerAdminNode | null>;
    deleteNode(id: string): Promise<ToporBalancerNodeDeleteResult>;
    listAssignments(filters: ToporBalancerAssignmentFilters): Promise<ToporBalancerDbAssignment[]>;
    listGroupAssignments(filters: ToporBalancerGroupAssignmentFilters): Promise<ToporBalancerDbAssignment[]>;
    resetGroupAssignments(filters: ToporBalancerGroupAssignmentFilters): Promise<number>;
    reassign(input: ToporBalancerManualReassignInput): Promise<ToporBalancerDbAssignment | null>;
    listRequests(filters: ToporBalancerRequestFilters): Promise<ToporBalancerAdminRequest[]>;
    replaceRemnawaveTopologyCache(input: ToporRemnawaveTopologySnapshot): Promise<void>;
    getRemnawaveTopologyCache(): Promise<ToporRemnawaveTopologySnapshot>;
    upsertImportedNodes(
        input: ToporBalancerNodeCreateInput[],
    ): Promise<{ created: ToporBalancerAdminNode[]; updated: ToporBalancerAdminNode[] }>;
    close(): Promise<void>;
}

interface DbNodeRow {
    id: string;
    group_id: string | null;
    technical_host_name: string;
    public_host_code: string;
    public_name: string;
    location_code: string | null;
    plan_code: string;
    weight: string | number;
    max_users: number;
    status: ToporBalancerNodeStatus;
    priority: number;
    created_at?: Date | string;
    updated_at?: Date | string;
}

interface DbGroupRow {
    id: string;
    public_host_code: string;
    public_name: string;
    location_code: string | null;
    plan_code: string;
    strategy: ToporBalancerGroupStrategy;
    enabled: boolean;
    squad_scope: ToporBalancerGroupSquadScope;
    internal_squad_uuid: string | null;
    created_at?: Date | string;
    updated_at?: Date | string;
}

interface DbAssignmentRow {
    id: string;
    short_uuid: string;
    public_host_code: string;
    plan_code: string;
    node_id: string;
    technical_host_name?: string;
    created_at?: Date | string;
    updated_at?: Date | string;
}

interface DbCountRow {
    count: string | number;
}

interface DbAdminNodeRow extends DbNodeRow {
    assigned_users: string | number;
}

interface DbAdminGroupRow extends DbGroupRow {
    active_nodes_count: string | number;
    assigned_users: string | number;
    nodes_count: string | number;
    nodes_count_source?: 'db_group_id';
}

interface DbTopologyHostRow {
    uuid: string;
    remark: string;
    address: string | null;
    inbound_uuid: string | null;
    node_uuid: string | null;
    node_name: string | null;
    profile_uuid: string | null;
    profile_name: string | null;
    inbound_name: string | null;
    accessible_squads: Array<{ name: string; uuid: string }> | string | null;
    updated_at?: Date | string;
}

interface DbTopologyNodeRow {
    uuid: string;
    name: string;
    address: string | null;
    status: string | null;
    updated_at?: Date | string;
}

interface DbTopologyInboundRow {
    uuid: string;
    name: string;
    profile_uuid: string | null;
    profile_name: string | null;
    updated_at?: Date | string;
}

interface DbTopologySquadRow {
    uuid: string;
    name: string;
    updated_at?: Date | string;
}

interface DbRequestRow {
    group_candidate_diagnostics: unknown[] | null;
    id: string;
    short_uuid: string;
    user_agent: string | null;
    response_format: string | null;
    input_links_count: number | null;
    matched_technical_links: number | null;
    output_links_count: number | null;
    rewritten_links_count: number | null;
    selected_nodes: Record<string, string> | null;
    status: string | null;
    error_message: string | null;
    created_at: Date | string;
    warnings: string[] | null;
}

export class ToporBalancerPostgresRepository implements ToporBalancerAssignmentRepository {
    private readonly pool: PgPool;

    constructor(databaseUrl: string) {
        const requireFromHere = createRequire(__filename);
        const pg = requireFromHere('pg') as PgModule;

        this.pool = new pg.Pool({
            connectionString: databaseUrl,
        });
    }

    public async initializeSchema(): Promise<void> {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS topor_balancer_groups (
                id UUID PRIMARY KEY,
                public_host_code TEXT NOT NULL,
                public_name TEXT NOT NULL,
                location_code TEXT,
                plan_code TEXT NOT NULL,
                strategy TEXT NOT NULL DEFAULT 'least_loaded',
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                squad_scope TEXT NOT NULL DEFAULT 'any_visible_to_user',
                internal_squad_uuid TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (public_host_code, plan_code)
            );

            CREATE TABLE IF NOT EXISTS topor_balancer_nodes (
                id UUID PRIMARY KEY,
                group_id UUID,
                technical_host_name TEXT NOT NULL,
                public_host_code TEXT NOT NULL,
                public_name TEXT NOT NULL,
                location_code TEXT,
                plan_code TEXT NOT NULL,
                weight NUMERIC NOT NULL DEFAULT 1,
                max_users INTEGER NOT NULL DEFAULT 300,
                status TEXT NOT NULL DEFAULT 'active',
                priority INTEGER NOT NULL DEFAULT 100,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            ALTER TABLE topor_balancer_nodes
                ADD COLUMN IF NOT EXISTS group_id UUID;

            ALTER TABLE topor_balancer_nodes
                ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100;

            ALTER TABLE topor_balancer_groups
                ADD COLUMN IF NOT EXISTS strategy TEXT NOT NULL DEFAULT 'least_loaded';

            ALTER TABLE topor_balancer_groups
                ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;

            ALTER TABLE topor_balancer_groups
                ADD COLUMN IF NOT EXISTS squad_scope TEXT NOT NULL DEFAULT 'any_visible_to_user';

            ALTER TABLE topor_balancer_groups
                ADD COLUMN IF NOT EXISTS internal_squad_uuid TEXT;

            INSERT INTO topor_balancer_groups (
                id,
                public_host_code,
                public_name,
                location_code,
                plan_code
            )
            SELECT
                md5(n.public_host_code || ':' || n.plan_code)::uuid,
                n.public_host_code,
                (ARRAY_AGG(n.public_name ORDER BY n.updated_at DESC))[1],
                (ARRAY_AGG(n.location_code ORDER BY n.updated_at DESC))[1],
                n.plan_code
            FROM topor_balancer_nodes n
            WHERE n.group_id IS NULL
            GROUP BY n.public_host_code, n.plan_code
            ON CONFLICT (public_host_code, plan_code) DO NOTHING;

            UPDATE topor_balancer_nodes n
            SET group_id = g.id
            FROM topor_balancer_groups g
            WHERE n.group_id IS NULL
              AND g.public_host_code = n.public_host_code
              AND g.plan_code = n.plan_code;

            ALTER TABLE topor_balancer_nodes
                DROP CONSTRAINT IF EXISTS topor_balancer_nodes_technical_host_name_key;

            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'topor_balancer_nodes_group_id_fkey'
                ) THEN
                    ALTER TABLE topor_balancer_nodes
                        ADD CONSTRAINT topor_balancer_nodes_group_id_fkey
                        FOREIGN KEY (group_id)
                        REFERENCES topor_balancer_groups(id);
                END IF;
            END $$;

            CREATE UNIQUE INDEX IF NOT EXISTS topor_balancer_nodes_group_technical_host_name_key
                ON topor_balancer_nodes (group_id, technical_host_name);

            CREATE TABLE IF NOT EXISTS topor_balancer_assignments (
                id UUID PRIMARY KEY,
                short_uuid TEXT NOT NULL,
                public_host_code TEXT NOT NULL,
                plan_code TEXT NOT NULL,
                node_id UUID NOT NULL REFERENCES topor_balancer_nodes(id),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (short_uuid, public_host_code, plan_code)
            );

            CREATE TABLE IF NOT EXISTS topor_balancer_requests (
                id UUID PRIMARY KEY,
                short_uuid TEXT NOT NULL,
                user_agent TEXT,
                response_format TEXT,
                input_links_count INTEGER,
                output_links_count INTEGER,
                status TEXT,
                error_message TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            ALTER TABLE topor_balancer_requests
                ADD COLUMN IF NOT EXISTS status TEXT;

            ALTER TABLE topor_balancer_requests
                ADD COLUMN IF NOT EXISTS error_message TEXT;

            ALTER TABLE topor_balancer_requests
                ADD COLUMN IF NOT EXISTS matched_technical_links INTEGER;

            ALTER TABLE topor_balancer_requests
                ADD COLUMN IF NOT EXISTS rewritten_links_count INTEGER;

            ALTER TABLE topor_balancer_requests
                ADD COLUMN IF NOT EXISTS selected_nodes JSONB NOT NULL DEFAULT '{}'::jsonb;

            ALTER TABLE topor_balancer_requests
                ADD COLUMN IF NOT EXISTS group_candidate_diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb;

            ALTER TABLE topor_balancer_requests
                ADD COLUMN IF NOT EXISTS warnings JSONB NOT NULL DEFAULT '[]'::jsonb;

            CREATE TABLE IF NOT EXISTS topor_remnawave_hosts (
                uuid TEXT PRIMARY KEY,
                remark TEXT NOT NULL,
                address TEXT,
                inbound_uuid TEXT,
                node_uuid TEXT,
                node_name TEXT,
                profile_uuid TEXT,
                profile_name TEXT,
                inbound_name TEXT,
                accessible_squads JSONB NOT NULL DEFAULT '[]'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS topor_remnawave_nodes (
                uuid TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                address TEXT,
                status TEXT,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS topor_remnawave_inbounds (
                uuid TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                profile_uuid TEXT,
                profile_name TEXT,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS topor_remnawave_internal_squads (
                uuid TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS topor_remnawave_host_squad_access (
                host_uuid TEXT NOT NULL REFERENCES topor_remnawave_hosts(uuid) ON DELETE CASCADE,
                squad_uuid TEXT NOT NULL REFERENCES topor_remnawave_internal_squads(uuid) ON DELETE CASCADE,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (host_uuid, squad_uuid)
            );

            CREATE INDEX IF NOT EXISTS topor_balancer_assignments_node_id_idx
                ON topor_balancer_assignments (node_id);

            CREATE INDEX IF NOT EXISTS topor_balancer_nodes_group_id_idx
                ON topor_balancer_nodes (group_id);

            CREATE INDEX IF NOT EXISTS topor_balancer_requests_short_uuid_created_at_idx
                ON topor_balancer_requests (short_uuid, created_at);
        `);
    }

    public async upsertConfiguredNodes(config: ToporBalancerConfig): Promise<void> {
        for (const location of config.locations) {
            for (const node of location.nodes) {
                await this.upsertNode(location, node);
            }
        }
    }

    public async getOrCreateAssignment(
        input: ToporBalancerAssignmentSelectionInput,
    ): Promise<ToporBalancerDbNode | null> {
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
                `${input.shortUuid}:${input.location.publicHostCode}:${input.location.planCode}`,
            ]);

            const existingNode = await this.findExistingUsableAssignment(client, input);

            if (existingNode) {
                await client.query('COMMIT');

                return existingNode;
            }

            const selectedNode = await this.selectActiveNode(client, input);

            if (!selectedNode) {
                await client.query('COMMIT');

                return null;
            }

            if ((input.location.strategy ?? 'least_loaded') !== 'sticky_hash') {
                await this.upsertAssignment(client, input, selectedNode.id);
            }
            await client.query('COMMIT');

            return selectedNode;
        } catch (error) {
            await client.query('ROLLBACK');

            throw error;
        } finally {
            client.release();
        }
    }

    public async recordRequest(input: ToporBalancerRequestLogInput): Promise<void> {
        await this.pool.query(
            `
            INSERT INTO topor_balancer_requests (
                id,
                short_uuid,
                user_agent,
                response_format,
                input_links_count,
                matched_technical_links,
                output_links_count,
                rewritten_links_count,
                selected_nodes,
                group_candidate_diagnostics,
                status,
                error_message,
                warnings
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12::jsonb)
            `,
            [
                randomUUID(),
                input.shortUuid,
                input.userAgent ?? null,
                input.responseFormat,
                input.inputLinksCount,
                input.matchedTechnicalLinks ?? null,
                input.outputLinksCount,
                input.rewrittenLinksCount ?? null,
                JSON.stringify(input.selectedNodes ?? {}),
                JSON.stringify(input.groupCandidateDiagnostics ?? []),
                input.status ?? 'ok',
                input.errorMessage ?? null,
                JSON.stringify(input.warnings ?? []),
            ],
        );
    }

    public async healthCheck(): Promise<boolean> {
        await this.pool.query('SELECT 1');

        return true;
    }

    public async countNodes(): Promise<number> {
        const result = await this.pool.query<DbCountRow>(
            'SELECT COUNT(*) AS count FROM topor_balancer_nodes',
        );

        return Number(result.rows[0]?.count ?? 0);
    }

    public async countAssignments(): Promise<number> {
        const result = await this.pool.query<DbCountRow>(
            'SELECT COUNT(*) AS count FROM topor_balancer_assignments',
        );

        return Number(result.rows[0]?.count ?? 0);
    }

    public async countRequests(): Promise<number> {
        const result = await this.pool.query<DbCountRow>(
            'SELECT COUNT(*) AS count FROM topor_balancer_requests',
        );

        return Number(result.rows[0]?.count ?? 0);
    }

    public async listGroups(): Promise<ToporBalancerAdminGroup[]> {
        const result = await this.pool.query<DbAdminGroupRow>(`
            SELECT
                g.*,
                COUNT(DISTINCT n.id) AS nodes_count,
                COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'active') AS active_nodes_count,
                COUNT(DISTINCT a.id) AS assigned_users,
                'db_group_id' AS nodes_count_source
            FROM topor_balancer_groups g
            LEFT JOIN topor_balancer_nodes n ON n.group_id = g.id
            LEFT JOIN topor_balancer_assignments a ON a.node_id = n.id
            GROUP BY g.id
            ORDER BY g.public_host_code ASC, g.plan_code ASC
        `);

        return result.rows.map(mapAdminGroupRow);
    }

    public async getGroup(id: string): Promise<ToporBalancerAdminGroup | null> {
        const groups = await this.listGroups();

        return groups.find((group) => group.id === id) ?? null;
    }

    public async createGroup(
        input: ToporBalancerGroupCreateInput,
    ): Promise<ToporBalancerAdminGroup | null> {
        const id = randomUUID();
        const result = await this.pool.query<DbGroupRow>(
            `
            INSERT INTO topor_balancer_groups (
                id,
                public_host_code,
                public_name,
                location_code,
                plan_code,
                strategy,
                enabled,
                squad_scope,
                internal_squad_uuid
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (public_host_code, plan_code) DO NOTHING
            RETURNING *
            `,
            [
                id,
                input.publicHostCode,
                input.publicName,
                input.locationCode ?? null,
                input.planCode,
                input.strategy,
                input.enabled,
                input.squadScope ?? 'any_visible_to_user',
                input.internalSquadUuid ?? null,
            ],
        );

        if (!result.rows[0]) {
            return null;
        }

        const groups = await this.listGroups();

        return groups.find((group) => group.id === id) ?? null;
    }

    public async updateGroup(
        id: string,
        input: ToporBalancerGroupUpdateInput,
    ): Promise<ToporBalancerAdminGroup | null> {
        const updates: string[] = [];
        const params: unknown[] = [];

        addUpdate(updates, params, 'public_host_code', input.publicHostCode);
        addUpdate(updates, params, 'public_name', input.publicName);
        addUpdate(updates, params, 'location_code', input.locationCode);
        addUpdate(updates, params, 'plan_code', input.planCode);
        addUpdate(updates, params, 'strategy', input.strategy);
        addUpdate(updates, params, 'enabled', input.enabled);
        addUpdate(updates, params, 'squad_scope', input.squadScope);
        addUpdate(updates, params, 'internal_squad_uuid', input.internalSquadUuid);

        if (updates.length > 0) {
            params.push(id);
            await this.pool.query(
                `
                UPDATE topor_balancer_groups
                SET ${updates.join(', ')}, updated_at = NOW()
                WHERE id = $${params.length}
                `,
                params,
            );

            await this.syncNodeCompatibilityColumnsForGroup(id);
        }

        const groups = await this.listGroups();

        return groups.find((group) => group.id === id) ?? null;
    }

    public async deleteGroup(id: string): Promise<ToporBalancerGroupDeleteResult> {
        const nodeCount = await this.pool.query<DbCountRow>(
            'SELECT COUNT(*) AS count FROM topor_balancer_nodes WHERE group_id = $1',
            [id],
        );

        if (Number(nodeCount.rows[0]?.count ?? 0) > 0) {
            return 'has_nodes';
        }

        const result = await this.pool.query<DbCountRow>(
            `
            WITH deleted AS (
                DELETE FROM topor_balancer_groups
                WHERE id = $1
                RETURNING id
            )
            SELECT COUNT(*) AS count FROM deleted
            `,
            [id],
        );

        return Number(result.rows[0]?.count ?? 0) > 0 ? 'deleted' : 'not_found';
    }

    public async listGroupNodes(groupId: string): Promise<ToporBalancerAdminNode[] | null> {
        if (!(await this.groupExists(groupId))) {
            return null;
        }

        return (await this.listNodes()).filter((node) => node.groupId === groupId);
    }

    public async createGroupNode(
        groupId: string,
        input: ToporBalancerGroupNodeCreateInput,
    ): Promise<ToporBalancerAdminNode | null> {
        const group = await this.getGroup(groupId);

        if (!group) {
            return null;
        }

        const id = randomUUID();
        const result = await this.pool.query<DbNodeRow>(
            `
            INSERT INTO topor_balancer_nodes (
                id,
                group_id,
                technical_host_name,
                public_host_code,
                public_name,
                location_code,
                plan_code,
                weight,
                max_users,
                status,
                priority
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (group_id, technical_host_name) DO NOTHING
            RETURNING *
            `,
            [
                id,
                group.id,
                input.technicalHostName,
                group.publicHostCode,
                group.publicName,
                group.locationCode ?? null,
                group.planCode,
                input.weight,
                input.maxUsers,
                input.status,
                input.priority ?? 100,
            ],
        );

        if (!result.rows[0]) {
            return null;
        }

        const nodes = await this.listNodes();

        return nodes.find((node) => node.id === id) ?? null;
    }

    public async updateGroupNode(
        groupId: string,
        nodeId: string,
        input: ToporBalancerNodeUpdateInput,
    ): Promise<ToporBalancerAdminNode | null> {
        const node = (await this.listNodes()).find(
            (item) => item.id === nodeId && item.groupId === groupId,
        );

        if (!node) {
            return null;
        }

        return this.updateNode(nodeId, {
            maxUsers: input.maxUsers,
            priority: input.priority,
            status: input.status,
            technicalHostName: input.technicalHostName,
            weight: input.weight,
        });
    }

    public async deleteGroupNode(
        groupId: string,
        nodeId: string,
    ): Promise<ToporBalancerNodeDeleteResult> {
        const node = (await this.listNodes()).find(
            (item) => item.id === nodeId && item.groupId === groupId,
        );

        if (!node) {
            return 'not_found';
        }

        return this.deleteNode(nodeId);
    }

    public async listNodes(): Promise<ToporBalancerAdminNode[]> {
        const result = await this.pool.query<DbAdminNodeRow>(`
            SELECT
                n.id,
                n.group_id,
                n.technical_host_name,
                COALESCE(g.public_host_code, n.public_host_code) AS public_host_code,
                COALESCE(g.public_name, n.public_name) AS public_name,
                COALESCE(g.location_code, n.location_code) AS location_code,
                COALESCE(g.plan_code, n.plan_code) AS plan_code,
                n.weight,
                n.max_users,
                n.status,
                n.priority,
                n.created_at,
                n.updated_at,
                COUNT(a.id) AS assigned_users
            FROM topor_balancer_nodes n
            LEFT JOIN topor_balancer_groups g ON g.id = n.group_id
            LEFT JOIN topor_balancer_assignments a ON a.node_id = n.id
            GROUP BY n.id, g.id
            ORDER BY n.public_host_code ASC, n.plan_code ASC, n.technical_host_name ASC
        `);

        return result.rows.map(mapAdminNodeRow);
    }

    public async createNode(
        input: ToporBalancerNodeCreateInput,
    ): Promise<ToporBalancerAdminNode | null> {
        const group =
            (input.groupId ? await this.getGroup(input.groupId) : null) ??
            (await this.getOrCreateGroup({
                enabled: true,
                locationCode: input.locationCode,
                planCode: input.planCode,
                publicHostCode: input.publicHostCode,
                publicName: input.publicName,
                strategy: 'least_loaded',
            }));

        if (!group) {
            return null;
        }

        return this.createGroupNode(group.id, input);
    }

    public async updateNode(
        id: string,
        input: ToporBalancerNodeUpdateInput,
    ): Promise<ToporBalancerAdminNode | null> {
        const existing = await this.pool.query<DbNodeRow>(
            'SELECT * FROM topor_balancer_nodes WHERE id = $1 LIMIT 1',
            [id],
        );
        const existingNode = existing.rows[0];

        if (!existingNode) {
            return null;
        }

        if (
            existingNode.group_id &&
            (input.publicHostCode !== undefined ||
                input.publicName !== undefined ||
                input.locationCode !== undefined ||
                input.planCode !== undefined)
        ) {
            await this.updateGroup(existingNode.group_id, {
                locationCode: input.locationCode,
                planCode: input.planCode,
                publicHostCode: input.publicHostCode,
                publicName: input.publicName,
            });
        }

        const updates: string[] = [];
        const params: unknown[] = [];

        addUpdate(updates, params, 'technical_host_name', input.technicalHostName);
        if (!existingNode.group_id) {
            addUpdate(updates, params, 'public_host_code', input.publicHostCode);
            addUpdate(updates, params, 'public_name', input.publicName);
            addUpdate(updates, params, 'location_code', input.locationCode);
            addUpdate(updates, params, 'plan_code', input.planCode);
        }
        addUpdate(updates, params, 'weight', input.weight);
        addUpdate(updates, params, 'max_users', input.maxUsers);
        addUpdate(updates, params, 'status', input.status);
        addUpdate(updates, params, 'priority', input.priority);

        if (updates.length === 0) {
            const nodes = await this.listNodes();

            return nodes.find((node) => node.id === id) ?? null;
        }

        params.push(id);

        await this.pool.query(
            `
            UPDATE topor_balancer_nodes
            SET ${updates.join(', ')}, updated_at = NOW()
            WHERE id = $${params.length}
            `,
            params,
        );

        const nodes = await this.listNodes();

        return nodes.find((node) => node.id === id) ?? null;
    }

    public async deleteNode(id: string): Promise<ToporBalancerNodeDeleteResult> {
        const assignmentCount = await this.pool.query<DbCountRow>(
            'SELECT COUNT(*) AS count FROM topor_balancer_assignments WHERE node_id = $1',
            [id],
        );

        if (Number(assignmentCount.rows[0]?.count ?? 0) > 0) {
            return 'has_assignments';
        }

        const result = await this.pool.query<DbCountRow>(
            `
            WITH deleted AS (
                DELETE FROM topor_balancer_nodes
                WHERE id = $1
                RETURNING id
            )
            SELECT COUNT(*) AS count FROM deleted
            `,
            [id],
        );

        return Number(result.rows[0]?.count ?? 0) > 0 ? 'deleted' : 'not_found';
    }

    public async listAssignments(
        filters: ToporBalancerAssignmentFilters,
    ): Promise<ToporBalancerDbAssignment[]> {
        const conditions: string[] = [];
        const params: unknown[] = [];

        addFilter(conditions, params, 'a.short_uuid', filters.shortUuid);
        addFilter(conditions, params, 'a.public_host_code', filters.publicHostCode);
        addFilter(conditions, params, 'a.plan_code', filters.planCode);
        addFilter(conditions, params, 'a.node_id', filters.nodeId);

        const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await this.pool.query<DbAssignmentRow>(
            `
            SELECT a.*, n.technical_host_name
            FROM topor_balancer_assignments a
            JOIN topor_balancer_nodes n ON n.id = a.node_id
            ${whereSql}
            ORDER BY a.updated_at DESC
            LIMIT 500
            `,
            params,
        );

        return result.rows.map(mapAssignmentRow);
    }

    public async listGroupAssignments(
        filters: ToporBalancerGroupAssignmentFilters,
    ): Promise<ToporBalancerDbAssignment[]> {
        const result = await this.pool.query<DbAssignmentRow>(
            `
            SELECT a.*, n.technical_host_name
            FROM topor_balancer_assignments a
            JOIN topor_balancer_nodes n ON n.id = a.node_id
            WHERE a.public_host_code = $1
              AND a.plan_code = $2
            ORDER BY a.updated_at DESC
            `,
            [filters.publicHostCode, filters.planCode],
        );

        return result.rows.map(mapAssignmentRow);
    }

    public async resetGroupAssignments(filters: ToporBalancerGroupAssignmentFilters): Promise<number> {
        const result = await this.pool.query<DbCountRow>(
            `
            WITH deleted AS (
                DELETE FROM topor_balancer_assignments
                WHERE public_host_code = $1
                  AND plan_code = $2
                RETURNING id
            )
            SELECT COUNT(*) AS count FROM deleted
            `,
            [filters.publicHostCode, filters.planCode],
        );

        return Number(result.rows[0]?.count ?? 0);
    }

    public async reassign(
        input: ToporBalancerManualReassignInput,
    ): Promise<ToporBalancerDbAssignment | null> {
        const nodeResult = await this.pool.query<DbNodeRow>(
            `
            SELECT
                n.id,
                n.group_id,
                n.technical_host_name,
                COALESCE(g.public_host_code, n.public_host_code) AS public_host_code,
                COALESCE(g.public_name, n.public_name) AS public_name,
                COALESCE(g.location_code, n.location_code) AS location_code,
                COALESCE(g.plan_code, n.plan_code) AS plan_code,
                n.weight,
                n.max_users,
                n.status,
                n.priority,
                n.created_at,
                n.updated_at
            FROM topor_balancer_nodes
            n
            LEFT JOIN topor_balancer_groups g ON g.id = n.group_id
            WHERE n.technical_host_name = $1
              AND COALESCE(g.public_host_code, n.public_host_code) = $2
              AND COALESCE(g.plan_code, n.plan_code) = $3
              AND COALESCE(g.enabled, TRUE) = TRUE
              AND n.status = 'active'
            LIMIT 1
            `,
            [input.technicalHostName, input.publicHostCode, input.planCode],
        );
        const node = nodeResult.rows[0];

        if (!node) {
            return null;
        }

        const result = await this.pool.query<DbAssignmentRow>(
            `
            INSERT INTO topor_balancer_assignments (
                id,
                short_uuid,
                public_host_code,
                plan_code,
                node_id
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (short_uuid, public_host_code, plan_code) DO UPDATE SET
                node_id = EXCLUDED.node_id,
                updated_at = NOW()
            RETURNING *
            `,
            [randomUUID(), input.shortUuid, input.publicHostCode, input.planCode, node.id],
        );

        return mapAssignmentRow({
            ...result.rows[0],
            technical_host_name: node.technical_host_name,
        });
    }

    public async listRequests(
        filters: ToporBalancerRequestFilters,
    ): Promise<ToporBalancerAdminRequest[]> {
        const conditions: string[] = [];
        const params: unknown[] = [];

        addFilter(conditions, params, 'short_uuid', filters.shortUuid);

        const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await this.pool.query<DbRequestRow>(
            `
            SELECT *
            FROM topor_balancer_requests
            ${whereSql}
            ORDER BY created_at DESC
            LIMIT 500
            `,
            params,
        );

        return result.rows.map(mapRequestRow);
    }

    public async listGroupRecentDiagnostics(
        filters: ToporBalancerGroupAssignmentFilters,
    ): Promise<ToporBalancerAdminRequest[]> {
        const result = await this.pool.query<DbRequestRow>(
            `
            SELECT *
            FROM topor_balancer_requests
            WHERE group_candidate_diagnostics @> $1::jsonb
            ORDER BY created_at DESC
            LIMIT 100
            `,
            [
                JSON.stringify([
                    {
                        publicHostCode: filters.publicHostCode,
                        planCode: filters.planCode,
                    },
                ]),
            ],
        );

        return result.rows.map(mapRequestRow);
    }

    public async upsertImportedNodes(
        input: ToporBalancerNodeCreateInput[],
    ): Promise<{ created: ToporBalancerAdminNode[]; updated: ToporBalancerAdminNode[] }> {
        const created: ToporBalancerAdminNode[] = [];
        const updated: ToporBalancerAdminNode[] = [];

        for (const node of input) {
            const group =
                (node.groupId ? await this.getGroup(node.groupId) : null) ??
                (await this.getOrCreateGroup({
                    enabled: true,
                    locationCode: node.locationCode,
                    planCode: node.planCode,
                    publicHostCode: node.publicHostCode,
                    publicName: node.publicName,
                    strategy: 'least_loaded',
                }));

            if (!group) {
                continue;
            }

            const existing = await this.pool.query<DbNodeRow>(
                `
                SELECT *
                FROM topor_balancer_nodes
                WHERE group_id = $1
                  AND technical_host_name = $2
                LIMIT 1
                `,
                [group.id, node.technicalHostName],
            );
            const existingNode = existing.rows[0];

            if (existingNode) {
                await this.updateNode(existingNode.id, {
                    maxUsers: node.maxUsers,
                    status: node.status,
                    weight: node.weight,
                });

                const adminNode = (await this.listNodes()).find(
                    (item) => item.technicalHostName === node.technicalHostName,
                );

                if (adminNode) {
                    updated.push(adminNode);
                }
            } else {
                const adminNode = await this.createGroupNode(group.id, node);

                if (adminNode) {
                    created.push(adminNode);
                }
            }
        }

        return { created, updated };
    }

    public async replaceRemnawaveTopologyCache(
        input: ToporRemnawaveTopologySnapshot,
    ): Promise<void> {
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM topor_remnawave_host_squad_access');
            await client.query('DELETE FROM topor_remnawave_hosts');
            await client.query('DELETE FROM topor_remnawave_nodes');
            await client.query('DELETE FROM topor_remnawave_inbounds');
            await client.query('DELETE FROM topor_remnawave_internal_squads');

            for (const node of input.nodes) {
                await client.query(
                    `
                    INSERT INTO topor_remnawave_nodes (uuid, name, address, status)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (uuid) DO UPDATE SET
                        name = EXCLUDED.name,
                        address = EXCLUDED.address,
                        status = EXCLUDED.status,
                        updated_at = NOW()
                    `,
                    [node.uuid, node.name, node.address ?? null, node.status ?? null],
                );
            }

            for (const inbound of input.inbounds) {
                await client.query(
                    `
                    INSERT INTO topor_remnawave_inbounds (uuid, name, profile_uuid, profile_name)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (uuid) DO UPDATE SET
                        name = EXCLUDED.name,
                        profile_uuid = EXCLUDED.profile_uuid,
                        profile_name = EXCLUDED.profile_name,
                        updated_at = NOW()
                    `,
                    [
                        inbound.uuid,
                        inbound.name,
                        inbound.profileUuid ?? null,
                        inbound.profileName ?? null,
                    ],
                );
            }

            for (const squad of input.squads) {
                await client.query(
                    `
                    INSERT INTO topor_remnawave_internal_squads (uuid, name)
                    VALUES ($1, $2)
                    ON CONFLICT (uuid) DO UPDATE SET
                        name = EXCLUDED.name,
                        updated_at = NOW()
                    `,
                    [squad.uuid, squad.name],
                );
            }

            for (const host of input.hosts) {
                await client.query(
                    `
                    INSERT INTO topor_remnawave_hosts (
                        uuid,
                        remark,
                        address,
                        inbound_uuid,
                        node_uuid,
                        node_name,
                        profile_uuid,
                        profile_name,
                        inbound_name,
                        accessible_squads
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
                    ON CONFLICT (uuid) DO UPDATE SET
                        remark = EXCLUDED.remark,
                        address = EXCLUDED.address,
                        inbound_uuid = EXCLUDED.inbound_uuid,
                        node_uuid = EXCLUDED.node_uuid,
                        node_name = EXCLUDED.node_name,
                        profile_uuid = EXCLUDED.profile_uuid,
                        profile_name = EXCLUDED.profile_name,
                        inbound_name = EXCLUDED.inbound_name,
                        accessible_squads = EXCLUDED.accessible_squads,
                        updated_at = NOW()
                    `,
                    [
                        host.uuid,
                        host.remark,
                        host.address ?? null,
                        host.inboundUuid ?? null,
                        host.nodeUuid ?? null,
                        host.nodeName ?? null,
                        host.profileUuid ?? null,
                        host.profileName ?? null,
                        host.inboundName ?? null,
                        JSON.stringify(host.accessibleSquads),
                    ],
                );

                for (const squad of host.accessibleSquads) {
                    await client.query(
                        `
                        INSERT INTO topor_remnawave_host_squad_access (host_uuid, squad_uuid)
                        VALUES ($1, $2)
                        ON CONFLICT (host_uuid, squad_uuid) DO UPDATE SET updated_at = NOW()
                        `,
                        [host.uuid, squad.uuid],
                    );
                }
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    public async getRemnawaveTopologyCache(): Promise<ToporRemnawaveTopologySnapshot> {
        const [hostsResult, nodesResult, inboundsResult, squadsResult] = await Promise.all([
            this.pool.query<DbTopologyHostRow>('SELECT * FROM topor_remnawave_hosts ORDER BY remark ASC'),
            this.pool.query<DbTopologyNodeRow>('SELECT * FROM topor_remnawave_nodes ORDER BY name ASC'),
            this.pool.query<DbTopologyInboundRow>('SELECT * FROM topor_remnawave_inbounds ORDER BY name ASC'),
            this.pool.query<DbTopologySquadRow>('SELECT * FROM topor_remnawave_internal_squads ORDER BY name ASC'),
        ]);

        return {
            hosts: hostsResult.rows.map(mapTopologyHostRow),
            nodes: nodesResult.rows.map(mapTopologyNodeRow),
            inbounds: inboundsResult.rows.map(mapTopologyInboundRow),
            squads: squadsResult.rows.map(mapTopologySquadRow),
            warnings: [],
        };
    }

    public async close(): Promise<void> {
        await this.pool.end();
    }

    private async upsertNode(
        location: ToporBalancerLocation,
        node: ToporBalancerNode,
    ): Promise<void> {
        const group = await this.getOrCreateGroup({
            enabled: true,
            locationCode: location.locationCode,
            planCode: location.planCode,
            publicHostCode: location.publicHostCode,
            publicName: location.publicName,
            strategy: 'least_loaded',
            ...(location.strategy ? { strategy: location.strategy } : {}),
        });

        if (!group) {
            return;
        }

        await this.pool.query(
            `
            INSERT INTO topor_balancer_nodes (
                id,
                group_id,
                technical_host_name,
                public_host_code,
                public_name,
                location_code,
                plan_code,
                weight,
                max_users,
                status,
                priority
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (group_id, technical_host_name) DO UPDATE SET
                public_host_code = EXCLUDED.public_host_code,
                public_name = EXCLUDED.public_name,
                location_code = EXCLUDED.location_code,
                plan_code = EXCLUDED.plan_code,
                weight = EXCLUDED.weight,
                max_users = EXCLUDED.max_users,
                status = EXCLUDED.status,
                priority = EXCLUDED.priority,
                updated_at = NOW()
            `,
            [
                randomUUID(),
                group.id,
                node.technicalHostName,
                location.publicHostCode,
                location.publicName,
                location.locationCode ?? null,
                location.planCode,
                node.weight,
                node.maxUsers,
                node.status,
                node.priority ?? 100,
            ],
        );
    }

    private async findExistingUsableAssignment(
        client: PgQueryable,
        input: ToporBalancerAssignmentSelectionInput,
    ): Promise<ToporBalancerDbNode | null> {
        const result = await client.query<DbNodeRow>(
            `
            SELECT
                n.id,
                n.group_id,
                n.technical_host_name,
                COALESCE(g.public_host_code, n.public_host_code) AS public_host_code,
                COALESCE(g.public_name, n.public_name) AS public_name,
                COALESCE(g.location_code, n.location_code) AS location_code,
                COALESCE(g.plan_code, n.plan_code) AS plan_code,
                n.weight,
                n.max_users,
                n.status,
                n.priority,
                n.created_at,
                n.updated_at
            FROM topor_balancer_assignments a
            JOIN topor_balancer_nodes n ON n.id = a.node_id
            LEFT JOIN topor_balancer_groups g ON g.id = n.group_id
            WHERE a.short_uuid = $1
              AND a.public_host_code = $2
              AND a.plan_code = $3
              AND n.technical_host_name = ANY($4)
              AND n.status IN ('active', 'draining')
            LIMIT 1
            `,
            [
                input.shortUuid,
                input.location.publicHostCode,
                input.location.planCode,
                input.candidateTechnicalHostNames,
            ],
        );

        return result.rows[0] ? mapNodeRow(result.rows[0]) : null;
    }

    private async selectActiveNode(
        client: PgQueryable,
        input: ToporBalancerAssignmentSelectionInput,
    ): Promise<ToporBalancerDbNode | null> {
        switch (input.location.strategy ?? 'least_loaded') {
            case 'manual':
                return null;
            case 'priority_failover':
                return this.selectPriorityFailoverActiveNode(client, input);
            case 'sticky_hash':
                return this.selectStickyHashActiveNode(client, input);
            case 'weighted':
                return this.selectWeightedActiveNode(client, input);
            case 'least_loaded':
            default:
                return this.selectLeastLoadedActiveNode(client, input);
        }
    }

    private async selectLeastLoadedActiveNode(
        client: PgQueryable,
        input: ToporBalancerAssignmentSelectionInput,
    ): Promise<ToporBalancerDbNode | null> {
        const result = await client.query<DbNodeRow>(
            `
            SELECT
                n.id,
                n.group_id,
                n.technical_host_name,
                COALESCE(g.public_host_code, n.public_host_code) AS public_host_code,
                COALESCE(g.public_name, n.public_name) AS public_name,
                COALESCE(g.location_code, n.location_code) AS location_code,
                COALESCE(g.plan_code, n.plan_code) AS plan_code,
                n.weight,
                n.max_users,
                n.status,
                n.priority,
                n.created_at,
                n.updated_at
            FROM topor_balancer_nodes n
            LEFT JOIN topor_balancer_groups g ON g.id = n.group_id
            LEFT JOIN topor_balancer_assignments a ON a.node_id = n.id
            WHERE COALESCE(g.public_host_code, n.public_host_code) = $1
              AND COALESCE(g.plan_code, n.plan_code) = $2
              AND COALESCE(g.enabled, TRUE) = TRUE
              AND n.technical_host_name = ANY($3)
              AND n.status = 'active'
            GROUP BY n.id, g.id
            ORDER BY
              (COUNT(a.id)::numeric / GREATEST((n.max_users::numeric * n.weight), 1)) ASC,
              n.technical_host_name ASC
            LIMIT 1
            `,
            [
                input.location.publicHostCode,
                input.location.planCode,
                input.candidateTechnicalHostNames,
            ],
        );

        return result.rows[0] ? mapNodeRow(result.rows[0]) : null;
    }

    private async selectWeightedActiveNode(
        client: PgQueryable,
        input: ToporBalancerAssignmentSelectionInput,
    ): Promise<ToporBalancerDbNode | null> {
        const result = await client.query<DbNodeRow>(
            `
            WITH active_nodes AS (
                SELECT
                    n.id,
                    n.group_id,
                    n.technical_host_name,
                    COALESCE(g.public_host_code, n.public_host_code) AS public_host_code,
                    COALESCE(g.public_name, n.public_name) AS public_name,
                    COALESCE(g.location_code, n.location_code) AS location_code,
                    COALESCE(g.plan_code, n.plan_code) AS plan_code,
                    n.weight,
                    n.max_users,
                    n.status,
                    n.priority,
                    n.created_at,
                    n.updated_at,
                    COUNT(a.id) AS assigned_users
                FROM topor_balancer_nodes n
                LEFT JOIN topor_balancer_groups g ON g.id = n.group_id
                LEFT JOIN topor_balancer_assignments a ON a.node_id = n.id
                WHERE COALESCE(g.public_host_code, n.public_host_code) = $1
                  AND COALESCE(g.plan_code, n.plan_code) = $2
                  AND COALESCE(g.enabled, TRUE) = TRUE
                  AND n.technical_host_name = ANY($3)
                  AND n.status = 'active'
                GROUP BY n.id, g.id
            )
            SELECT *
            FROM active_nodes
            ORDER BY
              CASE
                WHEN EXISTS (SELECT 1 FROM active_nodes WHERE assigned_users < max_users) THEN
                  CASE WHEN assigned_users < max_users THEN 0 ELSE 1 END
                ELSE 0
              END ASC,
              (assigned_users::numeric / GREATEST(weight, 1)) ASC,
              technical_host_name ASC
            LIMIT 1
            `,
            [
                input.location.publicHostCode,
                input.location.planCode,
                input.candidateTechnicalHostNames,
            ],
        );

        return result.rows[0] ? mapNodeRow(result.rows[0]) : null;
    }

    private async selectPriorityFailoverActiveNode(
        client: PgQueryable,
        input: ToporBalancerAssignmentSelectionInput,
    ): Promise<ToporBalancerDbNode | null> {
        const result = await client.query<DbNodeRow>(
            `
            SELECT
                n.id,
                n.group_id,
                n.technical_host_name,
                COALESCE(g.public_host_code, n.public_host_code) AS public_host_code,
                COALESCE(g.public_name, n.public_name) AS public_name,
                COALESCE(g.location_code, n.location_code) AS location_code,
                COALESCE(g.plan_code, n.plan_code) AS plan_code,
                n.weight,
                n.max_users,
                n.status,
                n.priority,
                n.created_at,
                n.updated_at
            FROM topor_balancer_nodes n
            LEFT JOIN topor_balancer_groups g ON g.id = n.group_id
            WHERE COALESCE(g.public_host_code, n.public_host_code) = $1
              AND COALESCE(g.plan_code, n.plan_code) = $2
              AND COALESCE(g.enabled, TRUE) = TRUE
              AND n.technical_host_name = ANY($3)
              AND n.status = 'active'
            ORDER BY n.priority ASC, n.technical_host_name ASC
            LIMIT 1
            `,
            [
                input.location.publicHostCode,
                input.location.planCode,
                input.candidateTechnicalHostNames,
            ],
        );

        return result.rows[0] ? mapNodeRow(result.rows[0]) : null;
    }

    private async selectStickyHashActiveNode(
        client: PgQueryable,
        input: ToporBalancerAssignmentSelectionInput,
    ): Promise<ToporBalancerDbNode | null> {
        const result = await client.query<DbNodeRow>(
            `
            SELECT
                n.id,
                n.group_id,
                n.technical_host_name,
                COALESCE(g.public_host_code, n.public_host_code) AS public_host_code,
                COALESCE(g.public_name, n.public_name) AS public_name,
                COALESCE(g.location_code, n.location_code) AS location_code,
                COALESCE(g.plan_code, n.plan_code) AS plan_code,
                n.weight,
                n.max_users,
                n.status,
                n.priority,
                n.created_at,
                n.updated_at
            FROM topor_balancer_nodes n
            LEFT JOIN topor_balancer_groups g ON g.id = n.group_id
            WHERE COALESCE(g.public_host_code, n.public_host_code) = $1
              AND COALESCE(g.plan_code, n.plan_code) = $2
              AND COALESCE(g.enabled, TRUE) = TRUE
              AND n.technical_host_name = ANY($3)
              AND n.status = 'active'
            ORDER BY n.technical_host_name ASC
            `,
            [
                input.location.publicHostCode,
                input.location.planCode,
                input.candidateTechnicalHostNames,
            ],
        );
        const nodes = result.rows.map(mapNodeRow);

        if (nodes.length === 0) {
            return null;
        }

        const hash = createHash('sha256')
            .update(`${input.shortUuid}:${input.location.publicHostCode}:${input.location.planCode}`)
            .digest();
        const index = hash.readUInt32BE(0) % nodes.length;

        return nodes[index];
    }

    private async upsertAssignment(
        client: PgQueryable,
        input: ToporBalancerAssignmentSelectionInput,
        nodeId: string,
    ): Promise<ToporBalancerDbAssignment> {
        const result = await client.query<DbAssignmentRow>(
            `
            INSERT INTO topor_balancer_assignments (
                id,
                short_uuid,
                public_host_code,
                plan_code,
                node_id
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (short_uuid, public_host_code, plan_code) DO UPDATE SET
                node_id = EXCLUDED.node_id,
                updated_at = NOW()
            RETURNING *
            `,
            [
                randomUUID(),
                input.shortUuid,
                input.location.publicHostCode,
                input.location.planCode,
                nodeId,
            ],
        );

        return mapAssignmentRow(result.rows[0]);
    }

    private async groupExists(id: string): Promise<boolean> {
        const result = await this.pool.query<DbCountRow>(
            'SELECT COUNT(*) AS count FROM topor_balancer_groups WHERE id = $1',
            [id],
        );

        return Number(result.rows[0]?.count ?? 0) > 0;
    }

    private async getOrCreateGroup(
        input: ToporBalancerGroupCreateInput,
    ): Promise<ToporBalancerDbGroup | null> {
        const existing = await this.pool.query<DbGroupRow>(
            `
            SELECT *
            FROM topor_balancer_groups
            WHERE public_host_code = $1
              AND plan_code = $2
            LIMIT 1
            `,
            [input.publicHostCode, input.planCode],
        );

        if (existing.rows[0]) {
            return mapGroupRow(existing.rows[0]);
        }

        const created = await this.createGroup(input);

        return created ?? null;
    }

    private async syncNodeCompatibilityColumnsForGroup(groupId: string): Promise<void> {
        await this.pool.query(
            `
            UPDATE topor_balancer_nodes n
            SET
                public_host_code = g.public_host_code,
                public_name = g.public_name,
                location_code = g.location_code,
                plan_code = g.plan_code,
                updated_at = NOW()
            FROM topor_balancer_groups g
            WHERE n.group_id = g.id
              AND g.id = $1
            `,
            [groupId],
        );
    }
}

function mapGroupRow(row: DbGroupRow): ToporBalancerDbGroup {
    return {
        id: row.id,
        publicHostCode: row.public_host_code,
        publicName: row.public_name,
        locationCode: row.location_code ?? undefined,
        planCode: row.plan_code,
        strategy: row.strategy,
        enabled: row.enabled,
        squadScope: row.squad_scope ?? 'any_visible_to_user',
        internalSquadUuid: row.internal_squad_uuid ?? undefined,
        createdAt: row.created_at?.toString(),
        updatedAt: row.updated_at?.toString(),
    };
}

function mapAdminGroupRow(row: DbAdminGroupRow): ToporBalancerAdminGroup {
    return {
        ...mapGroupRow(row),
        activeNodesCount: Number(row.active_nodes_count),
        assignedUsers: Number(row.assigned_users),
        nodesCount: Number(row.nodes_count),
        nodesCountSource: row.nodes_count_source ?? 'db_group_id',
    };
}

function mapTopologyHostRow(row: DbTopologyHostRow): ToporRemnawaveTopologyHost {
    return {
        uuid: row.uuid,
        remark: row.remark,
        address: row.address ?? undefined,
        inboundUuid: row.inbound_uuid ?? undefined,
        nodeUuid: row.node_uuid ?? undefined,
        nodeName: row.node_name ?? undefined,
        profileUuid: row.profile_uuid ?? undefined,
        profileName: row.profile_name ?? undefined,
        inboundName: row.inbound_name ?? undefined,
        accessibleSquads: parseJsonArray(row.accessible_squads),
        updatedAt: row.updated_at?.toString(),
    };
}

function mapTopologyNodeRow(row: DbTopologyNodeRow): ToporRemnawaveTopologyNode {
    return {
        uuid: row.uuid,
        name: row.name,
        address: row.address ?? undefined,
        status: row.status ?? undefined,
        updatedAt: row.updated_at?.toString(),
    };
}

function mapTopologyInboundRow(row: DbTopologyInboundRow): ToporRemnawaveTopologyInbound {
    return {
        uuid: row.uuid,
        name: row.name,
        profileUuid: row.profile_uuid ?? undefined,
        profileName: row.profile_name ?? undefined,
        updatedAt: row.updated_at?.toString(),
    };
}

function mapTopologySquadRow(row: DbTopologySquadRow): ToporRemnawaveTopologySquad {
    return {
        uuid: row.uuid,
        name: row.name,
        updatedAt: row.updated_at?.toString(),
    };
}

function parseJsonArray(value: Array<{ name: string; uuid: string }> | string | null): Array<{ name: string; uuid: string }> {
    if (Array.isArray(value)) {
        return value;
    }

    if (!value) {
        return [];
    }

    try {
        const parsed = JSON.parse(value);

        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function mapNodeRow(row: DbNodeRow): ToporBalancerDbNode {
    return {
        id: row.id,
        groupId: row.group_id ?? undefined,
        technicalHostName: row.technical_host_name,
        publicHostCode: row.public_host_code,
        publicName: row.public_name,
        locationCode: row.location_code ?? undefined,
        planCode: row.plan_code,
        weight: Number(row.weight),
        maxUsers: row.max_users,
        status: row.status,
        priority: row.priority,
        createdAt: row.created_at?.toString(),
        updatedAt: row.updated_at?.toString(),
    };
}

function mapAssignmentRow(row: DbAssignmentRow): ToporBalancerDbAssignment {
    return {
        id: row.id,
        shortUuid: row.short_uuid,
        publicHostCode: row.public_host_code,
        planCode: row.plan_code,
        nodeId: row.node_id,
        technicalHostName: row.technical_host_name,
        createdAt: row.created_at?.toString(),
        updatedAt: row.updated_at?.toString(),
    };
}

function mapAdminNodeRow(row: DbAdminNodeRow): ToporBalancerAdminNode {
    return {
        ...mapNodeRow(row),
        assignedUsers: Number(row.assigned_users),
    };
}

function mapRequestRow(row: DbRequestRow): ToporBalancerAdminRequest {
    return {
        id: row.id,
        shortUuid: row.short_uuid,
        userAgent: row.user_agent ?? undefined,
        responseFormat: row.response_format ?? undefined,
        inputLinksCount: row.input_links_count ?? undefined,
        matchedTechnicalLinks: row.matched_technical_links ?? undefined,
        outputLinksCount: row.output_links_count ?? undefined,
        rewrittenLinksCount: row.rewritten_links_count ?? undefined,
        selectedNodes: row.selected_nodes ?? undefined,
        status: row.status ?? undefined,
        errorMessage: row.error_message ?? undefined,
        groupCandidateDiagnostics:
            (row.group_candidate_diagnostics as NonNullable<
                ToporBalancerAdminRequest['groupCandidateDiagnostics']
            > | null) ?? undefined,
        createdAt: row.created_at?.toString(),
        warnings: row.warnings ?? undefined,
    };
}

function addUpdate(updates: string[], params: unknown[], column: string, value: unknown): void {
    if (value === undefined) {
        return;
    }

    params.push(value);
    updates.push(`${column} = $${params.length}`);
}

function addFilter(conditions: string[], params: unknown[], column: string, value: unknown): void {
    if (value === undefined || value === '') {
        return;
    }

    params.push(value);
    conditions.push(`${column} = $${params.length}`);
}
