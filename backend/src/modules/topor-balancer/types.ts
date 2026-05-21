export type ToporBalancerNodeStatus = 'active' | 'draining' | 'disabled' | 'dead';

export type ToporBalancerAssignmentMode = 'hash' | 'database';

export type ToporBalancerGroupStrategy = 'least_loaded';

export interface ToporBalancerNode {
    technicalHostName: string;
    weight: number;
    maxUsers: number;
    status: ToporBalancerNodeStatus;
}

export interface ToporBalancerLocation {
    publicHostCode: string;
    publicName: string;
    locationCode?: string;
    planCode: string;
    nodes: ToporBalancerNode[];
}

export interface ToporBalancerConfig {
    enabled: boolean;
    locations: ToporBalancerLocation[];
}

export interface ToporBalancerAssignment {
    publicHostCode: string;
    technicalHostName: string;
    locationCode?: string;
    planCode: string;
    assignedAt: string;
}

export interface ParsedVlessLink {
    raw: string;
    protocol: 'vless';
    uuid: string;
    host: string;
    port?: number;
    params: Record<string, string>;
    queryParams: Record<string, string>;
    rawQuery: string;
    remark?: string;
    name?: string;
    security?: string;
    type?: string;
    sni?: string;
    flow?: string;
    pbk?: string;
    sid?: string;
    fp?: string;
    path?: string;
    serviceName?: string;
    alpn?: string;
}

export type SubscriptionFormat = 'plain_links' | 'base64_links' | 'json' | 'html' | 'unknown';

export interface ParsedSubscription {
    raw: string;
    isBase64: boolean;
    format: SubscriptionFormat;
    links: ParsedVlessLink[];
}

export interface ToporBalancerDebugInfo {
    shortUuid: string;
    requestPath?: string;
    userAgent?: string;
    detectedFormat: SubscriptionFormat;
    totalVlessLinks: number;
    matchedTechnicalLinks: number;
    selectedNodes: Record<string, string>;
    outputLinkCount: number;
    warnings?: string[];
}

export interface ToporBalancerProcessResult {
    body: string;
    debugInfo: ToporBalancerDebugInfo;
}

export interface ToporBalancerMaskedLinkDiff {
    index: number;
    selected: boolean;
    input?: {
        protocol?: string;
        host?: string;
        port?: number;
        remark?: string;
        uuid?: string;
        pbk?: string;
        sid?: string;
        queryParamKeys: string[];
    };
    output?: {
        protocol?: string;
        host?: string;
        port?: number;
        remark?: string;
        uuid?: string;
        pbk?: string;
        sid?: string;
        queryParamKeys: string[];
    };
    changedFields: string[];
    warning?: string;
}

export interface ToporBalancerDebugProcessSubscriptionResult {
    inputLinksCount: number;
    outputLinksCount: number;
    selectedNodes: Record<string, string>;
    warnings: string[];
    maskedDiff: ToporBalancerMaskedLinkDiff[];
}

export type ToporBalancerSubscriptionDiagnosticsFormat = 'base64' | 'plain' | 'unknown';

export type ToporBalancerSubscriptionDiagnosticsGroupStatus =
    | 'fail-open'
    | 'no-active-node'
    | 'ok';

export interface ToporBalancerSubscriptionDiagnosticsResult {
    ok: boolean;
    format: ToporBalancerSubscriptionDiagnosticsFormat;
    inputLinksCount: number;
    outputLinksCount: number;
    groups: Array<{
        publicHostCode: string;
        planCode: string;
        selectedTechnicalHostName?: string;
        status: ToporBalancerSubscriptionDiagnosticsGroupStatus;
    }>;
    vlessValidation: Array<{
        remark?: string;
        valid: boolean;
        warnings: string[];
        queryParamKeys: string[];
    }>;
    warnings: string[];
    errors: string[];
}

export interface ToporBalancerDbNode {
    id: string;
    groupId?: string;
    technicalHostName: string;
    publicHostCode: string;
    publicName: string;
    locationCode?: string;
    planCode: string;
    weight: number;
    maxUsers: number;
    status: ToporBalancerNodeStatus;
    createdAt?: string;
    updatedAt?: string;
}

export interface ToporBalancerDbGroup {
    id: string;
    publicHostCode: string;
    publicName: string;
    locationCode?: string;
    planCode: string;
    strategy: ToporBalancerGroupStrategy;
    enabled: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface ToporBalancerDbAssignment {
    id: string;
    shortUuid: string;
    publicHostCode: string;
    planCode: string;
    nodeId: string;
    technicalHostName?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface ToporBalancerAdminNode extends ToporBalancerDbNode {
    assignedUsers: number;
}

export interface ToporBalancerAdminGroup extends ToporBalancerDbGroup {
    activeNodesCount: number;
    assignedUsers: number;
    nodesCount: number;
}

export interface ToporBalancerAdminHealth {
    enabled: boolean;
    assignmentMode: ToporBalancerAssignmentMode;
    configLoaded: boolean;
    databaseConnected: boolean;
    nodeCount: number;
    assignmentCount: number;
    requestCount: number;
    lastError?: string;
}

export interface ToporBalancerAdminRequest {
    id: string;
    shortUuid: string;
    userAgent?: string;
    responseFormat?: string;
    inputLinksCount?: number;
    outputLinksCount?: number;
    status?: string;
    errorMessage?: string;
    createdAt?: string;
}

export interface ToporBalancerBootstrap {
    version: string;
    locale: 'ru' | 'en';
    features: {
        failover: boolean;
        healthChecks: boolean;
        stickyAssignment: boolean;
        weightedBalancing: boolean;
    };
    settings: {
        assignmentMode: ToporBalancerAssignmentMode;
        enabled: boolean;
        fallbackToHash: boolean;
    };
    hosts: Array<{
        publicHostCode: string;
        publicName: string;
        locationCode?: string;
        planCode: string;
    }>;
    nodes: ToporBalancerAdminNode[];
}

export interface ToporBalancerDiscoveredHost {
    technicalHostName: string;
    protocol?: 'vless';
    host?: string;
    port?: number;
    security?: string;
    type?: string;
    sni?: string;
    flow?: string;
    pbk?: string;
    sid?: string;
    rawRemark?: string;
    remnawaveNodeName?: string;
    remnawaveNodeUuid?: string;
    alreadyImported: boolean;
    matchedGroupId?: string;
    matchedGroupPublicHostCode?: string;
    matchedGroupPlanCode?: string;
    matchedNodeId: string | null;
}

export interface ToporBalancerDiscoveryResponse {
    source: 'remnawave-api' | 'subscription';
    shortUuid?: string;
    items: ToporBalancerDiscoveredHost[];
}

export interface ToporBalancerDiscoveryImportInput {
    groupId?: string;
    group?: {
        publicHostCode: string;
        publicName: string;
        locationCode?: string;
        planCode: string;
    };
    publicHostCode?: string;
    publicName?: string;
    locationCode?: string;
    planCode?: string;
    nodes: Array<{
        technicalHostName: string;
        weight: number;
        maxUsers: number;
        status: ToporBalancerNodeStatus;
    }>;
}

export interface ToporBalancerDiscoveryImportResult {
    created: ToporBalancerAdminNode[];
    updated: ToporBalancerAdminNode[];
    skipped: Array<{
        technicalHostName: string;
        reason: string;
    }>;
    errors: Array<{
        technicalHostName?: string;
        reason: string;
    }>;
    conflicts: Array<{
        technicalHostName: string;
        reason: string;
        existingGroupId?: string;
        existingPublicHostCode?: string;
        existingPlanCode?: string;
        existingPublicName?: string;
    }>;
}
