export type ToporBalancerNodeStatus = 'active' | 'draining' | 'disabled' | 'dead';

export type ToporBalancerAssignmentMode = 'hash' | 'database';

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

export interface ToporBalancerDbNode {
    id: string;
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
