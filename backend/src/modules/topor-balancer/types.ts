export type ToporBalancerNodeStatus = 'active' | 'draining' | 'disabled' | 'dead';

export type ToporBalancerAssignmentMode = 'hash' | 'database';

export type ToporBalancerGroupStrategy =
    | 'least_loaded'
    | 'manual'
    | 'priority_failover'
    | 'sticky_hash'
    | 'weighted';

export type ToporBalancerGroupSquadScope =
    | 'any_visible_to_user'
    | 'specific_internal_squad';

export type ToporBalancerUnavailablePolicy = 'hide_group' | 'pass_through_original';

export interface ToporBalancerNode {
    currentTechnicalHostName?: string;
    identityKey?: string;
    identityStatus?: 'stable' | 'fallback_by_name' | 'unknown';
    previousTechnicalHostName?: string;
    remnawaveConfigProfileUuid?: string;
    remnawaveHostName?: string;
    remnawaveHostUuid?: string;
    remnawaveInboundUuid?: string;
    remnawaveNodeName?: string;
    remnawaveNodeUuid?: string;
    technicalHostName: string;
    weight: number;
    maxUsers: number;
    status: ToporBalancerNodeStatus;
    priority?: number;
}

export interface ToporBalancerLocation {
    enabled?: boolean;
    publicHostCode: string;
    publicName: string;
    locationCode?: string;
    planCode: string;
    strategy?: ToporBalancerGroupStrategy;
    squadScope?: ToporBalancerGroupSquadScope;
    internalSquadUuid?: string;
    unavailablePolicy?: ToporBalancerUnavailablePolicy;
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
    userSquads?: Array<{ name: string; uuid: string }>;
    accessibleNodesCount?: number;
    groupCandidateDiagnostics?: Array<{
        publicHostCode: string;
        planCode: string;
        userSquads: Array<{ name: string; uuid: string }>;
        accessibleNodesCount: number;
        groupNodesCount: number;
        subscriptionCandidateNodes: string[];
        effectiveCandidateNodes: string[];
        excludedNodes: Array<{
            technicalHostName: string;
            reason:
                | 'not_in_subscription'
                | 'not_accessible_to_user_squad'
                | 'not_accessible_to_group_squad'
                | 'missing_topology'
                | 'user_not_in_group_squad'
                | 'node_disabled'
                | 'node_dead'
                | 'node_draining';
            message: string;
        }>;
        previousAssignedNode?: string;
        previousAssignedNodeStatus?: ToporBalancerNodeStatus | 'not_in_subscription' | 'unknown';
        reassignmentAttempted: boolean;
        reassignmentResult?: 'kept' | 'reassigned' | 'failed' | 'not_needed';
        selectedTechnicalHostName?: string;
        failOpenReason?:
            | 'group_disabled_hidden'
            | 'manual_strategy'
            | 'no_active_candidates'
            | 'node_dead'
            | 'node_disabled';
        hiddenLinksCount?: number;
        matchedLinksCount?: number;
        passThroughOriginalUsed?: boolean;
        reason?:
            | 'group_disabled_hidden'
            | 'manual_strategy'
            | 'no_active_candidates'
            | 'node_dead'
            | 'node_disabled'
            | 'processed';
        status?: string;
        warnings: string[];
    }>;
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

export type ToporBalancerSubscriptionDiagnosticsFormat =
    | 'base64_links'
    | 'plain_links'
    | 'unknown';

export type ToporBalancerSubscriptionDiagnosticsStatus =
    | 'failed_open'
    | 'partially_processed'
    | 'passed_through'
    | 'processed'
    | 'unsupported_app';

export type ToporBalancerSubscriptionDiagnosticsGroupStatus =
    | 'fail-open'
    | 'no-active-node'
    | 'ok'
    | 'passed-through'
    | 'partial';

export type ToporBalancerSubscriptionDiagnosticsUnchangedReason =
    | 'exact_mismatch'
    | 'format_unsupported'
    | 'group_disabled'
    | 'invisible_characters'
    | 'leading_trailing_whitespace'
    | 'no_active_node'
    | 'no_accessible_candidates'
    | 'no_selected_node'
    | 'node_inactive'
    | 'not_configured'
    | 'technicalHostName_mismatch'
    | 'unsupported_app'
    | 'unicode_normalization_mismatch';

export interface ToporBalancerSubscriptionLinkDiagnostic {
    visibleRemark?: string;
    normalizedRemark?: string;
    remarkLength: number;
    matchesTechnicalHostName: boolean;
    matchedTechnicalHostName?: string;
    matchedPublicHostCode?: string;
    matchedPlanCode?: string;
    configuredTechnicalHostNames: string[];
    closestTechnicalHostNameCandidates: string[];
    reason?:
        | 'exact_mismatch'
        | 'group_disabled'
        | 'invisible_characters'
        | 'leading_trailing_whitespace'
        | 'node_inactive'
        | 'not_configured'
        | 'unsupported_app'
        | 'unicode_normalization_mismatch';
    normalizedComparisonResult: 'matched' | 'not_matched';
}

export interface ToporBalancerSubscriptionDiagnosticsResult {
    ok: boolean;
    status: ToporBalancerSubscriptionDiagnosticsStatus;
    format: ToporBalancerSubscriptionDiagnosticsFormat;
    totalVlessLinks: number;
    matchedTechnicalLinks: number;
    userSquads: Array<{ name: string; uuid: string }>;
    accessibleNodesCount: number;
    unmatchedRemarks: string[];
    linkDiagnostics: ToporBalancerSubscriptionLinkDiagnostic[];
    matchedGroups: Array<{
        publicHostCode: string;
        planCode: string;
        publicName: string;
        technicalHostNames: string[];
        matchedRemarks: string[];
        selectedTechnicalHostName?: string;
        userSquads: Array<{ name: string; uuid: string }>;
        accessibleNodesCount: number;
        groupNodesCount: number;
        subscriptionCandidateNodes: string[];
        effectiveCandidateNodes: string[];
        excludedNodes: Array<{
            technicalHostName: string;
            reason:
                | 'not_in_subscription'
                | 'not_accessible_to_user_squad'
                | 'not_accessible_to_group_squad'
                | 'missing_topology'
                | 'user_not_in_group_squad'
                | 'node_disabled'
                | 'node_dead'
                | 'node_draining';
            message: string;
        }>;
        outputRemarks: string[];
        outputContainsPublicName: boolean;
        rewrittenLinksCount: number;
        unchangedLinksCount: number;
        unchangedReasons: Array<{
            reason: ToporBalancerSubscriptionDiagnosticsUnchangedReason;
            remark?: string;
            technicalHostName?: string;
            message: string;
        }>;
    }>;
    selectedNodes: Record<string, string>;
    rewrittenLinksCount: number;
    unchangedLinksCount: number;
    unchangedReasons: Array<{
        publicHostCode?: string;
        planCode?: string;
        reason: ToporBalancerSubscriptionDiagnosticsUnchangedReason;
        remark?: string;
        technicalHostName?: string;
        message: string;
    }>;
    reasons: Array<{
        publicHostCode?: string;
        planCode?: string;
        reason: ToporBalancerSubscriptionDiagnosticsUnchangedReason;
        remark?: string;
        technicalHostName?: string;
        message: string;
    }>;
    inputLinksCount: number;
    outputLinksCount: number;
    groups: Array<{
        publicHostCode: string;
        planCode: string;
        publicName?: string;
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
    currentTechnicalHostName?: string;
    identityKey?: string;
    identityStatus?: 'stable' | 'fallback_by_name' | 'unknown';
    lastSeenAt?: string;
    previousTechnicalHostName?: string;
    remnawaveConfigProfileUuid?: string;
    remnawaveHostName?: string;
    remnawaveHostUuid?: string;
    remnawaveInboundUuid?: string;
    remnawaveNodeName?: string;
    remnawaveNodeUuid?: string;
    technicalHostName: string;
    publicHostCode: string;
    publicName: string;
    locationCode?: string;
    planCode: string;
    weight: number;
    maxUsers: number;
    status: ToporBalancerNodeStatus;
    priority: number;
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
    squadScope: ToporBalancerGroupSquadScope;
    internalSquadUuid?: string;
    unavailablePolicy?: ToporBalancerUnavailablePolicy;
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

export interface ToporBalancerAssignmentActionSummary {
    removed: number;
    reassigned: number;
    skipped: number;
    errors: Array<{
        reason: string;
        shortUuid?: string;
    }>;
}

export interface ToporBalancerAdminNode extends ToporBalancerDbNode {
    assignedUsers: number;
}

export interface ToporRemnawaveTopologyHost {
    uuid: string;
    remark: string;
    address?: string;
    flow?: string;
    inboundUuid?: string;
    lastSeenAt?: string;
    nodeUuid?: string;
    nodeName?: string;
    port?: number;
    protocol?: 'vless';
    profileUuid?: string;
    profileName?: string;
    security?: string;
    sni?: string;
    transport?: string;
    inboundName?: string;
    accessibleSquads: Array<{
        uuid: string;
        name: string;
    }>;
    updatedAt?: string;
}

export interface ToporRemnawaveTopologyNode {
    uuid: string;
    name: string;
    address?: string;
    status?: string;
    updatedAt?: string;
}

export interface ToporRemnawaveTopologyInbound {
    uuid: string;
    name: string;
    profileUuid?: string;
    profileName?: string;
    updatedAt?: string;
}

export interface ToporRemnawaveTopologySquad {
    uuid: string;
    name: string;
    updatedAt?: string;
}

export interface ToporRemnawaveTopologySnapshot {
    hosts: ToporRemnawaveTopologyHost[];
    nodes: ToporRemnawaveTopologyNode[];
    inbounds: ToporRemnawaveTopologyInbound[];
    squads: ToporRemnawaveTopologySquad[];
    warnings: string[];
    refreshedAt?: string;
}

export interface ToporBalancerAdminGroup extends ToporBalancerDbGroup {
    activeNodesCount: number;
    assignedUsers: number;
    nodesCount: number;
    nodesCountSource?: 'db_group_id';
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
    groupCandidateDiagnostics?: NonNullable<ToporBalancerDebugInfo['groupCandidateDiagnostics']>;
    matchedTechnicalLinks?: number;
    rewrittenLinksCount?: number;
    selectedNodes?: Record<string, string>;
    createdAt?: string;
    warnings?: string[];
}

export type ToporBalancerRuntimeDiagnosticsStatus =
    | 'failed_open'
    | 'no_active_candidates'
    | 'no_effective_candidates'
    | 'partially_processed'
    | 'passed_through'
    | 'processed'
    | 'unsupported_app';

export interface ToporBalancerGroupRecentDiagnostic {
    time?: string;
    shortUuid: string;
    userAgent?: string;
    totalLinks?: number;
    matchedLinks?: number;
    rewrittenLinks?: number;
    selectedNode?: string;
    status?: ToporBalancerRuntimeDiagnosticsStatus | string;
    warnings: string[];
    groupDiagnostic?: NonNullable<ToporBalancerDebugInfo['groupCandidateDiagnostics']>[number];
}

export interface ToporBalancerSubscriptionRequestTrace {
    timestamp: string;
    shortUuid: string;
    requestPath?: string;
    queryString?: string;
    method?: string;
    host?: string;
    userAgent?: string;
    accept?: string;
    acceptLanguage?: string;
    secFetchMode?: string;
    xForwardedProto?: string;
    xForwardedHost?: string;
    xRealIp?: string;
    clientIp?: string;
    flow: 'browser' | 'raw';
    returnWebpageUsed: boolean;
    rawSubscriptionUsed: boolean;
}

export interface ToporBalancerSubscriptionUpstreamTrace {
    endpointType: 'getSubpageConfig' | 'getSubscription' | 'getSubscriptionInfo' | 'originalSubscription';
    outgoingUserAgent?: string;
    contentType?: string;
    bodyLength: number;
    detectedFormat: SubscriptionFormat;
    vlessLinksCount: number;
    firstRemarks: string[];
    unsupportedAppFallback: boolean;
}

export interface ToporBalancerSubscriptionBalancerTrace {
    inputLinksCount: number;
    matchedTechnicalLinks: number;
    unmatchedRemarks: string[];
    selectedNodes: Record<string, string>;
    rewrittenLinksCount: number;
    outputLinksCount: number;
    outputBodyLength: number;
    finalContentType?: string;
    status: ToporBalancerSubscriptionDiagnosticsStatus;
    unsupportedAppFallback: boolean;
}

export interface ToporBalancerRecentSubscriptionTrace {
    id: string;
    request: ToporBalancerSubscriptionRequestTrace;
    upstream: ToporBalancerSubscriptionUpstreamTrace;
    balancer: ToporBalancerSubscriptionBalancerTrace;
}

export interface ToporBalancerTraceSubscriptionResult {
    upstream: ToporBalancerSubscriptionUpstreamTrace;
    balancer: ToporBalancerSubscriptionBalancerTrace;
    output: {
        contentType?: string;
        bodyLength: number;
        detectedFormat: SubscriptionFormat;
        vlessLinksCount: number;
        firstRemarks: string[];
        unsupportedAppFallback: boolean;
    };
    comparison?: {
        original?: ToporBalancerSubscriptionUpstreamTrace;
        balancerOutputVlessLinksCount: number;
        originalVlessLinksCount?: number;
        unsupportedAppFallbackDiffers?: boolean;
    };
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
    currentTechnicalHostName?: string;
    identityKey?: string;
    identityKeyMasked?: string;
    identityStatus?: 'stable' | 'fallback_by_name' | 'unknown';
    previousTechnicalHostName?: string;
    technicalHostName: string;
    protocol?: 'vless';
    host?: string;
    port?: number;
    security?: string;
    type?: string;
    sni?: string;
    flow?: string;
    lastSeenAt?: string;
    pbk?: string;
    sid?: string;
    rawRemark?: string;
    remnawaveHostName?: string;
    remnawaveHostUuid?: string;
    remnawaveConfigProfileUuid?: string;
    remnawaveInboundUuid?: string;
    remnawaveNodeName?: string;
    remnawaveNodeUuid?: string;
    remnawaveInboundName?: string;
    remnawaveProfileName?: string;
    accessibleSquads?: Array<{
        uuid: string;
        name: string;
    }>;
    squadStatus?: 'accessible' | 'not_accessible_to_selected_squad' | 'unknown';
    alreadyImported: boolean;
    matchedGroupId?: string;
    matchedGroupPublicHostCode?: string;
    matchedGroupPlanCode?: string;
    matchedNodeId: string | null;
}

export type ToporBalancerGroupDiscoveryItemStatus =
    | 'conflict'
    | 'free'
    | 'in_other_group'
    | 'in_this_group'
    | 'not_accessible_to_selected_squad';

export interface ToporBalancerGroupDiscoveryItem extends ToporBalancerDiscoveredHost {
    canAdd: boolean;
    currentGroupId: null | string;
    currentGroupName: null | string;
    membershipStatus: ToporBalancerGroupDiscoveryItemStatus;
    status: ToporBalancerGroupDiscoveryItemStatus;
}

export interface ToporBalancerGroupDiscoveryResponse {
    group: {
        id: string;
        planCode: string;
        publicHostCode: string;
        publicName: string;
    };
    items: ToporBalancerGroupDiscoveryItem[];
    message?: string;
    cacheStale?: boolean;
    refreshedAt?: string;
    shortUuid?: string;
    source: 'remnawave-api' | 'subscription';
}

export interface ToporBalancerDiscoveryResponse {
    source: 'remnawave-api' | 'subscription';
    cacheStale?: boolean;
    refreshedAt?: string;
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
        squadScope?: ToporBalancerGroupSquadScope;
        internalSquadUuid?: string;
    };
    publicHostCode?: string;
    publicName?: string;
    locationCode?: string;
    planCode?: string;
    squadScope?: ToporBalancerGroupSquadScope;
    internalSquadUuid?: string;
    nodes: Array<{
        technicalHostName: string;
        weight: number;
        maxUsers: number;
        status: ToporBalancerNodeStatus;
        priority?: number;
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

export interface ToporBalancerGroupNodeImportResult {
    alreadyInGroup: Array<{
        nodeId?: string;
        technicalHostName: string;
    }>;
    created: ToporBalancerAdminNode[];
    errors: Array<{
        reason: string;
        technicalHostName?: string;
    }>;
    inOtherGroup: Array<{
        currentGroupId?: string;
        currentGroupName?: string;
        technicalHostName: string;
    }>;
}
