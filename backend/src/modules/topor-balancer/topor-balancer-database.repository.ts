import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

import type {
    ToporBalancerConfig,
    ToporBalancerAdminNode,
    ToporBalancerAdminRequest,
    ToporBalancerDbAssignment,
    ToporBalancerDbNode,
    ToporBalancerLocation,
    ToporBalancerNode,
    ToporBalancerNodeStatus,
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
    shortUuid: string;
    userAgent?: string;
    responseFormat: string;
    inputLinksCount: number;
    outputLinksCount: number;
    status?: string;
    errorMessage?: string;
}

export interface ToporBalancerAssignmentFilters {
    shortUuid?: string;
    publicHostCode?: string;
    planCode?: string;
    nodeId?: string;
}

export interface ToporBalancerRequestFilters {
    shortUuid?: string;
}

export interface ToporBalancerNodeUpdateInput {
    weight?: number;
    maxUsers?: number;
    status?: ToporBalancerNodeStatus;
    publicName?: string;
}

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
    listNodes(): Promise<ToporBalancerAdminNode[]>;
    updateNode(
        id: string,
        input: ToporBalancerNodeUpdateInput,
    ): Promise<ToporBalancerAdminNode | null>;
    listAssignments(filters: ToporBalancerAssignmentFilters): Promise<ToporBalancerDbAssignment[]>;
    reassign(input: ToporBalancerManualReassignInput): Promise<ToporBalancerDbAssignment | null>;
    listRequests(filters: ToporBalancerRequestFilters): Promise<ToporBalancerAdminRequest[]>;
    close(): Promise<void>;
}

interface DbNodeRow {
    id: string;
    technical_host_name: string;
    public_host_code: string;
    public_name: string;
    location_code: string | null;
    plan_code: string;
    weight: string | number;
    max_users: number;
    status: ToporBalancerNodeStatus;
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

interface DbRequestRow {
    id: string;
    short_uuid: string;
    user_agent: string | null;
    response_format: string | null;
    input_links_count: number | null;
    output_links_count: number | null;
    status: string | null;
    error_message: string | null;
    created_at: Date | string;
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
            CREATE TABLE IF NOT EXISTS topor_balancer_nodes (
                id UUID PRIMARY KEY,
                technical_host_name TEXT UNIQUE NOT NULL,
                public_host_code TEXT NOT NULL,
                public_name TEXT NOT NULL,
                location_code TEXT,
                plan_code TEXT NOT NULL,
                weight NUMERIC NOT NULL DEFAULT 1,
                max_users INTEGER NOT NULL DEFAULT 300,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

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

            CREATE INDEX IF NOT EXISTS topor_balancer_assignments_node_id_idx
                ON topor_balancer_assignments (node_id);

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

            const selectedNode = await this.selectLeastLoadedActiveNode(client, input);

            if (!selectedNode) {
                await client.query('COMMIT');

                return null;
            }

            await this.upsertAssignment(client, input, selectedNode.id);
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
                output_links_count,
                status,
                error_message
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `,
            [
                randomUUID(),
                input.shortUuid,
                input.userAgent ?? null,
                input.responseFormat,
                input.inputLinksCount,
                input.outputLinksCount,
                input.status ?? 'ok',
                input.errorMessage ?? null,
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

    public async listNodes(): Promise<ToporBalancerAdminNode[]> {
        const result = await this.pool.query<DbAdminNodeRow>(`
            SELECT n.*, COUNT(a.id) AS assigned_users
            FROM topor_balancer_nodes n
            LEFT JOIN topor_balancer_assignments a ON a.node_id = n.id
            GROUP BY n.id
            ORDER BY n.public_host_code ASC, n.plan_code ASC, n.technical_host_name ASC
        `);

        return result.rows.map(mapAdminNodeRow);
    }

    public async updateNode(
        id: string,
        input: ToporBalancerNodeUpdateInput,
    ): Promise<ToporBalancerAdminNode | null> {
        const updates: string[] = [];
        const params: unknown[] = [];

        addUpdate(updates, params, 'weight', input.weight);
        addUpdate(updates, params, 'max_users', input.maxUsers);
        addUpdate(updates, params, 'status', input.status);
        addUpdate(updates, params, 'public_name', input.publicName);

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

    public async reassign(
        input: ToporBalancerManualReassignInput,
    ): Promise<ToporBalancerDbAssignment | null> {
        const nodeResult = await this.pool.query<DbNodeRow>(
            `
            SELECT *
            FROM topor_balancer_nodes
            WHERE technical_host_name = $1
              AND public_host_code = $2
              AND plan_code = $3
              AND status = 'active'
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

    public async close(): Promise<void> {
        await this.pool.end();
    }

    private async upsertNode(
        location: ToporBalancerLocation,
        node: ToporBalancerNode,
    ): Promise<void> {
        await this.pool.query(
            `
            INSERT INTO topor_balancer_nodes (
                id,
                technical_host_name,
                public_host_code,
                public_name,
                location_code,
                plan_code,
                weight,
                max_users,
                status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (technical_host_name) DO UPDATE SET
                public_host_code = EXCLUDED.public_host_code,
                public_name = EXCLUDED.public_name,
                location_code = EXCLUDED.location_code,
                plan_code = EXCLUDED.plan_code,
                weight = EXCLUDED.weight,
                max_users = EXCLUDED.max_users,
                status = EXCLUDED.status,
                updated_at = NOW()
            `,
            [
                randomUUID(),
                node.technicalHostName,
                location.publicHostCode,
                location.publicName,
                location.locationCode ?? null,
                location.planCode,
                node.weight,
                node.maxUsers,
                node.status,
            ],
        );
    }

    private async findExistingUsableAssignment(
        client: PgQueryable,
        input: ToporBalancerAssignmentSelectionInput,
    ): Promise<ToporBalancerDbNode | null> {
        const result = await client.query<DbNodeRow>(
            `
            SELECT n.*
            FROM topor_balancer_assignments a
            JOIN topor_balancer_nodes n ON n.id = a.node_id
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

    private async selectLeastLoadedActiveNode(
        client: PgQueryable,
        input: ToporBalancerAssignmentSelectionInput,
    ): Promise<ToporBalancerDbNode | null> {
        const result = await client.query<DbNodeRow>(
            `
            SELECT n.*
            FROM topor_balancer_nodes n
            LEFT JOIN topor_balancer_assignments a ON a.node_id = n.id
            WHERE n.public_host_code = $1
              AND n.plan_code = $2
              AND n.technical_host_name = ANY($3)
              AND n.status = 'active'
            GROUP BY n.id
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
}

function mapNodeRow(row: DbNodeRow): ToporBalancerDbNode {
    return {
        id: row.id,
        technicalHostName: row.technical_host_name,
        publicHostCode: row.public_host_code,
        publicName: row.public_name,
        locationCode: row.location_code ?? undefined,
        planCode: row.plan_code,
        weight: Number(row.weight),
        maxUsers: row.max_users,
        status: row.status,
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
        outputLinksCount: row.output_links_count ?? undefined,
        status: row.status ?? undefined,
        errorMessage: row.error_message ?? undefined,
        createdAt: row.created_at?.toString(),
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
